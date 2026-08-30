import pytest

from server.game import GameManager
from server.providers import ProviderConfig, provider_catalog


def test_provider_public_metadata_never_contains_api_key():
    config = ProviderConfig(
        provider="deepseek",
        kind="openai-compatible",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-flash",
        api_key="do-not-return-this",
    )
    public = config.public()
    assert public["has_api_key"] is True
    assert "api_key" not in public
    assert "do-not-return-this" not in str(public)


def test_provider_catalog_includes_subscription_and_local_options():
    ids = {item["id"] for item in provider_catalog(ProviderConfig())}
    assert {"gemini", "groq", "deepseek", "openai", "anthropic", "ollama", "lmstudio", "codex", "claude"} <= ids


@pytest.mark.asyncio
async def test_chat_keeps_continuous_history():
    class FakeTeacher:
        def __init__(self):
            self.calls = []

        async def chat_conversation(self, **kwargs):
            self.calls.append(kwargs)
            return f"I remember: {len(kwargs['history'])} earlier messages."

        def provider_info(self):
            return {"provider": "test", "model": "test", "has_api_key": False}

    teacher = FakeTeacher()
    manager = GameManager(engine=None, teacher=teacher)  # type: ignore[arg-type]
    session_id, _, _ = manager.new_game()

    first = await manager.chat(session_id, "What should I watch for?")
    second = await manager.chat(session_id, "And what is my plan now?")

    assert first["message"] == "I remember: 0 earlier messages."
    assert second["message"] == "I remember: 2 earlier messages."
    assert len(teacher.calls) == 2
    assert teacher.calls[1]["history"] == [
        {"role": "user", "text": "What should I watch for?"},
        {"role": "assistant", "text": "I remember: 0 earlier messages."},
    ]


@pytest.mark.asyncio
async def test_game_session_persists_game_and_chat(tmp_path):
    class FakeTeacher:
        async def chat_conversation(self, **kwargs):
            return "Keep developing and check forcing moves."

        def provider_info(self):
            return {"provider": "test", "model": "test", "has_api_key": False}

    database = tmp_path / "sessions.db"
    first = GameManager(engine=None, teacher=FakeTeacher(), session_db_path=str(database))  # type: ignore[arg-type]
    session_id, _, _ = first.new_game(elo_profile="beginner")
    first.get_game(session_id).board.push_uci("e2e4")  # type: ignore[union-attr]
    await first.chat(session_id, "What is my plan?")

    second = GameManager(engine=None, teacher=FakeTeacher(), session_db_path=str(database))  # type: ignore[arg-type]
    restored = second.snapshot(session_id)
    assert restored is not None
    assert restored["moves"] == ["e4"]
    assert restored["elo_profile"] == "beginner"
    assert restored["chat_history"][0]["text"] == "What is my plan?"
