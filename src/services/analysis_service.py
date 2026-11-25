"""Shared analysis pipeline: scrape/transcribe -> semantic LLM analysis -> aggregate -> persist -> notify.

Async Job Queue. Extracted out of `api.py` so this
logic has exactly one home instead of drifting into two near-duplicates: the
the channel-monitor scheduler (`src/scheduler/channel_monitor.py`) and the
new background worker (`src/workers/job_worker.py`) both call into this
module directly. This also removes the lazy `from api import
_process_youtube_url` `channel_monitor.py` previously needed specifically to
dodge a circular import (api.py -> channel_monitor.py -> api.py) — that
workaround no longer applies now that api.py doesn't own this logic.

`/analyze` and `/analyze-video` (api.py) do NOT call into this module: since
the async job queuethey only enqueue an `analysis_jobs` row and return
immediately. `job_worker.py` is what actually runs this pipeline for jobs
created by those two endpoints.
"""

from __future__ import annotations

import os
from typing import Callable

from src.agents.llm_agent import LLMAgent
from src.analysers.transcript_analyser import TranscriptAnalyser
from src.config import load_config
from src.notifiers.notification_service import notify_if_notable
from src.scrapers.video_transcriber import extract_audio, transcribe_audio
from src.scrapers.youtube_scraper import YouTubeScraper
from src.storage.competitors_repository import get_or_create_competitor, get_most_recent_report_for_competitor
from src.storage.embeddings_repository import save_report_embeddings
from src.storage.reports_repository import save_report

# Lets a caller (job_worker) record real status/current_step transitions on
# the owning `analysis_jobs` row as the pipeline advances, e.g.
# on_progress("transcribing", "Fetching transcript from YouTube"). The
# channel monitor doesn't pass one — `processed_videos` has
# no equivalent column, and that flow doesn't need mid-run progress.
ProgressCallback = Callable[[str, str], None]


def _notify_progress(on_progress: ProgressCallback | None, status: str, step: str) -> None:
    if on_progress:
        on_progress(status, step)


def run_semantic_analysis(raw_text: str, segments: list[dict] | None = None) -> list[dict]:
    """Shared pipeline stage: chunk a raw transcript and extract JSON insights via the LLM agent.

    Used by both the URL-based and the file-upload-based pipelines so the
    existing semantic extraction logic/prompts stay untouched and unduplicated.
    When `segments` (Whisper timestamps, mp4 upload only) are provided, chunks
    are built from them instead of the flat string so the LLM can cite a
    timestamp per claim; the YouTube flow never passes segments, so it keeps
    using the original flat-text chunking path unchanged.
    """
    analyser = TranscriptAnalyser()
    result = analyser.analyse_segments(segments) if segments else analyser.analyse(raw_text)

    agent = LLMAgent()
    extracted_battlecards = []
    for chunk in result['chunks']:
        data = agent.summarize_chunk(chunk['text'])
        extracted_battlecards.append(data)

    return extracted_battlecards


# Placeholder values the LLM agent emits on parse/API failures; excluded from
# aggregation so a failed chunk doesn't pollute the consolidated report with
# noise. Note this is distinct from `LLMAgent`'s `[INCOMPLETE - API ERROR]`
# marker, which is deliberately NOT in this set — that
# marker must survive dedup/aggregation and show up in the saved report.
_PLACEHOLDER_VALUES = {"data unreadable", "error calling ai", "none specified", ""}


def _dedupe_claims(chunks: list[dict], key: str) -> list[dict]:
    """Merge one pillar's claims across all chunks, deduping by claim text (case-insensitive)."""
    seen: set[str] = set()
    claims: list[dict] = []

    for chunk in chunks:
        for claim in chunk.get(key, []) or []:
            if not isinstance(claim, dict):
                continue
            text = str(claim.get("text") or "").strip()
            dedupe_key = text.lower()
            if not text or dedupe_key in _PLACEHOLDER_VALUES or dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            claims.append({"text": text, "timestamp": claim.get("timestamp")})

    return claims


def aggregate_battlecards(chunks: list[dict]) -> dict:
    """Merge per-chunk battlecard JSON into a single consolidated 4-pillar report.

    The strict B2B prompt runs once per transcript chunk, so raw output is a
    list of partial insights. The frontend needs exactly one report with the
    four fixed pillars (New Features, Pricing & Packaging, Marketing Message,
    Risks/Weaknesses); each pillar is a deduped array of `{text, timestamp}`
    claims (timestamp is null unless the chunk came from timestamped segments).
    """
    return {
        "new_features": _dedupe_claims(chunks, "new_features"),
        "pricing_changes": _dedupe_claims(chunks, "pricing_changes"),
        "marketing_message": _dedupe_claims(chunks, "marketing_message"),
        "objections_or_risks": _dedupe_claims(chunks, "objections_or_risks"),
    }


def save_report_safe(
    source: str,
    raw_text: str,
    report: dict,
    user_id: str,
    competitor_id: str | None = None,
    changes_summary: dict | None = None,
    raw_segments: list[dict] | None = None,
) -> dict | None:
    """Persist the report to Supabase without ever failing the pipeline.

    `user_id` is required — see
    `reports_repository.save_report`. Persistence is a nice-to-have on top
    of the existing analysis pipeline, not a hard dependency: if Supabase is
    unreachable/misconfigured, log it and still return the analysis to the
    caller (defensive programming). Returns the full saved row (not just the
    id) so callers can read back the DB-assigned `created_at` for
    embedding/search indexing.
    """
    try:
        return save_report(
            filename=source,
            raw_transcript=raw_text,
            report=report,
            user_id=user_id,
            competitor_id=competitor_id,
            changes_summary=changes_summary,
            raw_segments=raw_segments,
        )
    except Exception as e:
        print(f"[Storage Error] Failed to persist report: {str(e)}")
        return None


def resolve_competitor_and_changes(
    competitor_name: str, report: dict, user_id: str
) -> tuple[str | None, dict | None]:
    """Resolve the competitor by name and best-effort diff against their last report.

    `user_id` scopes both the competitor lookup and the "previous report"
    lookup so tenants never resolve onto, or diff
    against, another tenant's competitor/report data.

    Runs before the new report is saved. Never raises: if Supabase or the LLM
    diff call fails, returns (None, None) so the core scrape/transcribe ->
    analyze flow is unaffected, mirroring `save_report_safe`'s defensive style.
    """
    try:
        competitor = get_or_create_competitor(competitor_name, user_id=user_id)
        competitor_id = competitor["id"]
    except Exception as e:
        print(f"[Storage Error] Failed to resolve competitor '{competitor_name}': {str(e)}")
        return None, None

    changes_summary = None
    try:
        previous = get_most_recent_report_for_competitor(competitor_id, user_id=user_id)
        if previous:
            agent = LLMAgent()
            changes_summary = agent.compare_reports(
                previous={
                    "new_features": previous.get("new_features", []),
                    "pricing_changes": previous.get("pricing_changes"),
                    "marketing_message": previous.get("marketing_message"),
                    "objections_or_risks": previous.get("objections_or_risks"),
                },
                current=report,
            )
    except Exception as e:
        print(f"[Change Detection Error] {str(e)}")
        changes_summary = None

    return competitor_id, changes_summary


def process_youtube_url(
    video_url: str,
    competitor_name: str,
    user_id: str,
    on_progress: ProgressCallback | None = None,
) -> dict:
    """Core YouTube-URL pipeline: scrape -> semantic analysis -> aggregate -> save -> embed.

    Shared verbatim by the channel-monitoring scheduler and the
    async job worker — behavior is unchanged from the original
    inline implementation that used to live in `api.py` before the job queue,
    aside from `user_id`: required, and threaded
    into every downstream storage call so the resulting report/competitor/
    embedding rows are correctly attributed to their owning tenant. Callers
    are the only source of truth for this — job_worker.py reads it off the
    owning `analysis_jobs` row, channel_monitor.py reads it off the owning
    `tracked_channels` row.

    Raises `ValueError` on an unrecoverable extraction failure (previously an
    `HTTPException`, which no longer made sense once no HTTP endpoint called
    this function directly); callers are expected to catch and handle it.
    """
    print(f"Received extraction request for: {video_url}")
    _notify_progress(on_progress, "transcribing", "Fetching transcript from YouTube")

    scraper = YouTubeScraper()
    raw_text = scraper.fetch(video_url)
    if not raw_text:
        raise ValueError("Could not extract text from the provided video (Native CC and AI fallback failed).")

    _notify_progress(on_progress, "analyzing", "Extracting battlecard insights")
    extracted_battlecards = run_semantic_analysis(raw_text)
    report = aggregate_battlecards(extracted_battlecards)
    competitor_id, changes_summary = resolve_competitor_and_changes(competitor_name, report, user_id=user_id)
    saved_report = save_report_safe(
        source=video_url,
        raw_text=raw_text,
        report=report,
        user_id=user_id,
        competitor_id=competitor_id,
        changes_summary=changes_summary,
    )
    report_id = saved_report.get("id") if saved_report else None
    if saved_report:
        save_report_embeddings(
            report_id=saved_report["id"],
            report=report,
            user_id=user_id,
            competitor_id=competitor_id,
            report_created_at=saved_report.get("created_at"),
        )
    notify_if_notable(load_config(), competitor_name, changes_summary, report_id)

    print("Extraction complete. Returning clean JSON payload.")
    return {
        "status": "success",
        "id": report_id,
        "raw_transcript": raw_text,
        "raw_segments": None,
        "data": extracted_battlecards,
        "report": report,
        "competitor": competitor_name,
        "changes": changes_summary,
    }


def process_uploaded_video(
    file_path: str,
    competitor_name: str,
    user_id: str,
    original_filename: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> dict:
    """Core mp4-upload pipeline: extract audio -> Whisper -> semantic analysis -> aggregate -> save -> embed.

    Mirrors `process_youtube_url` for locally-uploaded videos (no built-in
    captions), including the required `user_id`.
    `file_path` is the durable on-disk path POST /analyze-video
    persisted the upload to (`api._persist_pending_upload`) before enqueueing
    the job — the caller (job_worker) owns deleting that file once this
    function returns or raises, not this function. `original_filename`
    (the `analysis_jobs.original_filename` the endpoint captured from the
    upload) is used as the saved report's `filename` when available, falling
    back to `file_path` so a saved report is never unlabeled.
    """
    print(f"Received video file for transcription: {file_path}")
    _notify_progress(on_progress, "transcribing", "Extracting and transcribing audio")

    audio_path = extract_audio(file_path)
    try:
        transcription = transcribe_audio(audio_path)
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)

    raw_text = transcription["text"]
    segments = transcription["segments"]
    if not raw_text:
        raise ValueError("Whisper transcription returned no text for the provided video.")

    _notify_progress(on_progress, "analyzing", "Extracting battlecard insights")
    extracted_battlecards = run_semantic_analysis(raw_text, segments=segments)
    report = aggregate_battlecards(extracted_battlecards)
    competitor_id, changes_summary = resolve_competitor_and_changes(competitor_name, report, user_id=user_id)
    saved_report = save_report_safe(
        source=original_filename or file_path,
        raw_text=raw_text,
        report=report,
        user_id=user_id,
        competitor_id=competitor_id,
        changes_summary=changes_summary,
        raw_segments=segments,
    )
    report_id = saved_report.get("id") if saved_report else None
    if saved_report:
        save_report_embeddings(
            report_id=saved_report["id"],
            report=report,
            user_id=user_id,
            competitor_id=competitor_id,
            report_created_at=saved_report.get("created_at"),
        )
    notify_if_notable(load_config(), competitor_name, changes_summary, report_id)

    print("Extraction complete. Returning clean JSON payload.")
    return {
        "status": "success",
        "id": report_id,
        "raw_transcript": raw_text,
        "raw_segments": segments,
        "data": extracted_battlecards,
        "report": report,
        "competitor": competitor_name,
        "changes": changes_summary,
    }
