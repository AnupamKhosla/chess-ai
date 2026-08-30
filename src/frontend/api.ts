import { Chess } from "chess.js";

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
  opponent_move_method?: "llm" | "local" | "engine" | null;
  opponent_move_reason?: string | null;
  status: string;
  result: string | null;
  coaching: CoachingData | null;
  ai_turn?: boolean;
}

const API_BASE = "/api";
const STATIC_DEMO = typeof window !== "undefined" &&
  (window.location.hostname.endsWith(".github.io") || window.location.search.includes("demo=1"));
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
    model: "browser-policy-v1",
    effort: "auto",
    effort_options: ["auto"],
    has_api_key: false,
    installed: null,
    authenticated: null,
    label: "Free browser AI (no key)",
  };
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
export async function requestAiMove(sessionId: string): Promise<MoveResponse> {
  if (STATIC_DEMO) {
    const session = getDemoSession(sessionId);
    if (!session) throw new Error("Demo game session not found");
    if (session.board.turn() === "w") throw new Error("It is your turn");
    const selected = chooseDemoMove(session.board);
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
      opponent_move_method: "local",
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

export async function getProviders(): Promise<ProvidersResponse> {
  if (STATIC_DEMO) {
    return {
      active: demoProvider(),
      providers: [{
        id: "local",
        label: "Free browser AI (no key)",
        kind: "builtin",
        base_url: "",
        model: "browser-policy-v1",
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

export async function startProviderLogin(provider: string): Promise<{
  status: string;
  provider: string;
  message?: string;
}> {
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
