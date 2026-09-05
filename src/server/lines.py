"""Teachable variation lines for the "Show me the idea" explorer.

Builds a short engine line (up to ten half-moves) with a spoken-friendly
comment per ply, using only coded move facts — no language model, so it is
fast and works offline. Comments stay strictly factual (piece, squares,
capture, check, castle, promotion) plus the line's overall engine verdict.

Trap lines: from a MultiPV result, tempting-but-flawed human moves
(naturalness × win% drop) are extracted with their refutation riding along
in the line's own PV tail — no extra engine calls needed.
"""

from __future__ import annotations

import math

import chess

PIECE_NAMES = {
    chess.PAWN: "Pawn",
    chess.KNIGHT: "Knight",
    chess.BISHOP: "Bishop",
    chess.ROOK: "Rook",
    chess.QUEEN: "Queen",
    chess.KING: "King",
}

MAX_PLIES = 10

# Win% classification mirrors coach.py so traps and coaching agree.
_TRAP_WINDROP = 10.0

# Central squares humans naturally play toward.
_CENTER = {
    chess.square(f, r)
    for f in range(2, 6)
    for r in range(2, 6)
}


def win_percent(cp: int) -> float:
    """Win probability (0-100) from White's perspective. Same curve as coach."""
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp)) - 1.0)


def naturalness(board: chess.Board, move: chess.Move) -> int:
    """How tempting a move looks to a human (0-3+), no search required."""
    score = 0
    if board.is_capture(move):
        score += 3
    if board.gives_check(move):
        score += 3
    if board.is_castling(move):
        score += 2
    piece = board.piece_at(move.from_square)
    if piece is not None and piece.piece_type in (
        chess.KNIGHT,
        chess.BISHOP,
        chess.PAWN,
        chess.QUEEN,
    ):
        if move.to_square in _CENTER:
            score += 2
    if move.promotion:
        score += 3
    return score


def find_traps(
    fen: str,
    lines: list,
    max_traps: int = 2,
) -> list[dict]:
    """Extract tempting-but-flawed lines from a MultiPV result.

    ``lines`` are engine LineInfo-like objects with ``pv`` (UCI list),
    ``score_cp``/``score_mate`` (White POV). Returns trap dicts with SAN
    moves, refutation PV, and a human-story hook — all from the single
    MultiPV result, no extra searches.
    """
    board = chess.Board(fen)
    try:
        best_cp = lines[0].score_cp if lines[0].score_cp is not None else 0
    except (IndexError, AttributeError):
        return []
    best_win = win_percent(best_cp)
    traps: list[dict] = []
    for line in lines[1:]:
        pv = list(getattr(line, "pv", []) or [])
        if not pv:
            continue
        try:
            first = chess.Move.from_uci(pv[0])
        except ValueError:
            continue
        if first not in board.legal_moves:
            continue
        tempting = naturalness(board, first)
        if tempting < 2:
            continue
        line_cp = line.score_cp if line.score_cp is not None else 0
        drop = best_win - win_percent(line_cp)
        if drop < _TRAP_WINDROP:
            continue
        # Refutation rides along in the line's own PV tail.
        refutation: list[str] = []
        walker = board.copy()
        for uci in pv[:6]:
            try:
                mover = chess.Move.from_uci(uci)
            except ValueError:
                break
            if mover not in walker.legal_moves:
                break
            refutation.append(walker.san(mover))
            walker.push(mover)
        try:
            san = board.san(first)
        except (ValueError, AssertionError):
            san = pv[0]
        traps.append({
            "move_uci": pv[0],
            "move_ucis": pv[:6],
            "score_cp": line.score_cp,
            "score_mate": line.score_mate,
            "move_san": san,
            "tempting_because": _tempting_reason(board, first),
            "win_drop": round(drop, 1),
            "refutation_san": refutation,
        })
    traps.sort(key=lambda trap: trap["win_drop"], reverse=True)
    return traps[:max_traps]


def _tempting_reason(board: chess.Board, move: chess.Move) -> str:
    """One honest clause explaining why a human reaches for this move."""
    if board.is_capture(move):
        return "it grabs material"
    if board.gives_check(move):
        return "it gives check"
    if board.is_castling(move):
        return "it tucks the king away"
    if move.promotion:
        return "it promotes"
    return "it develops toward the center"

PIECE_NAMES = {
    chess.PAWN: "Pawn",
    chess.KNIGHT: "Knight",
    chess.BISHOP: "Bishop",
    chess.ROOK: "Rook",
    chess.QUEEN: "Queen",
    chess.KING: "King",
}

MAX_PLIES = 10


def describe_score(score_cp: int | None, score_mate: int | None) -> str:
    """White-relative engine verdict in plain words."""
    if score_mate:
        if score_mate > 0:
            return f"White mates in {score_mate}."
        return f"Black mates in {abs(score_mate)}."
    if score_cp is None:
        return "The engine calls it unclear."
    pawns = abs(score_cp) / 100
    if pawns < 0.3:
        return "The engine calls it level."
    leader = "White" if score_cp > 0 else "Black"
    return f"The engine rates this {pawns:.1f} pawns for {leader}."


def ply_comment(
    board_before: chess.Board,
    move: chess.Move,
    san: str,
    is_last: bool,
    score_cp: int | None,
    score_mate: int | None,
) -> str:
    """One short factual comment for a single ply (spoken aloud on step)."""
    piece = board_before.piece_at(move.from_square)
    name = PIECE_NAMES.get(piece.piece_type, "Piece") if piece else "Piece"
    dest = chess.square_name(move.to_square)
    parts: list[str] = []

    if board_before.is_castling(move):
        side = "kingside" if chess.square_file(move.to_square) == 6 else "queenside"
        parts.append(f"{name} castles {side} for safety.")
    elif move.promotion:
        promo = PIECE_NAMES.get(move.promotion, "queen")
        parts.append(f"{name} promotes to {promo} on {dest}.")
    else:
        parts.append(f"{name} to {dest}.")
    if board_before.is_capture(move):
        parts.append(f"Takes on {dest}.")
    board_after = board_before.copy()
    board_after.push(move)
    if board_after.is_checkmate():
        parts.append("Checkmate.")
    elif board_after.is_check():
        parts.append("Check — the king must move, block, or capture.")
    if is_last:
        parts.append(describe_score(score_cp, score_mate))
    return " ".join(parts)


def build_teachable_line(
    fen: str,
    pv_uci: list[str],
    score_cp: int | None,
    score_mate: int | None,
    depth: int,
    max_plies: int = MAX_PLIES,
) -> dict:
    """Walk a PV from ``fen``, stopping at illegal moves or ``max_plies``."""
    limit = max(1, min(int(max_plies or MAX_PLIES), MAX_PLIES))
    board = chess.Board(fen)
    plies: list[dict] = []
    for uci in pv_uci[:limit]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        san = board.san(move)
        comment = ply_comment(board, move, san, False, score_cp, score_mate)
        board.push(move)
        plies.append({
            "ply": len(plies) + 1,
            "san": san,
            "uci": uci,
            "fen_after": board.fen(),
            "comment": comment,
            # Flags need the pre-move board; corrected in the pass below.
            "capture": False,
            "check": False,
            "checkmate": False,
            "castle": False,
        })
    # Fix flags that need the pre-move board, and mark the true last comment.
    board = chess.Board(fen)
    for i, ply in enumerate(plies):
        move = chess.Move.from_uci(ply["uci"])
        ply["capture"] = board.is_capture(move)
        ply["castle"] = board.is_castling(move)
        if i == len(plies) - 1:
            ply["comment"] = ply_comment(
                board, move, ply["san"], True, score_cp, score_mate
            )
        board.push(move)
    return {
        "fen": fen,
        "depth": depth,
        "score_cp": score_cp,
        "score_mate": score_mate,
        "verdict": describe_score(score_cp, score_mate),
        "moves": plies,
    }
