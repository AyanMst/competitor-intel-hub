"""Supabase-backed persistence for the `competitors` lookup table.

A report belongs to at most one competitor. This repo resolves a competitor
by name (creating it on first use) so uploads can link a report without a
separate "create competitor" step, and so change detection has a way to find
a competitor's prior reports.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

_TABLE = "competitors"
_REPORTS_TABLE = "reports"


def get_or_create_competitor(name: str, user_id: str) -> dict[str, Any]:
    """Return the competitor row for `name` (case-insensitive), creating it if new.

    Scoped to `user_id` (Data Isolation — see
    schema_rls_isolation.sql, which also moves the DB-level uniqueness
    constraint from a global `name` to `(user_id, lower(name))`). Without
    this, two tenants both tracking e.g. "Acme Corp" would collide onto the
    same competitor row and each would see the other's reports/changes.
    """
    normalized = name.strip()
    client = get_client()

    existing = (
        client.table(_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .ilike("name", normalized)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]

    created = client.table(_TABLE).insert({"name": normalized, "user_id": user_id}).execute()
    logger.info("competitor_created", name=normalized, user_id=user_id)
    return created.data[0]


def get_most_recent_report_for_competitor(competitor_id: str, user_id: str) -> dict[str, Any] | None:
    """Return a competitor's latest saved report, or None if this is their first.

    `user_id` filter is defense-in-depth on top of `competitor_id` already
    being tenant-scoped by `get_or_create_competitor` above.
    """
    client = get_client()
    result = (
        client.table(_REPORTS_TABLE)
        .select("*")
        .eq("competitor_id", competitor_id)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None
