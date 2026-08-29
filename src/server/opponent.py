"""Opponent move selection module.

Extracts opponent move logic from the game loop. Stockfish supplies analysis
and safety checks; the configured AI chooses the actual legal move.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging

import chess

from server.analysis import GamePhase, analyze, detect_game_phase
from server.descriptions import describe_position_from_report
from server.engine import EngineProtocol, MoveInfo
from server.llm import ChessTeacher, OpponentMoveContext


# Centipawn thresholds per phase — moves within this delta of the best
# candidate are considered acceptable.
OPENING_CP_THRESHOLD = 30
MIDDLEGAME_CP_THRESHOLD = 75
ENDGAME_CP_THRESHOLD = 20

CANDIDATE_COUNT = 5
SELECTION_DEPTH = 12

logger = logging.getLogger(__name__)


@dataclass
class OpponentMoveResult:
    uci: str
    san: str
    phase: GamePhase
    reason: str | None = None   # LLM's rationale (for logging)
    method: str = "engine"      # "llm" or "engine"


def _cp_threshold(phase: GamePhase) -> int:
    """Return the centipawn tolerance for the given phase."""
    if phase == GamePhase.OPENING:
        return OPENING_CP_THRESHOLD
    if phase == GamePhase.MIDDLEGAME:
        return MIDDLEGAME_CP_THRESHOLD
    return ENDGAME_CP_THRESHOLD


def _score_value(move: MoveInfo) -> int:
    """Extract a comparable centipawn value from a MoveInfo.

    Mate scores are mapped to large values so they sort correctly.
    """
    if move.score_mate is not None:
        if move.score_mate > 0:
            return 10_000 - move.score_mate
        return -10_000 - move.score_mate
    if move.score_cp is not None:
        return move.score_cp
    return 0


def filter_candidates(
    candidates: list[MoveInfo], phase: GamePhase
) -> list[MoveInfo]:
    """Keep moves within epsilon cp of the best. Always returns at least 1."""
    if not candidates:
        return candidates
    threshold = _cp_threshold(phase)
    best_score = _score_value(candidates[0])
    filtered = [
        m for m in candidates
        if abs(_score_value(m) - best_score) <= threshold
    ]
    # Safety: always return at least the best move
    if not filtered:
        filtered = [candidates[0]]
    return filtered


async def select_opponent_move(
    board: chess.Board,
    engine: EngineProtocol,
    teacher: ChessTeacher | None = None,
    opponent_rating: int = 1200,
    playing_style: str = "balanced",
    persona: str = "Anna Cramling",
) -> OpponentMoveResult:
    """Select an opponent move using AI direction plus engine guardrails.

    Stockfish supplies analysis hints and a safe fallback. When a teacher
    provider is configured, the AI chooses the actual move from the full legal
    move list using the requested rating, style, and persona. This means the
    AI is the player; Stockfish is the legality/strength guardrail. A fallback
    is used only when the AI is unavailable or precision leaves no choice.
    """
    fen = board.fen()
    phase = detect_game_phase(board)

    candidates = await engine.best_moves(fen, n=CANDIDATE_COUNT, depth=SELECTION_DEPTH)
    if not candidates:
        raise RuntimeError("Engine returned no moves")

    filtered = filter_candidates(candidates, phase)
    best = filtered[0]

    def _make_result(move_info: MoveInfo, method: str = "engine", reason: str | None = None):
        move_obj = chess.Move.from_uci(move_info.uci)
        return OpponentMoveResult(
            uci=move_info.uci,
            san=board.san(move_obj),
            phase=phase,
            reason=reason,
            method=method,
        )

    # Skip LLM for: single candidate, no teacher, or endgame precision
    if len(filtered) <= 1 or teacher is None or phase == GamePhase.ENDGAME:
        return _make_result(best)

    # Build context for LLM selection. The AI sees every legal move, not just
    # Stockfish's shortlist, so it can play a human-like teaching move rather
    # than merely rubber-stamping the engine's first line.
    report = analyze(board)
    student_is_white = board.turn != chess.WHITE  # student is the side NOT about to move
    pos_desc = describe_position_from_report(report, student_is_white)
    summary = pos_desc.as_text()

    # Determine player color (opponent is the other side)
    player_color = "White" if board.turn == chess.BLACK else "Black"

    legal_moves = list(board.legal_moves)
    candidate_dicts = [
        {"san": board.san(chess.Move.from_uci(m.uci)), "uci": m.uci, "score_cp": m.score_cp}
        for m in filtered
    ]

    ctx = OpponentMoveContext(
        fen=fen,
        game_phase=phase.value,
        position_summary=summary,
        candidates=candidate_dicts,
        player_color=player_color,
        opponent_rating=opponent_rating,
        playing_style=playing_style,
        persona=persona,
        legal_moves=[board.san(move) for move in legal_moves],
    )

    result = await teacher.select_teaching_move(ctx)
    if result is not None:
        selected_san, reason = result
        # Validate the AI's answer against the live board. SAN punctuation is
        # normalized for tolerant parsing, but no unvalidated move can pass.
        normalized = selected_san.strip().replace("0-0-0", "O-O-O").replace("0-0", "O-O")
        normalized = normalized.rstrip("!?+#")
        for move_obj in legal_moves:
            legal_san = board.san(move_obj)
            if legal_san.rstrip("!?+#") == normalized:
                return _make_result(
                    MoveInfo(uci=move_obj.uci(), score_cp=None, score_mate=None),
                    method="llm",
                    reason=reason,
                )
            if move_obj.uci() == selected_san.strip():
                return _make_result(
                    MoveInfo(uci=move_obj.uci(), score_cp=None, score_mate=None),
                    method="llm",
                    reason=reason,
                )

    # Fallback: top engine move
    logger.info(
        "AI opponent unavailable or declined a candidate; using Stockfish fallback "
        "(rating=%s, style=%s)", opponent_rating, playing_style,
    )
    return _make_result(best)
