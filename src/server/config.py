"""Centralized application configuration.

All settings are read from environment variables (or a .env file).
The checked-in defaults use OpenCode's keyless Big Pickle trial for local
natural-language coaching.  A provider selected in .env.chess or through the
browser's AI settings still overrides those defaults.

We read from .env.chess instead of .env because ChromaDB's Settings
class (also a BaseSettings subclass with extra="forbid") auto-reads
.env and rejects any keys it doesn't recognize.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.chess", env_file_encoding="utf-8",
    )

    # LLM (OpenAI-compatible — works with Ollama, OpenRouter, litellm, etc.)
    # OpenCode Big Pickle is the default conversational AI. The explicit
    # ``local`` provider remains available as a no-network Stockfish player.
    llm_provider: str = "opencode-free"
    llm_base_url: str = "https://opencode.ai/zen"
    llm_model: str = "big-pickle"
    llm_api_key: str | None = None
    llm_timeout: float = 30.0
    llm_effort: str = "auto"

    # Embeddings (defaults to LLM service if not set separately)
    embed_base_url: str | None = None
    embed_model: str = "nomic-embed-text"
    embed_api_key: str | None = None

    # Stockfish
    stockfish_path: str = "stockfish"
    stockfish_hash_mb: int = 64
    stockfish_mode: str = "local"  # "local" (subprocess) or "browser" (WebSocket)

    # Data paths
    chromadb_dir: str = "data/chromadb"
    puzzle_db_path: str = "data/puzzles.db"
    session_db_path: str = "data/sessions.db"

    # RAG configuration
    # OpenCode is a chat endpoint, not an embedding service. RAG becomes
    # active only when the user supplies an explicit embedding endpoint.
    rag_top_k: int = 0  # Number of knowledge chunks to retrieve (0 = disabled)

    # Initialization
    auto_init_puzzles: bool = True

    @property
    def effective_embed_base_url(self) -> str:
        """Embedding base URL, falling back only for known compatible services.

        OpenCode's free chat route is not assumed to expose embeddings. This
        prevents a fresh install from trying ``/v1/embeddings`` against a
        chat-only provider; configure EMBED_BASE_URL explicitly for RAG.
        """
        if self.embed_base_url:
            return self.embed_base_url
        if self.llm_provider == "opencode-free":
            return ""
        return self.embed_base_url or self.llm_base_url

    @property
    def effective_embed_api_key(self) -> str | None:
        """Embedding API key, falling back to llm_api_key."""
        if self.embed_base_url:
            return self.embed_api_key
        if self.llm_provider == "opencode-free":
            return None
        return self.embed_api_key or self.llm_api_key
