"""Opponent move selection module.

Extracts opponent move logic from the game loop. Stockfish supplies analysis
and safety checks; the configured AI chooses the actual legal move.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import logging
import random

import chess

from server.analysis import GamePhase, analyze, detect_game_phase
from server.descriptions import describe_position_from_report
from server.engine import EngineProtocol, MoveInfo
from server.llm import ChessTeacher, OpponentMoveContext
from server.openings import opening_context


# Centipawn thresholds per phase — moves within this delta of the best
# candidate are considered acceptable.
OPENING_CP_THRESHOLD = 30
MIDDLEGAME_CP_THRESHOLD = 75
ENDGAME_CP_THRESHOLD = 20

# Humanlike reply-delay bounds (seconds). Deliberately snappier than the
# maia3-local-stack HumanTime curve this is adapted from: our players asked
# for human rhythm, not human slowness.
HUMAN_DELAY_MIN = 0.6
HUMAN_DELAY_MAX = 4.0


def human_think_delay(board: chess.Board, move_uci: str | None = None) -> float:
    """Seconds a human-like opponent would take before replying.

    Adapted from maia3-local-stack's HumanTime: book-like opening moves are
    quick, captures/checks/promotions take longer, endgames slower than
    openings, with jitter so it never feels metronomic. Only used for
    instant (non-LLM) opponents — language-model turns are slow already.
    """
    num_legal = 0
    try:
        num_legal = sum(1 for _ in board.legal_moves)
    except (ValueError, AssertionError):
        num_legal = 20
    base = 1.0 + min(num_legal / 12.0, 2.0)
    if move_uci:
        try:
            move = chess.Move.from_uci(move_uci)
            if board.is_capture(move):
                base += 0.8
            board.push(move)
            if board.is_check():
                base += 0.8
            board.pop()
            if move.promotion:
                base += 1.0
        except (ValueError, AssertionError):
            pass
    try:
        pieces = len(board.piece_map())
    except (ValueError, AssertionError):
        pieces = 20
    if pieces >= 28:
        base *= 0.7
    elif pieces <= 12:
        base *= 1.2
    delay = base * random.uniform(0.7, 1.3)
    return max(HUMAN_DELAY_MIN, min(delay, HUMAN_DELAY_MAX))

CANDIDATE_COUNT = 5
SELECTION_DEPTH = 12

logger = logging.getLogger(__name__)


@dataclass
class OpponentMoveResult:
    uci: str
    san: str
    phase: GamePhase
    reason: str | None = None   # LLM's rationale (for logging)
    method: str = "local-engine"  # "llm" or "local-engine"


class AIUnavailableError(RuntimeError):
    """Raised when no AI can choose the opponent's move.

    A configured language model is never silently replaced by a different
    move source. The explicit no-key guest mode is the only mode that uses
    the local Stockfish player.
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


def _selection_depth(opponent_rating: int) -> int:
    """Choose a responsive local-engine depth for the selected practice level.

    The rating is a practice target, not a claim that Stockfish has an Elo.
    Stronger targets get a deeper search and always use the top engine move;
    lower targets sample from a narrow top set in ``_select_local_engine``.
    """
    if opponent_rating < 900:
        return 10
    if opponent_rating < 1300:
        return 13
    if opponent_rating < 1700:
        return 16
    if opponent_rating < 2100:
        return 19
    return 22


def _engine_reason(board: chess.Board, move: chess.Move, rank: int) -> str:
    """Give the local engine move a factual, non-anthropomorphic explanation."""
    san = board.san(move)
    if san.endswith("#"):
        return f"{san} is a forced checkmate found by the local engine."
    if san.endswith("+"):
        return f"{san} is a forcing check; you must answer the king threat."
    if "x" in san:
        return f"{san} wins or recovers material while preserving the engine's best continuation."
    if san.startswith("O-O"):
        return f"{san} secures the king and activates a rook according to the local engine."
    if rank == 0:
        return f"{san} is the local engine's top move: it improves the position and avoids the immediate tactical errors."
    return f"{san} is a near-top local-engine move chosen to keep the practice game less predictable."


async def _select_local_engine_move(
    board: chess.Board,
    engine: EngineProtocol,
    opponent_rating: int,
) -> OpponentMoveResult:
    """Play a legal, engine-backed move in the no-key guest mode.

    This is deliberately separate from LLM selection. It is the honest
    always-available fallback: the local engine chooses the move, with a
    small top-line sample at lower practice ratings. It never uses the old
    hand-written policy and never claims to be a language model.
    """
    phase = detect_game_phase(board)
    try:
        candidates = await engine.best_moves(
            board.fen(), n=CANDIDATE_COUNT, depth=_selection_depth(opponent_rating)
        )
    except Exception as exc:  # pragma: no cover - depends on local engine
        logger.warning("Local engine player unavailable: %s", exc)
        raise AIUnavailableError(
            "The local Stockfish player is unavailable. Start Stockfish or connect a language model."
        ) from exc

    legal = {move.uci(): move for move in board.legal_moves}
    ranked = [candidate for candidate in candidates if candidate.uci in legal]
    if not ranked:
        raise AIUnavailableError(
            "The local Stockfish player returned no legal move. No move was made."
        )

    # A high target should play the engine's top line. Lower targets get a
    # deterministic choice from the first few engine lines, never from an
    # unsearched arbitrary legal move.
    width = 1 if opponent_rating >= 1800 else 2 if opponent_rating >= 1200 else 3
    width = min(width, len(ranked))
    digest = hashlib.sha256(
        f"{board.fen()}|{opponent_rating}".encode()
    ).digest()
    rank = int.from_bytes(digest[:4], "big") % width
    selected = ranked[rank]
    move = legal[selected.uci]
    return OpponentMoveResult(
        uci=move.uci(),
        san=board.san(move),
        phase=phase,
        reason=_engine_reason(board, move, rank),
        method="local-engine",
    )


async def select_opponent_move(
    board: chess.Board,
    engine: EngineProtocol,
    teacher: ChessTeacher | None = None,
    opponent_rating: int = 1200,
    playing_style: str = "balanced",
    persona: str = "Anna Cramling",
) -> OpponentMoveResult:
    """Select an opponent move using either a configured LLM or local Stockfish.

    In the explicit no-key mode, Stockfish is the player and is identified as
    such. In a configured LLM mode, Stockfish supplies legal, quality-screened
    candidates and the LLM chooses among them. A failed configured LLM stops
    the turn instead of silently changing the selected player.
    """
    fen = board.fen()
    phase = detect_game_phase(board)
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        raise AIUnavailableError("The position has no legal opponent move.")

    # The built-in provider is the explicit no-key local engine player.
    provider_id = "local"
    if teacher is not None:
        # Real ChessTeacher exposes a synchronous provider_info() method. Keep
        # unit-test doubles and lightweight adapters safe without awaiting a
        # mock coroutine here.
        config = getattr(teacher, "_config", None)
        configured_id = getattr(config, "provider", None)
        provider_id = configured_id if isinstance(configured_id, str) else "remote"

    if teacher is None or provider_id == "local":
        return await _select_local_engine_move(board, engine, opponent_rating)

    try:
        candidates = await engine.best_moves(
            fen, n=CANDIDATE_COUNT, depth=max(SELECTION_DEPTH, 16)
        )
    except Exception as exc:  # pragma: no cover - depends on external engine
        logger.warning("Stockfish candidate generation unavailable for LLM move: %s", exc)
        raise AIUnavailableError(
            "Stockfish could not verify candidate moves for the selected language model. No move was made."
        ) from exc

    filtered = filter_candidates(candidates, phase)

    def _make_result(move_obj: chess.Move, method: str, reason: str | None = None):
        return OpponentMoveResult(
            uci=move_obj.uci(),
            san=board.san(move_obj),
            phase=phase,
            reason=reason,
            method=method,
        )

    if not filtered:
        raise AIUnavailableError(
            "Stockfish returned no safe candidates for the selected language model. No move was made."
        )

    # Build context for LLM selection. The model sees the legal move list for
    # context, but can only select from Stockfish's screened shortlist. This
    # preserves human-style choice without allowing an ungrounded blunder.
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
            opening_context=opening_context(board),
        )
        result = await teacher.select_teaching_move(ctx)
    except Exception as exc:  # provider failures must not change the player
        logger.warning("Configured AI opponent failed: %s", exc)
        result = None

    if isinstance(result, (tuple, list)) and len(result) >= 2:
        selected_san, reason = result
        normalized = selected_san.strip().replace("0-0-0", "O-O-O").replace("0-0", "O-O")
        normalized = normalized.rstrip("!?+#")
        # Enforce the contract from OPPONENT_SYSTEM_PROMPT. A model may only
        # choose from Stockfish-screened candidates; merely being legal is not
        # enough to bypass the tactical guardrail.
        legal_uci = {move.uci() for move in legal_moves}
        screened_moves = [
            chess.Move.from_uci(candidate.uci)
            for candidate in filtered
            if candidate.uci in legal_uci
        ]
        for move_obj in screened_moves:
            legal_san = board.san(move_obj)
            if legal_san.rstrip("!?+#") == normalized or move_obj.uci() == selected_san.strip():
                return _make_result(move_obj, method="llm", reason=reason)

    raise AIUnavailableError(
        "The selected language model was unavailable or returned an invalid move. No move was made."
    )
