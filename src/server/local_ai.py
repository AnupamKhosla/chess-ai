"""A tiny, no-key local chess player.

This is deliberately independent from Stockfish. It is only the explicitly
selected no-key guest chat explainer; configured language-model failures are
reported to the user instead of being silently routed here. It is a lightweight
policy, not an evaluation engine.

The boundary matters: Stockfish may explain a position, but this module is the
only built-in component allowed to choose the computer's move.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass

import chess


@dataclass(frozen=True)
class LocalMove:
    uci: str
    san: str
    reason: str


_PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20_000,
}


def _center_bonus(square: chess.Square) -> int:
    file_distance = abs(chess.square_file(square) - 3.5)
    rank_distance = abs(chess.square_rank(square) - 3.5)
    return int(max(0, 28 - 8 * (file_distance + rank_distance)))


def _is_development(board: chess.Board, move: chess.Move) -> bool:
    piece = board.piece_at(move.from_square)
    if piece is None:
        return False
    return piece.piece_type in {chess.KNIGHT, chess.BISHOP} and chess.square_rank(move.from_square) in {0, 7}


def _opening_preference(board: chess.Board, move: chess.Move, style: str) -> int:
    """Return a style-aware bonus for common, human teaching plans."""
    san = board.san(move)
    text = style.lower()
    bonus = 0

    if board.fullmove_number <= 8:
        if san in {"Nf6", "Nc6", "Be7", "Bc5", "d5", "e5"}:
            bonus += 32
        if "dutch" in text or "stonewall" in text or "f-pawn" in text or "f pawn" in text:
            if san == "f5":
                # When the student explicitly asks for this lesson, honour
                # the thematic ...f5 plan instead of quietly reverting to a
                # generic developing move.
                bonus += 260
            if san in {"Nf6", "e6", "d5", "c5"}:
                bonus += 48
        if any(word in text for word in ("attack", "gambit", "aggressive", "sacrifice")):
            if san in {"f5", "c5", "e5", "d5", "Bc5", "Nc6"}:
                bonus += 42

    if san in {"O-O", "O-O-O"}:
        bonus += 42
    return bonus


def _score_move(board: chess.Board, move: chess.Move, style: str, rating: int) -> int:
    piece = board.piece_at(move.from_square)
    captured = board.piece_at(move.to_square)
    if piece is None:
        return -10_000

    score = _opening_preference(board, move, style)
    score += _center_bonus(move.to_square)
    if _is_development(board, move):
        score += 34
    if captured is not None:
        # Captures are useful, but avoid the simplistic "always capture"
        # behaviour by rewarding valuable captures only moderately.
        score += 24 + _PIECE_VALUES[captured.piece_type] // 18
        if _PIECE_VALUES[piece.piece_type] > _PIECE_VALUES[captured.piece_type]:
            score -= 18
    if move.promotion:
        score += 800

    probe = board.copy(stack=False)
    probe.push(move)
    if probe.is_check():
        score += 105
    if probe.is_checkmate():
        score += 100_000
    if board.is_castling(move):
        score += 50

    # Lower ratings choose among more moves; high ratings stay closer to the
    # policy's top choice.  This is a teaching dial, not a claim of Elo.
    if rating < 1000:
        score -= max(0, chess.square_rank(move.to_square) - 4) * 2
    return score


def choose_local_move(
    board: chess.Board,
    *,
    opponent_rating: int = 1200,
    playing_style: str = "balanced",
) -> LocalMove:
    """Choose one legal move instantly without an engine or network call."""
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        raise ValueError("No legal moves remain")

    ranked = sorted(
        ((_score_move(board, move, playing_style, opponent_rating), move) for move in legal_moves),
        key=lambda item: item[0],
        reverse=True,
    )
    # A little deterministic variety makes repeated games less robotic while
    # keeping the result reproducible for a saved position.
    requested_structure = any(
        word in playing_style.lower()
        for word in ("dutch", "stonewall", "f-pawn", "f pawn")
    )
    if requested_structure:
        width = 1
    elif opponent_rating < 1100:
        width = min(5, len(ranked))
    elif opponent_rating < 1500:
        width = min(3, len(ranked))
    else:
        width = min(2, len(ranked))
    digest = hashlib.sha256(f"{board.fen()}|{playing_style}|{opponent_rating}".encode()).digest()
    rng = random.Random(int.from_bytes(digest[:8], "big"))
    _, move = ranked[rng.randrange(width)]
    san = board.san(move)

    if board.is_checkmate() or san.endswith("#"):
        reason = "I found a forced checkmate."
    elif san.startswith("O-O"):
        reason = "I secured the king and brought a rook toward the centre."
    elif "x" in san:
        reason = f"I chose {san} to create immediate material or tactical pressure."
    elif san.endswith("+"):
        reason = f"{san} gives check and makes you answer a concrete threat."
    elif san in {"f5", "f4"} and any(word in playing_style.lower() for word in ("dutch", "stonewall", "f-pawn", "f pawn")):
        reason = f"{san} starts the requested Dutch/Stonewall-style plan and challenges the centre."
    elif _is_development(board, move):
        reason = f"{san} develops a piece and keeps the position easy to understand."
    else:
        reason = f"{san} follows the local free policy: improve a piece, control the centre, and keep a clear plan."

    return LocalMove(uci=move.uci(), san=san, reason=reason)


def local_coach_reply(message: str, board: chess.Board, *, opponent_rating: int = 1200) -> str:
    """Give useful no-key chat guidance when no language model is connected."""
    text = message.lower()
    turn = "White" if board.turn == chess.WHITE else "Black"
    if any(word in text for word in ("stonewall", "dutch", "f pawn", "f-pawn")):
        return (
            f"For a Dutch/Stonewall position, watch the e5-square and the timing of ...c5. "
            f"Before every move, check your opponent's checks, captures, and threats; then ask whether "
            f"you can challenge the d5 chain with e4 or c4. It is {turn} to move here, against a target "
            f"of {opponent_rating}."
        )
    if any(word in text for word in ("why", "plan", "thinking", "idea")):
        return (
            f"Use a simple human checklist in this position: identify the opponent's last-move threat, "
            f"look at forcing checks/captures, then compare one developing move with one pawn break. "
            f"It is {turn} to move. I can give deeper wording when you connect a language model, but this "
            "local coach is ready without a key."
        )
    return (
        f"I’m the free local chess coach: no key, no network, and no Stockfish move substitution. "
        f"The board is on {turn} to move. Tell me an opening, weakness, or training theme and I’ll turn "
        "the position into a concrete checklist."
    )
