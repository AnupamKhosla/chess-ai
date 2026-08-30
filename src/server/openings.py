"""Small, deterministic opening recognizer for grounded coaching prompts.

The language model should not have to infer an opening name from a FEN.  This
module recognizes common opening prefixes from the preserved move stack and
returns the intent a coach should explain.  It is deliberately factual and
does not evaluate the opening; Stockfish remains responsible for evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess


@dataclass(frozen=True)
class OpeningInfo:
    name: str
    eco: str
    move_prefix: str
    intent: str

    def as_prompt(self) -> str:
        return (
            f"{self.name} ({self.eco}), identified by {self.move_prefix}. "
            f"Opening intent: {self.intent}"
        )


_OPENING_PREFIXES: tuple[tuple[tuple[str, ...], OpeningInfo], ...] = (
    (
        ("e4", "e5", "f4", "exf4", "Bc4"),
        OpeningInfo(
            "King's Gambit Accepted, Bishop's Gambit", "C33",
            "1.e4 e5 2.f4 exf4 3.Bc4",
            "White gives a pawn for rapid development and pressure on f7; Black must consolidate the extra pawn.",
        ),
    ),
    (
        ("e4", "e5", "f4", "exf4"),
        OpeningInfo(
            "King's Gambit Accepted", "C34-C39",
            "1.e4 e5 2.f4 exf4",
            "White offers the f-pawn to open lines and gain time; Black accepts material but must survive the initiative.",
        ),
    ),
    (
        ("e4", "e5", "f4", "d5"),
        OpeningInfo(
            "King's Gambit, Falkbeer Countergambit", "C31",
            "1.e4 e5 2.f4 d5",
            "White has played a genuine gambit, while Black immediately returns the challenge in the center.",
        ),
    ),
    (
        ("e4", "e5", "f4"),
        OpeningInfo(
            "King's Gambit", "C30-C39",
            "1.e4 e5 2.f4",
            "White offers the f-pawn for rapid development, an open f-file, and attacking chances against the black king.",
        ),
    ),
    (
        ("e4", "e5", "Nf3", "Nc6", "Bb5"),
        OpeningInfo(
            "Ruy Lopez", "C60-C99",
            "1.e4 e5 2.Nf3 Nc6 3.Bb5",
            "White develops with pressure on the e5-pawn and the c6-knight, often preparing long-term central pressure.",
        ),
    ),
    (
        ("e4", "e5", "Nf3", "Nc6", "Bc4"),
        OpeningInfo(
            "Italian Game", "C50-C59",
            "1.e4 e5 2.Nf3 Nc6 3.Bc4",
            "White targets f7 and develops quickly toward castling and central or kingside pressure.",
        ),
    ),
    (
        ("e4", "e5", "Nf3", "Nc6", "d4"),
        OpeningInfo(
            "Scotch Game", "C45",
            "1.e4 e5 2.Nf3 Nc6 3.d4",
            "White opens the center immediately to gain development and active piece play.",
        ),
    ),
    (
        ("e4", "c5"),
        OpeningInfo(
            "Sicilian Defense", "B20-B99",
            "1.e4 c5",
            "Black creates an asymmetrical fight and challenges White's central control from the flank.",
        ),
    ),
    (
        ("e4", "e6"),
        OpeningInfo(
            "French Defense", "C00-C19",
            "1.e4 e6",
            "Black prepares ...d5 to challenge the e4-pawn and accepts a strategic battle over the center.",
        ),
    ),
    (
        ("e4", "c6"),
        OpeningInfo(
            "Caro-Kann Defense", "B10-B19",
            "1.e4 c6",
            "Black prepares ...d5 with a solid pawn structure and an active light-squared bishop.",
        ),
    ),
    (
        ("d4", "d5", "c4", "c6"),
        OpeningInfo(
            "Slav Defense", "D10-D19",
            "1.d4 d5 2.c4 c6",
            "Black supports d5 with ...c6 while keeping the c8-bishop's diagonal open.",
        ),
    ),
    (
        ("d4", "d5", "c4"),
        OpeningInfo(
            "Queen's Gambit", "D06-D69",
            "1.d4 d5 2.c4",
            "White offers the c-pawn to build central control and gain a development or space advantage.",
        ),
    ),
    (
        ("d4", "Nf6", "c4", "e6", "Nc3", "Bb4"),
        OpeningInfo(
            "Nimzo-Indian Defense", "E20-E59",
            "1.d4 Nf6 2.c4 e6 3.Nc3 Bb4",
            "Black pins the c3-knight and contests the center with piece pressure rather than an immediate pawn claim.",
        ),
    ),
    (
        ("d4", "Nf6", "c4", "g6", "Nc3", "Bg7"),
        OpeningInfo(
            "King's Indian Defense", "E60-E99",
            "1.d4 Nf6 2.c4 g6 3.Nc3 Bg7",
            "Black allows White a broad center and prepares ...O-O and a later ...e5 or ...c5 counterbreak.",
        ),
    ),
    (
        ("d4", "f5"),
        OpeningInfo(
            "Dutch Defense", "A80-A99",
            "1.d4 f5",
            "Black immediately controls e4 and prepares an unbalanced kingside or Stonewall-style setup.",
        ),
    ),
    (
        ("c4",),
        OpeningInfo(
            "English Opening", "A10-A39",
            "1.c4",
            "White controls d5 from the flank and keeps the central pawn structure flexible.",
        ),
    ),
)


def _history_san(board: chess.Board) -> tuple[str, ...]:
    replay = chess.Board()
    moves: list[str] = []
    for move in board.move_stack:
        moves.append(replay.san(move))
        replay.push(move)
    return tuple(moves)


def identify_opening(board: chess.Board) -> OpeningInfo | None:
    """Return the most specific recognized opening prefix for *board*."""
    history = _history_san(board)
    matches = [
        (len(prefix), info) for prefix, info in _OPENING_PREFIXES
        if len(prefix) <= len(history) and history[:len(prefix)] == prefix
    ]
    return max(matches, key=lambda item: item[0])[1] if matches else None


def opening_context(board: chess.Board) -> str:
    """Return grounded opening information suitable for an AI prompt."""
    info = identify_opening(board)
    if info is None:
        return "No recognized opening prefix yet. Do not invent an opening name."
    return info.as_prompt()
