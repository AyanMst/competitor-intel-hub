"""Supabase-backed persistence for the async analysis job queue.

Async Job Queue. Backs the `analysis_jobs` table
(see schema_jobs.sql). `/analyze` and `/analyze-video` (api.py) now call
`create_or_get_job` to enqueue work instead of running Whisper/LLM calls
inline; a background worker will drain
`status = 'pending'` rows and call `update_job_status` as it progresses.

Dedup is enforced authoritatively at the DB layer via a partial unique index
on `(user_id, dedup_key) where status <> 'failed'` (see schema_jobs.sql), not
by this module's read-then-write check alone — `create_or_get_job` treats
that check purely as an optimization to avoid a round trip in the common
case, and falls back to re-reading the row on a unique-violation race.
"""

from __future__ import annotations

from typing import Any

import structlog
from postgrest.exceptions import APIError

from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

_TABLE = "analysis_jobs"
# Any status other than 'failed' holds the dedup slot (mirrors the partial
# unique index in schema_jobs.sql), so these are the statuses a lookup must
# treat as "already in flight or done — do not enqueue another one".
_ACTIVE_STATUSES = ("pending", "transcribing", "analyzing", "completed")
_UNIQUE_VIOLATION_CODE = "23505"


def find_active_job(dedup_key: str, user_id: str | None = None) -> dict[str, Any] | None:
    """Return the most recent non-failed job for this (user, dedup_key), or None."""
    client = get_client()
    query = (
        client.table(_TABLE)
        .select("*")
        .eq("dedup_key", dedup_key)
        .in_("status", _ACTIVE_STATUSES)
    )
    query = query.eq("user_id", user_id) if user_id else query.is_("user_id", "null")
    result = query.order("created_at", desc=True).limit(1).execute()
    return result.data[0] if result.data else None


def create_job(
    user_id: str | None,
    source_type: str,
    source_ref: str,
    competitor_name: str,
    dedup_key: str,
    original_filename: str | None = None,
) -> dict[str, Any]:
    """Insert a new pending job. Raises `APIError` (code 23505) on a dedup race."""
    client = get_client()
    row = {
        "user_id": user_id,
        "source_type": source_type,
        "source_ref": source_ref,
        "competitor_name": competitor_name,
        "dedup_key": dedup_key,
        "original_filename": original_filename,
        "status": "pending",
        "current_step": "queued",
    }
    result = client.table(_TABLE).insert(row).execute()
    logger.info("analysis_job_created", dedup_key=dedup_key, source_type=source_type)
    return result.data[0]


def create_or_get_job(
    user_id: str | None,
    source_type: str,
    source_ref: str,
    competitor_name: str,
    dedup_key: str,
    original_filename: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Return (job, created) — the single entry point the API endpoints should use.

    Reuses an existing in-flight/completed job for this dedup_key instead of
    enqueueing a duplicate. If two identical requests race past the initial
    lookup at the same time, the DB's partial unique index lets only one
    INSERT succeed; the loser catches the unique-violation here and re-reads
    the winner's row instead of erroring out to the caller.
    """
    existing = find_active_job(dedup_key, user_id=user_id)
    if existing:
        return existing, False

    try:
        return create_job(user_id, source_type, source_ref, competitor_name, dedup_key, original_filename), True
    except APIError as e:
        if e.code != _UNIQUE_VIOLATION_CODE:
            raise
        logger.info("analysis_job_dedup_race_resolved", dedup_key=dedup_key)
        winner = find_active_job(dedup_key, user_id=user_id)
        if winner is not None:
            return winner, False
        # The row that won the race must have already been marked 'failed'
        # (freeing the slot) between our failed insert and this re-read.
        # Safe to retry once — this call cannot fail for the same reason again.
        return create_job(user_id, source_type, source_ref, competitor_name, dedup_key, original_filename), True


def get_job(job_id: str) -> dict[str, Any] | None:
    """Return one job row by id, or None if it doesn't exist."""
    client = get_client()
    result = client.table(_TABLE).select("*").eq("id", job_id).limit(1).execute()
    return result.data[0] if result.data else None


def claim_pending_jobs(batch_size: int = 3) -> list[dict[str, Any]]:
    """Atomically claim up to `batch_size` pending jobs, oldest first (FIFO).

    Worker Concurrency:
    replaces the old `list_pending_jobs` plain SELECT, which let two
    concurrent `job_worker.py` instances (or an overlapping restart) both
    pick up the same 'pending' row and double-run — and double-bill — the
    same job. Delegates to the `claim_pending_jobs` RPC (see
    schema_worker_lock.sql), which uses `FOR UPDATE SKIP LOCKED` inside a
    single atomic UPDATE so each row is claimed by exactly one caller, ever.
    """
    client = get_client()
    result = client.rpc("claim_pending_jobs", {"batch_size": batch_size}).execute()
    return result.data or []


def requeue_orphan_jobs(timeout_minutes: int = 15) -> list[dict[str, Any]]:
    """Reap jobs stuck in 'transcribing'/'analyzing' since a worker crashed mid-job.

    Orphan Job Recovery: `claim_pending_jobs` only ever
    looks at status = 'pending', so a job left mid-flight by a killed/crashed
    worker is invisible to every future poll cycle and would otherwise hang
    forever with no path back to 'pending'. Delegates to the
    `requeue_orphan_jobs` RPC (see schema_orphan_recovery.sql), which
    atomically (via `FOR UPDATE SKIP LOCKED`, same pattern as
    `claim_pending_jobs`) finds every processing row whose `claimed_at` is
    older than `timeout_minutes` and either:
      - bounces it back to 'pending' (attempt_count still < max_retries) so
        the next `claim_pending_jobs` cycle picks it back up, or
      - marks it 'failed' for good (attempt_count >= max_retries), with
        error_message explaining it was orphaned rather than a normal
        pipeline failure.

    Intended to be run on its own schedule (see job_worker.py), independent
    of and much less frequent than the main claim/poll cycle.
    """
    client = get_client()
    result = client.rpc("requeue_orphan_jobs", {"timeout_minutes": timeout_minutes}).execute()
    jobs = result.data or []
    if jobs:
        requeued = [j["id"] for j in jobs if j["status"] == "pending"]
        failed = [j["id"] for j in jobs if j["status"] == "failed"]
        logger.info(
            "orphan_jobs_reaped",
            requeued_count=len(requeued),
            failed_count=len(failed),
            requeued_job_ids=requeued,
            failed_job_ids=failed,
        )
    return jobs


def update_job_status(
    job_id: str,
    status: str,
    current_step: str | None = None,
    error_message: str | None = None,
    result_report_id: str | None = None,
) -> dict[str, Any]:
    """Advance a job's status. Intended for the background worker.

    Unguarded, best-effort progress ticks only (see job_worker._on_progress)
    — a stray/late write here just flickers `current_step` cosmetically at
    worst. The one write that actually decides which worker's output "wins"
    is the terminal 'completed'/'failed' transition, which MUST go through
    `finalize_job_status` instead, never this function.
    """
    client = get_client()
    row: dict[str, Any] = {"status": status}
    if current_step is not None:
        row["current_step"] = current_step
    if error_message is not None:
        row["error_message"] = error_message
    if result_report_id is not None:
        row["result_report_id"] = result_report_id

    result = client.table(_TABLE).update(row).eq("id", job_id).execute()
    logger.info("analysis_job_status_updated", job_id=job_id, status=status)
    return result.data[0] if result.data else {}


def finalize_job_status(
    job_id: str,
    status: str,
    expected_claimed_at: str | None,
    current_step: str | None = None,
    error_message: str | None = None,
    result_report_id: str | None = None,
) -> dict[str, Any] | None:
    """Terminal ('completed'/'failed') write, Compare-and-Swap-guarded on `claimed_at`.

    Zombie-Write Race fix: a job's
    `claimed_at` (see schema_orphan_recovery.sql) only ever changes when
    `claim_pending_jobs` or `requeue_orphan_jobs` touches the row again.
    That makes it a correct fencing token for "am I still the worker this
    row belongs to?" — a worker that ran long enough for the Orphan Reaper
    to decide it looked crashed is no longer the sole owner of this row by
    the time it actually finishes: the reaper has since either requeued it
    (claimed_at reset to NULL, then re-claimed by a second worker under a
    NEW claimed_at) or, if retries were exhausted, left claimed_at
    untouched and just marked it 'failed' directly.

    Scoping the UPDATE to `WHERE id = job_id AND claimed_at =
    expected_claimed_at` means: if a second worker has since claimed this
    row, the WHERE no longer matches anything, and this "zombie" worker's
    final write becomes a safe no-op instead of silently overwriting
    whatever status/result_report_id the row's new, legitimate owner has
    since written (or is still in the middle of writing) — a split-brain
    where two workers' outputs race for the same row and either one can
    silently clobber the other.

    Returns the updated row on success, or `None` if the CAS matched zero
    rows — the caller (job_worker._run_job) must treat that as "abort,
    another worker owns this job now", not as an error to retry or surface.
    """
    client = get_client()
    row: dict[str, Any] = {"status": status}
    if current_step is not None:
        row["current_step"] = current_step
    if error_message is not None:
        row["error_message"] = error_message
    if result_report_id is not None:
        row["result_report_id"] = result_report_id

    query = client.table(_TABLE).update(row).eq("id", job_id)
    if expected_claimed_at is not None:
        query = query.eq("claimed_at", expected_claimed_at)
    else:
        # Defensive fallback only — claim_pending_jobs always stamps
        # claimed_at now, so a claimed job should never reach here without
        # one. Still allow the write through rather than hard-failing a
        # real job outcome over a value that should never actually be None.
        logger.warning("finalize_job_status_missing_claimed_at", job_id=job_id, status=status)
    result = query.execute()

    if not result.data:
        logger.warning(
            "zombie_write_prevented",
            job_id=job_id,
            attempted_status=status,
            expected_claimed_at=expected_claimed_at,
        )
        return None

    logger.info("analysis_job_status_updated", job_id=job_id, status=status)
    return result.data[0]


def list_jobs_for_user(user_id: str) -> list[dict[str, Any]]:
    """Read-only listing of this user's `analysis_jobs` rows.

    Used by account-deletion Phase 1 to find local upload paths to unlink
    from disk. This function MUST NOT grow a delete/update path — the only
    code allowed to DELETE from `analysis_jobs` is
    `scripts/purge_deleted_account.py`, and only after an explicit
    `--confirm-delete-analysis-jobs` flag (see that script's REVIEW banner).
    """
    client = get_client()
    result = client.table(_TABLE).select("*").eq("user_id", user_id).execute()
    return result.data or []


def count_other_users_with_source_ref(source_ref: str, user_id: str) -> int:
    """How many jobs owned by someone other than `user_id` share this source_ref.

    Upload files are keyed by content hash, so two tenants can point at the
    same pending_uploads path. Phase 1 file cleanup uses this to refuse
    unlinking a file another tenant still needs.
    """
    client = get_client()
    result = (
        client.table(_TABLE)
        .select("id", count="exact")
        .eq("source_ref", source_ref)
        .neq("user_id", user_id)
        .execute()
    )
    # If PostgREST didn't return a count, treat the file as shared rather
    # than unlinking a path another tenant might still need.
    if result.count is None:
        return 1
    return result.count
