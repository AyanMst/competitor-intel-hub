"""Scrapers for fetching transcripts and metadata from video platforms."""

from src.scrapers.youtube_scraper import YouTubeScraper
from src.scrapers.video_transcriber import extract_audio, transcribe_audio, transcribe_video

__all__ = ["YouTubeScraper", "extract_audio", "transcribe_audio", "transcribe_video"]
