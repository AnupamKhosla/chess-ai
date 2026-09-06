/** The coach presence: a breathing orb ringed by chess squares. */

import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

export type OrbState = "idle" | "watching" | "speaking" | "excited";

const STATE_COLOR: Record<OrbState, string> = {
  idle: theme.accent,
  watching: theme.warn,
  speaking: theme.info,
  excited: theme.accent,
};

export default function Orb({
  state,
  beat,
  size = 76,
  onPress,
}: {
  state: OrbState;
  beat: number;
  size?: number;
  onPress?: () => void;
}) {
  const breath = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const speed = state === "excited" ? 700 : state === "speaking" ? 1100 : 2600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: speed / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: speed / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, breath]);

  useEffect(() => {
    if (beat === 0) return;
    Animated.sequence([
      Animated.timing(ripple, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(ripple, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [beat, ripple]);

  const color = STATE_COLOR[state];
  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, state === "excited" ? 1.14 : 1.06] });
  const glow = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.85] });

  const dots = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    return { left: Math.cos(angle) * size * 0.42, top: Math.sin(angle) * size * 0.42, light: i % 2 === 0 };
  });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Coach presence">
      <View style={[styles.wrap, { width: size, height: size }]}>
        {dots.map((d, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                left: size / 2 + d.left - 2,
                top: size / 2 + d.top - 2,
                backgroundColor: d.light ? "#e5e7eb" : color,
              },
            ]}
          />
        ))}
        <Animated.View
          style={[
            styles.glow,
            {
              width: size * 0.9,
              height: size * 0.9,
              borderRadius: size * 0.45,
              borderColor: color,
              opacity: glow,
              transform: [{ scale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.core,
            {
              width: size * 0.52,
              height: size * 0.52,
              borderRadius: size * 0.26,
              borderColor: color,
              transform: [{ scale }],
            },
          ]}
        >
          <Text style={[styles.pawn, { fontSize: size * 0.3, color }]}>♟</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", width: 4, height: 4, borderRadius: 2, opacity: 0.7 },
  glow: { position: "absolute", borderWidth: 2 },
  core: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    backgroundColor: "rgba(11,18,32,0.85)",
  },
  pawn: { fontWeight: "700" },
});
