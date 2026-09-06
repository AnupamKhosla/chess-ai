/** Play tab: board, status, move list with grades, game controls, quick chat. */

import { useWindowDimensions, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import Board from "../components/Board";
import { boardSizeFor } from "../components/Board";
import { GRADE_COLORS, theme } from "../theme";
import { movesToPgn, useChat, useGame } from "../state";

export default function PlayScreen({ game, backend }: { game: ReturnType<typeof useGame>; backend: string | null }) {
  const { width } = useWindowDimensions();
  const size = boardSizeFor(width);
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chat = useChat(backend, game.sessionId, game.fen, game.history);
  const recent = chat.messages.slice(-3);

  const copyPgn = async () => {
    await Clipboard.setStringAsync(movesToPgn(game.history));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sendQuickChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    await chat.send(text);
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
      <View style={styles.chatBox}>
        <Text style={styles.chatTitle}>Ask the coach</Text>
        {recent.map((m, i) => (
          <View key={`${i}-${m.text.slice(0, 12)}`} style={[styles.chatBubble, m.role === "user" ? styles.you : styles.coach]}>
            <Text style={styles.chatRole}>{m.role === "user" ? "You" : "Coach"}</Text>
            <Text style={styles.chatBody} numberOfLines={4}>
              {m.text}
            </Text>
          </View>
        ))}
        {recent.length === 0 ? (
          <Text style={styles.empty}>Ask about this position — the coach answers right here.</Text>
        ) : null}
        {chat.sending ? <ActivityIndicator color={theme.accent} style={{ marginTop: 6 }} /> : null}
        <View style={styles.chatRow}>
          <TextInput
            style={styles.chatInput}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Why is this move good?"
            placeholderTextColor={theme.dim}
            returnKeyType="send"
            onSubmitEditing={() => void sendQuickChat()}
          />
          <Pressable style={[styles.btn, styles.sendBtn]} onPress={() => void sendQuickChat()}>
            <Text style={styles.btnText}>Send</Text>
          </Pressable>
        </View>
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
  chatBox: {
    alignSelf: "stretch",
    backgroundColor: theme.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.panelEdge,
    padding: 12,
    gap: 8,
  },
  chatTitle: { color: theme.text, fontWeight: "800", fontSize: 14 },
  chatBubble: { borderRadius: 8, padding: 10, borderWidth: 1 },
  you: { alignSelf: "flex-end", width: "92%", borderColor: theme.panelEdge, backgroundColor: theme.input },
  coach: { alignSelf: "stretch", borderColor: "#2c5b3f", backgroundColor: "#0f1f16", borderLeftWidth: 3, borderLeftColor: theme.accent },
  chatRole: { color: theme.accent, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 },
  chatBody: { color: theme.text, fontSize: 14, lineHeight: 20 },
  chatRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  chatInput: {
    flex: 1,
    backgroundColor: theme.input,
    color: theme.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.panelEdge,
  },
  sendBtn: { justifyContent: "center" },
});
