"""Centralized application configuration.

All settings are read from environment variables (or a .env file).
LLM_BASE_URL and LLM_MODEL are required — the app will fail at startup
with a clear error if they are not set.

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
    # Ollama is the no-login local default. Hosted providers can be selected
    # from the browser's AI setup menu.
    llm_provider: str = "ollama"
    llm_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "llama3.2"
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
    rag_top_k: int = 3  # Number of knowledge chunks to retrieve (0 = disabled)

    # Initialization
    auto_init_puzzles: bool = True

    @property
    def effective_embed_base_url(self) -> str:
        """Embedding base URL, falling back to llm_base_url."""
        return self.embed_base_url or self.llm_base_url

    @property
    def effective_embed_api_key(self) -> str | None:
        """Embedding API key, falling back to llm_api_key."""
        return self.embed_api_key or self.llm_api_key
