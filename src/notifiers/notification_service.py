"""Notable-Change Alerts.

Plugs into the existing Change Detection step (`LLMAgent.compare_reports`,
called from `api._resolve_competitor_and_changes`) with a single call:
`notify_if_notable(...)`. No new LLM call and no separate "notability"
heuristic is introduced — `compare_reports` already sets `has_changes: False`
whenever all four pillars come back "No changes detected.", so gating on
that existing flag is exactly what prevents alerts for minor/no-op reports
(e.g. a re-upload of the same video, or a pillar with only wording noise).

Delivery is Slack-only for now (see `src/notifiers/slack_notifier.py`);
toggled and configured via `config.yaml` -> `notifications`, per the
project's config-first convention.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.notifiers.slack_notifier import send_slack_alert

logger = structlog.get_logger(__name__)

_PILLAR_LABELS = {
    "new_features": "New Features Announced",
    "pricing_changes": "Pricing & Packaging",
    "marketing_message": "Core Marketing Message",
    "objections_or_risks": "Potential Risks/Weaknesses",
}
_NO_CHANGE_TEXT = "no changes detected."


def notify_if_notable(
    config: dict,
    competitor_name: str,
    changes_summary: dict[str, Any] | None,
    report_id: str | None,
) -> None:
    """Send a Slack alert only when Change Detection found a notable diff.

    Best-effort and silent by design (like `_save_report_safe`): any failure
    here must never surface to the caller, since the report has already been
    analyzed/saved by this point.
    """
    if not changes_summary or not changes_summary.get("has_changes"):
        return

    notifications_config = (config or {}).get("notifications", {})
    slack_config = notifications_config.get("slack", {})
    if not notifications_config.get("enabled", False) or not slack_config.get("enabled", False):
        logger.info("notification_skipped_disabled", competitor=competitor_name)
        return

    try:
        changed_pillars = [
            _PILLAR_LABELS[key]
            for key in _PILLAR_LABELS
            if str(changes_summary.get(key, "")).strip().lower() != _NO_CHANGE_TEXT
            and str(changes_summary.get(key, "")).strip()
        ]
        if not changed_pillars:
            return

        lines = [f"*Notable change detected for {competitor_name}*"]
        for key in _PILLAR_LABELS:
            value = str(changes_summary.get(key, "")).strip()
            if value and value.lower() != _NO_CHANGE_TEXT:
                lines.append(f"• *{_PILLAR_LABELS[key]}*: {value}")
        if report_id:
            lines.append(f"Report ID: `{report_id}`")

        send_slack_alert(text="\n".join(lines))
    except Exception as e:
        logger.error("notify_if_notable_failed", competitor=competitor_name, error=str(e))
