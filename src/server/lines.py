"""Teachable variation lines for the "Show me the idea" explorer.

Builds a short engine line (up to ten half-moves) with a spoken-friendly
comment per ply, using only coded move facts — no language model, so it is
fast and works offline. Comments stay strictly factual (piece, squares,
capture, check, castle, promotion) plus the line's overall engine verdict.
"""

from __future__ import annotations

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
