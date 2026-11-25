"""Transcript analysis and AI pattern extraction."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

import structlog
import yaml

logger = structlog.get_logger(__name__)

_SENTENCE_BREAK_PATTERN = re.compile(r"(?<=[.!?])\s+")


class TranscriptAnalyser:
    """Process scraped text and extract structured research insights."""

    def __init__(self, config_path: str | Path = "config.yaml") -> None:
        self.config_path = Path(config_path)
        self.config = self._load_config()
        self.analyser_config = self.config.get("analysers", {})

    def _load_config(self) -> dict[str, Any]:
        with self.config_path.open(encoding="utf-8") as f:
            return yaml.safe_load(f)

    def analyse(self, text: str) -> dict[str, Any]:
        """
        Process a raw transcript string and return structured metadata.

        Extracts word count, estimated reading time, and splits the text into
        logical chunks sized by ``analysers.chunk_size`` in config.
        """
        logger.info("analysis_started", char_count=len(text))

        normalized_text = self._normalize_text(text)
        logger.info(
            "text_normalized",
            original_char_count=len(text),
            normalized_char_count=len(normalized_text),
        )

        word_count = self._count_words(normalized_text)
        logger.info("word_count_computed", word_count=word_count)

        reading_time = self._estimate_reading_time(word_count)
        logger.info(
            "reading_time_estimated",
            words_per_minute=reading_time["words_per_minute"],
            minutes=reading_time["minutes"],
            seconds=reading_time["seconds"],
        )

        chunk_size = int(self.analyser_config.get("chunk_size", 1000))
        logger.info("chunking_started", chunk_size=chunk_size)

        raw_chunks = self._chunk_text(normalized_text, chunk_size)
        chunks = [
            {"index": index, "text": chunk, "char_count": len(chunk)}
            for index, chunk in enumerate(raw_chunks)
        ]
        logger.info("chunking_completed", chunk_count=len(chunks))

        result = {
            "metadata": {
                "character_count": len(normalized_text),
                "word_count": word_count,
                "estimated_reading_time": reading_time,
                "chunk_count": len(chunks),
                "chunk_size": chunk_size,
            },
            "chunks": chunks,
        }

        logger.info(
            "analysis_completed",
            word_count=word_count,
            chunk_count=len(chunks),
            reading_time_seconds=reading_time["seconds"],
        )
        return result

    def analyse_segments(self, segments: list[dict[str, Any]]) -> dict[str, Any]:
        """Chunk Whisper's timestamped segments for the LLM, tagging each line
        with its start time so per-claim timestamps can be extracted downstream.

        Additive alternative to `analyse()` used only by the mp4 upload flow
        (which has segment data); the YouTube flow keeps calling `analyse()`
        on a flat string, completely untouched by this method.
        """
        logger.info("segment_analysis_started", segment_count=len(segments))

        chunk_size = int(self.analyser_config.get("chunk_size", 1000))
        chunks: list[dict[str, Any]] = []
        current_lines: list[str] = []
        current_char_count = 0

        def flush() -> None:
            if not current_lines:
                return
            text = "\n".join(current_lines)
            chunks.append({"index": len(chunks), "text": text, "char_count": len(text)})

        for segment in segments:
            text = (segment.get("text") or "").strip()
            if not text:
                continue
            line = f"[{segment.get('start', 0.0):.1f}s] {text}"
            if current_lines and current_char_count + len(line) > chunk_size:
                flush()
                current_lines = []
                current_char_count = 0
            current_lines.append(line)
            current_char_count += len(line) + 1

        flush()

        logger.info("segment_analysis_completed", chunk_count=len(chunks))
        return {
            "metadata": {"chunk_count": len(chunks), "chunk_size": chunk_size},
            "chunks": chunks,
        }

    @staticmethod
    def _normalize_text(text: str) -> str:
        if not text:
            return ""
        return re.sub(r"\s+", " ", text.strip())

    @staticmethod
    def _count_words(text: str) -> int:
        if not text:
            return 0
        return len(text.split())

    def _estimate_reading_time(self, word_count: int) -> dict[str, int | float]:
        words_per_minute = int(self.analyser_config.get("words_per_minute", 200))
        if word_count == 0 or words_per_minute <= 0:
            return {
                "words_per_minute": words_per_minute,
                "minutes": 0.0,
                "seconds": 0,
            }

        total_seconds = math.ceil((word_count / words_per_minute) * 60)
        return {
            "words_per_minute": words_per_minute,
            "minutes": round(total_seconds / 60, 2),
            "seconds": total_seconds,
        }

    def _chunk_text(self, text: str, chunk_size: int) -> list[str]:
        if not text:
            logger.warning("chunking_skipped", reason="empty_text")
            return []

        if chunk_size <= 0:
            logger.warning("chunking_skipped", reason="invalid_chunk_size", chunk_size=chunk_size)
            return [text]

        chunks: list[str] = []
        remaining = text

        while remaining:
            if len(remaining) <= chunk_size:
                chunks.append(remaining)
                logger.debug(
                    "chunk_created",
                    chunk_index=len(chunks) - 1,
                    char_count=len(remaining),
                    final_chunk=True,
                )
                break

            split_at = self._find_logical_break(remaining, chunk_size)
            chunk = remaining[:split_at].strip()
            if not chunk:
                chunk = remaining[:chunk_size]
                split_at = chunk_size

            chunks.append(chunk)
            logger.debug(
                "chunk_created",
                chunk_index=len(chunks) - 1,
                char_count=len(chunk),
                final_chunk=False,
            )
            remaining = remaining[split_at:].lstrip()

        return chunks

    @staticmethod
    def _find_logical_break(text: str, chunk_size: int) -> int:
        """Find a split point near chunk_size that respects sentence or word boundaries."""
        window = text[:chunk_size]
        min_break = chunk_size // 2

        paragraph_break = window.rfind("\n\n")
        if paragraph_break >= min_break:
            return paragraph_break + 2

        for match in reversed(list(_SENTENCE_BREAK_PATTERN.finditer(window))):
            if match.end() >= min_break:
                return match.end()

        for punct in (". ", "! ", "? "):
            punct_break = window.rfind(punct)
            if punct_break >= min_break:
                return punct_break + len(punct)

        word_break = window.rfind(" ")
        if word_break > 0:
            return word_break + 1

        return chunk_size
