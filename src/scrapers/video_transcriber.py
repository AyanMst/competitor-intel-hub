"""Audio extraction and transcription pipeline for videos without subtitles.

Handles local mp4 video files that ship without built-in captions by
extracting the audio track (via ``moviepy``) and transcribing it with
OpenAI's Whisper API (``whisper-1``). This complements the native-CC /
YouTube-URL fallback flow implemented in ``youtube_scraper.py``.
"""

from __future__ import annotations

import os
import tempfile

import structlog
from moviepy import VideoFileClip
from openai import OpenAI

logger = structlog.get_logger(__name__)


def extract_audio(video_path: str) -> str:
    """Extract the audio track from an mp4 file and save it as a temporary mp3.

    Args:
        video_path: Path to the source mp4 video file on disk.

    Returns:
        The filesystem path to the extracted temporary mp3 audio file.

    Raises:
        FileNotFoundError: If ``video_path`` does not exist.
        ValueError: If the video has no audio track.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    logger.info("audio_extraction_started", video_path=video_path)

    # moviepy writes to a real file on disk, so reserve the path up front.
    fd, audio_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)

    video_clip = None
    try:
        video_clip = VideoFileClip(video_path)
        if video_clip.audio is None:
            raise ValueError(f"No audio track found in video: {video_path}")

        video_clip.audio.write_audiofile(audio_path, logger=None)
        logger.info("audio_extraction_completed", video_path=video_path, audio_path=audio_path)
        return audio_path
    except Exception as e:
        # Defensive cleanup: never leak the reserved temp file on failure.
        if os.path.exists(audio_path):
            os.remove(audio_path)
        logger.error("audio_extraction_failed", video_path=video_path, error=str(e))
        raise
    finally:
        if video_clip is not None:
            video_clip.close()


def transcribe_audio(audio_path: str) -> dict:
    """Transcribe an mp3 audio file to text using OpenAI's Whisper API.

    Requests ``verbose_json`` so the response includes segment-level
    timestamps, which power the timestamp-linked citations feature (mp4
    upload flow only — the YouTube flow does not use this function).

    Args:
        audio_path: Path to the mp3 audio file to transcribe.

    Returns:
        A dict with ``text`` (the full transcript) and ``segments`` (a list
        of ``{"start": float, "text": str}`` dicts in chronological order).
    """
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    logger.info("transcription_started", audio_path=audio_path)
    with open(audio_path, "rb") as audio_file:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    segments = [
        {"start": segment.start, "text": segment.text}
        for segment in (transcript.segments or [])
    ]
    logger.info("transcription_completed", audio_path=audio_path, segment_count=len(segments))
    return {"text": transcript.text, "segments": segments}


def transcribe_video(video_path: str) -> dict:
    """Run the full audio extraction + transcription pipeline for a video file.

    Extracts the audio track, transcribes it via Whisper, and deletes the
    temporary mp3 file immediately once transcription has returned (whether
    it succeeded or raised), so no temp audio is ever left behind on disk.

    Args:
        video_path: Path to the source mp4 video file.

    Returns:
        The same ``{"text": ..., "segments": ...}`` dict as `transcribe_audio`,
        ready to be passed into the semantic LLM analysis pipeline.
    """
    audio_path = extract_audio(video_path)

    try:
        return transcribe_audio(audio_path)
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)
            logger.info("temp_audio_file_deleted", audio_path=audio_path)
