/**
 * Play tab: top bar (ChatGPT login · settings), fixed board with
 * drag-to-move, graded moves, quick actions, and full-width AI chat with
 * a half-screen overlay, arrow-send, voice flip, and options.
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import Board from "../components/Board";
import { boardSizeFor } from "../components/Board";
import ChatPanel from "../components/ChatPanel";
import { GRADE_COLORS, theme } from "../theme";
import { fetchProviders } from "../api";
import { movesToPgn, useChat, useGame } from "../state";
import type { useVoice } from "../voice";
import type { Tab } from "../tabs";

const SCALE_KEY = "ct-board-scale";
const ORIENT_KEY = "ct-board-orientation";
const SCALES = [
  { id: "s", label: "S", factor: 0.85 },
  { id: "m", label: "M", factor: 1 },
  { id: "l", label: "L", factor: 1.12 },
] as const;

export default function PlayScreen({
  game,
  backend,
  voice,
  onNavigate,
}: {
  game: ReturnType<typeof useGame>;
  backend: string | null;
  voice: ReturnType<typeof useVoice>;
  onNavigate: (tab: Tab) => void;
}) {
  const { width } = useWindowDimensions();
  const [scrollOn, setScrollOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scaleId, setScaleId] = useState<"s" | "m" | "l">("m");
  const [flipped, setFlipped] = useState(false);
  const [loginNote, setLoginNote] = useState<string | null>(null);
  const chat = useChat(backend, game.sessionId, game.fen, game.history);

  const scale = SCALES.find((s) => s.id === scaleId)?.factor ?? 1;
  const size = boardSizeFor(width) * scale;

  useEffect(() => {
    (async () => {
      try {
        const [s, o] = await Promise.all([AsyncStorage.getItem(SCALE_KEY), AsyncStorage.getItem(ORIENT_KEY)]);
        if (s === "s" || s === "m" || s === "l") setScaleId(s);
        if (o === "black") setFlipped(true);
      } catch {
        // Defaults stand.
      }
    })();
  }, []);

  const setScale = (id: "s" | "m" | "l") => {
    setScaleId(id);
    void AsyncStorage.setItem(SCALE_KEY, id).catch(() => undefined);
  };
  const flipBoard = () => {
    setFlipped((f) => {
      void AsyncStorage.setItem(ORIENT_KEY, f ? "white" : "black").catch(() => undefined);
      return !f;
    });
  };

  const copyPgn = async () => {
    await Clipboard.setStringAsync(movesToPgn(game.history));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const checkLogin = async () => {
    if (!backend) {
      setLoginNote("No backend — demo mode");
    } else {
      try {
        const data = await fetchProviders(backend);
        const codex = (data?.providers ?? []).find((p: { id?: string }) => p.id === "codex");
        setLoginNote(codex?.authenticated ? "ChatGPT active" : "Login needed — use the local app");
      } catch {
        setLoginNote("Backend unreachable");
      }
    }
    setTimeout(() => setLoginNote(null), 2200);
  };

  const flipVoice = () => {
    voice.setEngine(voice.engine === "system" ? "neural" : voice.engine === "neural" ? "auto" : "system");
  };

  const sendChat = async (text: string) => {
    const reply = await chat.send(text);
    if (reply) void voice.speak(reply.text, {});
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} scrollEnabled={scrollOn}>
      <View style={styles.topBar}>
        <Pressable style={styles.topBtn} onPress={() => void checkLogin()}>
          <Text style={styles.topBtnText}>{loginNote ?? "💬 ChatGPT"}</Text>
        </Pressable>
        <Text style={styles.topTitle}>Play</Text>
        <Pressable style={styles.topBtn} onPress={() => setSettingsOpen(true)} accessibilityLabel="Board settings">
          <Text style={styles.topBtnText}>⚙</Text>
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.status}>{game.aiThinking ? "AI thinking…" : game.status}</Text>
        {game.aiThinking ? <ActivityIndicator color={theme.accent} /> : null}
      </View>
      <Board
        fen={game.fen}
        size={size}
        orientation={flipped ? "black" : "white"}
        disabled={game.busy || game.aiThinking || game.over || !game.sessionId}
        arrows={game.lastArrows}
        onMove={(from, to, promotion) => {
          void game.playMove(from, to, promotion);
        }}
        onDragStateChange={setScrollOn}
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

      <ChatPanel
        title="AI chat"
        messages={chat.messages}
        sending={chat.sending}
        onSend={(t) => void sendChat(t)}
        voiceOn={voice.engine !== "system"}
        onFlipVoice={flipVoice}
        onInfo={() => setOptionsOpen(true)}
        onExpand={() => setExpanded(true)}
      />

      <Modal visible={expanded} transparent animationType="slide" onRequestClose={() => setExpanded(false)}>
        <View style={styles.sheetTop}>
          <View style={styles.sheetCard}>
            <ChatPanel
              title="AI chat"
              messages={chat.messages}
              sending={chat.sending}
              onSend={(t) => void sendChat(t)}
              voiceOn={voice.engine !== "system"}
              onFlipVoice={flipVoice}
              onInfo={() => setOptionsOpen(true)}
              maxListHeight={10000}
            />
            <Pressable style={[styles.btn, styles.sheetClose]} onPress={() => setExpanded(false)}>
              <Text style={styles.btnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={optionsOpen} transparent animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
        <Pressable style={styles.sheetCenter} onPress={() => setOptionsOpen(false)}>
          <View style={styles.sheetBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Chat options</Text>
            {(
              [
                ["💡 Show idea lines", () => { setOptionsOpen(false); onNavigate("idea"); }],
                ["Copy PGN", () => { setOptionsOpen(false); void copyPgn(); }],
                ["New game", () => { setOptionsOpen(false); void game.newGame(); }],
              ] as Array<[string, () => void]>
            ).map(([label, action]) => (
              <Pressable key={label} style={styles.sheetOption} onPress={action}>
                <Text style={styles.sheetOptionText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.sheetCenter} onPress={() => setSettingsOpen(false)}>
          <View style={styles.sheetBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Board settings</Text>
            <Text style={styles.sheetLabel}>Board size</Text>
            <View style={styles.segRow}>
              {SCALES.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.segBtn, scaleId === s.id && styles.segOn]}
                  onPress={() => setScale(s.id)}
                >
                  <Text style={[styles.segText, scaleId === s.id && styles.segTextOn]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.sheetOption} onPress={flipBoard}>
              <Text style={styles.sheetOptionText}>{flipped ? "◉ Black at bottom" : "◯ White at bottom"} — tap to flip</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                flipVoice();
                setSettingsOpen(false);
              }}
            >
              <Text style={styles.sheetOptionText}>
                Voice: {voice.engine === "neural" ? "Neural" : voice.engine === "system" ? "System" : "Auto"}
                {voice.neuralReady ? " (neural ready)" : ""} — tap to cycle
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12, alignItems: "center" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch" },
  topTitle: { color: theme.text, fontWeight: "800", fontSize: 15 },
  topBtn: { borderWidth: 1, borderColor: theme.panelEdge, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
  topBtnText: { color: theme.accent, fontWeight: "800", fontSize: 13 },
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
  sheetTop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 12, paddingTop: 48 },
  sheetCard: {
    height: "50%",
    backgroundColor: theme.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.accent,
    padding: 12,
    gap: 8,
  },
  sheetClose: { alignSelf: "center" },
  sheetCenter: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheetBox: { width: "100%", maxWidth: 420, backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.panelEdge, padding: 16, gap: 6 },
  sheetTitle: { color: theme.text, fontWeight: "800", fontSize: 16, marginBottom: 4 },
  sheetLabel: { color: theme.muted, fontSize: 13, marginTop: 4 },
  sheetOption: { borderWidth: 1, borderColor: theme.panelEdge, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12 },
  sheetOptionText: { color: theme.text, fontWeight: "700", fontSize: 15 },
  segRow: { flexDirection: "row", gap: 8 },
  segBtn: { flex: 1, borderWidth: 1, borderColor: theme.panelEdge, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  segOn: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  segText: { color: theme.muted, fontWeight: "800", fontSize: 15 },
  segTextOn: { color: theme.accent },
});
