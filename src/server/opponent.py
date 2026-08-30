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
from server.local_ai import choose_local_move


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
    method: str = "local"       # "llm" or "local"


class AIUnavailableError(RuntimeError):
    """Raised when no AI can choose the opponent's move.

    Stockfish is intentionally not an allowed recovery path.  The built-in
    local policy is normally available, but this error keeps the game stopped
    rather than ever making an engine move if that policy is unavailable.
    """


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
    """Select an opponent move. Stockfish can advise, never play.

    A connected language model gets first choice. If it is unavailable or
    returns invalid SAN, the no-key local policy chooses a legal move. That
    policy is deliberately separate from Stockfish, so an AI failure can never
    turn into a silent engine move.
    """
    fen = board.fen()
    phase = detect_game_phase(board)
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        raise AIUnavailableError("The position has no legal opponent move.")

    # The built-in provider is intentionally immediate and does not make a
    # network or Stockfish call. It is the default guest AI for a fresh
    # installation.
    provider_id = "local"
    if teacher is not None:
        # Real ChessTeacher exposes a synchronous provider_info() method. Keep
        # unit-test doubles and lightweight adapters safe without awaiting a
        # mock coroutine here.
        config = getattr(teacher, "_config", None)
        configured_id = getattr(config, "provider", None)
        provider_id = configured_id if isinstance(configured_id, str) else "remote"

    # These are hints for the conversational model only. An engine outage
    # must not prevent the free local player from responding.
    if provider_id == "local":
        candidates = []
    else:
        try:
            candidates = await engine.best_moves(fen, n=CANDIDATE_COUNT, depth=SELECTION_DEPTH)
        except Exception as exc:  # pragma: no cover - depends on external engine
            logger.warning("Stockfish hints unavailable for AI move: %s", exc)
            candidates = []

    filtered = filter_candidates(candidates, phase)

    def _make_result(move_obj: chess.Move, method: str, reason: str | None = None):
        return OpponentMoveResult(
            uci=move_obj.uci(),
            san=board.san(move_obj),
            phase=phase,
            reason=reason,
            method=method,
        )

    if teacher is None or provider_id == "local":
        local = choose_local_move(
            board, opponent_rating=opponent_rating, playing_style=playing_style
        )
        return _make_result(
            chess.Move.from_uci(local.uci), method="local", reason=local.reason
        )

    # Build context for LLM selection. The AI sees every legal move, not just
    # Stockfish's shortlist, so it can choose a teaching move rather than
    # rubber-stamping the engine's first line.
    try:
        report = analyze(board)
        student_is_white = board.turn != chess.WHITE
        pos_desc = describe_position_from_report(report, student_is_white)
        summary = pos_desc.as_text()
        player_color = "White" if board.turn == chess.BLACK else "Black"
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
    except Exception as exc:  # provider failures are recovered by local AI
        logger.warning("Configured AI opponent failed: %s", exc)
        result = None

    if isinstance(result, (tuple, list)) and len(result) >= 2:
        selected_san, reason = result
        normalized = selected_san.strip().replace("0-0-0", "O-O-O").replace("0-0", "O-O")
        normalized = normalized.rstrip("!?+#")
        for move_obj in legal_moves:
            legal_san = board.san(move_obj)
            if legal_san.rstrip("!?+#") == normalized or move_obj.uci() == selected_san.strip():
                return _make_result(move_obj, method="llm", reason=reason)

    # The recovery path is another AI (the no-key local policy), never
    # Stockfish. This keeps the game playable while making the source visible.
    logger.info(
        "Configured AI was unavailable or invalid; using the no-key local AI "
        "(rating=%s, style=%s)", opponent_rating, playing_style,
    )
    local = choose_local_move(
        board, opponent_rating=opponent_rating, playing_style=playing_style
    )
    return _make_result(chess.Move.from_uci(local.uci), method="local", reason=local.reason)
