/** Settings tab: backend connection, voice, about. */

import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { probeBackend } from "../api";
import { theme } from "../theme";

const PRESETS = [
  { label: "Demo (offline)", value: "" },
  { label: "Emulator → this PC", value: "http://10.0.2.2:8901" },
  { label: "Simulator → this Mac", value: "http://localhost:8901" },
];

export default function SettingsScreen({
  backend,
  onSave,
  coachName,
  onCoachName,
}: {
  backend: string | null;
  onSave: (url: string | null) => void;
  coachName: string;
  onCoachName: (name: string) => void;
}) {
  const [url, setUrl] = useState(backend ?? "");
  const [name, setName] = useState(coachName);
  const [checking, setChecking] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  const test = async (candidate: string) => {
    setChecking(candidate);
    setResult(null);
    const ok = candidate ? await probeBackend(candidate) : true;
    setChecking(null);
    setResult(ok ? "✓ Connected — full Stockfish, memory, neural voice." : "✗ No server there. Start the local app or check the address.");
    return ok;
  };

  const save = async () => {
    const candidate = url.trim().replace(/\/$/, "");
    if (!candidate) {
      onSave(null);
      onCoachName(name.trim() || "Anna");
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
      setResult("Demo mode — offline sparring, hosted chat.");
      return;
    }
    if (await test(candidate)) {
      onSave(candidate);
      onCoachName(name.trim() || "Anna");
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h}>Backend</Text>
      <Text style={styles.p}>Your FastAPI app: real Stockfish, providers, memory, neural voice. Leave empty for offline demo.</Text>
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable key={p.label} style={[styles.preset, url.trim() === p.value && styles.presetOn]} onPress={() => setUrl(p.value)}>
            <Text style={styles.presetText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.20:8901"
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable style={[styles.btn, styles.primary]} onPress={() => void save()}>
        <Text style={styles.btnPrimaryText}>{savedTick ? "Saved ✓" : "Save & connect"}</Text>
      </Pressable>
      {checking !== null ? <ActivityIndicator color={theme.accent} /> : null}
      {result ? <Text style={styles.result}>{result}</Text> : null}

      <Text style={styles.h}>Coach</Text>
      <Text style={styles.p}>Name on the dock and chat bubbles.</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Anna" placeholderTextColor={theme.dim} />

      <Text style={styles.h}>Privacy</Text>
      <Text style={styles.p}>
        No accounts, no analytics, no tracking. Games live on your device (demo) or your own machine (backend). API keys
        stay in server memory. ChatGPT login happens only on OpenAI's page. Not affiliated with OpenAI or Anthropic.
      </Text>
      <Text style={styles.build}>build expo-1 · native client</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 10 },
  h: { color: theme.text, fontWeight: "800", fontSize: 16, marginTop: 8 },
  p: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  presets: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  preset: { borderWidth: 1, borderColor: theme.panelEdge, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  presetOn: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  presetText: { color: theme.text, fontWeight: "700", fontSize: 13 },
  input: {
    backgroundColor: theme.input,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.panelEdge,
  },
  btn: { borderWidth: 1, borderColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  primary: { backgroundColor: theme.accent },
  btnPrimaryText: { color: "#092018", fontWeight: "800", fontSize: 15 },
  result: { color: theme.text, fontSize: 14 },
  build: { color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 12 },
});
