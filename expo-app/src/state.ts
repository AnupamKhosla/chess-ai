/**
 * Shared game state for backend (full server) and demo (offline) modes.
 * Backend = your FastAPI app: real Stockfish, providers, memory, voice.
 * Demo = fully offline: local rules, greedy sparring partner, hosted chat.
 */

import { useCallback, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  createGame,
  demoChat,
  requestAiMove,
  sendChat as apiChat,
  sendMove as apiMove,
  type ChatMessage,
} from "./api";
import { applyUci, gameStatus, pickDemoReply, startingFen } from "./engine";

export interface HistoryMove {
  san: string;
  uci: string;
  grade: string | null;
  by: "you" | "ai";
}

export interface BoardArrow {
  from: string;
  to: string;
  color: string;
}

const BRUSH_HEX: Record<string, string> = {
  green: "#4ade80",
  red: "#f87171",
  blue: "#7dd3fc",
  yellow: "#fbbf24",
};

export function useGame(backend: string | null) {
  const [fen, setFen] = useState(startingFen());
  const [history, setHistory] = useState<HistoryMove[]>([]);
  const [status, setStatus] = useState("Your move");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [lastArrows, setLastArrows] = useState<BoardArrow[]>([]);
  const backendRef = useRef(backend);
  backendRef.current = backend;

  const refreshStatus = useCallback((nextFen: string) => {
    const s = gameStatus(nextFen);
    setStatus(s.label);
    setOver(s.over);
  }, []);

  const newGame = useCallback(async () => {
    setBusy(true);
    try {
      const base = backendRef.current;
      setLastArrows([]);
      if (base) {
        const game = await createGame(base);
        setSessionId(game.session_id);
        setFen(game.fen);
        setHistory([]);
        refreshStatus(game.fen);
      } else {
        const fresh = startingFen();
        setSessionId(`demo-${Date.now()}`);
        setFen(fresh);
        setHistory([]);
        refreshStatus(fresh);
      }
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  const playMove = useCallback(
    async (from: string, to: string, promotion?: string) => {
      const uci = from + to + (promotion ?? "");
      const base = backendRef.current;
      if (base && sessionId && !sessionId.startsWith("demo-")) {
        setBusy(true);
        try {
          const res = await apiMove(base, sessionId, uci);
          setFen(res.fen);
          setHistory((h) => [
            ...h,
            { san: res.player_move_san, uci, grade: res.coaching?.quality ?? null, by: "you" as const },
          ]);
          const arrows = Array.isArray(res.coaching?.arrows)
            ? res.coaching.arrows
                .filter((a: { orig?: string; dest?: string }) => a?.orig && a?.dest)
                .slice(0, 3)
                .map((a: { orig: string; dest: string; brush?: string }) => ({
                  from: a.orig,
                  to: a.dest,
                  color: BRUSH_HEX[a.brush ?? ""] ?? "#4ade80",
                }))
            : [];
          setLastArrows(arrows);
          refreshStatus(res.fen);
          return true;
        } catch {
          return false;
        } finally {
          setBusy(false);
        }
      }
      // Demo: local rules, greedy reply.
      const applied = applyUci(fen, uci);
      if (!applied) return false;
      setFen(applied.fen);
      setHistory((h) => [...h, { san: applied.san, uci, grade: null, by: "you" }]);
      refreshStatus(applied.fen);
      return true;
    },
    [backend, sessionId, fen, refreshStatus],
  );

  const playAiMove = useCallback(async () => {
    const base = backendRef.current;
    setAiThinking(true);
    try {
      if (base && sessionId && !sessionId.startsWith("demo-")) {
        const res = await requestAiMove(base, sessionId);
        if (res.opponent_move_uci) {
          setFen(res.fen);
          setHistory((h) => [
            ...h,
            { san: res.opponent_move_san ?? "?", uci: res.opponent_move_uci, grade: null, by: "ai" as const },
          ]);
          refreshStatus(res.fen);
        }
        return res.opponent_move_reason ?? null;
      }
      await new Promise((r) => setTimeout(r, 600));
      const reply = pickDemoReply(fen);
      if (!reply) return null;
      const applied = applyUci(fen, reply.uci);
      if (!applied) return null;
      setFen(applied.fen);
      setHistory((h) => [...h, { san: applied.san, uci: reply.uci, grade: null, by: "ai" }]);
      refreshStatus(applied.fen);
      return "Demo sparring reply.";
    } catch {
      return null;
    } finally {
      setAiThinking(false);
    }
  }, [backend, sessionId, fen, refreshStatus]);

  return { fen, history, status, over, busy, aiThinking, sessionId, lastArrows, newGame, playMove, playAiMove, refreshStatus };
}

export function useChat(backend: string | null, sessionId: string | null, fen: string, history: HistoryMove[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (text: string): Promise<{ label: string; text: string } | null> => {
      const question = text.trim();
      if (!question || sending) return null;
      setSending(true);
      setMessages((m) => [...m, { role: "user", text: question }]);
      try {
        const base = backend;
        if (base && sessionId && !sessionId.startsWith("demo-")) {
          const res = await apiChat(base, sessionId, question);
          const label = res.provider?.provider === "codex" ? "Codex" : res.provider?.provider === "claude" ? "Claude" : "Coach";
          setMessages((m) => [...m, { role: "assistant", text: res.message }]);
          return { label, text: res.message };
        }
        const reply = await demoChat(fen, history.map((h) => h.san).join(" "), question);
        setMessages((m) => [...m, { role: "assistant", text: reply }]);
        return { label: "Free Weak AI", text: reply };
      } catch (e) {
        const fallback = e instanceof Error ? e.message : "Chat failed";
        setMessages((m) => [...m, { role: "assistant", text: `I couldn't answer: ${fallback}` }]);
        return null;
      } finally {
        setSending(false);
      }
    },
    [backend, sessionId, fen, history, sending],
  );

  const clearForNewGame = useCallback(() => setMessages([]), []);

  return { messages, sending, send, clearForNewGame };
}

export function movesToPgn(history: HistoryMove[]): string {
  const game = new Chess();
  for (const h of history) {
    try {
      game.move(h.san);
    } catch {
      break;
    }
  }
  return game.pgn();
}
