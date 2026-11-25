"""Billing routes: `GET /billing/status` (frontend paywall UI) and the Stripe webhook.

Mounted onto the main FastAPI app in api.py via `app.include_router(billing_router)`
— kept in its own module/router (rather than added inline to the already-large
api.py) so the paywall surface area stays easy to review in isolation.
"""

from __future__ import annotations

import os

import stripe
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status

from src.auth.dependencies import require_auth
from src.billing import stripe_client
from src.billing.dependencies import trial_days
from src.schemas import EntitlementStatusResponse, SimpleStatusResponse
from src.storage.entitlements_repository import (
    activate_entitlement,
    ensure_trial_entitlement,
    is_entitled,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/status", response_model=EntitlementStatusResponse)
def get_billing_status(user: dict = Depends(require_auth)):
    """Entitlement snapshot for the dashboard's paywall banner.

    Does the same lazy trial-row creation `require_entitlement` does, so
    this can be called on page load (before the user ever hits a gated
    action) to render an accurate "N days left" / "upgrade now" banner
    instead of only finding out via a 402 on the first blocked /analyze call.
    """
    user_id = getattr(user, "id", None) or user.get("id")
    entitlement = ensure_trial_entitlement(user_id, trial_days=trial_days())
    entitled = is_entitled(entitlement)

    checkout_url = None
    if not entitled and stripe_client.is_configured():
        checkout_url = stripe_client.build_checkout_url(user_id)

    return {
        "status": "success",
        "data": {
            "entitlement_status": entitlement.get("status"),
            "is_entitled": entitled,
            "trial_ends_at": entitlement.get("trial_ends_at"),
            "checkout_url": checkout_url,
        },
    }


# STRIPE WEBHOOK — Payment Link confirmation.
#
# Intentionally unauthenticated (no `require_auth`): Stripe, not a logged-in
# browser session, calls this. Trust is established entirely by verifying
# the `Stripe-Signature` header against STRIPE_WEBHOOK_SECRET
# (`stripe_client.construct_webhook_event`) — anyone who can forge that
# signature could forge a payment, so this must NEVER trust the request
# body without that verification succeeding first.
@router.post("/webhook", response_model=SimpleStatusResponse)
async def stripe_webhook(request: Request):
    payload = await request.body()
    signature_header = request.headers.get("stripe-signature")

    try:
        event = stripe_client.construct_webhook_event(payload, signature_header)
    except stripe.error.SignatureVerificationError:
        logger.warning("stripe_webhook_bad_signature")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature.")
    except RuntimeError as e:
        # STRIPE_WEBHOOK_SECRET missing — a config problem, not a forged
        # request; still reject rather than silently no-op-ing a real event.
        logger.error("stripe_webhook_misconfigured", error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        # `client_reference_id` is the value `stripe_client.build_checkout_url`
        # attached to this user's Payment Link URL before they ever paid —
        # Stripe echoes it back here verbatim. No `client_reference_id` means
        # this payment didn't originate from a link we tagged (e.g. someone
        # paid via the raw, untagged Payment Link) — log it loudly instead of
        # silently activating nothing, so it doesn't get lost.
        user_id = session.get("client_reference_id")
        if not user_id:
            logger.error(
                "stripe_webhook_missing_client_reference_id",
                session_id=session.get("id"),
            )
            return {"status": "success"}

        activate_entitlement(
            user_id=user_id,
            stripe_customer_id=session.get("customer"),
            stripe_checkout_session_id=session.get("id"),
        )
    else:
        logger.info("stripe_webhook_ignored_event_type", event_type=event["type"])

    return {"status": "success"}
