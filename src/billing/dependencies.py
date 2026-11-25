"""FastAPI dependency that gates routes behind an active entitlement.

Scope (per project instruction): this gates ONLY the core Battlecard
generation endpoints — `POST /analyze` and `POST /analyze-video` in api.py.
It is deliberately NOT applied to `/reports`, `/search`, `/channels`, etc.,
so a beta user past their trial can still read reports/data they already
paid to generate; they just can't kick off new (billable) analysis runs.

Layered on top of `require_auth`, not a replacement for it — this always
runs after a valid Supabase session has already been resolved.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from src.auth.dependencies import require_auth
from src.billing import stripe_client
from src.config import load_config
from src.storage.entitlements_repository import ensure_trial_entitlement, is_entitled


def trial_days() -> int:
    """Beta trial length in days, from config.yaml (`billing.trial_days`)."""
    return load_config().get("billing", {}).get("trial_days", 14)


def require_entitlement(user: dict = Depends(require_auth)) -> dict:
    """Raise 402 unless the caller has an active entitlement or is still in trial.

    Returns the entitlement row (mirrors `require_auth` returning the user)
    so a route can inspect it further if it ever needs to, though today's
    two gated routes don't.
    """
    user_id = getattr(user, "id", None) or user.get("id")
    entitlement = ensure_trial_entitlement(user_id, trial_days=trial_days())

    if is_entitled(entitlement):
        return entitlement

    checkout_url = None
    if stripe_client.is_configured():
        checkout_url = stripe_client.build_checkout_url(user_id)

    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "error": "payment_required",
            "message": "Your beta trial has ended. Upgrade to continue generating battlecards.",
            "checkout_url": checkout_url,
        },
    )
