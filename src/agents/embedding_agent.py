import os

from openai import OpenAI
import structlog

logger = structlog.get_logger(__name__)

# Matches the `vector(1536)` column/RPC param declared in schema_search.sql —
# changing this model requires a matching schema migration.
_MODEL = "text-embedding-3-small"


class EmbeddingAgent:
    """Thin wrapper around OpenAI embeddings, mirroring LLMAgent's style."""

    def __init__(self):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts, returning one 1536-dim vector per input in order."""
        if not texts:
            return []

        response = self.client.embeddings.create(model=_MODEL, input=texts)
        return [item.embedding for item in response.data]
