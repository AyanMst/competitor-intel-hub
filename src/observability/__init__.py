"""Observability helpers (Sentry init, no per-endpoint wrapping)."""

from src.observability.sentry_init import init_sentry

__all__ = ["init_sentry"]
