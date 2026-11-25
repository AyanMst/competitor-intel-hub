"""Async Job Queue: background worker that drains `analysis_jobs`.

Tied into the same in-process APScheduler instance as the channel
monitor (see api.py's startup hook), so it starts automatically the moment
uvicorn boots — no separate process to run. Each poll cycle picks up to
`max_concurrent_jobs` pending jobs and runs them concurrently in a thread
pool (each job is network-bound — YouTube/Whisper/OpenAI calls — not
CPU-bound, so threads are sufficient without needing a process pool),
advancing every job's `status`/`current_step` as it progresses so the UI can
eventually show real progress instead of a single opaque spinner.
"""

from __future__ import annotations

import os
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import sentry_sdk
import structlog

from src.services.analysis_service import process_uploaded_video, process_youtube_url
from src.storage.jobs_repository import (
    claim_pending_jobs,
    finalize_job_status,
    requeue_orphan_jobs,
    update_job_status,
)

# Error monitoring.
# SENTRY_DSN defaults to None (unset) so this is a no-op locally/in dev
# instead of crashing when the env var isn't configured. Initialized here too
# (not just api.py) so job_worker.py still reports errors if it is ever run
# as its own standalone process instead of in-process via api.py's scheduler.
sentry_sdk.init(dsn=os.getenv("SENTRY_DSN"))

logger = structlog.get_logger(__name__)


def poll_jobs(max_concurrent_jobs: int = 3) -> dict[str, Any]:
    """Run one worker cycle: pick up to `max_concurrent_jobs` pending jobs and process them.

    Returns a small summary dict (jobs picked up / their outcomes), mirroring
    `channel_monitor.poll_channels`, so this can be inspected/tested the
    same way if a manual trigger endpoint is added later (like
    `/channels/poll-now`).
    """
    # Worker Concurrency: claims jobs
    # atomically via the `claim_pending_jobs` RPC (FOR UPDATE SKIP LOCKED,
    # see schema_worker_lock.sql) instead of a plain SELECT, so this stays
    # safe the moment job_worker.py ever runs as more than one instance.
    jobs = claim_pending_jobs(batch_size=max_concurrent_jobs)
    if not jobs:
        return {"jobs_picked_up": 0, "results": []}

    logger.info("job_poll_started", job_count=len(jobs))
    with ThreadPoolExecutor(max_workers=max_concurrent_jobs) as executor:
        results = list(executor.map(_run_job, jobs))
    logger.info("job_poll_finished", job_count=len(jobs))

    return {"jobs_picked_up": len(jobs), "results": results}


def reap_orphan_jobs(timeout_minutes: int = 15) -> dict[str, Any]:
    """Run one reaper cycle: requeue/fail jobs orphaned by a crashed worker.

    Orphan Job Recovery: scheduled independently of
    (and far less often than) `poll_jobs` — see api.py's startup hook.
    Delegates to `requeue_orphan_jobs`, which atomically finds every
    'transcribing'/'analyzing' row whose `claimed_at` is older than
    `timeout_minutes` and either bounces it back to 'pending' for the next
    `poll_jobs` cycle to pick up, or marks it 'failed' for good once
    attempt_count has exhausted max_retries.
    """
    jobs = requeue_orphan_jobs(timeout_minutes=timeout_minutes)
    if not jobs:
        return {"orphans_found": 0, "requeued": 0, "failed": 0}

    requeued = sum(1 for j in jobs if j["status"] == "pending")
    failed = sum(1 for j in jobs if j["status"] == "failed")
    logger.warning("orphan_reap_cycle", orphans_found=len(jobs), requeued=requeued, failed=failed)
    return {"orphans_found": len(jobs), "requeued": requeued, "failed": failed}


def _run_job(job: dict[str, Any]) -> dict[str, Any]:
    """Run a single job end-to-end and record its outcome on the `analysis_jobs` row.

    Success: status='completed' + result_report_id set to the saved report.
    Unrecoverable failure: status='failed' + error_message set to the full
    exception traceback (not just str(e)) so there's enough to debug from
    the DB alone.

    Zombie-Write Race fix: both terminal writes go through
    `finalize_job_status`, fenced by `expected_claimed_at` captured here at
    the top — the exact `claimed_at` this worker was handed when it claimed
    the row. If the Orphan Reaper decides mid-run that this job looked
    crashed and hands it to a second worker, that fence goes stale and our
    eventual finalize becomes a safe no-op instead of clobbering the second
    worker's result.
    """
    job_id = job["id"]
    source_type = job["source_type"]
    # Data Isolation: the worker runs as service_role (bypasses
    # RLS), so it must explicitly stamp every row this job produces with the
    # SAME user_id the job itself was enqueued under (api.py's
    # create_or_get_job) — never trust anything else as the owner.
    user_id = job["user_id"]
    expected_claimed_at = job.get("claimed_at")

    def _on_progress(status: str, step: str) -> None:
        update_job_status(job_id, status=status, current_step=step)

    try:
        if not user_id:
            # Defensive: analysis_jobs.user_id is nullable at the DB level
            # only for pre-auth legacy rows (schema_jobs.sql). Every job
            # created by today's api.py (require_auth on both endpoints)
            # always has one — refuse to silently process an unowned job
            # rather than risk writing orphaned/unscoped report data.
            raise ValueError(f"analysis_jobs.id={job_id} has no user_id; refusing to process.")

        if source_type == "youtube":
            result = process_youtube_url(
                job["source_ref"], job["competitor_name"], user_id=user_id, on_progress=_on_progress
            )
        elif source_type == "upload":
            result = process_uploaded_video(
                job["source_ref"],
                job["competitor_name"],
                user_id=user_id,
                original_filename=job.get("original_filename"),
                on_progress=_on_progress,
            )
        else:
            raise ValueError(f"Unknown analysis_jobs.source_type: {source_type!r}")

        final = finalize_job_status(
            job_id,
            status="completed",
            expected_claimed_at=expected_claimed_at,
            current_step="Done",
            result_report_id=result.get("id"),
        )
        if final is None:
            # Zombie write prevented: the report itself was already saved
            # by process_youtube_url/process_uploaded_video (a real,
            # billed Whisper+LLM run happened) — it just never gets linked
            # from this job row, because a second worker has since claimed
            # and (presumably) completed it. Logged loudly since an
            # unlinked report is exactly the kind of thing worth noticing,
            # even though it's not a correctness bug for the job row itself.
            logger.warning(
                "job_completed_but_zombie_write_prevented",
                job_id=job_id,
                orphaned_report_id=result.get("id"),
            )
            return {"job_id": job_id, "status": "zombie_write_prevented", "report_id": result.get("id")}
        logger.info("job_completed", job_id=job_id, report_id=result.get("id"))
        return {"job_id": job_id, "status": "completed", "report_id": result.get("id")}

    except Exception as e:
        error_detail = traceback.format_exc()
        logger.error("job_failed", job_id=job_id, error=str(e))
        final = finalize_job_status(
            job_id,
            status="failed",
            expected_claimed_at=expected_claimed_at,
            current_step="Failed",
            error_message=error_detail,
        )
        if final is None:
            logger.warning("job_failed_but_zombie_write_prevented", job_id=job_id)
            return {"job_id": job_id, "status": "zombie_write_prevented", "error": str(e)}
        return {"job_id": job_id, "status": "failed", "error": str(e)}

    finally:
        # The persisted upload only ever needed to survive long enough for
        # this worker to read it (see api.py's `_persist_pending_upload`);
        # clean it up now regardless of outcome so pending_uploads/ doesn't
        # grow unbounded, success or failure.
        if source_type == "upload":
            _cleanup_pending_upload(job["source_ref"])


def _cleanup_pending_upload(upload_path: str) -> None:
    """Best-effort delete of a persisted mp4 once its job has finished."""
    try:
        if os.path.exists(upload_path):
            os.remove(upload_path)
    except OSError as e:
        logger.error("pending_upload_cleanup_failed", upload_path=upload_path, error=str(e))
