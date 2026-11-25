import hashlib
import os
import subprocess
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

# Load environment variables (OPENAI_API_KEY) before any OpenAI-backed module is imported/used.
load_dotenv()

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, HttpUrl
from src.account.routes import router as account_router
from src.auth.dependencies import require_auth
from src.billing.dependencies import require_entitlement
from src.billing.routes import router as billing_router
from src.config import load_config
from src.scrapers.youtube_scraper import VideoValidationError, YouTubeScraper
from src.agents.embedding_agent import EmbeddingAgent
from src.storage.competitors_repository import get_or_create_competitor
from src.storage.reports_repository import get_report, list_reports
from src.storage.embeddings_repository import search_embeddings
from src.storage.channels_repository import add_channel, delete_channel, list_channels, set_channel_active
from src.storage.jobs_repository import create_or_get_job
from src.scheduler.channel_monitor import poll_channels
from src.workers.job_worker import poll_jobs, reap_orphan_jobs
from src.middleware.security_headers import SecurityHeadersMiddleware
from src.observability import init_sentry
from src.schemas import (
    ChannelListResponse,
    ChannelResponse,
    HealthResponse,
    JobResponse,
    PollChannelsResponse,
    ReportDetailResponse,
    ReportListResponse,
    SearchResponse,
    SimpleStatusResponse,
)

# Crash reporting (init only). Runs after job_worker import so this
# FastAPI-aware init is what the API process keeps; we do not wrap
# poll_jobs / claim_pending_jobs. No-op when SENTRY_DSN is unset.
init_sentry()

# Initialize the FastAPI application
app = FastAPI(title="Competitor Intel Hub API")

# 1. CORS LOCKDOWN: the previous
# hardcoded allow_origins list included localhost origins that have no
# business being reachable from a deployed backend, and — more
# importantly — was never environment-aware, so "just add the prod URL"
# meant editing and redeploying this file. Now strictly a single origin
# from FRONTEND_URL (falling back to the Next.js dev server locally), no
# wildcard, no hardcoded list to keep in sync across environments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1b. SECURITY HEADERS: X-Content-Type-Options,
# X-Frame-Options, Strict-Transport-Security, and a basic CSP on every
# response — see src/middleware/security_headers.py for the per-header
# rationale.
app.add_middleware(SecurityHeadersMiddleware)

# 1c. PAYWALL + ACCOUNT LIFECYCLE routers (Monetization Gating / Account
# Deletion): kept in their own modules (src/billing/, src/account/) rather
# than added inline here, so that surface area stays easy to review on its
# own. See src/billing/dependencies.require_entitlement below for where the
# actual gate is applied — these two endpoints on their own (status +
# webhook, delete-request) are not gated by it.
app.include_router(billing_router)
app.include_router(account_router)

# 2. STRICT INPUT VALIDATION: Ensure the input is an actual URL, not garbage text
#
# Mass Assignment / Field Tampering: `extra="forbid"` on every
# request schema below rejects any field not explicitly declared (422)
# instead of Pydantic v2's default of silently dropping unknown keys. Not
# exploitable today (nothing does `**data` passthrough into a DB insert),
# but closes the hole before any future endpoint introduces that pattern.
class VideoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: HttpUrl
    competitor: str

class ChannelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    channel_url: HttpUrl
    competitor: str

# Channels CRUD: body for PATCH /channels/{id}.
class ChannelStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool

# File Upload Restrictions: the filename-extension check alone
# (`.mp4`) is trivially spoofable — a client can rename any file to
# "x.mp4". These two checks are layered on top of it, not a replacement:
#   1. `Content-Type` allowlist — still client-supplied/spoofable, but
#      cheap and catches accidental wrong-file-type uploads immediately.
#   2. Magic-byte sniff of the actual bytes — an MP4 (ISO base media file
#      format) container has an `ftyp` box whose 4-byte type tag sits at
#      byte offset 4, so a real .mp4 always has b"ftyp" at bytes[4:8]
#      regardless of what the client claims. This is the check that
#      actually can't be spoofed by renaming an arbitrary file.
_ALLOWED_UPLOAD_CONTENT_TYPES = {"video/mp4", "application/mp4"}
_MP4_FTYP_MAGIC = b"ftyp"


def _looks_like_mp4_container(file_bytes: bytes) -> bool:
    """Best-effort sniff for an ISO base media file format (mp4) container."""
    return len(file_bytes) >= 12 and file_bytes[4:8] == _MP4_FTYP_MAGIC


def _read_upload_enforcing_size_cap(file: UploadFile, max_bytes: int) -> bytes:
    """Read an UploadFile's body, aborting the moment it exceeds `max_bytes`.

    Pre-flight Validation: reads in fixed-size chunks off the
    underlying SpooledTemporaryFile instead of a single `file.file.read()`
    call, so an oversized upload is rejected as soon as it crosses the cap
    rather than being fully buffered into memory first just to find out it
    should be rejected — the whole point of having a ceiling in the first
    place.
    """
    chunk_size = 8 * 1024 * 1024  # 8MB
    total_bytes = 0
    chunks: list[bytes] = []
    while True:
        chunk = file.file.read(chunk_size)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File exceeds the {max_bytes // (1024 * 1024)}MB upload limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _probe_video_duration_seconds(path: str) -> float:
    """Read a local video file's duration via `ffprobe`, without decoding/transcoding it.

    Upload Duration Cap: the 500MB size ceiling alone does NOT
    bound a video's duration — a low-bitrate 3-hour recording can sail
    comfortably under 500MB while still costing 3x the Whisper/LLM spend the
    60-minute cap (`sources.youtube.max_duration_minutes`) exists to bound.
    This closes that gap for uploads the same way `YouTubeScraper.
    validate_video` already closes it for YouTube URLs — reading only the
    container's metadata (near-instant, no frame decoding), never the actual
    video stream.

    Raises `RuntimeError` (a message safe to log, not to show a user
    directly — could leak ffprobe/stderr internals) if ffprobe is missing
    from PATH, times out, or can't parse the file. The caller decides what
    that means for the request.
    """
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
    except FileNotFoundError as e:
        raise RuntimeError("ffprobe is not installed / not on PATH") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("ffprobe timed out reading video metadata") from e
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffprobe could not read this file: {e.stderr.strip()}") from e

    try:
        return float(completed.stdout.strip())
    except ValueError as e:
        raise RuntimeError(f"ffprobe returned a non-numeric duration: {completed.stdout!r}") from e


def _delete_upload_best_effort(path: str) -> None:
    """Best-effort delete of a persisted upload that's being rejected before a job exists.

    Mirrors `job_worker._cleanup_pending_upload`'s pattern — this exists
    separately because that cleanup only runs once a job is created and
    finishes; a duration-cap (or ffprobe-failure) rejection happens before
    a job is ever created, so nothing else will ever clean this file up.
    """
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError as e:
        print(f"[API Error] Failed to delete rejected upload {path}: {e}")


def _persist_pending_upload(dedup_key: str, file_bytes: bytes) -> str:
    """Write an uploaded mp4 to a durable path the background worker can read from.

    Async Job Queue: POST /analyze-video no longer
    transcribes inline, so the file must survive past the request instead of
    living in a `tempfile.NamedTemporaryFile` that used to be deleted before
    the response returned. Keyed by the upload's own content hash so
    re-uploading identical bytes overwrites the same path instead of
    accumulating duplicates on disk. `job_worker._cleanup_pending_upload`
    deletes this file once the job it belongs to finishes (success or failure).
    """
    uploads_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        load_config().get("directories", {}).get("pending_uploads", "data/pending_uploads"),
    )
    os.makedirs(uploads_dir, exist_ok=True)
    upload_path = os.path.join(uploads_dir, f"{dedup_key}.mp4")
    with open(upload_path, "wb") as f:
        f.write(file_bytes)
    return upload_path

def _job_response(job: dict, created: bool) -> dict:
    """Shape the enqueue-or-reuse result the same way for /analyze and /analyze-video."""
    return {
        "status": "accepted" if created else "duplicate",
        "job_id": job["id"],
        "job_status": job["status"],
        "result_report_id": job.get("result_report_id"),
    }

# 7. SCHEDULED CHANNEL MONITORING & ASYNC JOB WORKER: a single in-process APScheduler instance runs two independent
# interval jobs — one polling every active `tracked_channels` row for new
# uploads, one draining pending `analysis_jobs` rows enqueued by
# POST /analyze and POST /analyze-video. All intervals/batch sizes come from
# config.yaml, never hardcoded.
_scheduler = BackgroundScheduler()

@app.on_event("startup")
def _start_scheduler():
    config = load_config()
    youtube_config = config.get("sources", {}).get("youtube", {})
    interval_minutes = youtube_config.get("poll_interval_minutes", 30)
    videos_per_channel = youtube_config.get("videos_per_channel_per_poll", 5)

    jobs_config = config.get("jobs", {})
    job_poll_seconds = jobs_config.get("poll_interval_seconds", 15)
    max_concurrent_jobs = jobs_config.get("max_concurrent_jobs", 3)
    orphan_reap_minutes = jobs_config.get("orphan_reap_interval_minutes", 5)
    orphan_timeout_minutes = jobs_config.get("orphan_timeout_minutes", 15)

    _scheduler.add_job(
        lambda: poll_channels(videos_per_channel=videos_per_channel),
        "interval",
        minutes=interval_minutes,
        id="channel_monitor",
        replace_existing=True,
    )
    _scheduler.add_job(
        lambda: poll_jobs(max_concurrent_jobs=max_concurrent_jobs),
        "interval",
        seconds=job_poll_seconds,
        id="analysis_job_worker",
        replace_existing=True,
        # Guards against overlapping poll cycles if a batch of jobs takes
        # longer to process than job_poll_seconds (a real risk at a 15s
        # default interval, unlike the 30-minute channel monitor above).
        max_instances=1,
    )
    # Orphan Job Recovery: separate, much less
    # frequent cycle that reaps jobs a crashed/killed worker left stuck in
    # 'transcribing'/'analyzing' — see reap_orphan_jobs / schema_orphan_recovery.sql.
    _scheduler.add_job(
        lambda: reap_orphan_jobs(timeout_minutes=orphan_timeout_minutes),
        "interval",
        minutes=orphan_reap_minutes,
        id="orphan_job_reaper",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.start()
    print(f"[Scheduler] Channel monitoring started (every {interval_minutes} min, "
          f"{videos_per_channel} videos/channel/cycle).")
    print(f"[Scheduler] Analysis job worker started (every {job_poll_seconds}s, "
          f"max {max_concurrent_jobs} concurrent jobs).")
    print(f"[Scheduler] Orphan job reaper started (every {orphan_reap_minutes} min, "
          f"timeout {orphan_timeout_minutes} min).")

@app.on_event("shutdown")
def _stop_scheduler():
    _scheduler.shutdown(wait=False)

# 8. ASYNC JOB QUEUE: both ingest endpoints
# enqueue an `analysis_jobs` row and return immediately instead of running
# Whisper/LLM calls inline. This closes the retry-storm/cost-overrun hole a
# blocking request had (a client or proxy timeout retry used to re-run the
# full pipeline and re-bill OpenAI); `create_or_get_job` reuses any existing
# non-failed job for the same (user, dedup_key) instead of enqueueing a
# duplicate. The pipeline logic that used to live here now lives in
# `src/services/analysis_service.py`, shared by the channel-monitoring
# scheduler and `src/workers/job_worker.py`, which drains the jobs these two
# endpoints create (wired into the scheduler above).
# Health Check: unauthenticated on purpose — load
# balancers/uptime monitors hitting this can't be expected to carry a
# Supabase session, and it deliberately does no DB/network calls of its own
# so it reflects "is the process up and serving requests" rather than
# "is Supabase also reachable" (a different, more involved check).
@app.get("/health", response_model=HealthResponse)
def health_check():
    return {"status": "healthy"}

@app.post("/analyze", response_model=JobResponse)
def analyze_video(request: VideoRequest, response: Response, _user=Depends(require_auth), _entitlement=Depends(require_entitlement)):
    try:
        video_url = str(request.url)

        # Pre-flight Validation: reject private/deleted/live/
        # age-restricted/too-long videos here — via yt-dlp metadata only, no
        # download — before a job is ever created. Without this, a bad URL
        # used to sail straight into `analysis_jobs` and only surface as an
        # opaque 'failed' job minutes later, after already occupying a
        # worker slot for nothing.
        youtube_config = load_config().get("sources", {}).get("youtube", {})
        max_duration_seconds = youtube_config.get("max_duration_minutes", 60) * 60
        try:
            YouTubeScraper().validate_video(video_url, max_duration_seconds=max_duration_seconds)
        except VideoValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))

        dedup_key = YouTubeScraper().extract_video_id(video_url)

        job, created = create_or_get_job(
            user_id=getattr(_user, "id", None),
            source_type="youtube",
            source_ref=video_url,
            competitor_name=request.competitor,
            dedup_key=dedup_key,
        )
        response.status_code = 202 if created else 200
        return _job_response(job, created)

    except HTTPException:
        raise
    except Exception as e:
        # Catch any unexpected crashes and return a clean 500 error instead of killing the server
        print(f"[API Error] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.post("/analyze-video", response_model=JobResponse)
def analyze_video_file(
    response: Response,
    file: UploadFile = File(...),
    competitor: str = Form(...),
    _user=Depends(require_auth),
    _entitlement=Depends(require_entitlement),
):
    if not file.filename or not file.filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 video files are supported.")

    # File Upload Restrictions: reject an obviously-wrong
    # Content-Type before spending any I/O reading the body. Still only a
    # first-pass filter — see the magic-byte check below for the part of
    # this that can't be spoofed by the client.
    if file.content_type not in _ALLOWED_UPLOAD_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only video/mp4 uploads are supported.",
        )

    try:
        # Pre-flight Validation: enforce the upload size ceiling
        # while reading, not after — a naive `file.file.read()` fully
        # buffers the upload into memory before any size check could ever
        # reject it, defeating the point of having a ceiling.
        max_upload_bytes = load_config().get("uploads", {}).get("max_file_size_mb", 500) * 1024 * 1024
        file_bytes = _read_upload_enforcing_size_cap(file, max_upload_bytes)
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # File Upload Restrictions: the actual, non-spoofable
        # check — an mp4/ISO-BMFF container always has an `ftyp` box this
        # early in the file, no matter what filename/Content-Type the
        # client sent. Runs before persisting anything to disk.
        if not _looks_like_mp4_container(file_bytes):
            raise HTTPException(
                status_code=400,
                detail="File does not look like a valid mp4 video.",
            )

        # Content hash as the dedup_key: identical bytes re-uploaded (e.g. a
        # frontend retry after a client-side timeout) resolve to the same
        # job instead of a second Whisper+LLM run.
        dedup_key = hashlib.sha256(file_bytes).hexdigest()
        upload_path = _persist_pending_upload(dedup_key, file_bytes)

        # Upload Duration Cap: the 500MB size ceiling above only
        # bounds file size, not runtime — a low-bitrate long recording can
        # be small. This is the second half of the same 60-minute
        # cost-control the yt-dlp check enforces on POST /analyze, applied
        # here via ffprobe on the just-persisted file (must be a real path
        # on disk, not the in-memory bytes). Runs — and can reject —
        # BEFORE any `analysis_jobs` row is created, same as every other
        # pre-flight check in this file.
        max_duration_minutes = load_config().get("sources", {}).get("youtube", {}).get("max_duration_minutes", 60)
        try:
            duration_seconds = _probe_video_duration_seconds(upload_path)
        except RuntimeError as e:
            _delete_upload_best_effort(upload_path)
            print(f"[API Error] ffprobe duration check failed: {e}")
            raise HTTPException(
                status_code=500,
                detail="Could not verify this video's duration. Please try again shortly.",
            )

        if duration_seconds > max_duration_minutes * 60:
            _delete_upload_best_effort(upload_path)
            raise HTTPException(
                status_code=400,
                detail=f"Video duration exceeds the {max_duration_minutes}-minute limit.",
            )

        job, created = create_or_get_job(
            user_id=getattr(_user, "id", None),
            source_type="upload",
            source_ref=upload_path,
            competitor_name=competitor,
            dedup_key=dedup_key,
            original_filename=file.filename,
        )
        response.status_code = 202 if created else 200
        return _job_response(job, created)

    except HTTPException:
        raise
    except Exception as e:
        print(f"[API Error] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

# 5. PERSISTENCE: List/detail endpoints for reports already saved to Supabase.
@app.get("/reports", response_model=ReportListResponse)
def get_reports(_user: dict = Depends(require_auth)):
    try:
        # Data Isolation: scoped to the authenticated caller —
        # previously returned every tenant's reports to any logged-in user.
        return {"status": "success", "data": list_reports(user_id=_user.id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not fetch reports: {str(e)}")

@app.get("/reports/{report_id}", response_model=ReportDetailResponse)
def get_report_by_id(report_id: str, _user: dict = Depends(require_auth)):
    try:
        # Data Isolation: id + user_id together, so requesting
        # another tenant's report_id 404s exactly like a nonexistent one
        # instead of leaking their data.
        row = get_report(report_id, user_id=_user.id)
        if not row:
            raise HTTPException(status_code=404, detail="Report not found.")
        return {"status": "success", "data": row}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not fetch report: {str(e)}")

# 6. SEMANTIC SEARCH: queries claim embeddings across ALL stored
# reports/competitors via pgvector, e.g. "what has X said about pricing in
# the last 6 months". Read-only, additive — does not touch /analyze(-video).
@app.get("/search", response_model=SearchResponse)
def search_reports(
    q: str,
    limit: int = 10,
    months: int | None = None,
    competitor_id: str | None = None,
    pillar: str | None = None,
    _user: dict = Depends(require_auth),
):
    query = q.strip()
    if not query:
        return {"status": "success", "data": []}

    try:
        since_date = None
        if months is not None and months > 0:
            since_date = (datetime.now(timezone.utc) - timedelta(days=30 * months)).isoformat()

        query_embedding = EmbeddingAgent().embed([query])[0]
        # Data Isolation: user_id is forwarded to the
        # `match_report_embeddings` RPC's `current_user_id` filter — this is
        # the actual enforcement point, since this connection uses the
        # service_role key and bypasses RLS entirely.
        results = search_embeddings(
            query_embedding=query_embedding,
            user_id=_user.id,
            match_count=limit,
            since_date=since_date,
            competitor_id=competitor_id,
            pillar=pillar,
        )
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

# 7. SCHEDULED CHANNEL MONITORING: manage which YouTube channels the
# background scheduler polls, and a manual trigger to test a poll cycle
# on-demand instead of waiting for the interval.
@app.post("/channels", response_model=ChannelResponse)
def track_channel(request: ChannelRequest, _user: dict = Depends(require_auth)):
    try:
        # Data Isolation: both the competitor and the channel are
        # created/looked-up scoped to the caller, so two tenants tracking
        # the same channel/competitor name never collide onto shared rows.
        competitor = get_or_create_competitor(request.competitor, user_id=_user.id)
        channel = add_channel(
            channel_url=str(request.channel_url),
            user_id=_user.id,
            competitor_id=competitor["id"],
        )
        return {"status": "success", "data": channel}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not track channel: {str(e)}")

@app.get("/channels", response_model=ChannelListResponse)
def get_channels(_user: dict = Depends(require_auth)):
    try:
        # Data Isolation: scoped to the authenticated caller.
        return {"status": "success", "data": list_channels(user_id=_user.id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not fetch channels: {str(e)}")

@app.patch("/channels/{channel_id}", response_model=ChannelResponse)
def update_channel_status(channel_id: str, request: ChannelStatusUpdate, _user: dict = Depends(require_auth)):
    """Toggle a tracked channel's active/paused state."""
    try:
        updated = set_channel_active(channel_id, user_id=_user.id, is_active=request.is_active)
        if updated is None:
            # No row matched (channel_id, user_id) together — either it
            # doesn't exist, or it belongs to another tenant. Same 404
            # either way so existence of another tenant's channel is never
            # leaked.
            raise HTTPException(status_code=404, detail="Channel not found.")
        return {"status": "success", "data": updated}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not update channel: {str(e)}")

@app.delete("/channels/{channel_id}", response_model=SimpleStatusResponse)
def remove_channel(channel_id: str, _user: dict = Depends(require_auth)):
    """Stop tracking a channel entirely."""
    try:
        deleted = delete_channel(channel_id, user_id=_user.id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Channel not found.")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not delete channel: {str(e)}")

@app.post("/channels/poll-now", response_model=PollChannelsResponse)
def poll_channels_now(_user: dict = Depends(require_auth)):
    """Manually run one monitoring cycle immediately (for testing), instead of waiting for the interval.

    Data Isolation: scoped to the caller's own tracked channels
    (`user_id=_user.id`) — unlike the scheduled background cycle in
    `_start_scheduler` (which intentionally polls every tenant), this is a
    user-triggered action and must not let one tenant force processing of
    every other tenant's channels.
    """
    try:
        videos_per_channel = load_config().get("sources", {}).get("youtube", {}).get("videos_per_channel_per_poll", 5)
        summary = poll_channels(videos_per_channel=videos_per_channel, user_id=_user.id)
        return {"status": "success", "data": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Channel poll failed: {str(e)}")