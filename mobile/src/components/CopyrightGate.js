import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import GlassPanel from "./GlassPanel";
import GradientButton from "./GradientButton";
import Logo from "./Logo";
import { centeredContent } from "../responsive";
import { colors } from "../theme";

/**
 * A one-time-per-launch gate shown before anything else — states the
 * game's copyright, and requires an explicit tap to proceed. Rendered
 * instead of the normal screen tree in App.js until `onEnter` fires, so
 * nothing else (HomeScreen, a live session, sockets) mounts before this is
 * dismissed.
 */
export default function CopyrightGate({ onEnter }) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, []);

  const year = new Date().getFullYear();

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity: fadeIn, alignItems: "center", width: "100%" }}>
        <Logo size={92} />
        <Text style={styles.title}>Pick the Pack</Text>

        <GlassPanel style={styles.panel}>
          <Text style={styles.noticeTitle}>© {year} Pick the Pack</Text>
          <Text style={styles.noticeBody}>
            This game, including its design, artwork, and code, is protected by copyright. All
            rights reserved — no reproduction or redistribution without permission.
          </Text>
        </GlassPanel>

        <View style={styles.enterButtonWrap}>
          <GradientButton onPress={onEnter}>Enter</GradientButton>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...centeredContent, flex: 1, padding: 24, alignItems: "center", justifyContent: "center" },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.sunGold,
    letterSpacing: 0.3,
    marginTop: 14,
    marginBottom: 24,
    textShadowColor: "rgba(245,167,90,0.4)",
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  panel: { width: "100%", padding: 18, marginBottom: 28 },
  noticeTitle: { color: colors.sunGold, fontSize: 15, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  noticeBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center" },
  enterButtonWrap: { width: "100%", paddingHorizontal: 40 },
});
