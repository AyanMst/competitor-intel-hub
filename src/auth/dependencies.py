"""FastAPI dependency that gates routes behind a valid Supabase Auth session.

Verifies the bearer token by asking Supabase's Auth server to resolve it to a
user (via the existing service-role client), so no separate JWT secret or
anon key is needed on the backend. Reused across every protected route so
auth logic lives in exactly one place.
"""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from src.storage.reports_repository import get_client


def require_auth(authorization: str | None = Header(default=None)) -> dict:
    """Raise 401 unless the request carries a valid Supabase session token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
        )

    token = authorization.split(" ", 1)[1].strip()

    try:
        user_response = get_client().auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )

    if not user_response or not user_response.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )

    return user_response.user
