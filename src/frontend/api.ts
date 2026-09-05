import { Chess } from "chess.js";
import type { Square } from "chess.js";

export interface NewGameResponse {
  session_id: string;
  fen: string;
  status: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface GameStateResponse {
  session_id: string;
  fen: string;
  moves: string[];
  status: string;
  result: string | null;
  elo_profile: string;
  opponent_rating: number;
  opponent_style: string;
  coach_name: string;
  chat_history: ChatMessage[];
}

export interface ProviderInfo {
  provider: string;
  kind: string;
  base_url: string;
  model: string;
  effort: string;
  effort_options: string[];
  has_api_key: boolean;
  installed: boolean | null;
  authenticated?: boolean | null;
  label: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  kind: string;
  base_url: string;
  model: string;
  effort_options: string[];
  requires_key: boolean;
  cli_command: string | null;
  help: string;
  installed: boolean | null;
  authenticated: boolean | null;
  active: boolean;
}

export interface ProvidersResponse {
  active: ProviderInfo;
  providers: ProviderPreset[];
  key_storage: string;
}

export interface ArrowData {
  orig: string;
  dest: string;
  brush: string;
}

export interface HighlightData {
  square: string;
  brush: string;
}

export interface CoachingData {
  quality: string;
  message: string;
  arrows: ArrowData[];
  highlights: HighlightData[];
  severity: string;
  debug_prompt?: string;
  source?: "stockfish" | "ai+stockfish" | "local-ai+stockfish";
}

export interface MoveResponse {
  fen: string;
  player_move_san: string;
  opponent_move_uci: string | null;
  opponent_move_san: string | null;
  opponent_move_method?: "llm" | "local" | "local-engine" | "engine" | null;
  opponent_move_reason?: string | null;
  status: string;
  result: string | null;
  coaching: CoachingData | null;
  ai_turn?: boolean;
}

const API_BASE = "/api";
export const GITHUB_PAGES_DEMO = typeof window !== "undefined" &&
  window.location.hostname.toLowerCase().endsWith(".github.io");
const STATIC_DEMO = GITHUB_PAGES_DEMO ||
  (typeof window !== "undefined" && window.location.search.includes("demo=1"));
const PUBLIC_AI_BASE_URL = "https://api.llm7.io/v1";
const PUBLIC_AI_MODEL = "mistral-Nemo-Instruct-2407";
const CODEX_SANDBOX_API_URL = "https://chess-ai-codex-sandbox.vercel.app/api/codex";
export const CODEX_SANDBOX_SOURCE_URL = "https://github.com/AnupamKhosla/chess-ai-codex-sandbox";
const PUBLIC_AI_COOLDOWN_MS = 7_000;
const PUBLIC_AI_LAST_REQUEST_KEY = "chess-teacher-public-ai-last-request";
let publicAiLastRequestAt = 0;
const DEMO_STORAGE_PREFIX = "chess-teacher-demo-session:";

interface DemoSession {
  board: Chess;
  opponentRating: number;
  coachName: string;
  opponentStyle: string;
  chatHistory: ChatMessage[];
}

const demoSessions = new Map<string, DemoSession>();

function demoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "demo-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

function saveDemoSession(sessionId: string, session: DemoSession): void {
  if (!STATIC_DEMO) return;
  localStorage.setItem(DEMO_STORAGE_PREFIX + sessionId, JSON.stringify({
    moves: session.board.history(),
    opponentRating: session.opponentRating,
    coachName: session.coachName,
    opponentStyle: session.opponentStyle,
    chatHistory: session.chatHistory.slice(-40),
  }));
}

function getDemoSession(sessionId: string): DemoSession | null {
  const existing = demoSessions.get(sessionId);
  if (existing) return existing;
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_PREFIX + sessionId);
    if (!raw) return null;
    const saved = JSON.parse(raw) as {
      moves?: string[]; opponentRating?: number; coachName?: string;
      opponentStyle?: string; chatHistory?: ChatMessage[];
    };
    const board = new Chess();
    for (const san of saved.moves || []) board.move(san);
    const session: DemoSession = {
      board,
      opponentRating: saved.opponentRating || 1200,
      coachName: saved.coachName || "Anna Cramling",
      opponentStyle: saved.opponentStyle || "balanced",
      chatHistory: Array.isArray(saved.chatHistory) ? saved.chatHistory : [],
    };
    demoSessions.set(sessionId, session);
    return session;
  } catch {
    return null;
  }
}

function demoSnapshot(sessionId: string, session: DemoSession): GameStateResponse {
  const status = session.board.isGameOver()
    ? session.board.isCheckmate() ? "checkmate" : "draw"
    : "playing";
  const result = session.board.isCheckmate()
    ? session.board.turn() === "w" ? "0-1" : "1-0"
    : status === "draw" ? "1/2-1/2" : null;
  return {
    session_id: sessionId,
    fen: session.board.fen(),
    moves: session.board.history(),
    status,
    result,
    elo_profile: session.opponentRating >= 1600 ? "competitive" : "intermediate",
    opponent_rating: session.opponentRating,
    opponent_style: session.opponentStyle,
    coach_name: session.coachName,
    chat_history: session.chatHistory,
  };
}

function demoProvider(): ProviderInfo {
  return {
    provider: "local",
    kind: "builtin",
    base_url: "",
    model: "stockfish-browser-v1",
    effort: "auto",
    effort_options: ["auto"],
    has_api_key: false,
    installed: null,
    authenticated: null,
    label: "Free browser engine-backed player (no key)",
  };
}

function publicAiProvider(): ProviderInfo {
  return {
    provider: "llm7-free",
    kind: "openai-compatible",
    base_url: PUBLIC_AI_BASE_URL,
    model: PUBLIC_AI_MODEL,
    effort: "auto",
    effort_options: ["auto"],
    has_api_key: false,
    installed: null,
    authenticated: null,
    label: "Free Weak AI",
  };
}

function codexSandboxProvider(): ProviderInfo {
  return {
    provider: "codex",
    kind: "codex-cli",
    base_url: "",
    model: "default",
    effort: "auto",
    effort_options: ["auto"],
    has_api_key: false,
    installed: true,
    authenticated: false,
    label: "ChatGPT / Codex login · temporary test",
  };
}

export type CodexSandboxEvent =
  | { type: "login_required"; verificationUrl: string; userCode: string }
  | { type: "authenticated" }
  | { type: "delta"; text: string }
  | { type: "complete"; text: string }
  | { type: "error"; message: string };

/**
 * Run the public one-shot Codex test. The function owns the login only for
 * this request and deletes its temporary session after the response.
 * An optional chess-aware message can be supplied; otherwise a generic
 * connectivity prompt is used.
 */
export async function runCodexSandboxTest(
  onEvent?: (event: CodexSandboxEvent) => void,
  message?: string,
): Promise<{ text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 280_000);
  const prompt = message?.trim().slice(0, 2_000) ||
    "Confirm that Codex is connected and ready to coach a chess position.";
  try {
    const response = await fetch(CODEX_SANDBOX_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "login_and_test",
        message: prompt,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Codex test failed: HTTP ${response.status}`);
    if (!response.body) throw new Error("Codex test returned no event stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: { text: string } | null = null;

    const handleBlock = (block: string) => {
      const lines = block.split("\n");
      const eventName = lines.find((line) => line.startsWith("event:"))
        ?.slice("event:".length).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");
      if (!eventName || !data) return;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new Error("Codex test returned invalid event data");
      }
      if (eventName === "login_required") {
        onEvent?.({
          type: "login_required",
          verificationUrl: String(payload.verificationUrl || "https://auth.openai.com/codex/device"),
          userCode: String(payload.userCode || ""),
        });
      } else if (eventName === "authenticated") {
        onEvent?.({ type: "authenticated" });
      } else if (eventName === "delta") {
        onEvent?.({ type: "delta", text: String(payload.text || "") });
      } else if (eventName === "complete") {
        result = { text: String(payload.text || "") };
        onEvent?.({ type: "complete", text: result.text });
      } else if (eventName === "error") {
        const message = String(payload.message || "Codex test failed");
        onEvent?.({ type: "error", message });
        throw new Error(message);
      }
    };

    while (!result) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleBlock(block);
        if (result) break;
        boundary = buffer.indexOf("\n\n");
      }
      if (chunk.done) {
        if (buffer.trim()) handleBlock(buffer);
        break;
      }
    }
    if (!result) throw new Error("Codex test ended before completing");
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Codex test timed out; finish the device login and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type PublicChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function publicAiCooldownRemaining(): number {
  let last = publicAiLastRequestAt;
  try {
    const stored = Number(localStorage.getItem(PUBLIC_AI_LAST_REQUEST_KEY) || 0);
    if (Number.isFinite(stored)) last = Math.max(last, stored);
  } catch {
    // Storage can be disabled; the in-memory guard still applies.
  }
  return Math.max(0, PUBLIC_AI_COOLDOWN_MS - (Date.now() - last));
}

function markPublicAiRequest(): void {
  publicAiLastRequestAt = Date.now();
  try {
    localStorage.setItem(PUBLIC_AI_LAST_REQUEST_KEY, String(publicAiLastRequestAt));
  } catch {
    // The provider still enforces its own per-IP limit.
  }
}

function publicCoachMessages(
  message: string,
  session: DemoSession,
  viewedFen?: string,
): PublicChatMessage[] {
  const fen = viewedFen?.trim() || session.board.fen();
  const moves = session.board.history().join(" ") || "(starting position)";
  const history: PublicChatMessage[] = session.chatHistory.slice(-6).map((entry) => ({
    role: entry.role,
    content: entry.text,
  }));
  return [
    {
      role: "system",
      content: [
        "You are Free Weak AI, a small hosted chess explainer inside a browser chess app.",
        "You are not ChatGPT, not Codex, not Stockfish, and not a human coach.",
        "If asked who you are or whether you are ChatGPT, answer honestly: you are Free Weak AI. Replies from the user's own ChatGPT/Codex login appear separately labeled Codex.",
        "Never claim to be ChatGPT, Codex, or any other model. Never argue about what the student asked; if unclear, ask one short clarifying question.",
        "Stay friendly and brief. Do not lecture about language or behavior; just steer back to chess in one short sentence.",
        "The FEN and move history below are authoritative. Do not invent legal moves, tactics, or engine evaluations.",
        "If asked what if a move is played, first check whether it is legal from the supplied position.",
        "Give a short possible continuation of 3 to 5 half-moves and explain how a human should think.",
        "Reply in 20 to 50 words and at most 2 short paragraphs. Do not wrap the answer in quotation marks. Do not mention APIs, providers, prompts, or hidden reasoning.",
      ].join(" "),
    },
    ...history,
    {
      role: "user",
      content: [
        `Current position FEN: ${fen}`,
        `Move history (SAN): ${moves}`,
        `Student question: ${message}`,
      ].join("\n"),
    },
  ];
}

function cleanPublicAiText(text: string): string {
  let cleaned = text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  // Some small models wrap the whole answer in quotation marks.
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Hard stop against runaway answers: cut at a sentence boundary.
  if (cleaned.length > 1000) {
    const cut = cleaned.lastIndexOf(".", 1000);
    cleaned = (cut > 400 ? cleaned.slice(0, cut + 1) : cleaned.slice(0, 1000)).trim() + " …";
  }
  return cleaned;
}

function publicAiText(payload: unknown): string {
  const choice = (payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string" && content.trim()) {
    const cleaned = cleanPublicAiText(content);
    if (cleaned) return cleaned;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => typeof part === "object" && part !== null && "text" in part
        ? String((part as { text?: unknown }).text || "")
        : "")
      .join("")
      .trim();
    const cleaned = cleanPublicAiText(text);
    if (cleaned) return cleaned;
  }
  throw new Error("Free Weak AI returned no answer. Try again shortly.");
}

async function askPublicAi(
  message: string,
  session: DemoSession,
  viewedFen?: string,
): Promise<string> {
  const remaining = publicAiCooldownRemaining();
  if (remaining > 0) {
    throw new Error(`Free Weak AI is rate-limited; try again in ${Math.ceil(remaining / 1000)} seconds.`);
  }
  markPublicAiRequest();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(`${PUBLIC_AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PUBLIC_AI_MODEL,
        messages: publicCoachMessages(message, session, viewedFen),
        max_tokens: 160,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const errorMessage = (payload as { message?: string; error?: { message?: string } } | null);
      const detail = errorMessage?.error?.message || errorMessage?.message || `HTTP ${response.status}`;
      throw new Error(response.status === 429
        ? "Free Weak AI is temporarily rate-limited; try again later."
        : `Free Weak AI is unavailable (${detail}).`);
    }
    return publicAiText(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Free Weak AI timed out; try again later.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function chooseDemoMove(board: Chess): { san: string; uci: string; reason: string } {
  const moves = board.moves({ verbose: true });
  const scored = moves.map((move) => {
    let score = 0;
    if (move.captured) score += 80 + (move.captured === "q" ? 500 : move.captured === "r" ? 260 : 100);
    if (move.san.endsWith("+")) score += 140;
    if (move.san.endsWith("#")) score += 10000;
    if (move.san === "O-O" || move.san === "O-O-O") score += 75;
    if (/^[NB]/.test(move.san)) score += 40;
    if ("cdef".includes(move.to[0]) && "34".includes(move.to[1])) score += 24;
    return { move, score };
  }).sort((a, b) => b.score - a.score);
  const selected = scored[0]?.move || moves[0];
  if (!selected) throw new Error("No legal AI move is available");
  const reason = selected.san.endsWith("+")
    ? "I chose a forcing move that makes you answer a concrete threat."
    : selected.captured
      ? "I took the available material while keeping the position active."
      : "I improved a piece and kept a clear, playable plan.";
  return {
    san: selected.san,
    uci: selected.from + selected.to + (selected.promotion || ""),
    reason,
  };
}

function demoCoachReply(message: string, session: DemoSession): string {
  const turn = session.board.turn() === "w" ? "White" : "Black";
  if (/\b(your move|play|move|reply|respond)\b/i.test(message) && turn === "Black") {
    return "I’m ready to play the black move. Press **▶ Play AI move** below when you want me to make it. I won’t move the board from chat alone.";
  }
  if (/\b(why|plan|thinking|defend|defense|defence)\b/i.test(message)) {
    return "Use a human checklist: first scan the opponent’s checks, captures, and threats; then compare one forcing move with one improving move. It is " + turn + " to move. I’ll keep the explanation tied to this board.";
  }
  return "I’m your local browser chess coach. It is " + turn + " to move against a " + session.opponentRating + "-rated practice opponent. Ask about a plan, a weakness, or a concrete move.";
}

export async function createGame(
  depth: number = 10,
  eloProfile: string = "intermediate",
  coachName: string = "Anna Cramling",
  opponentRating: number = 1200,
): Promise<NewGameResponse> {
  if (STATIC_DEMO) {
    const session_id = demoId();
    const session: DemoSession = {
      board: new Chess(),
      opponentRating,
      coachName,
      opponentStyle: "balanced",
      chatHistory: [],
    };
    demoSessions.set(session_id, session);
    saveDemoSession(session_id, session);
    return { session_id, fen: session.board.fen(), status: "playing" };
  }
  console.log(`[API] Creating game with persona: "${coachName}", opponent rating: ${opponentRating}`);
  const res = await fetch(`${API_BASE}/game/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      depth,
      elo_profile: eloProfile,
      coach_name: coachName,
      opponent_rating: opponentRating,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create game: ${res.status}`);
  }
  return res.json();
}

export async function sendMove(
  sessionId: string,
  moveUci: string,
  verbosity: string = "normal",
  fastReview = true,
): Promise<MoveResponse> {
  if (STATIC_DEMO) {
    const session = getDemoSession(sessionId);
    if (!session) throw new Error("Demo game session not found");
    if (session.board.turn() !== "w") throw new Error("It is the AI's turn");
    const move = session.board.move({
      from: moveUci.slice(0, 2),
      to: moveUci.slice(2, 4),
      promotion: moveUci[4] as "q" | "r" | "b" | "n" | undefined,
    });
    if (!move) throw new Error("Illegal move");
    saveDemoSession(sessionId, session);
    return {
      fen: session.board.fen(),
      player_move_san: move.san,
      opponent_move_uci: null,
      opponent_move_san: null,
      opponent_move_method: null,
      opponent_move_reason: null,
      status: session.board.isGameOver() ? "draw" : "playing",
      result: null,
      coaching: {
        quality: "good",
        message: move.san + " is now on the board. Before the AI replies, check its forcing moves and your king safety. Ask “why?” for a concrete human checklist.",
        arrows: [],
        highlights: [],
        severity: "0",
        source: "local-ai+stockfish",
      },
      ai_turn: !session.board.isGameOver(),
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${API_BASE}/game/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        move: moveUci,
        verbosity,
        fast_review: fastReview,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(detail.detail || `Move failed: ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the selected AI to play the pending opponent turn. */
export async function requestAiMove(sessionId: string, preferredUci?: string): Promise<MoveResponse> {
  if (STATIC_DEMO) {
    const session = getDemoSession(sessionId);
    if (!session) throw new Error("Demo game session not found");
    if (session.board.turn() === "w") throw new Error("It is your turn");
    let selected = chooseDemoMove(session.board);
    if (preferredUci) {
      const preferred = session.board.moves({ verbose: true }).find((move) =>
        move.from + move.to + (move.promotion || "") === preferredUci,
      );
      if (!preferred) throw new Error("Browser engine returned an illegal move");
      selected = {
        san: preferred.san,
        uci: preferred.from + preferred.to + (preferred.promotion || ""),
        reason: "Stockfish selected this legal move in the browser for the current practice level.",
      };
    }
    session.board.move({
      from: selected.uci.slice(0, 2),
      to: selected.uci.slice(2, 4),
      promotion: selected.uci[4] as "q" | "r" | "b" | "n" | undefined,
    });
    saveDemoSession(sessionId, session);
    return {
      fen: session.board.fen(),
      player_move_san: "",
      opponent_move_uci: selected.uci,
      opponent_move_san: selected.san,
      opponent_move_method: "local-engine",
      opponent_move_reason: selected.reason,
      status: session.board.isGameOver() ? "draw" : "playing",
      result: null,
      coaching: null,
      ai_turn: false,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${API_BASE}/game/ai-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: "AI move failed" }));
      throw new Error(detail.detail || `AI move failed: ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getGameState(sessionId: string): Promise<GameStateResponse> {
  if (STATIC_DEMO) {
    const session = getDemoSession(sessionId);
    if (!session) throw new Error("Demo game session not found");
    return demoSnapshot(sessionId, session);
  }
  const res = await fetch(`${API_BASE}/game/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`Failed to restore game: ${res.status}`);
  return res.json();
}

export async function sendChat(
  sessionId: string,
  message: string,
  viewedFen?: string,
  responseMode: "fast" | "deep" = "fast",
): Promise<{ message: string; source: "ai" | "local" | "unavailable"; provider: ProviderInfo | null; chat_history: ChatMessage[] }> {
  if (STATIC_DEMO) {
    const session = getDemoSession(sessionId);
    if (!session) throw new Error("Demo game session not found");
    if (GITHUB_PAGES_DEMO) {
      const response = await askPublicAi(message, session, viewedFen);
      session.chatHistory.push(
        { role: "user", text: message },
        { role: "assistant", text: response },
      );
      session.chatHistory = session.chatHistory.slice(-40);
      saveDemoSession(sessionId, session);
      return {
        message: response,
        source: "ai",
        provider: publicAiProvider(),
        chat_history: session.chatHistory,
      };
    }
    const response = demoCoachReply(message, session);
    session.chatHistory.push(
      { role: "user", text: message },
      { role: "assistant", text: response },
    );
    session.chatHistory = session.chatHistory.slice(-40);
    saveDemoSession(sessionId, session);
    return {
      message: response,
      source: "local",
      provider: demoProvider(),
      chat_history: session.chatHistory,
    };
  }
  const res = await fetch(`${API_BASE}/game/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      viewed_fen: viewedFen,
      response_mode: responseMode,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Chat failed" }));
    throw new Error(detail.detail || `Chat failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Build the one-shot Codex prompt for a Pages chat message. Browser
 * Stockfish facts are embedded as authoritative ground truth so Codex only
 * has to word the reply (single voice: GPT wording, Stockfish facts).
 */
export function composeCodexChessPrompt(input: {
  question: string;
  fen: string;
  moves: string;
  engineFacts?: string | null;
}): string {
  const parts = [
    `Student question: ${input.question.trim().slice(0, 500) || "(coach this position)"}`,
    `Current position FEN: ${input.fen}`,
    `Move history (SAN): ${input.moves || "(starting position)"}`,
  ];
  if (input.engineFacts?.trim()) {
    parts.push(`Browser Stockfish facts (authoritative): ${input.engineFacts.trim().slice(0, 600)}`);
  }
  return parts.join("\n");
}

export interface LinePly {
  ply: number;
  san: string;
  uci: string;
  fen_after: string;
  comment: string;
  capture: boolean;
  check: boolean;
  checkmate: boolean;
  castle: boolean;
}

export interface TeachableLine {
  fen: string;
  depth: number;
  score_cp: number | null;
  score_mate: number | null;
  verdict: string;
  moves: LinePly[];
}

const PIECE_NAMES: Record<string, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

/** Fetch a teachable line from the local server (unavailable in static demo). */
export async function fetchTeachableLine(fen: string, maxPlies = 10): Promise<TeachableLine> {
  const res = await fetch(`${API_BASE}/analysis/line`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fen, max_plies: maxPlies, depth: 16 }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Line analysis failed" }));
    throw new Error(detail.detail || `Line analysis failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Build a teachable line in the browser from a Stockfish PV (static demo
 * path). Mirrors server lines.py comment rules.
 */
export function buildLocalTeachableLine(
  fen: string,
  pvUci: string[],
  scoreCp: number | null,
  scoreMate: number | null,
  depth: number,
  maxPlies = 10,
): TeachableLine {
  const limit = Math.max(1, Math.min(maxPlies, 10));
  const verdict = describeScore(scoreCp, scoreMate);
  const board = new Chess(fen);
  const moves: LinePly[] = [];
  for (const uci of pvUci.slice(0, limit)) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci[4] as "q" | "r" | "b" | "n" | undefined;
    try {
      board.move({ from, to, promotion: promo });
    } catch {
      break;
    }
    moves.push({
      ply: moves.length + 1,
      san: "",
      uci,
      fen_after: board.fen(),
      comment: "",
      capture: false,
      check: false,
      checkmate: false,
      castle: false,
    });
  }
  // Second pass with pre-move boards for honest flags and comments.
  const walk = new Chess(fen);
  moves.forEach((ply, index) => {
    const from = ply.uci.slice(0, 2);
    const to = ply.uci.slice(2, 4);
    const promo = ply.uci[4] as "q" | "r" | "b" | "n" | undefined;
    // Flags must be read from the pre-move position.
    const mover = walk.get(from as Square);
    const pieceName = PIECE_NAMES[String(mover?.type || "")] || "Piece";
    ply.capture = isCaptureMove(walk, from, to);
    ply.castle = isCastleMove(walk, from, to);
    try {
      ply.san = walk.move({ from, to, promotion: promo }).san;
    } catch {
      ply.san = ply.san || to;
    }
    const parts = ply.castle
      ? [`${pieceName} castles ${to[0] === "g" ? "kingside" : "queenside"} for safety.`]
      : promo
        ? [`${pieceName} promotes to ${PIECE_NAMES[promo] || "queen"} on ${to}.`]
        : [`${pieceName} to ${to}.`];
    if (ply.capture) parts.push(`Takes on ${to}.`);
    const after = new Chess(ply.fen_after);
    ply.check = after.isCheck();
    ply.checkmate = after.isCheckmate();
    if (ply.checkmate) parts.push("Checkmate.");
    else if (ply.check) parts.push("Check — the king must move, block, or capture.");
    if (index === moves.length - 1) parts.push(verdict);
    ply.comment = parts.join(" ");
  });
  return { fen, depth, score_cp: scoreCp, score_mate: scoreMate, verdict, moves };
}

function isCaptureMove(board: Chess, from: string, to: string): boolean {
  try {
    const target = board.get(to as Square);
    if (target?.type) return true;
    const mover = board.get(from as Square);
    // En passant: pawn moves diagonally to an empty square.
    return mover?.type === "p" && from[0] !== to[0];
  } catch {
    return false;
  }
}

function isCastleMove(board: Chess, from: string, to: string): boolean {
  try {
    const mover = board.get(from as Square);
    return mover?.type === "k" && Math.abs(to.charCodeAt(0) - from.charCodeAt(0)) === 2;
  } catch {
    return false;
  }
}

function describeScore(scoreCp: number | null, scoreMate: number | null): string {
  if (scoreMate) {
    return scoreMate > 0 ? `White mates in ${scoreMate}.` : `Black mates in ${Math.abs(scoreMate)}.`;
  }
  if (scoreCp === null || scoreCp === undefined) return "The engine calls it unclear.";
  const pawns = Math.abs(scoreCp) / 100;
  if (pawns < 0.3) return "The engine calls it level.";
  return `The engine rates this ${pawns.toFixed(1)} pawns for ${scoreCp > 0 ? "White" : "Black"}.`;
}

/**
 * Persist a Codex one-shot reply into the demo chat history so it survives
 * reloads and stays visible to later Free Weak AI turns. No-op outside the
 * static demo (the local server owns its own history).
 */
export function rememberCodexExchange(sessionId: string, codexText: string): void {
  if (!STATIC_DEMO) return;
  const session = getDemoSession(sessionId);
  if (!session) return;
  const text = codexText.trim().slice(0, 2_000);
  if (!text) return;
  session.chatHistory.push(
    { role: "user", text: "Asked Codex about the current position." },
    { role: "assistant", text: `[Codex] ${text}` },
  );
  session.chatHistory = session.chatHistory.slice(-40);
  saveDemoSession(sessionId, session);
}

export async function getProviders(): Promise<ProvidersResponse> {
  if (STATIC_DEMO) {
    if (GITHUB_PAGES_DEMO) {
      const provider = publicAiProvider();
      const codex = codexSandboxProvider();
      return {
        active: provider,
        providers: [
          {
            id: provider.provider,
            label: provider.label,
            kind: provider.kind,
            base_url: provider.base_url,
            model: provider.model,
            effort_options: provider.effort_options,
            requires_key: false,
            cli_command: null,
            help: "Free hosted chess explainer · no key or login needed · limited to a small anonymous rate.",
            installed: null,
            authenticated: null,
            active: true,
          },
          {
            id: codex.provider,
            label: codex.label,
            kind: codex.kind,
            base_url: codex.base_url,
            model: codex.model,
            effort_options: codex.effort_options,
            requires_key: false,
            cli_command: null,
            help: "One response per login. Login happens only on the official auth.openai.com page; the backend source is public: https://github.com/AnupamKhosla/chess-ai-codex-sandbox",
            installed: true,
            authenticated: false,
            active: false,
          },
        ],
        key_storage: "direct browser connection · no key",
      };
    }
    return {
      active: demoProvider(),
      providers: [{
        id: "local",
        label: "Free browser engine-backed player (no key)",
        kind: "builtin",
        base_url: "",
        model: "stockfish-browser-v1",
        effort_options: ["auto"],
        requires_key: false,
        cli_command: null,
        help: "GitHub Pages runs a private, no-key browser demo. Connect the local app for ChatGPT, Claude, DeepSeek, or Ollama.",
        installed: null,
        authenticated: null,
        active: true,
      }],
      key_storage: "browser demo only",
    };
  }
  const res = await fetch(`${API_BASE}/providers`);
  if (!res.ok) throw new Error(`Failed to load providers: ${res.status}`);
  return res.json();
}

export async function configureProvider(config: {
  provider: string;
  base_url?: string;
  model?: string;
  api_key?: string;
  effort?: string;
}): Promise<{ active: ProviderInfo; key_storage: string }> {
  if (STATIC_DEMO) {
    if (GITHUB_PAGES_DEMO) {
      if (config.provider === "llm7-free") {
        return { active: publicAiProvider(), key_storage: "direct browser connection · no key" };
      }
      throw new Error("Codex is available here as a temporary one-response test; use its Sign in button.");
    }
    if (config.provider !== "local") {
      throw new Error("Remote AI connections are available in the local app, not the public static demo");
    }
    return { active: demoProvider(), key_storage: "browser demo only" };
  }
  const res = await fetch(`${API_BASE}/providers/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Provider configuration failed" }));
    throw new Error(detail.detail || `Provider configuration failed: ${res.status}`);
  }
  return res.json();
}

export async function startProviderLogin(
  provider: string,
  onEvent?: (event: CodexSandboxEvent) => void,
  message?: string,
): Promise<{
  status: string;
  provider: string;
  message?: string;
}> {
  if (GITHUB_PAGES_DEMO && provider === "codex") {
    const result = await runCodexSandboxTest(onEvent, message);
    return {
      status: "completed",
      provider,
      message: result.text
        ? `Codex connected for this one-shot test. Response: ${result.text}`
        : "Codex connected for this one-shot test. The temporary session has now been deleted.",
    };
  }
  if (STATIC_DEMO) {
    throw new Error("Login is available in the local app, not the public static demo");
  }
  const res = await fetch(`${API_BASE}/providers/auth/${encodeURIComponent(provider)}`, {
    method: "POST",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Login could not be started" }));
    throw new Error(detail.detail || `Login failed: ${res.status}`);
  }
  return res.json();
}
