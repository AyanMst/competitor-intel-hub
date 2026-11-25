"""Account lifecycle routes. Mounted in api.py via `app.include_router(account_router)`.

POST /account/delete-request is Phase 1 only (revoke access, unlink uploads).
It never DELETEs `analysis_jobs` — that is reserved for the human-gated
Phase 2 script. See src/account/deletion_service.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from src.auth.dependencies import require_auth
from src.account.deletion_service import request_account_deletion
from src.config import load_config
from src.schemas import AccountDeleteRequest, AccountDeletionResponse

router = APIRouter(prefix="/account", tags=["account"])


def _deletion_confirmation() -> str:
    return load_config().get("account", {}).get("deletion_confirmation", "DELETE")


@router.post("/delete-request", response_model=AccountDeletionResponse)
def delete_account(body: AccountDeleteRequest, user=Depends(require_auth)):
    """User-facing delete-my-account. Requires an explicit confirmation string.

    Confirmation is checked here (not just in the UI) so a crafted request
    without the confirmation step cannot trigger Phase 1.
    """
    expected = _deletion_confirmation()
    if body.confirmation != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Confirmation must be exactly {expected!r} to delete this account.",
        )

    user_id = getattr(user, "id", None) or user.get("id")
    user_email = getattr(user, "email", None)
    if user_email is None and isinstance(user, dict):
        user_email = user.get("email")

    return request_account_deletion(user_id, user_email)
