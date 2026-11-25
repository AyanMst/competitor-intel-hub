"""Supabase-backed persistence for Scheduled Channel Monitoring.

Two tables (see src/storage/schema_channels.sql):
    tracked_channels  — YouTube channels the scheduler polls.
    processed_videos  — idempotency ledger; one row per video_id ever
                         attempted (success or failed), so a video is never
                         analyzed twice, even across restarts or overlapping
                         poll cycles.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog

from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

_CHANNELS_TABLE = "tracked_channels"
_PROCESSED_TABLE = "processed_videos"


def _flatten_competitor(row: dict[str, Any]) -> dict[str, Any]:
    competitor = row.pop("competitors", None)
    row["competitor_name"] = competitor["name"] if competitor else None
    return row


def add_channel(
    channel_url: str,
    user_id: str,
    channel_name: str | None = None,
    competitor_id: str | None = None,
) -> dict[str, Any]:
    """Start tracking a channel. Idempotent on `(user_id, channel_url)`.

    Scoped to `user_id` (Data Isolation — see
    schema_rls_isolation.sql, which also moves the DB-level uniqueness
    constraint from a global `channel_url` to `(user_id, channel_url)`).
    Previously the lookup/uniqueness was global, so the second tenant to
    track an already-tracked channel URL would silently be handed back (and
    start sharing) the FIRST tenant's row.
    """
    client = get_client()
    existing = (
        client.table(_CHANNELS_TABLE)
        .select("*")
        .eq("channel_url", channel_url)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]

    created = (
        client.table(_CHANNELS_TABLE)
        .insert({
            "channel_url": channel_url,
            "channel_name": channel_name,
            "competitor_id": competitor_id,
            "user_id": user_id,
        })
        .execute()
    )
    logger.info("channel_tracked", channel_url=channel_url, user_id=user_id)
    return created.data[0]


def list_active_channels(user_id: str | None = None) -> list[dict[str, Any]]:
    """Return channels currently flagged for polling, with competitor name joined in.

    `user_id=None` (the default) intentionally returns EVERY tenant's active
    channels — this is what the background scheduler (channel_monitor.py)
    needs, since it must service every tenant, not just one. Pass `user_id`
    explicitly when scoping to a single tenant (e.g. a user-triggered
    "poll now" test run).
    """
    client = get_client()
    query = client.table(_CHANNELS_TABLE).select("*, competitors(name)").eq("is_active", True)
    if user_id is not None:
        query = query.eq("user_id", user_id)
    result = query.execute()
    return [_flatten_competitor(row) for row in result.data]


def list_channels(user_id: str) -> list[dict[str, Any]]:
    """Return every tracked channel (active or not) for one tenant, most recently added first."""
    client = get_client()
    result = (
        client.table(_CHANNELS_TABLE)
        .select("*, competitors(name)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_flatten_competitor(row) for row in result.data]


def set_channel_active(channel_id: str, user_id: str, is_active: bool) -> dict[str, Any] | None:
    """Pause/resume polling for a channel without deleting its history.

    Scoped to `user_id` (Data Isolation — see
    schema_rls_isolation.sql) so a caller can only toggle their own
    channels. Returns the updated row, or None if no row matched both the
    id and the owner — callers (api.py) should treat that as a 404, not a
    silent no-op.
    """
    client = get_client()
    result = (
        client.table(_CHANNELS_TABLE)
        .update({"is_active": is_active})
        .eq("id", channel_id)
        .eq("user_id", user_id)
        .execute()
    )
    return result.data[0] if result.data else None


def delete_channel(channel_id: str, user_id: str) -> bool:
    """Stop tracking a channel entirely (its `processed_videos` history cascade-deletes with it).

    Scoped to `user_id`. Returns True if a row
    was deleted, False if no channel matched both the id and the owner —
    callers (api.py) should treat that as a 404, not a silent no-op.
    """
    client = get_client()
    result = client.table(_CHANNELS_TABLE).delete().eq("id", channel_id).eq("user_id", user_id).execute()
    return bool(result.data)


def update_last_checked(channel_id: str) -> None:
    client = get_client()
    client.table(_CHANNELS_TABLE).update(
        {"last_checked_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", channel_id).execute()


def is_video_processed(video_id: str, tracked_channel_id: str) -> bool:
    """True if this video_id has already been attempted on this specific tracked channel.

    Scoped to `tracked_channel_id`, not just `video_id` (Data Isolation
    see schema_rls_isolation.sql). The old global-on-`video_id`
    check meant once ANY tenant's channel processed a video, every OTHER
    tenant tracking that same public channel would have it silently skipped
    forever, and would never get their own report generated for it.
    """
    client = get_client()
    result = (
        client.table(_PROCESSED_TABLE)
        .select("id")
        .eq("video_id", video_id)
        .eq("tracked_channel_id", tracked_channel_id)
        .limit(1)
        .execute()
    )
    return bool(result.data)


def mark_video_processed(
    video_id: str,
    tracked_channel_id: str,
    video_url: str,
    user_id: str,
    report_id: str | None = None,
    status: str = "success",
    error_message: str | None = None,
) -> dict[str, Any]:
    """Record that `video_id` has been attempted on this tracked channel, enforcing idempotency going forward.

    Relies on the `processed_videos (tracked_channel_id, video_id)` unique
    index as the hard safety net for race conditions (e.g. overlapping poll
    cycles); this call is the normal-path write for every video the
    scheduler ever looks at. `user_id` is stamped from the owning
    `tracked_channels` row so this ledger is
    directly tenant-filterable/RLS-able without a join.
    """
    client = get_client()
    row = {
        "video_id": video_id,
        "tracked_channel_id": tracked_channel_id,
        "video_url": video_url,
        "report_id": report_id,
        "status": status,
        "error_message": error_message,
        "user_id": user_id,
    }
    result = client.table(_PROCESSED_TABLE).insert(row).execute()
    logger.info("video_marked_processed", video_id=video_id, status=status, user_id=user_id)
    return result.data[0]
