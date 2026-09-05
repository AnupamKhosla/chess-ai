import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";

const LIVE_URL = "https://anupamkhosla.github.io/chess-ai/";
// Android emulator reaches the dev machine via 10.0.2.2; iOS simulator via localhost.
const DEV_URL = "http://10.0.2.2:8901/";

export default function App() {
  const [url, setUrl] = useState(LIVE_URL);
  const dev = url !== LIVE_URL;
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        <Pressable
          style={[styles.tab, !dev && styles.tabActive]}
          onPress={() => setUrl(LIVE_URL)}
        >
          <Text style={styles.tabText}>Live</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, dev && styles.tabActive]}
          onPress={() => setUrl(DEV_URL)}
        >
          <Text style={styles.tabText}>Local server</Text>
        </Pressable>
      </View>
      <WebView
        key={url}
        source={{ uri: url }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1220" },
  bar: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 48,
    paddingBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: "#0b1220",
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4ade80",
    opacity: 0.6,
  },
  tabActive: { opacity: 1, backgroundColor: "#4ade8022" },
  tabText: { color: "#e5e7eb", fontWeight: "700" },
  web: { flex: 1 },
});
