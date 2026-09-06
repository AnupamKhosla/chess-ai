/**
 * Chess Teacher — native app. Four tabs, one game, two brains:
 * your own backend (full power) or offline demo (sparring anywhere).
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { theme } from "./src/theme";
import { probeBackend } from "./src/api";
import { useGame } from "./src/state";
import { useVoice } from "./src/voice";
import PlayScreen from "./src/screens/PlayScreen";
import CoachScreen from "./src/screens/CoachScreen";
import IdeaScreen from "./src/screens/IdeaScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

type Tab = "play" | "coach" | "idea" | "settings";

const BACKEND_KEY = "ct-backend-url";
const COACH_KEY = "ct-coach-name";

export default function App() {
  const [tab, setTab] = useState<Tab>("play");
  const [backend, setBackend] = useState<string | null>(null);
  const [probed, setProbed] = useState(false);
  const [coachName, setCoachName] = useState("Anna");
  const game = useGame(backend);
  const [beat, setBeat] = useState(0);
  const voice = useVoice(backend, () => setBeat((b) => b + 1));

  // Restore settings, probe the saved backend, start a game.
  useEffect(() => {
    (async () => {
      try {
        const [savedUrl, savedName] = await Promise.all([
          AsyncStorage.getItem(BACKEND_KEY),
          AsyncStorage.getItem(COACH_KEY),
        ]);
        if (savedName) setCoachName(savedName);
        if (savedUrl) {
          const ok = await probeBackend(savedUrl);
          setBackend(ok ? savedUrl : null);
        }
      } catch {
        setBackend(null);
      } finally {
        setProbed(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (probed) void game.newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probed]);

  const saveBackend = (url: string | null) => {
    setBackend(url);
    void AsyncStorage.setItem(BACKEND_KEY, url ?? "").catch(() => undefined);
    void game.newGame();
  };

  const saveCoach = (name: string) => {
    setCoachName(name);
    void AsyncStorage.setItem(COACH_KEY, name).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Chess Teacher</Text>
        <View style={styles.live}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>
      <View style={styles.body}>
        {tab === "play" ? <PlayScreen game={game} /> : null}
        {tab === "coach" ? <CoachScreen game={game} backend={backend} coachName={coachName} voice={voice} beat={beat} /> : null}
        {tab === "idea" ? <IdeaScreen fen={game.fen} backend={backend} voice={voice} /> : null}
        {tab === "settings" ? (
          <SettingsScreen backend={backend} onSave={saveBackend} coachName={coachName} onCoachName={saveCoach} />
        ) : null}
      </View>
      <View style={styles.tabs}>
        {(
          [
            ["play", "♞ Play"],
            ["coach", "💬 Coach"],
            ["idea", "💡 Idea"],
            ["settings", "⚙ Settings"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <Pressable key={id} style={[styles.tab, tab === id && styles.tabOn]} onPress={() => setTab(id)}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {!probed || !backend ? (
        <Text style={styles.modeLine}>
          {!probed ? "Starting…" : "Demo mode — connect a backend in Settings for the full engine."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingTop: 48 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  title: { color: theme.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#f8717188",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.danger },
  liveText: { color: theme.danger, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  body: { flex: 1 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: theme.panelEdge, backgroundColor: theme.panel },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabOn: { borderTopWidth: 2, borderTopColor: theme.accent },
  tabText: { color: theme.muted, fontWeight: "700", fontSize: 13 },
  tabTextOn: { color: theme.accent },
  modeLine: { color: theme.dim, fontSize: 11, textAlign: "center", paddingBottom: 8 },
});
