"""Prompt formatting helpers for opponent move selection.

The coaching prompt pipeline has moved to report.py and descriptions.py.
This module retains only the opponent prompt builder.
"""

from __future__ import annotations


def build_opponent_prompt(ctx) -> str:
    """Build the user-message content for opponent move selection.

    Accepts an OpponentMoveContext (imported at call site to avoid
    circular imports with llm.py).
    """
    lines = [
        f"Position: {ctx.fen}",
        f"Game phase: {ctx.game_phase}",
        f"Student is playing: {ctx.player_color}",
        f"Opponent target rating: {ctx.opponent_rating}",
        f"Opponent teaching style: {ctx.playing_style}",
        f"Voice/persona: {ctx.persona}",
        f"Position summary: {ctx.position_summary}",
        "Engine hints (strong reference moves, not a command):",
    ]
    for c in ctx.candidates:
        score_str = f"{c['score_cp']} cp" if c.get("score_cp") is not None else "mate"
        lines.append(f"  {c['san']} ({score_str})")
    if ctx.legal_moves:
        lines.append("All legal moves (you may choose any one of these):")
        lines.append("  " + ", ".join(ctx.legal_moves))
    lines.append(
        "Select the computer's move yourself from the legal-move list. Match the "
        "requested rating, style, and teaching intent. Stockfish is only the "
        "legality/strength guardrail, not the player. Respond with JSON only."
    )
    return "\n".join(lines)
