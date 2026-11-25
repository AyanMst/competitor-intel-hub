"""Supabase-backed persistence for the account-deletion audit trail.

Backs `account_deletion_requests` (see schema_account_deletion.sql).
Phase 1 (the user-facing POST /account/delete-request) only INSERTs a
`status='requested'` row. Phase 2 (`scripts/purge_deleted_account.py`) is
the only caller of `mark_purged` — never imported by any request handler.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog

from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

_TABLE = "account_deletion_requests"


def get_latest_request(user_id: str) -> dict[str, Any] | None:
    """Return the most recent deletion request for this user, or None."""
    client = get_client()
    result = (
        client.table(_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("requested_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def create_request(user_id: str, user_email: str | None) -> dict[str, Any]:
    """Insert a Phase-1 audit row. Idempotent at the app layer: callers
    should check `get_latest_request` first and skip if one already exists.
    """
    client = get_client()
    result = (
        client.table(_TABLE)
        .insert({"user_id": user_id, "user_email": user_email, "status": "requested"})
        .execute()
    )
    logger.info("account_deletion_requested", user_id=user_id)
    return result.data[0]


def mark_purged(user_id: str) -> dict[str, Any] | None:
    """Flip the latest request to 'purged'. Phase 2 script only — do not
    call this from any FastAPI route.
    """
    client = get_client()
    now = datetime.now(timezone.utc).isoformat()
    result = (
        client.table(_TABLE)
        .update({"status": "purged", "purged_at": now})
        .eq("user_id", user_id)
        .eq("status", "requested")
        .execute()
    )
    logger.info("account_deletion_marked_purged", user_id=user_id)
    return result.data[0] if result.data else None
