"""Phase 2 account purge — REVIEW BEFORE RUNNING.

THIS IS THE ONLY CODE PATH THAT DELETES `analysis_jobs` ROWS.

It is intentionally NOT imported by api.py, src/account/routes.py,
src/account/deletion_service.py, any cron, or any webhook. A user clicking
"Delete my account" in the UI never reaches this file.

Data-retention decision (see src/account/deletion_service.py):
  Phase 1 (automatic, user-facing) = soft-delete / revoke access.
  Phase 2 (this script)            = hard-delete of tenant data, including
                                     analysis_jobs, reports, and the auth user.

Safety gates — ALL of the following must be true or this script exits
without writing:
  1. An `account_deletion_requests` row exists for --user-id (Phase 1 ran).
  2. You passed --confirm-delete-analysis-jobs.
  3. You passed --i-understand-this-is-irreversible.

Usage (from the project root, with the same .env as the API server):

    # Review plan only — prints row counts, deletes nothing:
    python scripts/purge_deleted_account.py --user-id <uuid>

    # Execute Phase 2 after you have reviewed the plan:
    python scripts/purge_deleted_account.py --user-id <uuid> \\
        --confirm-delete-analysis-jobs \\
        --i-understand-this-is-irreversible
"""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.storage.account_deletion_repository import get_latest_request, mark_purged  # noqa: E402
from src.storage.reports_repository import get_client  # noqa: E402

# REVIEW: tables this script will DELETE FROM, in order. `analysis_jobs` is
# first and is the table the operator must explicitly confirm. Do not add
# this list (or this module) to any request-handling import graph.
_PURGE_TABLES = (
    "analysis_jobs",
    "report_embeddings",
    "reports",
    "processed_videos",
    "tracked_channels",
    "competitors",
    "entitlements",
)


def _count_rows(table: str, user_id: str) -> int:
    client = get_client()
    result = client.table(table).select("id", count="exact").eq("user_id", user_id).execute()
    return result.count or 0


def _print_review_plan(user_id: str, request: dict) -> dict[str, int]:
    print("=" * 72)
    print("REVIEW — Phase 2 account purge plan (no writes yet)")
    print("=" * 72)
    print(f"  user_id:          {user_id}")
    print(f"  requested_at:     {request.get('requested_at')}")
    print(f"  request_status:   {request.get('status')}")
    print(f"  user_email:       {request.get('user_email')}")
    print()
    print("  Rows that WOULD be deleted if both confirm flags are passed:")
    counts: dict[str, int] = {}
    for table in _PURGE_TABLES:
        count = _count_rows(table, user_id)
        counts[table] = count
        flag = "  << analysis_jobs — gated by --confirm-delete-analysis-jobs" if table == "analysis_jobs" else ""
        print(f"    {table:<22} {count}{flag}")
    print("    auth.users             1 (admin delete_user, last)")
    print("=" * 72)
    return counts


def _delete_user_rows(table: str, user_id: str) -> int:
    client = get_client()
    result = client.table(table).delete().eq("user_id", user_id).execute()
    return len(result.data or [])


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Phase 2 hard-delete for a user who already completed Phase 1. "
            "Without the two confirm flags this only prints a review plan."
        )
    )
    parser.add_argument("--user-id", required=True, help="Auth user UUID from account_deletion_requests.")
    parser.add_argument(
        "--confirm-delete-analysis-jobs",
        action="store_true",
        help=(
            "REVIEW GATE: required to DELETE this user's analysis_jobs rows. "
            "The user-facing delete-account endpoint never sets this."
        ),
    )
    parser.add_argument(
        "--i-understand-this-is-irreversible",
        action="store_true",
        help="Second confirm flag. Both flags are required to execute.",
    )
    args = parser.parse_args()
    user_id = args.user_id

    request = get_latest_request(user_id)
    if request is None:
        print(
            f"Refusing to purge {user_id}: no account_deletion_requests row. "
            "Phase 1 (POST /account/delete-request) must run first.",
            file=sys.stderr,
        )
        return 2

    if request.get("status") == "purged":
        print(f"Refusing to purge {user_id}: already marked purged.", file=sys.stderr)
        return 2

    counts = _print_review_plan(user_id, request)

    confirmed = args.confirm_delete_analysis_jobs and args.i_understand_this_is_irreversible
    if not confirmed:
        print()
        print("No rows deleted. Re-run with BOTH flags to execute:")
        print("  --confirm-delete-analysis-jobs")
        print("  --i-understand-this-is-irreversible")
        return 0

    print()
    print("CONFIRM FLAGS PRESENT — executing Phase 2 deletes.")
    for table in _PURGE_TABLES:
        deleted = _delete_user_rows(table, user_id)
        print(f"  deleted {deleted}/{counts[table]} from {table}")

    get_client().auth.admin.delete_user(user_id)
    print("  deleted auth.users row")

    mark_purged(user_id)
    print("  marked account_deletion_requests as purged")
    print("Phase 2 complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
