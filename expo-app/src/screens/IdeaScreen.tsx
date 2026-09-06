/** Idea tab: guided engine lines with arrows, traps, and spoken steps. */

import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Chess } from "chess.js";
import Board, { BoardArrow, boardSizeFor } from "../components/Board";
import { theme } from "../theme";
import { fetchLine, type TeachableLine } from "../api";
import type { useVoice } from "../voice";

const HEAT: Record<string, string> = { checkmate: "#f87171", check: "#fb923c", capture: "#fbbf24" };

export default function IdeaScreen({ fen, backend, voice }: { fen: string; backend: string | null; voice: ReturnType<typeof useVoice> }) {
  const { width } = useWindowDimensions();
  const size = boardSizeFor(width);
  const [line, setLine] = useState<TeachableLine | null>(null);
  const [view, setView] = useState(0); // 0 = best, 1.. = traps
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = view === 0 ? line : line?.traps?.[view - 1]?.line ?? null;
  const hook = view === 0 ? null : line?.traps?.[view - 1];

  const load = async () => {
    if (!backend) {
      setError("Guided lines need the local app connected (Settings → backend URL).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fresh = await fetchLine(backend, new Chess(fen).fen());
      setLine(fresh);
      setView(0);
      setCursor(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Line failed");
    } finally {
      setLoading(false);
    }
  };

  const step = async (next: number) => {
    if (!active) return;
    const clamped = Math.max(0, Math.min(next, active.moves.length));
    setCursor(clamped);
    if (clamped > 0) {
      const ply = active.moves[clamped - 1];
      await voice.speak(`${ply.san}. ${ply.comment}`, {});
    }
  };

  const previewFen = cursor === 0 || !active ? fen : active.moves[cursor - 1].fen_after;
  const arrows: BoardArrow[] =
    cursor === 0 || !active
      ? []
      : [
          {
            from: active.moves[cursor - 1].uci.slice(0, 2),
            to: active.moves[cursor - 1].uci.slice(2, 4),
            color: active.moves[cursor - 1].checkmate || active.moves[cursor - 1].check ? "#f87171" : active.moves[cursor - 1].capture ? "#fbbf24" : "#4ade80",
          },
        ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable style={[styles.btn, styles.primary]} onPress={() => void load()} disabled={loading}>
        <Text style={styles.btnPrimaryText}>{loading ? "Reading…" : "💡 Show me the idea"}</Text>
      </Pressable>
      {!line && !loading && !error ? (
        <Text style={styles.empty}>
          Guided engine lines live here: best moves, human traps with refutations, arrows, and spoken steps.
          {backend ? "" : "\n\nNeeds the backend — connect it in Settings."}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {active ? (
        <>
          <View style={styles.tabs}>
            <Pressable style={[styles.tab, view === 0 && styles.tabOn]} onPress={() => { setView(0); setCursor(0); }}>
              <Text style={styles.tabText}>Best</Text>
            </Pressable>
            {(line?.traps ?? []).map((t, i) => (
              <Pressable key={i} style={[styles.tab, view === i + 1 && styles.tabOn]} onPress={() => { setView(i + 1); setCursor(0); }}>
                <Text style={styles.tabText}>Trap: {t.move_san}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.verdict}>
            {hook ? `Most humans play ${hook.move_san} — ${hook.tempting_because}. That's the trap:` : active.verdict}
          </Text>
          <Board fen={previewFen} size={size} arrows={arrows} disabled />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {active.moves.map((ply, i) => (
              <Pressable
                key={i}
                style={[
                  styles.chip,
                  cursor === i + 1 && styles.chipOn,
                  (ply.checkmate || ply.check) && { borderColor: HEAT.checkmate },
                  !ply.check && !ply.checkmate && ply.capture && { borderColor: HEAT.capture },
                ]}
                onPress={() => void step(i + 1)}
              >
                <Text style={styles.chipText}>
                  {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}{ply.san}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.comment}>
            {cursor === 0 ? "Start of the idea — step forward to walk it." : active.moves[cursor - 1].comment}
          </Text>
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={() => void step(cursor - 1)}>
              <Text style={styles.btnText}>◀ Prev</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => void step(cursor + 1)}>
              <Text style={styles.btnText}>Next ▶</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12, alignItems: "center" },
  btn: { borderWidth: 1, borderColor: theme.accent, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 20, minHeight: 52 },
  primary: { backgroundColor: theme.accent },
  btnPrimaryText: { color: "#092018", fontWeight: "800", fontSize: 16 },
  btnText: { color: theme.accent, fontWeight: "800", fontSize: 15 },
  error: { color: theme.danger },
  tabs: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  tab: { borderWidth: 1, borderColor: theme.panelEdge, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  tabOn: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  tabText: { color: theme.text, fontWeight: "700" },
  verdict: { color: theme.text, fontSize: 14, textAlign: "center", lineHeight: 20 },
  empty: { color: theme.dim, fontSize: 14, textAlign: "center", lineHeight: 21, paddingHorizontal: 24 },
  chips: { maxHeight: 48, alignSelf: "stretch" },
  chip: { borderWidth: 1, borderColor: theme.panelEdge, backgroundColor: theme.panel, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10, marginRight: 6 },
  chipOn: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  chipText: { color: theme.text, fontWeight: "700" },
  comment: { color: theme.muted, fontSize: 14, textAlign: "center", fontStyle: "italic" },
  row: { flexDirection: "row", gap: 10 },
});
