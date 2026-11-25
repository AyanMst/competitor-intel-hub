"""Explicit `response_model` schemas for every api.py route.

Response Trimming (backend security audit): every endpoint
previously returned whatever dict its repository call produced —
`select("*")` rows, in some cases including columns (`user_id`,
`competitor_id`, `youtube_channel_id`) that no frontend consumer actually
uses. FastAPI's `response_model` acts as a strict output allowlist: any
field not declared on the model here is silently dropped from the
serialized response, regardless of what the underlying repository/DB row
contains. This means a future column added to `reports` or
`tracked_channels` (e.g. an internal cost-tracking or scraper-cursor field)
can never leak to the frontend by accident — it has to be added here
deliberately first.

Field sets below were verified against the frontend's own contracts
(frontend/lib/api.ts, frontend/components/ChannelList.tsx) so this only
trims fields the frontend never reads; it does not change any field the
UI currently depends on.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Claim(BaseModel):
    text: str
    timestamp: float | None = None


class TranscriptSegment(BaseModel):
    start: float
    text: str


class ChangesSummary(BaseModel):
    new_features: str
    pricing_changes: str
    marketing_message: str
    objections_or_risks: str
    has_changes: bool


# ---- /health ---------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str


# ---- /analyze, /analyze-video ----------------------------------------------

class JobResponse(BaseModel):
    status: Literal["accepted", "duplicate"]
    job_id: str
    job_status: str
    result_report_id: str | None = None


# ---- /reports, /reports/{id} ------------------------------------------------

class ReportSummary(BaseModel):
    """GET /reports list view. Deliberately excludes `competitor_id` (an
    internal FK the frontend resolves via the joined `competitor_name`
    instead)."""

    id: str
    filename: str
    created_at: str
    competitor_name: str | None = None


class ReportListResponse(BaseModel):
    status: str
    data: list[ReportSummary]


class ReportDetail(BaseModel):
    """GET /reports/{id}. Excludes `competitor_id` and `user_id` — both are
    present on the raw Supabase row (`select("*")`) but never read by the
    frontend (frontend/lib/api.ts `ReportDetail`), so previously leaked as
    unused-but-present fields on every response."""

    id: str
    filename: str
    created_at: str
    raw_transcript: str
    raw_segments: list[TranscriptSegment] | None = None
    new_features: list[Claim] = []
    pricing_changes: list[Claim] = []
    marketing_message: list[Claim] = []
    objections_or_risks: list[Claim] = []
    changes_summary: ChangesSummary | None = None
    competitor_name: str | None = None


class ReportDetailResponse(BaseModel):
    status: str
    data: ReportDetail


# ---- /search -----------------------------------------------------------

class SearchResultItem(BaseModel):
    id: str
    report_id: str
    competitor_id: str | None = None
    competitor_name: str | None = None
    pillar: str
    claim_text: str
    claim_timestamp: float | None = None
    report_created_at: str
    similarity: float


class SearchResponse(BaseModel):
    status: str
    data: list[SearchResultItem]


# ---- /channels ---------------------------------------------------------

class TrackedChannel(BaseModel):
    """Shared shape for POST/GET/PATCH /channels(/{id}). Excludes
    `youtube_channel_id` (never populated/read), `competitor_id` (the
    frontend uses the joined `competitor_name` instead), and `user_id` (the
    caller already knows who they are) — all present on the raw
    `tracked_channels` row but outside the documented frontend contract
    (frontend/components/ChannelList.tsx `ChannelRow`).

    `competitor_name` defaults to None because only the list/read paths
    join `competitors(name)` — the create/update repository calls return
    the bare row without it.
    """

    id: str
    channel_url: str
    channel_name: str | None = None
    competitor_name: str | None = None
    is_active: bool
    last_checked_at: str | None = None
    created_at: str


class ChannelResponse(BaseModel):
    status: str
    data: TrackedChannel


class ChannelListResponse(BaseModel):
    status: str
    data: list[TrackedChannel]


class SimpleStatusResponse(BaseModel):
    status: str


class VideoProcessResult(BaseModel):
    video_id: str
    status: str
    report_id: str | None = None
    error: str | None = None


class PollSummary(BaseModel):
    channels_checked: int
    videos_processed: list[VideoProcessResult]


class PollChannelsResponse(BaseModel):
    status: str
    data: PollSummary


# ---- /billing/status ---------------------------------------------------

class EntitlementStatus(BaseModel):
    entitlement_status: str
    is_entitled: bool
    trial_ends_at: str | None = None
    # None when Stripe isn't configured yet (see stripe_client.is_configured)
    # or when the caller is already entitled and doesn't need one.
    checkout_url: str | None = None


class EntitlementStatusResponse(BaseModel):
    status: str
    data: EntitlementStatus


# ---- /account/delete-request --------------------------------------------

class AccountDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: str


class AccountDeletionResponse(BaseModel):
    status: str
    message: str
