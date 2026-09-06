/**
 * Backend + demo clients. The app talks to the Chess Teacher FastAPI server
 * when one is configured, otherwise it plays a fully offline demo (local
 * rules + greedy AI + free hosted chat).
 */

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
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

export interface TrapLine {
  move_san: string;
  tempting_because: string;
  win_drop: number;
  line: TeachableLine;
}

export interface TeachableLine {
  fen: string;
  depth: number;
  score_cp: number | null;
  score_mate: number | null;
  verdict: string;
  moves: LinePly[];
  traps?: TrapLine[];
}

async function postJson(base: string, path: string, body: unknown, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 120)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(base: string, path: string, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function probeBackend(base: string): Promise<boolean> {
  try {
    const data = await getJson(base, "/api/health", 6000);
    return data?.status === "ok";
  } catch {
    return false;
  }
}

export async function fetchProviders(base: string) {
  return getJson(base, "/api/providers", 10000);
}

export async function configureProvider(
  base: string,
  body: { provider: string; model?: string; effort?: string },
) {
  return postJson(base, "/api/providers/config", body, 15000);
}

export async function createGame(base: string): Promise<{ session_id: string; fen: string }> {
  return postJson(base, "/api/game/new", {}, 15000);
}

export async function sendMove(base: string, sessionId: string, moveUci: string) {
  return postJson(base, "/api/game/move", { session_id: sessionId, move: moveUci }, 30000);
}

export async function requestAiMove(base: string, sessionId: string) {
  return postJson(base, "/api/game/ai-move", { session_id: sessionId }, 120000);
}

export async function sendChat(
  base: string,
  sessionId: string,
  message: string,
  mode: "fast" | "deep" = "fast",
): Promise<{ message: string; provider: { provider: string } | null; chat_history: ChatMessage[] }> {
  return postJson(
    base,
    "/api/game/chat",
    { session_id: sessionId, message, response_mode: mode },
    120000,
  );
}

export async function fetchLine(base: string, fen: string): Promise<TeachableLine> {
  return postJson(base, "/api/analysis/line", { fen, max_plies: 10, depth: 16 }, 90000);
}

export async function fetchVoice(base: string, text: string): Promise<string> {
  // Returns a local blob/file URI of the rendered WAV.
  const res = await fetch(base + "/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 1200) }),
  });
  if (!res.ok) throw new Error(`voice HTTP ${res.status}`);
  const blob = await res.blob();
  // React Native: FileReader -> data URI works with expo-av on all platforms.
  const uri: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
  return uri;
}

export async function checkNeuralVoice(base: string): Promise<boolean> {
  try {
    const data = await getJson(base, "/api/voice/status", 8000);
    return data?.ready === true;
  } catch {
    return false;
  }
}

// ---- Free hosted demo chat (same endpoint/shape as the web demo) ----

const LLM7_URL = "https://api.llm7.io/v1/chat/completions";
const LLM7_MODEL = "mistral-Nemo-Instruct-2407";
let lastDemoChat = 0;

export async function demoChat(fen: string, moves: string, question: string): Promise<string> {
  const wait = 7000 - (Date.now() - lastDemoChat);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastDemoChat = Date.now();
  const res = await fetch(LLM7_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM7_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are Free Weak AI, a small hosted chess explainer. You are not ChatGPT or Codex. " +
            "Reply in 20 to 50 words, plain text, no quotes. Be friendly and brief.",
        },
        {
          role: "user",
          content: `FEN: ${fen}\nMoves: ${moves || "(start)"}\nQuestion: ${question}`,
        },
      ],
      max_tokens: 220,
    }),
  });
  if (!res.ok) throw new Error(`demo chat HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text === "string" && text.trim()) return text.trim();
  throw new Error("empty demo reply");
}
