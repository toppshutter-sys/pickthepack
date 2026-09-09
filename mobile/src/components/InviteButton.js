import React, { useRef, useEffect } from "react";
import { Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { colors, gradients } from "../theme";

/**
 * The "invite more players" call to action — a gold pill instead of plain
 * text, with a slow breathing glow so it reads as the thing to tap, not
 * just another link sitting next to "Leave table". Used in both the lobby
 * and mid-game (once a round ends and there's still room at the table).
 */
export default function InviteButton({ onPress, copied, style }) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  function onPressIn() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  }
  function onPressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
  }

  const shadowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });
  const shadowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [10, 20] });

  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={[{ transform: [{ scale }], shadowColor: colors.sunCoral, shadowOpacity, shadowRadius, shadowOffset: { width: 0, height: 0 } }, style]}>
        <LinearGradient colors={gradients.sunset} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.pill}>
          <Text style={styles.text}>{copied ? "✓ Link copied!" : "📤  Invite players"}</Text>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    elevation: 5,
  },
  text: { color: "#2a1a0a", fontWeight: "800", fontSize: 14.5, letterSpacing: 0.2 },
});
