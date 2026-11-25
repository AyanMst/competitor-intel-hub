"""Thin wrapper around the `stripe` SDK for the Payment-Link + webhook paywall flow.

Deliberately does NOT create Checkout Sessions via the API — the product
decision (see chat record) is a single static Stripe Payment Link (one-time
payment, not a recurring subscription), so the only two things this backend
needs from Stripe are:
  1. A way to hand each user a payment URL that Stripe will later echo their
     user_id back on (`client_reference_id`), so the webhook below can tell
     WHO paid.
  2. Signature-verified receipt of that webhook.

Test mode vs live mode: this module NEVER hardcodes or chooses between
`sk_test_...` / `sk_live_...` keys — it reads whatever `STRIPE_SECRET_KEY`
is set in the environment, same as every other secret in this codebase
(see reports_repository.get_client). Per explicit project instruction, going
live is a deliberate decision the operator makes by rotating which key is in
the environment, not something this code should ever decide on its own —
`_warn_if_live_key` below only logs a loud, one-time reminder so a stray
live key set in a dev/staging environment doesn't go unnoticed.
"""

from __future__ import annotations

import os
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import stripe
import structlog

logger = structlog.get_logger(__name__)

_warned_live_key = False


def _warn_if_live_key(secret_key: str) -> None:
    global _warned_live_key
    if _warned_live_key:
        return
    if secret_key.startswith("sk_live_"):
        logger.warning(
            "stripe_live_key_in_use",
            message=(
                "STRIPE_SECRET_KEY looks like a LIVE-mode key (sk_live_...). "
                "Confirm this is intentional before accepting real payments."
            ),
        )
    _warned_live_key = True


def is_configured() -> bool:
    """Whether enough Stripe env vars are set to run the paywall for real.

    Lets `/billing/status` degrade gracefully (report "not configured"
    instead of 500ing) in any environment where a Payment Link hasn't been
    created yet — see the `not_set_up` option in the design decision.
    """
    return bool(os.getenv("STRIPE_SECRET_KEY") and os.getenv("STRIPE_PAYMENT_LINK_URL"))


def _get_secret_key() -> str:
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not set.")
    _warn_if_live_key(key)
    return key


def build_checkout_url(user_id: str) -> str:
    """Return this user's Stripe Payment Link URL, tagged with client_reference_id.

    `client_reference_id` is the one field Stripe Payment Links let a caller
    attach up front and always echoes back, verbatim, on the
    `checkout.session.completed` webhook (Stripe docs: payment-links/
    url-parameters) — that echo is how `handle_checkout_completed` below
    knows which of our users just paid, without ever creating a Checkout
    Session ourselves.
    """
    base_url = os.getenv("STRIPE_PAYMENT_LINK_URL")
    if not base_url:
        raise RuntimeError("STRIPE_PAYMENT_LINK_URL is not set.")

    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query))
    query["client_reference_id"] = user_id
    return urlunparse(parsed._replace(query=urlencode(query)))


def construct_webhook_event(payload: bytes, signature_header: str | None) -> stripe.Event:
    """Verify and parse a Stripe webhook payload. Raises on a bad/missing signature.

    MUST be called with the raw request body (not a re-serialized dict) —
    Stripe's HMAC signature is computed over the exact bytes it sent, so
    round-tripping through `json.loads` + `json.dumps` first would break
    verification for a legitimate event just as reliably as a forged one.
    """
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not webhook_secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is not set.")
    if not signature_header:
        raise stripe.error.SignatureVerificationError(
            "Missing Stripe-Signature header.", signature_header
        )

    stripe.api_key = _get_secret_key()
    return stripe.Webhook.construct_event(payload, signature_header, webhook_secret)
