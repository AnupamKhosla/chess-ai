/**
 * Drag-and-drop chessboard with tap fallback and arrow overlays.
 * Zero native deps. The board itself never scrolls; while a drag is active
 * it reports via onDragStateChange so the parent ScrollView can lock.
 */

import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
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
  onMove?: (from: string, to: string, promotion?: string) => void;
  arrows?: BoardArrow[];
  lastMove?: { from: string; to: string } | null;
  disabled?: boolean;
  size: number;
  onDragStateChange?: (dragging: boolean) => void;
}

const FILES = "abcdefgh";

/**
 * Board size that grows onto tablets but never overflows phones:
 * full width on handsets, up to 700pt on iPads and landscape.
 */
export function boardSizeFor(windowWidth: number): number {
  return Math.min(windowWidth - 32, 700);
}

function squareXY(sq: string, orientation: "white" | "black", cell: number) {
  let file = FILES.indexOf(sq[0]);
  let rank = 8 - parseInt(sq[1], 10);
  if (orientation === "black") {
    file = 7 - file;
    rank = 7 - rank;
  }
  return { x: (file + 0.5) * cell, y: (rank + 0.5) * cell };
}

function squareAt(x: number, y: number, orientation: "white" | "black", cell: number): string | null {
  if (x < 0 || y < 0 || x >= cell * 8 || y >= cell * 8) return null;
  let file = Math.floor(x / cell);
  let rank = Math.floor(y / cell);
  if (orientation === "black") {
    file = 7 - file;
    rank = 7 - rank;
  }
  return `${FILES[file]}${8 - rank}`;
}

export default function Board({
  fen,
  orientation = "white",
  onMove,
  arrows = [],
  lastMove,
  disabled,
  size,
  onDragStateChange,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ from: string; moved: boolean } | null>(null);
  const cell = size / 8;

  const position = useMemo(() => {
    const game = new Chess(fen);
    const map: Record<string, string> = {};
    for (const sq of game.board().flat()) {
      if (sq) map[sq.square] = sq.color + sq.type;
    }
    return map;
  }, [fen]);

  const sideToMove = fen.split(" ")[1] === "b" ? "b" : "w";

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    try {
      const game = new Chess(fen);
      return new Set(game.moves({ square: selected as never, verbose: true }).map((m) => m.to));
    } catch {
      return new Set<string>();
    }
  }, [fen, selected]);

  const tryMove = (from: string, to: string) => {
    // Pawn to the last rank auto-promotes to queen (chooser would cost a
    // native sheet; queen is right ~97% of the time in coaching games).
    const piece = position[from];
    const lastRank = sideToMove === "w" ? "8" : "1";
    const promotion = piece === `${sideToMove}p` && to[1] === lastRank ? "q" : undefined;
    onMove?.(from, to, promotion);
  };

  const tapSquare = (sq: string | null) => {
    if (disabled || !sq) {
      setSelected(null);
      return;
    }
    if (selected && legalTargets.has(sq)) {
      tryMove(selected, sq);
      setSelected(null);
      return;
    }
    const piece = position[sq];
    if (piece && piece[0] === sideToMove) {
      setSelected(selected === sq ? null : sq);
    } else {
      setSelected(null);
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: (_e, g) => !disabled && (Math.abs(g.dx) + Math.abs(g.dy) > 6),
        onPanResponderGrant: (e) => {
          const sq = squareAt(e.nativeEvent.locationX, e.nativeEvent.locationY, orientation, cell);
          const piece = sq ? position[sq] : undefined;
          if (sq && piece && piece[0] === sideToMove && !disabled) {
            dragRef.current = { from: sq, moved: false };
            setDrag({ from: sq, x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
          } else {
            dragRef.current = null;
          }
        },
        onPanResponderMove: (e) => {
          const d = dragRef.current;
          if (!d) return;
          if (!d.moved) {
            d.moved = true;
            setSelected(d.from);
            onDragStateChange?.(true);
          }
          setDrag({ from: d.from, x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
        },
        onPanResponderRelease: (e) => {
          const d = dragRef.current;
          dragRef.current = null;
          onDragStateChange?.(false);
          const sq = squareAt(e.nativeEvent.locationX, e.nativeEvent.locationY, orientation, cell);
          const wasDrag = d?.moved ?? false;
          setDrag(null);
          if (d && wasDrag) {
            if (sq && sq !== d.from && legalTargets.has(sq)) {
              tryMove(d.from, sq);
              setSelected(null);
            } else {
              setSelected(d.from);
            }
          } else {
            tapSquare(sq);
          }
        },
        onPanResponderTerminate: () => {
          dragRef.current = null;
          setDrag(null);
          onDragStateChange?.(false);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, orientation, cell, fen, position, sideToMove, selected, legalTargets],
  );

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
      const isDragOrigin = drag?.from === sq;
      squares.push(
        <View
          key={sq}
          style={[
            styles.square,
            { width: cell, height: cell, backgroundColor: light ? "#E4D7BE" : "#7D6B58" },
            isLast && { backgroundColor: light ? "#D9C98F" : "#6E7B3A" },
            isSel && { backgroundColor: "#4ade8066" },
          ]}
        >
          {position[sq] && PIECES[position[sq]] && !isDragOrigin ? (
            (() => {
              const Glyph = PIECES[position[sq]];
              return <Glyph size={cell * 0.92} />;
            })()
          ) : null}
          {isTarget ? <View style={[styles.dot, { width: cell * 0.28, height: cell * 0.28, borderRadius: cell * 0.14 }]} /> : null}
        </View>,
      );
    }
  }

  const DragGlyph = drag && position[drag.from] && PIECES[position[drag.from]] ? PIECES[position[drag.from]] : null;

  return (
    <View style={[styles.frame, { width: size + 16 }]}>
      <View style={[styles.board, { width: size, height: size }]} {...responder.panHandlers}>
        {squares}
        {arrows.map((arrow, i) => (
          <ArrowOverlay key={i} arrow={arrow} orientation={orientation} cell={cell} />
        ))}
        {drag && DragGlyph ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { left: drag.x - cell / 2, top: drag.y - cell / 2, width: cell, height: cell }]}
          >
            <DragGlyph size={cell * 0.98} />
          </View>
        ) : null}
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
  dot: { position: "absolute", backgroundColor: "rgba(74,222,128,0.75)" },
});

export { squareXY };
export type { Props as BoardProps };
