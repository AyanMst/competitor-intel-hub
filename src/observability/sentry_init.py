"""Sentry process-level init for the FastAPI app (api.py).

Init-only: no try/except around business logic, and this module is not
imported by src/workers/job_worker.py (or claim_pending_jobs). Worker
errors keep flowing through existing structured logs. When SENTRY_DSN is
unset, sentry-sdk is a no-op.
"""

from __future__ import annotations

import os

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from src.config import load_config


def init_sentry() -> None:
    config = load_config()
    system = config.get("system") or {}
    sentry_cfg = (config.get("observability") or {}).get("sentry") or {}

    try:
        traces_sample_rate = float(sentry_cfg.get("traces_sample_rate", 0.0))
    except (TypeError, ValueError):
        traces_sample_rate = 0.0

    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN") or None,
        environment=os.getenv("SENTRY_ENVIRONMENT") or system.get("environment") or "development",
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
        ],
    )
