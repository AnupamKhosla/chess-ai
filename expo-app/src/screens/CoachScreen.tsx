/** Coach tab: orb presence + continuous chat + voice. */

import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Orb, { OrbState } from "../components/Orb";
import { theme } from "../theme";
import { useChat, useGame } from "../state";
import type { useVoice } from "../voice";

export default function CoachScreen({
  game,
  backend,
  coachName,
  voice,
  beat,
}: {
  game: ReturnType<typeof useGame>;
  backend: string | null;
  coachName: string;
  voice: ReturnType<typeof useVoice>;
  beat: number;
}) {
  const [input, setInput] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [greeted, setGreeted] = useState(false);
  const chat = useChat(backend, game.sessionId, game.fen, game.history);

  const greeting = `Hey — ${coachName} here. Play your move and I'll coach it live.`;
  const shown = greeted ? chat.messages : [{ role: "assistant", text: greeting } as const, ...chat.messages];

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setGreeted(true);
    setOrb("speaking");
    const reply = await chat.send(text);
    if (reply && /checkmate|mate in|brilliant/i.test(reply.text)) setOrb("excited");
    await voice.speak(reply?.text ?? "Hmm, say that again?", {});
    setOrb("idle");
  };

  return (
    <View style={styles.root}>
      <View style={styles.dock}>
        <Orb state={orb} beat={beat} size={64} onPress={() => void voice.speak("I'm here — ask me anything.", {})} />
        <View style={styles.meta}>
          <Text style={styles.name}>{coachName}</Text>
          <Text style={styles.status}>
            {voice.speaking ? "speaking…" : backend ? "connected · remembers you" : "demo · offline sparring"}
          </Text>
          <Text style={styles.engine}>
            Voice: {voice.engine === "neural" ? "Neural" : voice.engine === "system" ? "System" : "Auto"}
            {voice.neuralReady ? " → Neural" : " → System"} · tap Voice to cycle
          </Text>
        </View>
        <Pressable
          style={styles.cycle}
          onPress={() =>
            voice.setEngine(voice.engine === "auto" ? "system" : voice.engine === "system" ? "neural" : "auto")
          }
        >
          <Text style={styles.cycleText}>Voice</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
        {shown.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === "user" ? styles.you : styles.coach]}>
            <Text style={styles.role}>{m.role === "user" ? "You" : coachName}</Text>
            <Text style={styles.body}>{m.text}</Text>
          </View>
        ))}
        {chat.sending ? <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} /> : null}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about this position…"
          placeholderTextColor={theme.dim}
          multiline
          returnKeyType="send"
          onSubmitEditing={() => void send()}
        />
        <Pressable style={[styles.send, !input.trim() && styles.sendOff]} onPress={() => void send()}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
      <Pressable style={styles.stop} onPress={() => { void voice.stop(); setOrb("idle"); }}>
        <Text style={styles.stopText}>{voice.speaking ? "■ Stop speaking" : "🔊 Voice ready"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.panel,
  },
  meta: { flex: 1 },
  name: { color: theme.text, fontWeight: "800", fontSize: 16 },
  status: { color: theme.muted, fontSize: 13, marginTop: 2 },
  engine: { color: theme.dim, fontSize: 12, marginTop: 2 },
  cycle: { borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  cycleText: { color: theme.accent, fontWeight: "800" },
  log: { flex: 1, marginTop: 12 },
  logContent: { padding: 16, paddingTop: 0, gap: 10 },
  bubble: { borderRadius: 10, padding: 12, borderWidth: 1 },
  you: { alignSelf: "flex-end", width: "92%", backgroundColor: theme.panel, borderColor: theme.panelEdge },
  coach: { alignSelf: "stretch", backgroundColor: "#0f1f16", borderColor: "#2c5b3f", borderLeftWidth: 3, borderLeftColor: theme.accent },
  role: { color: theme.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  body: { color: theme.text, fontSize: 15, lineHeight: 22 },
  composer: { flexDirection: "row", gap: 8, padding: 12 },
  input: {
    flex: 1,
    backgroundColor: theme.input,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.panelEdge,
    maxHeight: 110,
  },
  send: { backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 18, justifyContent: "center", minHeight: 48 },
  sendOff: { opacity: 0.5 },
  sendText: { color: "#092018", fontWeight: "800" },
  stop: { alignItems: "center", paddingBottom: 14 },
  stopText: { color: theme.muted, fontSize: 13 },
});
