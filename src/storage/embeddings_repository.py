"""Supabase-backed persistence + search for per-claim embeddings.

Isolates access to the `report_embeddings` table (see schema_search.sql)
behind a small repository API, mirroring reports_repository.py /
competitors_repository.py. One row is stored per pillar-claim so search
results can cite the exact claim + timestamp, reusing the
timestamp-jump UI.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.agents.embedding_agent import EmbeddingAgent
from src.storage.reports_repository import get_client

logger = structlog.get_logger(__name__)

_TABLE = "report_embeddings"
_RPC = "match_report_embeddings"
_PILLARS = ("new_features", "pricing_changes", "marketing_message", "objections_or_risks")


def save_report_embeddings(
    report_id: str,
    report: dict[str, Any],
    user_id: str,
    competitor_id: str | None = None,
    report_created_at: str | None = None,
) -> None:
    """Embed every pillar claim in `report` and store them for semantic search.

    `user_id` is required (Data Isolation — see
    schema_rls_isolation.sql) so `search_embeddings` below has a column to
    filter on; without it every tenant's claims were equally rankable/
    returnable from any other tenant's search query.

    Best-effort: never raises, mirroring `_save_report_safe`'s defensive
    style, so a failed embedding call never blocks the core analyze flow.
    """
    try:
        claims = [
            (pillar, claim)
            for pillar in _PILLARS
            for claim in (report.get(pillar, []) or [])
            if str(claim.get("text") or "").strip()
        ]
        if not claims:
            return

        vectors = EmbeddingAgent().embed([claim["text"] for _, claim in claims])

        rows = [
            {
                "report_id": report_id,
                "competitor_id": competitor_id,
                "pillar": pillar,
                "claim_text": claim["text"],
                "claim_timestamp": claim.get("timestamp"),
                "report_created_at": report_created_at,
                "embedding": vector,
                "user_id": user_id,
            }
            for (pillar, claim), vector in zip(claims, vectors)
        ]
        get_client().table(_TABLE).insert(rows).execute()
        logger.info("report_embeddings_saved", report_id=report_id, count=len(rows), user_id=user_id)
    except Exception as e:
        logger.error("report_embeddings_failed", report_id=report_id, error=str(e))


def search_embeddings(
    query_embedding: list[float],
    user_id: str,
    match_count: int = 10,
    since_date: str | None = None,
    competitor_id: str | None = None,
    pillar: str | None = None,
) -> list[dict[str, Any]]:
    """Call the `match_report_embeddings` RPC and return ranked claim matches.

    `user_id` is passed through as the RPC's `current_user_id` parameter
    (see schema_rls_isolation.sql), which filters
    the underlying `where e.user_id = current_user_id` inside the function
    itself. This is the actual enforcement point for /search: the backend
    connects with the service_role key, which bypasses RLS, so tenant
    scoping MUST happen in this query, not just in a policy.
    """
    result = (
        get_client()
        .rpc(
            _RPC,
            {
                "query_embedding": query_embedding,
                "current_user_id": user_id,
                "match_count": match_count,
                "since_date": since_date,
                "filter_competitor_id": competitor_id,
                "filter_pillar": pillar,
            },
        )
        .execute()
    )
    return result.data or []
