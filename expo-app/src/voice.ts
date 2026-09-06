/**
 * Voice router: neural WAV from our backend when connected, OS speech
 * otherwise. One API for the whole app: speak(), stop(), useVoiceEngine().
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system";
import { checkNeuralVoice, fetchVoice } from "./api";

export type VoiceEngine = "auto" | "system" | "neural";

export function useVoice(backend: string | null, onBeat?: () => void) {
  const [engine, setEngine] = useState<VoiceEngine>("auto");
  const [neuralReady, setNeuralReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const fileRef = useRef<string | null>(null);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!backend) {
        if (!cancelled) setNeuralReady(false);
        return;
      }
      const ready = await checkNeuralVoice(backend);
      if (!cancelled) setNeuralReady(ready);
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const useNeural = engine === "neural" ? neuralReady : engine === "system" ? false : neuralReady;

  const stopBeat = useCallback(() => {
    if (beatRef.current) {
      clearInterval(beatRef.current);
      beatRef.current = null;
    }
  }, []);

  const forgetFile = useCallback((uri: string | null) => {
    if (uri && uri.startsWith("file://")) {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
  }, []);

  const stop = useCallback(async () => {
    stopBeat();
    try {
      Speech.stop();
    } catch {
      // OS speech may be absent; neural stop below still applies.
    }
    const sound = soundRef.current;
    soundRef.current = null;
    const file = fileRef.current;
    fileRef.current = null;
    forgetFile(file);
    if (sound) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch {
        // Best effort.
      }
    }
    setSpeaking(false);
  }, [stopBeat]);

  useEffect(() => () => {
    stopBeat();
    soundRef.current?.unloadAsync().catch(() => undefined);
  }, [stopBeat]);

  const speak = useCallback(
    async (rawText: string, opts?: { rate?: number }) => {
      const text = rawText.replace(/[*_#`]/g, "").slice(0, 1200);
      if (!text) return;
      await stop();
      setSpeaking(true);
      const startBeats = () => {
        stopBeat();
        beatRef.current = setInterval(() => onBeatRef.current?.(), 170);
      };
      if (useNeural && backend) {
        try {
          let uri = await fetchVoice(backend, text);
          // Prefer a real file over a data URI: more players accept it,
          // seeking works, and huge base64 strings stay out of memory.
          try {
            const comma = uri.indexOf(",");
            if (uri.startsWith("data:") && comma > 0 && FileSystem.cacheDirectory) {
              // Delete the previous utterance first: WAVs are ~100KB each
              // and would otherwise pile up in cache forever.
              forgetFile(fileRef.current);
              const fileUri = `${FileSystem.cacheDirectory}coach-${Date.now()}.wav`;
              await FileSystem.writeAsStringAsync(fileUri, uri.slice(comma + 1), {
                encoding: "base64",
              });
              fileRef.current = fileUri;
              uri = fileUri;
            }
          } catch {
            // Fall through with the data URI.
          }
          const { sound } = await Audio.Sound.createAsync(
            { uri },
            { shouldPlay: true, rate: opts?.rate ?? 1.0 },
          );
          soundRef.current = sound;
          startBeats();
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
              void stop();
            }
          });
          return;
        } catch {
          // Fall through to system speech rather than going silent.
        }
      }
      startBeats();
      Speech.speak(text, {
        rate: opts?.rate ?? 1.0,
        onDone: () => {
          stopBeat();
          setSpeaking(false);
        },
        onStopped: () => {
          stopBeat();
          setSpeaking(false);
        },
        onError: () => {
          stopBeat();
          setSpeaking(false);
        },
      });
    },
    [backend, useNeural, stop, stopBeat],
  );

  return { engine, setEngine, neuralReady, speaking, speak, stop };
}
