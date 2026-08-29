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
  source?: "stockfish" | "ai+stockfish";
}

export interface MoveResponse {
  fen: string;
  player_move_san: string;
  opponent_move_uci: string | null;
  opponent_move_san: string | null;
  opponent_move_method?: "llm" | "engine" | null;
  opponent_move_reason?: string | null;
  status: string;
  result: string | null;
  coaching: CoachingData | null;
}

const API_BASE = "/api";

export async function createGame(
  depth: number = 10,
  eloProfile: string = "intermediate",
  coachName: string = "Anna Cramling",
  opponentRating: number = 1200,
): Promise<NewGameResponse> {
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
): Promise<MoveResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${API_BASE}/game/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, move: moveUci, verbosity }),
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

export async function getGameState(sessionId: string): Promise<GameStateResponse> {
  const res = await fetch(`${API_BASE}/game/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`Failed to restore game: ${res.status}`);
  return res.json();
}

export async function sendChat(
  sessionId: string,
  message: string,
  viewedFen?: string,
  responseMode: "fast" | "deep" = "fast",
): Promise<{ message: string; source: "ai" | "unavailable"; provider: ProviderInfo | null; chat_history: ChatMessage[] }> {
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
  const res = await fetch(`${API_BASE}/providers/auth/${encodeURIComponent(provider)}`, {
    method: "POST",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Login could not be started" }));
    throw new Error(detail.detail || `Login failed: ${res.status}`);
  }
  return res.json();
}
