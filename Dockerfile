# FastAPI backend (api.py) — deploy target: Render "Docker" web service.
#
# Render's native Python runtime has no step for installing OS packages,
# and this app needs one: `ffmpeg` (which bundles `ffprobe`). It's required
# by:
#   - src/scrapers/youtube_scraper.py's Whisper-fallback audio download +
#     ffmpeg chunking (already shells out to the `ffmpeg` binary directly).
#   - moviepy (local video audio extraction).
#   - api.py's ffprobe-based upload duration check (upload duration cap) — reads a just-uploaded video's duration via `ffprobe`
#     BEFORE a job is created, so a low-bitrate long recording can't sneak
#     under the 500MB size ceiling and bypass the 60-minute cost-control
#     cap the way a plain file-size check alone would allow.
# Switching Render's service type to Docker and pointing it at this file is
# what actually gets `ffmpeg`/`ffprobe` onto PATH in production.

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copied and installed before the rest of the source so `docker build`
# only re-runs `pip install` when requirements.txt itself changes, not on
# every code edit.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Unbuffered so structlog/print output shows up immediately in Render's
# log stream instead of sitting in a buffer.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Render sets $PORT at runtime; falls back to 8000 for `docker run` locally.
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
