"""Slack Incoming Webhook delivery for Notable-Change Alerts.

Single-responsibility transport: builds a Slack Block Kit payload and POSTs
it to the configured Incoming Webhook URL. Contains no notability logic —
callers (see `src/notifiers/notification_service.py`) decide *whether* to
send; this module only knows *how*.
"""

from __future__ import annotations

import os

import requests
import structlog

logger = structlog.get_logger(__name__)

_REQUEST_TIMEOUT_SECONDS = 5


def send_slack_alert(text: str, blocks: list[dict] | None = None) -> bool:
    """POST an alert to the Slack webhook in `SLACK_WEBHOOK_URL`.

    Returns True/False instead of raising so a Slack outage or missing
    config can never break the calling pipeline (analysis/report saving
    already happened by the time this runs).
    """
    webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    if not webhook_url:
        logger.warning("slack_alert_skipped_no_webhook_configured")
        return False

    payload: dict = {"text": text}
    if blocks:
        payload["blocks"] = blocks

    try:
        response = requests.post(webhook_url, json=payload, timeout=_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        logger.info("slack_alert_sent")
        return True
    except Exception as e:
        logger.error("slack_alert_failed", error=str(e))
        return False
