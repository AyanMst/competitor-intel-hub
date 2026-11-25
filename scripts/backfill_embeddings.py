"""One-off backfill: embed pillar claims for reports saved before semantic search was added.

Existing reports predate the `report_embeddings` table, so they are invisible
to semantic search until their claims are embedded. Safe to re-run — reports
that already have embeddings are skipped, so this can also be used after a
partial failure without creating duplicate rows.

Data Isolation: `save_report_embeddings` now requires a `user_id`
to stamp onto every embedding row it writes, so semantic search stays
tenant-scoped (see schema_rls_isolation.sql). This is an admin/maintenance
script, not a per-tenant API endpoint, so it intentionally reads across ALL
tenants' `reports` directly via the service_role client (bypassing the
now user_id-scoped `list_reports()` repository helper) and re-attributes
each embedding to that SAME report's own `user_id` column — never a single
hardcoded user. Reports with no `user_id` (pre-multi-tenancy legacy rows,
see schema_rls_isolation.sql) are skipped with a warning instead of
being embedded unscoped.

Usage (from the project root, with the same .env as the API server):
    python -m scripts.backfill_embeddings
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()

# Allow running as `python -m scripts.backfill_embeddings` or as a plain script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.storage.reports_repository import get_client  # noqa: E402
from src.storage.embeddings_repository import save_report_embeddings  # noqa: E402

_PILLARS = ("new_features", "pricing_changes", "marketing_message", "objections_or_risks")


def _already_embedded(report_id: str) -> bool:
    client = get_client()
    result = (
        client.table("report_embeddings").select("id").eq("report_id", report_id).limit(1).execute()
    )
    return bool(result.data)


def _has_claims(report_row: dict) -> bool:
    return any(report_row.get(pillar) for pillar in _PILLARS)


def main() -> None:
    client = get_client()
    # Deliberately queries every tenant's reports directly (admin script),
    # unlike the app's own user_id-scoped `list_reports()`.
    all_reports = client.table("reports").select("*").execute().data or []
    print(f"Found {len(all_reports)} saved report(s).")

    embedded, skipped_no_claims, skipped_existing, skipped_no_owner, failed = 0, 0, 0, 0, 0

    for row in all_reports:
        report_id = row["id"]

        if _already_embedded(report_id):
            skipped_existing += 1
            continue

        if not _has_claims(row):
            skipped_no_claims += 1
            continue

        user_id = row.get("user_id")
        if not user_id:
            skipped_no_owner += 1
            print(f"  [skip] {report_id}: no user_id (legacy pre-multi-tenant row) — backfill it first")
            continue

        try:
            save_report_embeddings(
                report_id=report_id,
                report={pillar: row.get(pillar, []) for pillar in _PILLARS},
                user_id=user_id,
                competitor_id=row.get("competitor_id"),
                report_created_at=row.get("created_at"),
            )
            embedded += 1
            print(f"  [ok] {report_id} ({row.get('filename')})")
        except Exception as e:
            failed += 1
            print(f"  [fail] {report_id}: {e}")

    print(
        f"\nDone. embedded={embedded} skipped_existing={skipped_existing} "
        f"skipped_no_claims={skipped_no_claims} skipped_no_owner={skipped_no_owner} failed={failed}"
    )


if __name__ == "__main__":
    main()
