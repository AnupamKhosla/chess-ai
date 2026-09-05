"""One-round Stockfish tool loop for Codex chat turns.

The model may emit a single fenced request to interrogate Stockfish
mid-thought (the "what if" round)::

    ```chesstool
    {"tool": "compare_moves", "candidate_moves": ["e2e4", "d2d4"]}
    ```

Only four whitelisted operations exist, every argument is validated
(including chess legality), and each chat turn gets at most ONE extra
round with bounded depth/time. Structured engine evidence — never raw
shell, never unbounded agentic loops.
"""

from __future__ import annotations

import json
import re
from typing import Any

import chess

ALLOWED_TOOLS = {
    "eval_position",
    "eval_move",
    "compare_moves",
    "eval_line",
}

TOOL_BLOCK_RE = re.compile(r"```chesstool\s*(\{.*?\})\s*```", re.IGNORECASE | re.DOTALL)

MAX_TOOL_DEPTH = 18
MAX_LINES = 3


def tools_hint() -> str:
    """Prompt blurb advertising the one-round tool interface."""
    return (
        "If the evidence above is insufficient — for an unlisted candidate, "
        "a direct move comparison, or a user-supplied line — you may request "
        "exactly ONE extra analysis round by replying with ONLY a fenced block:\n"
        '```chesstool\n{"tool": "compare_moves", "candidate_moves": ["e2e4", "d2d4"]}\n```\n'
        "Allowed tools: eval_position, eval_move, compare_moves, eval_line. "
        "Moves may be UCI or SAN and must be legal in the current position. "
        "Omit `fen` to use the current position. Wait for the result before "
        "your final coaching answer. If the student explicitly asks you to "
        "use engine tools or analysis, always comply with exactly one request "
        "block first instead of answering from memory."
    )


def extract_tool_request(text: str) -> dict[str, Any] | None:
    """Pull a whitelisted tool request out of model output, else None."""
    match = TOOL_BLOCK_RE.search(text or "")
    if not match:
        return None
    try:
        request = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(request, dict) or request.get("tool") not in ALLOWED_TOOLS:
        return None
    return request


def _parse_move(board: chess.Board, raw: object) -> chess.Move | None:
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    try:
        move = chess.Move.from_uci(text)
    except ValueError:
        try:
            move = board.parse_san(text)
        except (ValueError, chess.IllegalMoveError, chess.InvalidMoveError):
            return None
    return move if move in board.legal_moves else None


def _score_line(score) -> dict[str, Any]:
    white = score.white()
    return {"cp": white.score(), "mate": white.mate()}


async def execute_tool_request(
    engine: Any,
    fen: str,
    request: dict[str, Any],
    depth: int = 14,
) -> dict[str, Any]:
    """Validate and run one whitelisted Stockfish query. Never raises."""
    from server.lines import win_percent  # local import: single curve everywhere

    tool = request.get("tool")
    depth = max(1, min(int(request.get("depth", depth) or depth), MAX_TOOL_DEPTH))
    try:
        board = chess.Board(fen)
    except ValueError:
        return {"ok": False, "error": "invalid_fen"}
    if board.is_game_over():
        return {"ok": False, "error": "game_over"}

    async def lines_for(position: chess.Board, n: int = MAX_LINES) -> list[dict]:
        infos = await engine.analyze_lines(position.fen(), n=n, depth=depth)
        out = []
        for info in infos[:n]:
            pv = list(info.pv[:6])
            sans: list[str] = []
            walker = position.copy()
            for uci in pv:
                try:
                    mover = chess.Move.from_uci(uci)
                except ValueError:
                    break
                if mover not in walker.legal_moves:
                    break
                sans.append(walker.san(mover))
                walker.push(mover)
            out.append({
                "move_uci": pv[0] if pv else None,
                "move_san": sans[0] if sans else None,
                "cp": info.score_cp,
                "mate": info.score_mate,
                "win_pct": round(win_percent(info.score_cp or 0), 1),
                "pv_san": sans,
            })
        return out

    try:
        if tool == "eval_position":
            return {"ok": True, "tool": tool, "lines": await lines_for(board)}
        if tool == "eval_move":
            move = _parse_move(board, request.get("move"))
            if move is None:
                return {"ok": False, "error": "illegal_move"}
            board.push(move)
            result = {"ok": True, "tool": tool, "played_san": board.peek().uci(),
                      "lines": await lines_for(board)}
            return result
        if tool == "compare_moves":
            raw_moves = request.get("candidate_moves", request.get("moves"))
            if not isinstance(raw_moves, list) or not raw_moves:
                return {"ok": False, "error": "need_candidate_moves"}
            compared = []
            for raw in raw_moves[:4]:
                move = _parse_move(board, raw)
                if move is None:
                    compared.append({"requested": str(raw), "ok": False, "error": "illegal_move"})
                    continue
                probe = board.copy()
                san = probe.san(move)
                probe.push(move)
                after = await lines_for(probe, n=1)
                compared.append({"requested": str(raw), "ok": True, "san": san,
                                 "reply": after[0] if after else None})
            return {"ok": True, "tool": tool, "compared": compared}
        if tool == "eval_line":
            raw_moves = request.get("moves")
            if not isinstance(raw_moves, list) or not raw_moves:
                return {"ok": False, "error": "need_moves"}
            walker = board.copy()
            sans = []
            for raw in raw_moves[:10]:
                move = _parse_move(walker, raw)
                if move is None:
                    return {"ok": False, "error": f"illegal_move_at_ply_{len(sans) + 1}"}
                sans.append(walker.san(move))
                walker.push(move)
            return {"ok": True, "tool": tool, "line_san": sans,
                    "lines": await lines_for(walker)}
        return {"ok": False, "error": "unknown_tool"}
    except (ValueError, AssertionError) as exc:
        return {"ok": False, "error": "engine_error", "message": str(exc)[:200]}


def tool_result_message(request: dict[str, Any], result: dict[str, Any]) -> str:
    """Follow-up user message carrying structured evidence back to the model."""
    return (
        "Controlled Stockfish evidence for your request "
        f"(White POV scores; answer the student now, 20-50 words):\n"
        f"{json.dumps({'request': request, 'result': result}, ensure_ascii=False)[:3000]}"
    )
