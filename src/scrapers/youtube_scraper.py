"""Scrapes and transcribes YouTube videos (using CC or AI Audio fallback with manual ffmpeg chunking)."""

import os
import tempfile
import glob
import subprocess
from youtube_transcript_api import YouTubeTranscriptApi
from openai import OpenAI
import structlog

logger = structlog.get_logger(__name__)


class VideoValidationError(Exception):
    """Raised by `validate_video` for any URL that must never reach the job queue.

    Pre-flight Validation: POST /analyze (api.py) catches this and
    turns it into a 400 Bad Request, so a private/deleted/live/too-long
    video is rejected at request time instead of silently entering
    `analysis_jobs` and only failing minutes later inside the background
    worker — burning a worker slot (and, for the too-long case, real Whisper
    API cost) on input that could never have succeeded.
    """


def _friendly_download_error(raw_message: str) -> str:
    """Map a yt-dlp DownloadError's raw message to a short, user-facing reason.

    yt-dlp's own messages are written for a CLI user (verbose, sometimes
    mention "ERROR:", ffmpeg, or other internals) — this narrows the common
    cases down to something safe to show directly in an API error response.
    Falls back to a generic message rather than leaking yt-dlp/CLI internals
    for anything not explicitly recognized.
    """
    lowered = raw_message.lower()
    if "private video" in lowered:
        return "This video is private and cannot be analyzed."
    if "sign in to confirm your age" in lowered or "age-restricted" in lowered:
        return "This video is age-restricted and cannot be analyzed without authentication."
    if "removed" in lowered or "unavailable" in lowered or "does not exist" in lowered:
        return "This video is unavailable — it may have been deleted or removed."
    if "premiere" in lowered or "live event will begin" in lowered:
        return "This video is an upcoming live premiere and hasn't started yet."
    if "members-only" in lowered or "join this channel" in lowered:
        return "This video is members-only and cannot be analyzed."
    return "Could not access this video. Please double-check the URL and try again."


class YouTubeScraper:
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        
    def extract_video_id(self, url: str) -> str:
        if "v=" in url:
            return url.split("v=")[1].split("&")[0]
        elif "youtu.be/" in url:
            return url.split("youtu.be/")[1].split("?")[0]
        return url

    def validate_video(self, url: str, max_duration_seconds: int | None = None) -> dict:
        """Pre-flight-check a YouTube URL with yt-dlp metadata only — no download.

        Pre-flight Validation: called by POST /analyze before any
        `analysis_jobs` row is created. `extract_info(..., download=False)`
        only fetches the page/player metadata (title, duration, live status),
        never the actual audio/video stream, so this is cheap enough to run
        synchronously inside the request.

        Raises `VideoValidationError` (never yt-dlp's own exception types —
        callers should not need to know yt-dlp is involved) for: private,
        deleted/removed, age-restricted, live (in progress or upcoming), or
        — when `max_duration_seconds` is given — over the duration cap.

        Returns the subset of yt-dlp's info dict callers might find useful
        (id/title/duration) on success.
        """
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except yt_dlp.utils.DownloadError as e:
            logger.info("scraper_validation_rejected", url=url, reason=str(e))
            raise VideoValidationError(_friendly_download_error(str(e))) from e

        if not info:
            raise VideoValidationError(
                "Could not read this video's metadata. It may be private, deleted, or region-restricted."
            )

        # Covers both "currently streaming" and "scheduled premiere that
        # hasn't started yet" — neither has a finished, transcribable audio
        # track. `is_live` is the older/simpler flag; `live_status` is
        # yt-dlp's more granular field and is checked defensively in case a
        # future yt-dlp version stops setting `is_live` for upcoming streams.
        if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
            raise VideoValidationError(
                "Live videos and upcoming premieres are not supported. "
                "Please provide a URL to a video that has finished streaming."
            )

        duration = info.get("duration")
        if max_duration_seconds is not None and duration is not None and duration > max_duration_seconds:
            raise VideoValidationError(
                f"Video is too long ({duration // 60} min). "
                f"The maximum supported duration is {max_duration_seconds // 60} min."
            )

        return {"id": info.get("id"), "title": info.get("title"), "duration": duration}

    def fetch(self, url: str) -> str:
        logger.info("scraper_fetch_started", url=url)
        video_id = self.extract_video_id(url)
        
        # METHOD 1: Fast & Free Native Subtitles
        try:
            print("[Scraper] Attempting to fetch native CC subtitles...")
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
            text = " ".join([entry['text'] for entry in transcript_list])
            print("[Scraper] Native subtitles found and extracted!")
            logger.info("scraper_native_cc_success")
            return text
        except Exception:
            print("[Scraper] Native CC unavailable. Falling back to Whisper AI...")
            logger.info("scraper_native_cc_failed_starting_whisper")
            return self.fallback_to_whisper(url)

    def list_recent_video_urls(self, channel_url: str, limit: int = 5) -> list[dict]:
        """List a channel's most recent uploads without downloading anything.

        Uses yt-dlp's flat-playlist extraction against the channel's `/videos`
        tab, which only reads upload-list metadata (no audio/video download),
        so it's cheap enough to call on every scheduled poll cycle.
        """
        import yt_dlp

        videos_tab_url = channel_url.rstrip("/")
        if not videos_tab_url.endswith("/videos"):
            videos_tab_url += "/videos"

        ydl_opts = {
            "extract_flat": True,
            "playlist_items": f"1-{limit}",
            "quiet": True,
            "no_warnings": True,
        }

        logger.info("scraper_list_channel_videos_started", channel_url=channel_url)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(videos_tab_url, download=False)

        entries = (info or {}).get("entries") or []
        videos = []
        for entry in entries:
            video_id = entry.get("id")
            if not video_id:
                continue
            videos.append({
                "video_id": video_id,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "title": entry.get("title"),
            })

        logger.info("scraper_list_channel_videos_finished", channel_url=channel_url, found=len(videos))
        return videos

    def fallback_to_whisper(self, url: str) -> str:
        # METHOD 2: AI Audio Transcription with Manual FFmpeg Auto-Chunking
        try:
            import yt_dlp
            
            with tempfile.TemporaryDirectory() as temp_dir:
                # 1. Download the full audio as MP3
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '128',
                    }],
                    'outtmpl': os.path.join(temp_dir, 'full_audio.%(ext)s'),
                    'quiet': True,
                    'no_warnings': True
                }
                
                print("[Scraper] Step 1: Downloading full audio track...")
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                
                audio_path = os.path.join(temp_dir, "full_audio.mp3")
                if not os.path.exists(audio_path):
                    raise Exception("Download failed, MP3 file not found.")
                
                # 2. Slice the audio using raw FFmpeg via subprocess
                print("[Scraper] Step 2: Slicing audio into chunks (10 min each)...")
                chunk_pattern = os.path.join(temp_dir, "chunk_%03d.mp3")
                
                subprocess.run([
                    'ffmpeg', '-y', '-i', audio_path,
                    '-f', 'segment',
                    '-segment_time', '600',
                    '-c', 'copy',
                    chunk_pattern
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                # 3. Process slices through OpenAI Whisper
                chunk_files = sorted(glob.glob(os.path.join(temp_dir, "chunk_*.mp3")))
                if not chunk_files:
                    raise Exception("FFmpeg slicing failed to produce chunks.")
                    
                print(f"[Scraper] Successfully extracted {len(chunk_files)} audio chunks.")
                
                full_transcript = ""
                for idx, chunk_path in enumerate(chunk_files):
                    print(f"[Scraper] Step 3: Transcribing slice {idx + 1}/{len(chunk_files)} with OpenAI Whisper...")
                    with open(chunk_path, "rb") as audio_file:
                        transcript = self.client.audio.transcriptions.create(
                            model="whisper-1", 
                            file=audio_file
                        )
                        full_transcript += transcript.text + " "
                
                print("[Scraper] AI Audio Transcription complete & assembled!")
                logger.info("scraper_whisper_success", total_chunks_processed=len(chunk_files))
                return full_transcript.strip()
                
        except Exception as e:
            logger.error("whisper_fallback_failed", error=str(e))
            print(f"[Scraper] ERROR during Whisper fallback: {str(e)}")
            return ""