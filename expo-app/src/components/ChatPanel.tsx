/**
 * Compact AI chat card: title, scrollable transcript, composer row with
 * arrow-send, speaker flip, and info buttons. Used inline on Play and
 * inside the half-screen overlay — one component, two homes.
 */

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { theme } from "../theme";
import type { ChatMessage } from "../api";

interface Props {
  title?: string;
  messages: ChatMessage[];
  sending: boolean;
  typingHint?: string;
  onSend: (text: string) => void;
  voiceOn: boolean;
  onFlipVoice: () => void;
  onInfo: () => void;
  onExpand?: () => void;
  maxListHeight?: number;
}

export default function ChatPanel({
  title = "AI chat",
  messages,
  sending,
  typingHint,
  onSend,
  voiceOn,
  onFlipVoice,
  onInfo,
  onExpand,
  maxListHeight = 220,
}: Props) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    onSend(text);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {onExpand ? (
          <Pressable style={styles.iconBtn} onPress={onExpand} accessibilityLabel="Expand chat">
            <Text style={styles.iconText}>⤢</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={[styles.list, { maxHeight: maxListHeight }]} contentContainerStyle={styles.listContent} nestedScrollEnabled>
        {messages.length === 0 ? (
          <Text style={styles.empty}>{typingHint ?? "Ask about this position — the coach answers right here."}</Text>
        ) : null}
        {messages.map((m, i) => (
          <View key={`${i}-${m.text.slice(0, 10)}`} style={[styles.bubble, m.role === "user" ? styles.you : styles.coach]}>
            <Text style={styles.role}>{m.role === "user" ? "You" : "Coach"}</Text>
            <Text style={styles.body} numberOfLines={m.role === "user" ? 6 : 12}>
              {m.text}
            </Text>
          </View>
        ))}
        {sending ? <ActivityIndicator color={theme.accent} style={{ marginTop: 6 }} /> : null}
      </ScrollView>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Why is this move good?"
          placeholderTextColor={theme.dim}
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <Pressable style={styles.iconBtn} onPress={onInfo} accessibilityLabel="Chat options">
          <Text style={styles.iconText}>i</Text>
        </Pressable>
        <Pressable
          style={[styles.iconBtn, voiceOn && styles.iconOn]}
          onPress={onFlipVoice}
          accessibilityLabel="Flip AI voice"
        >
          <Text style={styles.iconText}>{voiceOn ? "🔊" : "🔇"}</Text>
        </Pressable>
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendOff]}
          onPress={send}
          accessibilityLabel="Send"
        >
          <Text style={styles.sendArrow}>➤</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: theme.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.panelEdge,
    padding: 12,
    gap: 8,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.text, fontWeight: "800", fontSize: 14 },
  list: { alignSelf: "stretch" },
  listContent: { gap: 8, paddingBottom: 2 },
  empty: { color: theme.dim, fontStyle: "italic", fontSize: 13 },
  bubble: { borderRadius: 8, padding: 10, borderWidth: 1 },
  you: { alignSelf: "flex-end", width: "92%", borderColor: theme.panelEdge, backgroundColor: theme.input },
  coach: { alignSelf: "stretch", borderColor: "#2c5b3f", backgroundColor: "#0f1f16", borderLeftWidth: 3, borderLeftColor: theme.accent },
  role: { color: theme.accent, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 },
  body: { color: theme.text, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: 2 },
  input: {
    flex: 1,
    backgroundColor: theme.input,
    color: theme.text,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.panelEdge,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.panelEdge,
    alignItems: "center",
    justifyContent: "center",
  },
  iconOn: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  iconText: { color: theme.accent, fontWeight: "800", fontSize: 16 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { opacity: 0.45 },
  sendArrow: { color: "#092018", fontWeight: "800", fontSize: 18 },
});
