"""Scheduled Channel Monitoring.

Periodically polls each active `tracked_channels` row for new uploads via
`YouTubeScraper.list_recent_video_urls` (yt-dlp flat-playlist, no download),
and runs any video not yet present in `processed_videos` through
`analysis_service.process_youtube_url` — the same pipeline the async job
worker uses for manually-submitted YouTube URLs —
completely unattended.

Idempotency: `processed_videos.video_id` is unique and checked before every
run, so a video is never analyzed twice — even across restarts or overlapping
poll cycles. A short sleep between videos/channels keeps yt-dlp/Whisper/LLM
calls within reasonable rate limits.
"""

from __future__ import annotations

import time

import structlog

from src.scrapers.youtube_scraper import YouTubeScraper
from src.services.analysis_service import process_youtube_url
from src.storage.channels_repository import (
    is_video_processed,
    list_active_channels,
    mark_video_processed,
    update_last_checked,
)

logger = structlog.get_logger(__name__)

_SECONDS_BETWEEN_VIDEOS = 5    # stagger between videos to respect Whisper/LLM/yt-dlp rate limits
_SECONDS_BETWEEN_CHANNELS = 2


def poll_channels(videos_per_channel: int = 5, user_id: str | None = None) -> dict:
    """Run one monitoring cycle across active tracked channels.

    `user_id=None` (the default, used by the scheduled background job in
    api.py's startup hook) polls every tenant's channels in one cycle — this
    is intentional, not a data-isolation gap: the scheduler must service
    every tenant, and each channel/video/report it touches is individually
    stamped with its own owning `tracked_channels.user_id` (see
    `_poll_one_channel`/`_process_and_record` below), never mixed across
    tenants. Pass `user_id` to scope a single cycle to one tenant's channels
    only (used by the `/channels/poll-now` manual-trigger endpoint, so an
    authenticated user can only make on-demand test runs cost/process their
    own channels, not every tenant's).

    Returns a small summary dict (channels checked / new videos found+processed)
    so both the background job and the manual `/channels/poll-now` test
    endpoint can report results.
    """
    channels = list_active_channels(user_id=user_id)
    logger.info("channel_poll_started", channel_count=len(channels))

    scraper = YouTubeScraper()
    processed: list[dict] = []

    for channel in channels:
        processed.extend(_poll_one_channel(scraper, channel, videos_per_channel))
        time.sleep(_SECONDS_BETWEEN_CHANNELS)

    logger.info("channel_poll_finished", videos_processed=len(processed))
    return {"channels_checked": len(channels), "videos_processed": processed}


def _poll_one_channel(scraper: YouTubeScraper, channel: dict, videos_per_channel: int) -> list[dict]:
    channel_id = channel["id"]
    channel_url = channel["channel_url"]
    competitor_name = channel.get("competitor_name") or channel.get("channel_name") or channel_url
    # Data Isolation: this scheduler runs as service_role across
    # EVERY tenant's channels in one cycle (see poll_channels), so it must
    # read the owning tenant off each `tracked_channels` row individually
    # and stamp every video/report/embedding it produces with that same id.
    user_id = channel.get("user_id")

    results: list[dict] = []
    if not user_id:
        # Defensive: tracked_channels.user_id is nullable at the DB level
        # only for pre-auth legacy rows. Skip rather than risk writing
        # orphaned/unscoped report data for an unowned channel.
        logger.error("channel_missing_user_id", channel_url=channel_url, channel_id=channel_id)
        return results

    try:
        videos = scraper.list_recent_video_urls(channel_url, limit=videos_per_channel)
    except Exception as e:
        logger.error("channel_list_videos_failed", channel_url=channel_url, error=str(e))
        return results

    for video in videos:
        video_id = video["video_id"]
        video_url = video["url"]

        if is_video_processed(video_id, tracked_channel_id=channel_id):
            continue

        logger.info("channel_new_video_found", channel_url=channel_url, video_id=video_id)
        outcome = _process_and_record(channel_id, competitor_name, video_id, video_url, user_id=user_id)
        results.append(outcome)
        time.sleep(_SECONDS_BETWEEN_VIDEOS)

    update_last_checked(channel_id)
    return results


def _process_and_record(
    channel_id: str, competitor_name: str, video_id: str, video_url: str, user_id: str
) -> dict:
    try:
        result = process_youtube_url(video_url, competitor_name, user_id=user_id)
        mark_video_processed(
            video_id=video_id,
            tracked_channel_id=channel_id,
            video_url=video_url,
            user_id=user_id,
            report_id=result.get("id"),
            status="success",
        )
        logger.info("channel_video_processed", video_id=video_id, report_id=result.get("id"))
        return {"video_id": video_id, "status": "success", "report_id": result.get("id")}
    except Exception as e:
        mark_video_processed(
            video_id=video_id,
            tracked_channel_id=channel_id,
            video_url=video_url,
            user_id=user_id,
            report_id=None,
            status="failed",
            error_message=str(e),
        )
        logger.error("channel_video_processing_failed", video_id=video_id, error=str(e))
        return {"video_id": video_id, "status": "failed", "error": str(e)}
