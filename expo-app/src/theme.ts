/** CoachCast theme for the native app: midnight broadcast booth. */

export const theme = {
  bg: "#0b1220",
  panel: "#131c2e",
  panelEdge: "#274061",
  input: "#0e1626",
  text: "#e5e7eb",
  muted: "#9ca3af",
  dim: "#5b6b82",
  accent: "#4ade80",
  accentDim: "#4ade8022",
  danger: "#f87171",
  warn: "#fbbf24",
  info: "#7dd3fc",
  wood: "#2e2117",
  brass: "rgba(212,160,84,0.55)",
  radius: 12,
  fontMono: "monospace",
} as const;

export const GRADE_COLORS: Record<string, string> = {
  brilliant: "#4ade80",
  good: "transparent",
  inaccuracy: "#fbbf24",
  mistake: "#fb923c",
  blunder: "#f87171",
};

export const PIECE_GLYPHS: Record<string, string> = {
  wk: "♔",
  wq: "♕",
  wr: "♖",
  wb: "♗",
  wn: "♘",
  wp: "♙",
  bk: "♚",
  bq: "♛",
  br: "♜",
  bb: "♝",
  bn: "♞",
  bp: "♟",
};
