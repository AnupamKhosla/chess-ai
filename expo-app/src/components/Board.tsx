/** Tap-tap chessboard with arrow overlays. Zero native deps. */

import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chess } from "chess.js";
import { theme } from "../theme";
import { PIECES } from "./Pieces";

export interface BoardArrow {
  from: string;
  to: string;
  color: string;
}

interface Props {
  fen: string;
  orientation?: "white" | "black";
  onMove?: (from: string, to: string) => void;
  arrows?: BoardArrow[];
  lastMove?: { from: string; to: string } | null;
  disabled?: boolean;
  size: number;
}

const FILES = "abcdefgh";

/**
 * Board size that grows onto tablets but never overflows phones:
 * full width on handsets, up to 700pt on iPads and landscape.
 */
export function boardSizeFor(windowWidth: number): number {
  return Math.min(windowWidth - 32, 700);
}

function squareXY(sq: string, orientation: "white" | "black", cell: number) {  let file = FILES.indexOf(sq[0]);
  let rank = 8 - parseInt(sq[1], 10);
  if (orientation === "black") {
    file = 7 - file;
    rank = 7 - rank;
  }
  return { x: (file + 0.5) * cell, y: (rank + 0.5) * cell };
}

export default function Board({ fen, orientation = "white", onMove, arrows = [], lastMove, disabled, size }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const cell = size / 8;

  const position = useMemo(() => {
    const game = new Chess(fen);
    const map: Record<string, string> = {};
    for (const sq of game.board().flat()) {
      if (sq) map[sq.square] = sq.color + sq.type;
    }
    return map;
  }, [fen]);

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    try {
      const game = new Chess(fen);
      return new Set(game.moves({ square: selected as never, verbose: true }).map((m) => m.to));
    } catch {
      return new Set<string>();
    }
  }, [fen, selected]);

  const handleTap = (sq: string) => {
    if (disabled) return;
    if (selected && legalTargets.has(sq)) {
      onMove?.(selected, sq);
      setSelected(null);
      return;
    }
    const piece = position[sq];
    const turn = fen.split(" ")[1] === "b" ? "b" : "w";
    if (piece && piece[0] === turn) {
      setSelected(selected === sq ? null : sq);
    } else {
      setSelected(null);
    }
  };

  const squares = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const df = orientation === "white" ? file : 7 - file;
      const dr = orientation === "white" ? rank : 7 - rank;
      const sq = `${FILES[df]}${8 - dr}`;
      const light = (df + dr) % 2 === 1;
      const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
      const isSel = selected === sq;
      const isTarget = legalTargets.has(sq);
      squares.push(
        <Pressable
          key={sq}
          onPress={() => handleTap(sq)}
          style={[
            styles.square,
            { width: cell, height: cell, backgroundColor: light ? "#E4D7BE" : "#7D6B58" },
            isLast && { backgroundColor: light ? "#D9C98F" : "#6E7B3A" },
            isSel && { backgroundColor: "#4ade8066" },
          ]}
        >
          {position[sq] && PIECES[position[sq]] ? (
            (() => {
              const Glyph = PIECES[position[sq]];
              return <Glyph size={cell * 0.92} />;
            })()
          ) : null}
          {isTarget ? <View style={[styles.dot, { width: cell * 0.28, height: cell * 0.28, borderRadius: cell * 0.14 }]} /> : null}
        </Pressable>,
      );
    }
  }

  return (
    <View style={[styles.frame, { width: size + 16 }]}>
      <View style={[styles.board, { width: size, height: size }]}>
        {squares}
        {arrows.map((arrow, i) => (
          <ArrowOverlay key={i} arrow={arrow} orientation={orientation} cell={cell} />
        ))}
      </View>
    </View>
  );
}

function ArrowOverlay({ arrow, orientation, cell }: { arrow: BoardArrow; orientation: "white" | "black"; cell: number }) {
  const a = squareXY(arrow.from, orientation, cell);
  const b = squareXY(arrow.to, orientation, cell);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < cell * 0.5) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rad = (angle * Math.PI) / 180;
  const shorten = cell * 0.34;
  // Shaft drawn between the shortened endpoints, centered so rotation is exact.
  const sx = a.x + Math.cos(rad) * shorten;
  const sy = a.y + Math.sin(rad) * shorten;
  const ex = b.x - Math.cos(rad) * shorten;
  const ey = b.y - Math.sin(rad) * shorten;
  const shaftLen = Math.max(6, Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2));
  const thickness = Math.max(4, cell * 0.11);
  const head = cell * 0.3;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: "absolute",
          left: (sx + ex) / 2 - shaftLen / 2,
          top: (sy + ey) / 2 - thickness / 2,
          width: shaftLen,
          height: thickness,
          backgroundColor: arrow.color,
          opacity: 0.85,
          borderRadius: 3,
          transform: [{ rotate: `${angle}deg` }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: ex - head / 2,
          top: ey - head / 2,
          width: 0,
          height: 0,
          borderLeftWidth: head,
          borderTopWidth: head * 0.58,
          borderBottomWidth: head * 0.58,
          borderLeftColor: arrow.color,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          opacity: 0.9,
          transform: [{ rotate: `${angle}deg` }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: theme.wood,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: theme.brass,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  board: { flexDirection: "row", flexWrap: "wrap", borderRadius: 4, overflow: "hidden" },
  square: { alignItems: "center", justifyContent: "center" },
  piece: { textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 3 },
  dot: { position: "absolute", backgroundColor: "rgba(74,222,128,0.75)" },
});

// Re-exported for tests/consumers that want the pure geometry.
export { squareXY };
export type { Props as BoardProps };
