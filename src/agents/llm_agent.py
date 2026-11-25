import os
import json
import re
from openai import OpenAI
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

logger = structlog.get_logger(__name__)

# Failure marker: a chunk that exhausts every retry (or comes back as
# unparseable JSON despite a successful call) must still show up in the
# saved report instead of silently contributing empty arrays — otherwise a
# real gap in the competitor's analysis looks identical to "nothing
# noteworthy in this chunk", and nothing downstream (dedup, the saved
# report, the UI) can tell the difference.
_INCOMPLETE_MARKER = "[INCOMPLETE - API ERROR]"


class LLMAgent:
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(), reraise=True)
    def _call_chat_completion(self, system_prompt: str, user_content: str) -> str:
        """Raw OpenAI call, isolated so tenacity retries only the network/API
        hop (not JSON parsing) with exponential backoff — up to 3 attempts,
        so a transient rate-limit/5xx no longer silently blanks a chunk's
        claims on the first hiccup. `reraise=True` so callers see the
        original OpenAI exception (for logging/error_message) instead of a
        wrapping `tenacity.RetryError` once attempts are exhausted.
        """
        response = self.client.chat.completions.create(
            model="gpt-4o-mini",  # Keep it fast and cheap
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.2,
        )
        return response.choices[0].message.content

    def _incomplete_chunk_result(self) -> dict:
        """Structured failure indicator for `summarize_chunk`: every pillar gets a visible marker claim instead of an empty
        array, so it survives dedup/aggregation and is saved to the report.
        """
        marker = {"text": _INCOMPLETE_MARKER, "timestamp": None}
        return {
            "new_features": [marker],
            "pricing_changes": [marker],
            "marketing_message": [marker],
            "objections_or_risks": [marker],
        }

    def _clean_json_response(self, raw_text: str) -> dict:
        """Strips markdown code blocks and ensures we return a clean Python dictionary."""
        # Remove ```json from the start and ``` from the end if OpenAI hallucinated them
        cleaned_text = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.IGNORECASE)
        cleaned_text = re.sub(r"\s*```$", "", cleaned_text.strip())

        try:
            return json.loads(cleaned_text)
        except json.JSONDecodeError as e:
            logger.error("json_parse_failed", error=str(e), raw_text=cleaned_text)
            # The API call itself succeeded but returned unparseable JSON —
            # still a failure to extract insights from this chunk, so it
            # gets the same visible marker as an exhausted-retries failure.
            return self._incomplete_chunk_result()

    def summarize_chunk(self, text: str) -> dict:
        """Extract the 4 pillars from one transcript chunk as arrays of claims.

        Each claim is `{"text": ..., "timestamp": <seconds or null>}`. The mp4
        upload flow feeds chunks with inline "[12.3s] ..." markers (see
        TranscriptAnalyser.analyse_segments); the YouTube flow feeds plain
        untagged text, so the model always emits `timestamp: null` there —
        this is what powers the timestamp-linked-citations feature only for
        Whisper-sourced transcripts, with no change to YouTube extraction quality.
        """
        logger.info("llm_processing_chunk")

        system_prompt = """You are an expert B2B Competitive Intelligence Analyst.
Analyze the following text and extract strategic insights.

The text may contain inline time markers like "[12.3s]" before a line, giving the
transcript timestamp (in seconds) at that point. For every claim you extract, set
"timestamp" to the number from the nearest preceding time marker. If the text has
no time markers at all, set "timestamp" to null for every claim.

You MUST respond strictly with a raw JSON object and nothing else. No markdown, no introductions.

Schema:
{
  "new_features": [{"text": "one new feature", "timestamp": number or null}],
  "pricing_changes": [{"text": "one pricing/packaging claim", "timestamp": number or null}],
  "marketing_message": [{"text": "one marketing/positioning claim", "timestamp": number or null}],
  "objections_or_risks": [{"text": "one risk or weakness", "timestamp": number or null}]
}
Return an empty array for any pillar with nothing relevant in this chunk. Do not invent claims."""

        try:
            raw_response = self._call_chat_completion(system_prompt, text)
            return self._clean_json_response(raw_response)

        except Exception as e:
            logger.error("openai_api_error_exhausted_retries", error=str(e))
            return self._incomplete_chunk_result()

    def compare_reports(self, previous: dict, current: dict) -> dict | None:
        """Diff two consolidated 4-pillar battlecards for the same competitor.

        Best-effort: returns None (never raises) on any failure, so change
        detection can never block the core save/analyze flow. Unlike
        `summarize_chunk`, a failure here has nowhere structured to put an
        "incomplete" marker (this isn't a pillar-claims payload) — None
        already means "no diff available" cleanly to every caller
        (`resolve_competitor_and_changes`, `notify_if_notable`), so that
        contract is unchanged; only the underlying API call now retries.
        """
        logger.info("llm_comparing_reports")

        system_prompt = """You are an expert B2B Competitive Intelligence Analyst.
You are given a competitor's PREVIOUS battlecard and their CURRENT (newer) battlecard,
each with the same 4 pillars. Each pillar is a list of claim objects with a "text" field
(ignore the "timestamp" field entirely; it is not relevant to this comparison). For each
pillar, concisely describe what changed between the two (added, removed, or modified). If
a pillar is materially unchanged, respond with exactly "No changes detected." for that pillar.
You MUST respond strictly with a raw JSON object and nothing else. No markdown, no introductions.

Schema:
{
  "new_features": "string describing what changed in the features list",
  "pricing_changes": "string describing what changed in pricing/packaging",
  "marketing_message": "string describing what changed in the marketing message",
  "objections_or_risks": "string describing what changed in risks/weaknesses",
  "has_changes": true or false (false only if all four pillars are unchanged)
}"""

        user_content = json.dumps({"previous_report": previous, "current_report": current})

        try:
            raw_response = self._call_chat_completion(system_prompt, user_content)
            cleaned_text = re.sub(r"^```json\s*", "", raw_response.strip(), flags=re.IGNORECASE)
            cleaned_text = re.sub(r"\s*```$", "", cleaned_text.strip())
            return json.loads(cleaned_text)

        except Exception as e:
            logger.error("report_diff_failed", error=str(e))
            return None
