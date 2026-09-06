/** Offline demo brain: legal chess + a greedy, human-flavoured opponent. */

import { Chess, Move } from "chess.js";

const VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function startingFen(): string {
  return new Chess().fen();
}

export function legalMoves(fen: string): Move[] {
  return new Chess(fen).moves({ verbose: true });
}

export function applyUci(fen: string, uci: string): { fen: string; san: string } | null {
  try {
    const game = new Chess(fen);
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined,
    });
    return { fen: game.fen(), san: move.san };
  } catch {
    return null;
  }
}

/** Pick the AI reply: mostly greedy captures, sometimes principled development. */
export function pickDemoReply(fen: string, strength = 0.7): { uci: string; san: string } | null {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;
  const scored = moves.map((m) => {
    let score = Math.random() * 60;
    const victim = game.get(m.to);
    if (victim) score += VALUES[victim.type] - VALUES[m.piece] * 0.12 + 140;
    if (m.san.includes("+")) score += 90;
    if (m.san.includes("#")) score += 10000;
    if (["n", "b"].includes(m.piece) && /[c-f][3-6]/.test(m.to)) score += 45;
    if (m.flags.includes("k") || m.flags.includes("q")) score += 55;
    if (m.piece === "p" && /[c-f][45]/.test(m.to)) score += 35;
    // Human wobble: weaker settings sometimes play second-best.
    if (Math.random() > strength) score = Math.random() * 120;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].m;
  return {
    uci: best.from + best.to + (best.promotion ?? ""),
    san: best.san,
  };
}

export function gameStatus(fen: string): { over: boolean; label: string } {
  const game = new Chess(fen);
  if (game.isCheckmate()) return { over: true, label: `Checkmate — ${game.turn() === "w" ? "Black" : "White"} wins` };
  if (game.isStalemate()) return { over: true, label: "Stalemate — draw" };
  if (game.isDraw()) return { over: true, label: "Draw" };
  if (game.inCheck()) return { over: false, label: "Check!" };
  return { over: false, label: game.turn() === "w" ? "Your move" : "AI thinking…" };
}

export function toSanList(fen: string, uciMoves: string[]): string[] {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves) {
    try {
      out.push(
        game.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined,
        }).san,
      );
    } catch {
      break;
    }
  }
  return out;
}
