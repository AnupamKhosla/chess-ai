"""Tests for conversation-mode routing (review/plan/prepare/checkin)."""

from server.game import _CONVERSATION_MODE_NOTES, _conversation_mode


class TestConversationMode:
    def test_review(self):
        assert _conversation_mode("review my game please") == "review"
        assert _conversation_mode("Give me a post-mortem") == "review"
        assert _conversation_mode("how did i play?") == "review"

    def test_plan(self):
        assert _conversation_mode("make me a training plan") == "plan"
        assert _conversation_mode("what should i work on?") == "plan"

    def test_prepare(self):
        assert _conversation_mode("prepare against the sicilian") == "prepare"

    def test_checkin(self):
        assert _conversation_mode("starting a session, warm me up") == "checkin"

    def test_ordinary_chat_returns_none(self):
        assert _conversation_mode("what is the best move here?") is None
        assert _conversation_mode("hey") is None

    def test_every_mode_has_guidance(self):
        for mode in ("review", "plan", "prepare", "checkin"):
            assert mode in _CONVERSATION_MODE_NOTES
            assert "20-50 words" in _CONVERSATION_MODE_NOTES[mode]
