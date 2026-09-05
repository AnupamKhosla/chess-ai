"""Tests for the one-round Stockfish tool loop (pure parts + one live query)."""

import chess
import pytest

from server.toolsloop import (
    ALLOWED_TOOLS,
    execute_tool_request,
    extract_tool_request,
    tools_hint,
)

STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


class TestExtract:
    def test_valid_block(self):
        text = 'Thinking…\n```chesstool\n{"tool": "compare_moves", "candidate_moves": ["e2e4"]}\n```'
        req = extract_tool_request(text)
        assert req is not None and req["tool"] == "compare_moves"

    def test_no_block(self):
        assert extract_tool_request("Just play e4, it is good.") is None

    def test_disallowed_tool_rejected(self):
        text = '```chesstool\n{"tool": "run_shell", "cmd": "rm"}\n```'
        assert extract_tool_request(text) is None

    def test_broken_json_rejected(self):
        assert extract_tool_request("```chesstool\n{not json\n```") is None

    def test_hint_lists_all_tools(self):
        hint = tools_hint()
        for tool in ALLOWED_TOOLS:
            assert tool in hint


class TestValidation:
    async def test_illegal_move_rejected_without_engine(self):
        class ExplodingEngine:
            async def analyze_lines(self, *args, **kwargs):
                raise AssertionError("engine must not run for illegal moves")

        result = await execute_tool_request(
            ExplodingEngine(), STARTPOS, {"tool": "eval_move", "move": "e2e5"}
        )
        assert result["ok"] is False

    async def test_unknown_tool_rejected(self):
        result = await execute_tool_request(object(), STARTPOS, {"tool": "nope"})
        assert result["ok"] is False

    async def test_bad_fen_rejected(self):
        result = await execute_tool_request(object(), "garbage", {"tool": "eval_position"})
        assert result["ok"] is False


class TestLiveEngine:
    async def test_eval_position(self):
        from server.engine import EngineAnalysis

        engine = EngineAnalysis(hash_mb=32)
        try:
            await engine.start()
            result = await execute_tool_request(
                engine, STARTPOS, {"tool": "eval_position"}, depth=8,
            )
        finally:
            await engine.stop()
        assert result["ok"] is True
        assert len(result["lines"]) >= 1
        assert result["lines"][0]["move_san"]

    async def test_compare_moves(self):
        from server.engine import EngineAnalysis

        engine = EngineAnalysis(hash_mb=32)
        try:
            await engine.start()
            result = await execute_tool_request(
                engine,
                STARTPOS,
                {"tool": "compare_moves", "candidate_moves": ["e2e4", "e2e3", "h2h5"]},
                depth=8,
            )
        finally:
            await engine.stop()
        assert result["ok"] is True
        assert len(result["compared"]) == 3


class TestWhatIf:
    async def test_names_move_gets_evidence(self):
        from server.engine import EngineAnalysis
        from server.game import GameManager

        engine = EngineAnalysis(hash_mb=32)
        try:
            await engine.start()
            games = GameManager(engine=engine)
            evidence = await games._what_if_evidence(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "what if Nf3?",
            )
        finally:
            await engine.stop()
        assert evidence is not None
        assert "Nf3" in evidence

    async def test_no_move_no_evidence(self):
        from server.engine import EngineAnalysis
        from server.game import GameManager

        engine = EngineAnalysis(hash_mb=32)
        try:
            await engine.start()
            games = GameManager(engine=engine)
            assert await games._what_if_evidence(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "coach me generally",
            ) is None
            assert await games._what_if_evidence(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "what if Ke9?",
            ) is None
        finally:
            await engine.stop()
