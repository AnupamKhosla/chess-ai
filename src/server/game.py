from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field

import chess

from server.analysis import analyze
from server.coach import Arrow, CoachingResponse, MoveQuality, assess_move
from server.elo_profiles import get_profile
from server.engine import EngineProtocol
from server.game_tree import build_coaching_tree
from server.knowledge import query_knowledge
from server.llm import ChessTeacher
from server.local_ai import local_coach_reply
from server.openings import identify_opening, opening_context
from server.opponent import select_opponent_move
from server.rag import ChessRAG
from server.report import serialize_report
from server.session_store import SessionStore
from server.toolsloop import (
    execute_tool_request,
    extract_tool_request,
    tool_result_message,
)


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


def _opening_aware_fallback(
    board_after: chess.Board,
    board_before: chess.Board,
    player_san: str,
    coaching_data: CoachingResponse,
    best_move_uci: str | None,
) -> str | None:
    """Explain a recognized opening before giving the engine-only verdict."""
    opening = identify_opening(board_after)
    if opening is None:
        return None
    best_san = "the engine's alternative"
    if best_move_uci:
        try:
            best_san = board_before.san(chess.Move.from_uci(best_move_uci))
        except (ValueError, chess.IllegalMoveError):
            pass
    quality = coaching_data.quality.value
    verdict = (
        "Stockfish currently considers the move sound."
        if quality == "good"
        else f"Stockfish currently classifies this position as a {quality}; its top move is {best_san}."
    )
    return (
        f"This is the {opening.name}: {player_san} appears in a real opening idea "
        f"({opening.move_prefix}), "
        f"not an accidental pawn push. {opening.intent} {verdict} "
        "Treat the engine result as a concrete position-specific warning, not as proof that the gambit itself is nonsense."
    )


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
        response_source = "unavailable"
        provider_id = (
            self._teacher.provider_info().get("provider")
            if self._teacher is not None else "local"
        )
        # Deterministic "what if" grounding: when the student names a concrete
        # move, attach real engine evidence so the model reasons from facts
        # instead of memory. Best-effort — chat never breaks over this.
        what_if_evidence: str | None = None
        if provider_id != "local" and self._engine is not None:
            try:
                what_if_evidence = await self._what_if_evidence(context_fen, message)
            except (RuntimeError, ValueError, asyncio.TimeoutError):
                what_if_evidence = None
        grounded_message = (
            message if not what_if_evidence
            else f"{message}\n\nEngine evidence for the what-if (authoritative): {what_if_evidence}"
        )
        if provider_id == "local":
            response = local_coach_reply(
                message, state.board, opponent_rating=state.opponent_rating
            )
            response_source = "local"
        elif self._teacher is not None:
            response = await self._teacher.chat_conversation(
                message=grounded_message,
                history=list(state.chat_history),
                fen=context_fen,
                moves=_history_san(state.board),
                side="white",
                coach=state.coach_name,
                elo_profile=state.elo_profile,
                opponent_rating=state.opponent_rating,
                playing_style=state.opponent_style,
                response_mode=response_mode if response_mode in {"fast", "deep"} else "fast",
                opening_context=opening_context(state.board),
                thread_key=f"game:{session_id}",
                advertise_tools=provider_id == "codex",
            )
            # One-round "what if" tool loop: if the model asked Stockfish for
            # more evidence via a fenced chesstool block, run it (validated,
            # bounded) and resume the same thread for the final answer.
            if response and provider_id == "codex":
                response = await self._maybe_run_tool_round(
                    session_id=session_id,
                    state=state,
                    context_fen=context_fen,
                    response=response,
                    response_mode=response_mode,
                )
            if response:
                response_source = "ai"
        if not response:
            if provider_id == "local":
                response = local_coach_reply(
                    message, state.board, opponent_rating=state.opponent_rating
                )
                response_source = "local"
            else:
                provider_label = (
                    self._teacher.provider_info().get("label", provider_id)
                    if self._teacher is not None else provider_id
                )
                provider_error = None
                if self._teacher is not None:
                    error_getter = getattr(self._teacher, "last_provider_error", None)
                    if callable(error_getter):
                        provider_error = error_getter()
                detail = provider_error or f"{provider_label} did not respond."
                response = (
                    f"{detail} No local coach was substituted, "
                    "so I will not pretend this came from the selected AI. Check the "
                    "provider connection and send your question again."
                )
                response_source = "unavailable"

        state.chat_history.extend([
            {"role": "user", "text": message},
            {"role": "assistant", "text": response},
        ])
        state.chat_history = state.chat_history[-40:]
        self._persist(session_id, state)
        return {
            "message": response,
            "source": response_source,
            "provider": self._teacher.provider_info() if self._teacher else None,
            "chat_history": state.chat_history,
        }

    _WHAT_IF_RE = re.compile(
        r"what\s+if\s+([O0](?:-[O0]){1,2}|[a-h][1-8][a-h][1-8][qrbn]?|[KQRBN][a-h1-8x+#=\-O]{1,7})",
        re.IGNORECASE,
    )

    async def _what_if_evidence(self, fen: str, message: str) -> str | None:
        """Engine evidence for an explicit "what if <move>" question.

        Returns a one-line authoritative summary or None when no legal move
        is named. Bounded: single position eval at modest depth.
        """
        if "what if" not in message.lower():
            return None
        match = self._WHAT_IF_RE.search(message)
        if not match:
            return None
        try:
            board = chess.Board(fen)
        except ValueError:
            return None
        raw = match.group(1)
        try:
            if re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", raw, re.IGNORECASE):
                move = chess.Move.from_uci(raw.lower())
            else:
                move = board.parse_san(raw)
        except (ValueError, chess.IllegalMoveError, chess.InvalidMoveError):
            return None
        if move not in board.legal_moves:
            return None
        san = board.san(move)
        board.push(move)
        from server.lines import win_percent

        info = await self._engine.evaluate(board.fen(), depth=12)
        if info.score_mate:
            verdict = (
                f"mate in {info.score_mate} for White"
                if info.score_mate > 0 else f"mate in {abs(info.score_mate)} for Black"
            )
        else:
            cp = info.score_cp or 0
            verdict = f"{cp / 100:+.2f} pawns ({win_percent(cp):.1f}% White)"
        return f"After your {san}: {verdict}."

    async def _maybe_run_tool_round(        self,
        *,
        session_id: str,
        state,
        context_fen: str,
        response: str,
        response_mode: str,
    ) -> str:
        """Execute one fenced chesstool request and resume for the final answer.

        Bounded by construction: at most one extra model turn, depth-capped
        engine queries. Any failure returns the original response untouched.
        """
        try:
            request = extract_tool_request(response)
        except (ValueError, AttributeError):
            return response
        if not request or self._teacher is None or self._engine is None:
            return response
        logging.getLogger(__name__).info(
            "Codex requested Stockfish tool %s; executing one bounded round",
            request.get("tool"),
        )
        try:
            result = await execute_tool_request(
                self._engine, context_fen, request, depth=14,
            )
        except (RuntimeError, ValueError, asyncio.TimeoutError):
            return response
        if not result.get("ok"):
            return response
        try:
            follow_up = await self._teacher.chat_conversation(
                message=tool_result_message(request, result),
                history=list(state.chat_history),
                fen=context_fen,
                moves=_history_san(state.board),
                side="white",
                coach=state.coach_name,
                elo_profile=state.elo_profile,
                opponent_rating=state.opponent_rating,
                playing_style=state.opponent_style,
                response_mode=response_mode if response_mode in {"fast", "deep"} else "fast",
                opening_context=opening_context(state.board),
                thread_key=f"game:{session_id}",
            )
        except (RuntimeError, ValueError, asyncio.TimeoutError):
            return response
        return follow_up or response

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

        # Serialize report and add deterministic opening context. The model
        # must know that 1.e4 e5 2.f4 is the King's Gambit before discussing
        # the apparent weakness of the f-pawn.
        prompt = (
            f"Opening context: {opening_context(board)}\n\n"
            + serialize_report(
                tree,
                quality=coaching_data.quality.value,
                cp_loss=coaching_data.severity,
                rag_context=rag_context,
            )
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

    async def _fast_llm_review(
        self,
        coaching_data: CoachingResponse,
        board_before: chess.Board,
        board_after: chess.Board,
        player_move_uci: str,
        eval_before,
        eval_after,
        elo_profile: str,
        coach_name: str,
    ) -> None:
        """Ask the selected language model for a quick, grounded move review.

        ``fast_review`` used to skip every LLM call, so the UI showed a
        template sentence even when Codex was active. This lightweight path
        sends the move and engine facts directly to the model without running
        the expensive game-tree/RAG enrichment pass.
        """
        if self._teacher is None:
            return
        provider = self._teacher.provider_info().get("provider")
        if provider == "local":
            return

        def eval_text(evaluation) -> str:
            if evaluation.score_mate is not None:
                return f"mate in {abs(evaluation.score_mate)}"
            if evaluation.score_cp is not None:
                return f"{evaluation.score_cp / 100:.2f} pawns from White's perspective"
            return "unknown"

        move = chess.Move.from_uci(player_move_uci)
        player_san = board_before.san(move)
        best_san = "not supplied"
        if eval_before.best_move:
            try:
                best_san = board_before.san(chess.Move.from_uci(eval_before.best_move))
            except (ValueError, chess.IllegalMoveError):
                pass

        prompt = f"""Give a concise, concrete review of the student's move.

Student move: {player_san} ({player_move_uci})
Opening context: {opening_context(board_after)}
Position before move FEN: {board_before.fen()}
Position after move FEN: {board_after.fen()}
Engine evaluation before: {eval_text(eval_before)}
Engine evaluation after: {eval_text(eval_after)}
Engine's best move before: {best_san}
Deterministic move classification: {coaching_data.quality.value}
Tactical facts after the move: {coaching_data.tactics_summary or 'none reported'}

Explain what the student should have checked, whether the move is sound, and
one concrete human takeaway. If an opening is recognized, name it in the first
sentence and explain the opening purpose before discussing engine risk. Do not
describe a thematic gambit as an unexplained pawn blunder. Distinguish a
theoretical risk from a concrete tactical oversight. Use only the supplied
facts. Keep it to 2-4 sentences and do not invent a line or claim a sacrifice
is intentional unless the facts support it."""
        response = await self._teacher.explain_move(
            prompt,
            coach=coach_name,
            verbosity="terse",
            move_quality=coaching_data.quality.value,
            elo_profile=elo_profile,
        )
        if response:
            coaching_data.message = response
            coaching_data.source = "ai+stockfish"

    @staticmethod
    def _coaching_dict(coaching_data: CoachingResponse | None) -> dict | None:
        if coaching_data is None:
            return None
        return {
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
            "tactics_summary": coaching_data.tactics_summary,
            "source": coaching_data.source,
        }

    async def make_move(
        self,
        session_id: str,
        move_uci: str,
        verbosity: str = "normal",
        fast_review: bool = False,
    ) -> dict:
        """Apply and review the player's move, then wait for the AI action.

        The opponent is intentionally not moved here. The separate
        :meth:`make_ai_move` endpoint is the only game path that applies a
        computer move. This makes the turn visible and prevents Stockfish from
        ever being mistaken for the player.
        """
        state = self._sessions.get(session_id)
        if state is None:
            raise KeyError(f"Session not found: {session_id}")

        board = state.board

        if board.turn != chess.WHITE:
            raise ValueError("It is the AI's turn. Press 'Make AI move' first.")

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

        # The old coach stayed silent on routine moves. The product now
        # promises a review of every move, so create a neutral coaching record
        # that still goes through the AI explanation pipeline.
        if coaching_data is None:
            best_san = "an alternative"
            if best_move_uci is not None:
                try:
                    best_san = board_before.san(chess.Move.from_uci(best_move_uci))
                except (ValueError, chess.IllegalMoveError):
                    pass
            coaching_data = CoachingResponse(
                quality=MoveQuality.GOOD,
                message=(
                    f"{player_san} is a sound move. A human player would now check "
                    f"the opponent's forcing replies and compare the plan with {best_san}."
                ),
                source="stockfish",
            )

        opening_fallback = _opening_aware_fallback(
            board, board_before, player_san, coaching_data, best_move_uci
        )
        if opening_fallback:
            coaching_data.message = opening_fallback

        # Fast review still calls the selected LLM with a small grounded
        # prompt. Only the expensive game-tree/RAG pass is deferred.
        if coaching_data is not None and fast_review:
            try:
                await asyncio.wait_for(
                    self._fast_llm_review(
                        coaching_data, board_before, board.copy(), move_uci,
                        eval_before, eval_after, state.elo_profile, state.coach_name,
                    ),
                    timeout=20.0,
                )
            except asyncio.TimeoutError:
                logging.getLogger(__name__).warning("Fast coaching review timed out")
            except Exception as exc:
                logging.getLogger(__name__).warning("Fast coaching review failed: %s", exc)
        # Enrich coaching with two-pass pipeline + RAG + LLM (timeout so game never freezes).
        elif coaching_data is not None:
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

        coaching_dict = self._coaching_dict(coaching_data)

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
                "ai_turn": False,
            }
            self._persist(session_id, state)
            return result

        # Persist immediately. If AI is unavailable, the player move and its
        # review survive and the browser can retry the AI action safely.
        self._persist(session_id, state)
        return {
            "fen": board.fen(),
            "player_move_san": player_san,
            "opponent_move_uci": None,
            "opponent_move_san": None,
            "opponent_move_method": None,
            "opponent_move_reason": None,
            "status": status,
            "result": _game_result(board),
            "coaching": coaching_dict,
            "ai_turn": True,
        }

    async def make_ai_move(self, session_id: str) -> dict:
        """Ask the configured AI/local engine player to make exactly one move.

        In configured language-model mode, Stockfish supplies the screened
        candidate set and legality guardrail. In explicit guest mode, the
        local Stockfish player selects the move.
        """
        state = self._sessions.get(session_id)
        if state is None:
            raise KeyError(f"Session not found: {session_id}")

        board = state.board
        if board.turn == chess.WHITE:
            raise ValueError("It is the player's turn; make a move first.")
        status = _game_status(board)
        if status != "playing":
            return {
                "fen": board.fen(),
                "player_move_san": "",
                "opponent_move_uci": None,
                "opponent_move_san": None,
                "opponent_move_method": None,
                "opponent_move_reason": None,
                "status": status,
                "result": _game_result(board),
                "coaching": None,
                "ai_turn": False,
            }

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
            "player_move_san": "",
            "opponent_move_uci": selection.uci,
            "opponent_move_san": selection.san,
            "opponent_move_method": selection.method,
            "opponent_move_reason": selection.reason,
            "status": status,
            "result": _game_result(board),
            "coaching": None,
            "ai_turn": status == "playing" and board.turn == chess.BLACK,
        }
        self._persist(session_id, state)
        return result
