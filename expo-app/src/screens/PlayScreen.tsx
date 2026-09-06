/** Play tab: board, status, move list with grades, game controls. */

import { useWindowDimensions, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import Board from "../components/Board";
import { boardSizeFor } from "../components/Board";
import { GRADE_COLORS, theme } from "../theme";
import { movesToPgn, useGame } from "../state";

export default function PlayScreen({ game }: { game: ReturnType<typeof useGame> }) {
  const { width } = useWindowDimensions();
  const size = boardSizeFor(width);
  const [copied, setCopied] = useState(false);

  const copyPgn = async () => {
    await Clipboard.setStringAsync(movesToPgn(game.history));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.statusRow}>
        <Text style={styles.status}>{game.aiThinking ? "AI thinking…" : game.status}</Text>
        {game.aiThinking ? <ActivityIndicator color={theme.accent} /> : null}
      </View>
      <Board
        fen={game.fen}
        size={size}
        disabled={game.busy || game.aiThinking || game.over || !game.sessionId}
        arrows={game.lastArrows}
        onMove={(from, to) => {
          void game.playMove(from, to);
        }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moves}>
        {game.history.map((m, i) => (
          <View
            key={i}
            style={[
              styles.chip,
              m.grade && GRADE_COLORS[m.grade] !== "transparent"
                ? { borderLeftWidth: 3, borderLeftColor: GRADE_COLORS[m.grade] }
                : null,
            ]}
          >
            <Text style={styles.chipText}>
              {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}{m.san}
            </Text>
          </View>
        ))}
        {game.history.length === 0 ? <Text style={styles.empty}>Your moves appear here, graded live.</Text> : null}
      </ScrollView>
      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.primary]} onPress={() => void game.newGame()} disabled={game.busy}>
          <Text style={styles.btnPrimaryText}>New Game</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void game.playAiMove()} disabled={game.busy || game.aiThinking || game.over || !game.sessionId}>
          <Text style={styles.btnText}>{game.aiThinking ? "Thinking…" : "▶ AI move"}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void copyPgn()}>
          <Text style={styles.btnText}>{copied ? "Copied!" : "Copy PGN"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12, alignItems: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  status: { color: theme.accent, fontWeight: "800", fontSize: 15 },
  moves: { maxHeight: 44, alignSelf: "stretch" },
  chip: {
    backgroundColor: theme.panel,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 6,
    borderWidth: 1,
    borderColor: theme.panelEdge,
  },
  chipText: { color: theme.text, fontWeight: "700" },
  empty: { color: theme.dim, fontStyle: "italic" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  btn: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: "center",
  },
  primary: { backgroundColor: theme.accent },
  btnText: { color: theme.accent, fontWeight: "800" },
  btnPrimaryText: { color: "#092018", fontWeight: "800" },
});
