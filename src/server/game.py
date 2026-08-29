from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field

import chess

from server.analysis import analyze
from server.coach import Arrow, assess_move
from server.elo_profiles import get_profile
from server.engine import EngineProtocol
from server.game_tree import build_coaching_tree
from server.knowledge import query_knowledge
from server.llm import ChessTeacher
from server.opponent import select_opponent_move
from server.rag import ChessRAG
from server.report import serialize_report
from server.session_store import SessionStore


@dataclass
class GameState:
    board: chess.Board = field(default_factory=chess.Board)
    depth: int = 10
    elo_profile: str = "intermediate"
    opponent_rating: int = 1200
    opponent_style: str = "balanced"
    coach_name: str = "Anna Cramling"
    chat_history: list[dict[str, str]] = field(default_factory=list)


def _profile_for_rating(rating: int) -> str:
    """Map a numeric opponent rating to the existing coaching depth profile."""
    if rating < 900:
        return "beginner"
    if rating < 1100:
        return "intermediate"
    if rating < 1300:
        return "advancing"
    if rating < 1600:
        return "club"
    return "competitive"


def _intent_from_message(message: str, current: str = "balanced") -> str:
    """Keep a small, durable style intent between turns without guessing wildly."""
    text = message.lower()
    if any(word in text for word in ("stonewall", "f-pawn", "f pawn", "f4", "f5", "dutch")):
        return "Dutch / Stonewall pressure"
    if any(word in text for word in ("gambit", "attacking", "attack", "sacrifice", "aggressive")):
        return "attacking gambit"
    if any(word in text for word in ("positional", "quiet", "endgame", "solid", "defensive")):
        return "solid positional"
    return current


def _rating_from_message(message: str) -> int | None:
    match = re.search(r"\b([4-9]\d{2}|[12]\d{3}|2000|2100|2200|2300|2400|2500|2600|2700|2800|2900|3000)\s*(?:rated|rating|elo)\b", message.lower())
    if not match:
        return None
    return max(400, min(3000, int(match.group(1))))


def _game_status(board: chess.Board) -> str:
    if board.is_checkmate():
        return "checkmate"
    if board.is_stalemate():
        return "stalemate"
    if board.is_insufficient_material() or board.can_claim_draw():
        return "draw"
    return "playing"


def _game_result(board: chess.Board) -> str | None:
    if board.is_checkmate():
        return "0-1" if board.turn == chess.WHITE else "1-0"
    if board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        return "1/2-1/2"
    return None


def _history_san(board: chess.Board) -> list[str]:
    """Render the board's move stack as SAN without mutating the live board."""
    replay = chess.Board()
    moves: list[str] = []
    for move in board.move_stack:
        moves.append(replay.san(move))
        replay.push(move)
    return moves


class GameManager:
    def __init__(
        self,
        engine: EngineProtocol,
        teacher: ChessTeacher | None = None,
        rag: ChessRAG | None = None,
        rag_top_k: int = 3,
        session_db_path: str | None = None,
    ):
        self._engine = engine
        self._teacher = teacher
        self._rag = rag
        self._rag_top_k = rag_top_k
        self._sessions: dict[str, GameState] = {}
        self._session_store = SessionStore(session_db_path) if session_db_path else None
        self._restore_sessions()

    def _restore_sessions(self) -> None:
        if self._session_store is None:
            return
        for session_id, payload in self._session_store.load_all():
            try:
                moves = payload.get("moves", [])
                board = chess.Board()
                if isinstance(moves, list) and moves:
                    for san in moves:
                        board.push_san(str(san))
                elif isinstance(payload.get("fen"), str):
                    board = chess.Board(payload["fen"])
                history = payload.get("chat_history", [])
                if not isinstance(history, list):
                    history = []
                self._sessions[session_id] = GameState(
                    board=board,
                    depth=int(payload.get("depth", 10)),
                    elo_profile=str(payload.get("elo_profile", "intermediate")),
                    opponent_rating=int(payload.get("opponent_rating", 1200)),
                    opponent_style=str(payload.get("opponent_style", "balanced")),
                    coach_name=str(payload.get("coach_name", "Anna Cramling")),
                    chat_history=[
                        {"role": str(item["role"]), "text": str(item["text"])}
                        for item in history
                        if isinstance(item, dict)
                        and item.get("role") in {"user", "assistant"}
                        and isinstance(item.get("text"), str)
                    ][-40:],
                )
            except (ValueError, KeyError, TypeError):
                logging.getLogger(__name__).warning(
                    "Skipping invalid saved chess session %s", session_id[:8]
                )

    def _persist(self, session_id: str, state: GameState) -> None:
        if self._session_store is None:
            return
        self._session_store.save(session_id, {
            "fen": state.board.fen(),
            "moves": _history_san(state.board),
            "depth": state.depth,
            "elo_profile": state.elo_profile,
            "opponent_rating": state.opponent_rating,
            "opponent_style": state.opponent_style,
            "coach_name": state.coach_name,
            "chat_history": state.chat_history[-40:],
        })

    def new_game(
        self,
        depth: int = 10,
        elo_profile: str = "intermediate",
        coach_name: str = "Anna Cramling",
        opponent_rating: int = 1200,
    ) -> tuple[str, str, str]:
        """Create a new game session. Returns (session_id, fen, status)."""
        session_id = str(uuid.uuid4())
        logging.getLogger(__name__).info(
            f"Creating new game session {session_id[:8]}... with coach='{coach_name}', "
            f"opponent_rating='{opponent_rating}', elo='{elo_profile}'"
        )
        self._sessions[session_id] = GameState(
            depth=depth,
            elo_profile=elo_profile or _profile_for_rating(opponent_rating),
            opponent_rating=max(400, min(3000, int(opponent_rating))),
            coach_name=coach_name,
        )
        self._persist(session_id, self._sessions[session_id])
        return session_id, chess.STARTING_FEN, "playing"

    def get_game(self, session_id: str) -> GameState | None:
        return self._sessions.get(session_id)

    def snapshot(self, session_id: str) -> dict | None:
        """Return enough state for a browser refresh to resume a session."""
        state = self._sessions.get(session_id)
        if state is None:
            return None
        return {
            "session_id": session_id,
            "fen": state.board.fen(),
            "moves": _history_san(state.board),
            "status": _game_status(state.board),
            "result": _game_result(state.board),
            "elo_profile": state.elo_profile,
            "opponent_rating": state.opponent_rating,
            "opponent_style": state.opponent_style,
            "coach_name": state.coach_name,
            "chat_history": state.chat_history[-40:],
        }

    async def chat(
        self,
        session_id: str,
        message: str,
        viewed_fen: str | None = None,
        response_mode: str = "fast",
    ) -> dict:
        """Continue the persistent, board-aware coach conversation."""
        state = self._sessions.get(session_id)
        if state is None:
            raise KeyError(f"Session not found: {session_id}")
        message = message.strip()
        if not message:
            raise ValueError("Write a message first")
        if len(message) > 4000:
            raise ValueError("Keep the message under 4,000 characters")

        state.opponent_style = _intent_from_message(message, state.opponent_style)
        requested_rating = _rating_from_message(message)
        if requested_rating is not None:
            state.opponent_rating = requested_rating
            state.elo_profile = _profile_for_rating(requested_rating)

        context_fen = state.board.fen()
        if viewed_fen:
            try:
                chess.Board(viewed_fen)
                context_fen = viewed_fen
            except ValueError:
                logger = logging.getLogger(__name__)
                logger.warning("Ignoring invalid viewed FEN for chat")

        response: str | None = None
        if self._teacher is not None:
            response = await self._teacher.chat_conversation(
                message=message,
                history=list(state.chat_history),
                fen=context_fen,
                moves=_history_san(state.board),
                side="white",
                coach=state.coach_name,
                elo_profile=state.elo_profile,
                opponent_rating=state.opponent_rating,
                playing_style=state.opponent_style,
                response_mode=response_mode if response_mode in {"fast", "deep"} else "fast",
            )
        answered_by_ai = bool(response)
        if not response:
            response = (
                "I can keep the position and conversation, but the selected AI "
                "provider is not reachable yet. Configure a key or local model "
                "under AI setup, then send your question again."
            )

        state.chat_history.extend([
            {"role": "user", "text": message},
            {"role": "assistant", "text": response},
        ])
        state.chat_history = state.chat_history[-40:]
        self._persist(session_id, state)
        return {
            "message": response,
            "source": "ai" if answered_by_ai else "unavailable",
            "provider": self._teacher.provider_info() if self._teacher else None,
            "chat_history": state.chat_history,
        }

    async def _enrich_coaching(
        self,
        coaching_data,
        board: chess.Board,
        board_before: chess.Board,
        player_move_uci: str,
        eval_before,
        elo_profile: str,
        coach_name: str,
        verbosity: str = "normal",
    ) -> None:
        """Game-tree coaching pipeline with RAG + LLM."""
        profile = get_profile(elo_profile)

        tree = await build_coaching_tree(
            self._engine, board_before, player_move_uci, eval_before, profile
        )

        # RAG enrichment
        rag_context = ""
        if self._rag is not None:
            report = analyze(board.copy())
            rag_context = await query_knowledge(
                self._rag, report,
                coaching_data.quality.value,
                coaching_data.tactics_summary,
                n=self._rag_top_k,
            )

        # Serialize report
        prompt = serialize_report(
            tree,
            quality=coaching_data.quality.value,
            cp_loss=coaching_data.severity,
            rag_context=rag_context,
        )

        # Build full debug prompt (system + user) if teacher is available
        if self._teacher is not None:
            coaching_data.debug_prompt = self._teacher.build_debug_prompt(
                prompt, coach=coach_name, verbosity=verbosity,
                move_quality=coaching_data.quality.value, elo_profile=elo_profile,
            )
        else:
            coaching_data.debug_prompt = prompt

        # Update arrows from tree alternatives
        alts = tree.alternatives()
        if alts:
            top_uci = alts[0].move.uci()
            coaching_data.arrows = [a for a in coaching_data.arrows if a.brush != "green"]
            if len(top_uci) >= 4:
                coaching_data.arrows.append(
                    Arrow(orig=top_uci[:2], dest=top_uci[2:4], brush="green")
                )

        # LLM
        if self._teacher is not None:
            llm_message = await self._teacher.explain_move(
                prompt, coach=coach_name, verbosity=verbosity,
                move_quality=coaching_data.quality.value, elo_profile=elo_profile,
            )
            if llm_message is not None:
                coaching_data.message = llm_message
                coaching_data.source = "ai+stockfish"

    async def make_move(
        self, session_id: str, move_uci: str, verbosity: str = "normal",
    ) -> dict:
        """Apply player move, get Stockfish response, return result dict."""
        state = self._sessions.get(session_id)
        if state is None:
            raise KeyError(f"Session not found: {session_id}")

        board = state.board

        try:
            move = chess.Move.from_uci(move_uci)
        except (chess.InvalidMoveError, ValueError) as e:
            raise ValueError(f"Invalid move format: {move_uci}") from e

        if move not in board.legal_moves:
            raise ValueError(f"Illegal move: {move_uci}")

        # Evaluate position before the player's move for coaching.
        profile = get_profile(state.elo_profile)
        eval_before = await self._engine.evaluate(
            board.fen(), depth=profile.validate_depth
        )
        best_move_uci = eval_before.best_move

        board_before = board.copy()
        player_san = board.san(move)
        board.push(move)

        # Evaluate position after the player's move for coaching.
        eval_after = await self._engine.evaluate(
            board.fen(), depth=profile.validate_depth
        )

        # Assess the player's move for coaching feedback.
        coaching_data = None
        if best_move_uci is not None:
            coaching_data = assess_move(
                board_before=board_before,
                board_after=board.copy(),
                player_move_uci=move_uci,
                eval_before=eval_before,
                eval_after=eval_after,
                best_move_uci=best_move_uci,
            )

        # Enrich coaching with two-pass pipeline + RAG + LLM (timeout so game never freezes).
        if coaching_data is not None:
            try:
                await asyncio.wait_for(
                    self._enrich_coaching(
                        coaching_data, board, board_before,
                        move_uci, eval_before, state.elo_profile,
                        state.coach_name,
                        verbosity=verbosity,
                    ),
                    timeout=20.0,
                )
            except asyncio.TimeoutError:
                logging.getLogger(__name__).warning("Coaching enrichment timed out")

        coaching_dict = None
        if coaching_data is not None:
            coaching_dict = {
                "quality": coaching_data.quality.value,
                "message": coaching_data.message,
                "arrows": [
                    {"orig": a.orig, "dest": a.dest, "brush": a.brush}
                    for a in coaching_data.arrows
                ],
                "highlights": [
                    {"square": h.square, "brush": h.brush}
                    for h in coaching_data.highlights
                ],
                "severity": coaching_data.severity,
                "debug_prompt": coaching_data.debug_prompt,
                "source": coaching_data.source,
            }

        status = _game_status(board)
        if status != "playing":
            result = {
                "fen": board.fen(),
                "player_move_san": player_san,
                "opponent_move_uci": None,
                "opponent_move_san": None,
                "status": status,
                "result": _game_result(board),
                "coaching": coaching_dict,
            }
            self._persist(session_id, state)
            return result

        selection = await select_opponent_move(
            board,
            self._engine,
            teacher=self._teacher,
            opponent_rating=state.opponent_rating,
            playing_style=state.opponent_style,
            persona=state.coach_name,
        )
        opponent_move = chess.Move.from_uci(selection.uci)
        board.push(opponent_move)

        status = _game_status(board)
        result = {
            "fen": board.fen(),
            "player_move_san": player_san,
            "opponent_move_uci": selection.uci,
            "opponent_move_san": selection.san,
            "opponent_move_method": selection.method,
            "opponent_move_reason": selection.reason,
            "status": status,
            "result": _game_result(board),
            "coaching": coaching_dict,
        }
        self._persist(session_id, state)
        return result
