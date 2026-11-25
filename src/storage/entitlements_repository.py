"""Supabase-backed persistence for the paywall/entitlement gate.

Backs the `entitlements` table (see schema_entitlements.sql). One row per
user, created lazily on first need rather than at signup time, so this
module has exactly one entry point that ever creates a row:
`ensure_trial_entitlement`.

Isolates all database access the same way reports_repository.py /
jobs_repository.py do — `src/billing/dependencies.py` and
`src/billing/routes.py` never talk to Supabase directly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

_TABLE = "entitlements"
_UNIQUE_VIOLATION_CODE = "23505"


def get_entitlement(user_id: str) -> dict[str, Any] | None:
    """Return this user's entitlement row, or None if it doesn't exist yet."""
    client = get_client()
    result = client.table(_TABLE).select("*").eq("user_id", user_id).limit(1).execute()
    return result.data[0] if result.data else None


def ensure_trial_entitlement(user_id: str, trial_days: int) -> dict[str, Any]:
    """Return this user's entitlement row, creating a fresh trial row if none exists.

    The only path that ever inserts into `entitlements`. Racing concurrent
    requests for a brand-new user resolve the same way `create_or_get_job`
    does (jobs_repository.py): the loser of the insert race just re-reads
    the winner's row instead of erroring.
    """
    existing = get_entitlement(user_id)
    if existing:
        return existing

    client = get_client()
    trial_ends_at = (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat()
    row = {
        "user_id": user_id,
        "status": "trialing",
        "plan": "beta_trial",
        "trial_ends_at": trial_ends_at,
    }
    try:
        result = client.table(_TABLE).insert(row).execute()
        logger.info("entitlement_trial_started", user_id=user_id, trial_ends_at=trial_ends_at)
        return result.data[0]
    except Exception as e:
        # postgrest raises its own APIError subclass; duck-type on the
        # unique-violation code rather than importing it, since a bare
        # `unique(user_id)` violation is the only failure mode expected here.
        if getattr(e, "code", None) != _UNIQUE_VIOLATION_CODE:
            raise
        logger.info("entitlement_trial_race_resolved", user_id=user_id)
        winner = get_entitlement(user_id)
        if winner is not None:
            return winner
        raise


def is_entitled(entitlement: dict[str, Any]) -> bool:
    """Pure decision function: does this entitlement row currently unlock access?

    'active' always passes. 'trialing' passes only while trial_ends_at is
    still in the future — deliberately computed here at read time (not by a
    background job flipping status to 'expired' on a schedule), so there is
    no window where a trial silently keeps working past its end because a
    cron cycle hasn't run yet.
    """
    status = entitlement.get("status")
    if status == "active":
        return True
    if status == "trialing":
        trial_ends_at = entitlement.get("trial_ends_at")
        if not trial_ends_at:
            return False
        deadline = datetime.fromisoformat(trial_ends_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) < deadline
    return False


def activate_entitlement(
    user_id: str,
    stripe_customer_id: str | None,
    stripe_checkout_session_id: str | None,
) -> dict[str, Any] | None:
    """Mark a user's entitlement 'active' after the Stripe webhook confirms payment.

    The ONLY code path allowed to set status='active' — see
    src/billing/routes.py's webhook handler, which is itself the only
    caller. Upserts (rather than requiring a pre-existing row) so a payment
    completed before this user's first `ensure_trial_entitlement` call
    (e.g. paid immediately, never used the trial) still activates cleanly.
    """
    client = get_client()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "user_id": user_id,
        "status": "active",
        "plan": "paid",
        "stripe_customer_id": stripe_customer_id,
        "stripe_checkout_session_id": stripe_checkout_session_id,
        "activated_at": now,
    }
    result = client.table(_TABLE).upsert(row, on_conflict="user_id").execute()
    logger.info(
        "entitlement_activated",
        user_id=user_id,
        stripe_customer_id=stripe_customer_id,
        stripe_checkout_session_id=stripe_checkout_session_id,
    )
    return result.data[0] if result.data else None


def cancel_entitlement(user_id: str) -> dict[str, Any] | None:
    """Mark a user's entitlement 'canceled'. Called by account deletion (Phase 1).

    Deliberately does not delete the row — matches the account-deletion
    design decision (see src/account/deletion_service.py): Phase 1 revokes
    access without touching any row a Phase 2 review might want to inspect.
    """
    client = get_client()
    result = (
        client.table(_TABLE)
        .update({"status": "canceled", "canceled_at": datetime.now(timezone.utc).isoformat()})
        .eq("user_id", user_id)
        .execute()
    )
    logger.info("entitlement_canceled", user_id=user_id)
    return result.data[0] if result.data else None
