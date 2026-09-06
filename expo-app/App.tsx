/**
 * Chess Teacher — native app. Four tabs, one game, two brains:
 * your own backend (full power) or offline demo (sparring anywhere).
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
  const [beat, setBeat] = useState(0);
  const [diag, setDiag] = useState("boot");
  const { width } = useWindowDimensions();
  // iPad/tablets get a condensed tab bar floating in the middle instead of
  // a stretched full-width strip.
  const wideTabs = width >= 700;
  const game = useGame(backend);
  const voice = useVoice(backend, () => setBeat((b) => b + 1));

  // Restore settings, probe the saved backend, start a game.
  useEffect(() => {
    (async () => {
      try {
        setDiag("reading storage…");
        const [savedUrl, savedName] = await Promise.all([
          AsyncStorage.getItem(BACKEND_KEY),
          AsyncStorage.getItem(COACH_KEY),
        ]);
        setDiag(`stored=${savedUrl ?? "none"}`);
        if (savedName) setCoachName(savedName);
        let effective = savedUrl;
        if (!effective && __DEV__) {
          // Dev convenience: simulators reach the dev machine directly, so
          // a running local server Just Works with zero configuration.
          // Production builds never probe — they stay in demo until the
          // user saves a backend explicitly.
          setDiag("probing localhost:8901…");
          if (await probeBackend("http://localhost:8901")) {
            effective = "http://localhost:8901";
            setDiag("auto-connected localhost");
          } else if (await probeBackend("http://10.0.2.2:8901")) {
            effective = "http://10.0.2.2:8901";
            setDiag("auto-connected emulator host");
          }
        }
        if (effective) {
          setDiag(`probing ${effective}…`);
          const ok = await probeBackend(effective);
          setDiag(`probe=${ok ? "OK" : "FAIL"}`);
          setBackend(ok ? effective : null);
        }
      } catch (e) {
        setDiag(`error: ${e instanceof Error ? e.message.slice(0, 60) : "?"}`);
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
        {tab === "play" ? <PlayScreen game={game} backend={backend} /> : null}
        {tab === "coach" ? <CoachScreen game={game} backend={backend} coachName={coachName} voice={voice} beat={beat} /> : null}
        {tab === "idea" ? <IdeaScreen fen={game.fen} backend={backend} voice={voice} /> : null}
        {tab === "settings" ? (
          <SettingsScreen backend={backend} onSave={saveBackend} coachName={coachName} onCoachName={saveCoach} />
        ) : null}
      </View>
      <View style={[styles.tabs, wideTabs && styles.tabsWide]}>
        {(
          [
            ["play", "♞ Play"],
            ["coach", "💬 Coach"],
            ["idea", "💡 Idea"],
            ["settings", "⚙ Settings"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <Pressable key={id} style={[styles.tab, wideTabs && styles.tabWide, tab === id && styles.tabOn]} onPress={() => setTab(id)}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {!probed || !backend ? (
        <Text style={styles.modeLine}>
          {!probed ? `Starting… ${diag}` : "Demo mode — connect a backend in Settings for the full engine."}
        </Text>
      ) : (
        <Text style={styles.connectedLine}>Connected · {backend.replace(/^https?:\/\//, "")}</Text>
      )}
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
  tabWide: { flex: 0, paddingHorizontal: 22 },
  tabsWide: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 520,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: theme.panelEdge,
  },
  tabOn: { borderTopWidth: 2, borderTopColor: theme.accent },
  tabText: { color: theme.muted, fontWeight: "700", fontSize: 13 },
  tabTextOn: { color: theme.accent },
  modeLine: { color: theme.dim, fontSize: 11, textAlign: "center", paddingBottom: 8 },
  connectedLine: { color: theme.accent, fontSize: 11, textAlign: "center", paddingBottom: 8 },
});
