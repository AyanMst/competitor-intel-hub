"""Phase 1 of account deletion — revoke access, cancel entitlement, unlink uploads.

REVIEW / DATA-RETENTION DECISION
--------------------------------
Soft-delete first, hard-delete later:

  Phase 1 (this module, runs on POST /account/delete-request):
    - write an `account_deletion_requests` audit row
    - cancel the user's entitlement so they cannot generate new battlecards
    - ban the auth user and revoke sessions so they cannot sign back in
    - unlink this user's local pending-upload files from disk
    - does NOT delete, update, or otherwise mutate `analysis_jobs` rows

  Phase 2 (`scripts/purge_deleted_account.py`, human-operated):
    - the ONLY path that DELETEs `analysis_jobs` (and reports / auth user)
    - requires an explicit `--confirm-delete-analysis-jobs` flag
    - is not imported by this module, any router, cron, or webhook

Do not add an `analysis_jobs` DELETE (or a call to the purge script) here.
"""

from __future__ import annotations

import os

import structlog

from src.config import load_config
from src.storage.account_deletion_repository import create_request, get_latest_request
from src.storage.entitlements_repository import cancel_entitlement
from src.storage.jobs_repository import count_other_users_with_source_ref, list_jobs_for_user
from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

# ~100 years — Supabase treats this as a permanent ban without a separate
# "banned forever" flag. Phase 2 is what actually removes the auth row.
_BAN_DURATION = "876000h"


def _pending_uploads_dir() -> str:
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    relative = load_config().get("directories", {}).get("pending_uploads", "data/pending_uploads")
    return os.path.abspath(os.path.join(project_root, relative))


def _is_under_pending_uploads(path: str) -> bool:
    """Refuse to unlink anything that isn't inside directories.pending_uploads."""
    uploads_dir = _pending_uploads_dir()
    try:
        return os.path.commonpath([uploads_dir, os.path.abspath(path)]) == uploads_dir
    except ValueError:
        return False


def _unlink_user_uploads(user_id: str) -> int:
    """Best-effort unlink of this user's pending upload files. Read-only on analysis_jobs.

    Looks up `source_ref` values via `list_jobs_for_user` (SELECT only) and
    unlinks the file from disk. Skips a path if another tenant still has a
    job pointing at it (uploads are content-hash keyed and can be shared).
    Never issues a DELETE/UPDATE against `analysis_jobs`.
    """
    removed = 0
    jobs = list_jobs_for_user(user_id)
    seen_paths: set[str] = set()

    for job in jobs:
        if job.get("source_type") != "upload":
            continue
        source_ref = job.get("source_ref")
        if not source_ref or source_ref in seen_paths:
            continue
        seen_paths.add(source_ref)

        if not _is_under_pending_uploads(source_ref):
            logger.warning(
                "account_deletion_skipped_upload_outside_dir",
                user_id=user_id,
                source_ref=source_ref,
            )
            continue

        if count_other_users_with_source_ref(source_ref, user_id) > 0:
            logger.info(
                "account_deletion_skipped_shared_upload",
                user_id=user_id,
                source_ref=source_ref,
            )
            continue

        try:
            if os.path.exists(source_ref):
                os.remove(source_ref)
                removed += 1
        except OSError as e:
            logger.error(
                "account_deletion_upload_unlink_failed",
                user_id=user_id,
                source_ref=source_ref,
                error=str(e),
            )

    logger.info("account_deletion_uploads_unlinked", user_id=user_id, removed=removed)
    return removed


def _revoke_auth_access(user_id: str) -> None:
    """Ban the auth user and revoke outstanding sessions. Does not delete the row."""
    client = get_client()
    client.auth.admin.update_user_by_id(user_id, {"ban_duration": _BAN_DURATION})
    try:
        client.auth.admin.sign_out(user_id)
    except Exception as e:
        # Ban already prevents new sign-ins; a missing sign_out helper on an
        # older supabase-py is not a reason to abort Phase 1.
        logger.warning("account_deletion_sign_out_failed", user_id=user_id, error=str(e))


def request_account_deletion(user_id: str, user_email: str | None) -> dict:
    """Run Phase 1. Idempotent: a second call for the same user is a no-op on the audit row."""
    existing = get_latest_request(user_id)
    if existing is None:
        create_request(user_id, user_email)
    else:
        logger.info("account_deletion_already_requested", user_id=user_id)

    cancel_entitlement(user_id)
    _unlink_user_uploads(user_id)
    _revoke_auth_access(user_id)

    logger.info("account_deletion_phase1_complete", user_id=user_id)
    return {
        "status": "success",
        "message": (
            "Your account has been scheduled for deletion. "
            "You have been signed out and will not be able to sign back in."
        ),
    }
