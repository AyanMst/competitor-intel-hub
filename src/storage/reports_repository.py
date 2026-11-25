"""Supabase-backed persistence for generated battlecard reports.

Isolates all database access behind a small repository API so ``api.py``
never talks to Supabase directly, mirroring the existing scrapers/analysers/
generators split. Uses the service-role key (backend-only secret, never sent
to the frontend) so it can read/write regardless of RLS policies.

Expects a ``reports`` table (see project README / handoff notes for the
one-time SQL migration) with columns:
    id (uuid, pk), filename (text), created_at (timestamptz),
    raw_transcript (text),
    new_features / pricing_changes / marketing_message / objections_or_risks
        (jsonb, each an array of ``{"text": str, "timestamp": float | null}`` claims),
    competitor_id (uuid, fk -> competitors.id, nullable),
    changes_summary (jsonb, nullable),
    raw_segments (jsonb, nullable — Whisper ``{"start": float, "text": str}`` segments,
        only populated for mp4-upload-sourced reports)
"""

from __future__ import annotations

import os
from typing import Any

import structlog
from supabase import Client, create_client

logger = structlog.get_logger(__name__)

_TABLE = "reports"
_client: Client | None = None


def get_client() -> Client:
    """Lazily create and cache the Supabase client from env vars."""
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env "
                "to use the reports persistence layer."
            )
        _client = create_client(url, key)
    return _client


def save_report(
    filename: str,
    raw_transcript: str,
    report: dict[str, Any],
    user_id: str,
    competitor_id: str | None = None,
    changes_summary: dict[str, Any] | None = None,
    raw_segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Insert one consolidated 4-pillar report and return the saved row.

    `user_id` is required (Data Isolation — see
    schema_rls_isolation.sql): every report row must be stamped with its
    owning tenant at write time, since the service_role connection this
    module uses bypasses RLS and cannot rely on it to fill this in.
    """
    client = get_client()
    row = {
        "filename": filename,
        "raw_transcript": raw_transcript,
        "new_features": report.get("new_features", []),
        "pricing_changes": report.get("pricing_changes", []),
        "marketing_message": report.get("marketing_message", []),
        "objections_or_risks": report.get("objections_or_risks", []),
        "competitor_id": competitor_id,
        "changes_summary": changes_summary,
        "raw_segments": raw_segments,
        "user_id": user_id,
    }
    result = client.table(_TABLE).insert(row).execute()
    logger.info("report_saved", filename=filename, user_id=user_id)
    return result.data[0]


def _flatten_competitor(row: dict[str, Any]) -> dict[str, Any]:
    """Replace the embedded `competitors: {name}` join with a flat `competitor_name`."""
    competitor = row.pop("competitors", None)
    row["competitor_name"] = competitor["name"] if competitor else None
    return row


def list_reports(user_id: str) -> list[dict[str, Any]]:
    """Return lightweight metadata (no transcript/pillars) for the reports list view.

    Scoped to `user_id` — without this filter,
    every tenant's reports were returned to every authenticated caller.
    """
    client = get_client()
    result = (
        client.table(_TABLE)
        .select("id, filename, created_at, competitor_id, competitors(name)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_flatten_competitor(row) for row in result.data]


def get_report(report_id: str, user_id: str) -> dict[str, Any] | None:
    """Return the full row (transcript + pillars) for a single saved report.

    Scoped to `user_id` so a caller who guesses/
    enumerates another tenant's report id gets the same "not found" result
    as a nonexistent id, instead of the other tenant's data.
    """
    client = get_client()
    result = (
        client.table(_TABLE)
        .select("*, competitors(name)")
        .eq("id", report_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return _flatten_competitor(result.data[0]) if result.data else None
