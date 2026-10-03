import React, { useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, Animated, TouchableOpacity } from "react-native";
import GlassPanel from "./GlassPanel";
import GradientButton from "./GradientButton";
import Logo from "./Logo";
import { centeredContent } from "../responsive";
import { colors } from "../theme";

/**
 * A one-time-per-launch gate shown before anything else — states the
 * game's copyright, requires an explicit 18+ confirmation, and requires an
 * explicit tap to proceed. Rendered instead of the normal screen tree in
 * App.js until `onEnter` fires, so nothing else (HomeScreen, a live
 * session, sockets) mounts before this is dismissed.
 */
export default function CopyrightGate({ onEnter }) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, []);

  // Not persisted — same as the gate itself, this is re-asked every launch
  // rather than remembered, so there's no stored "proof of age" to manage
  // or for a different person using the same device/browser to inherit.
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  const year = new Date().getFullYear();

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity: fadeIn, alignItems: "center", width: "100%" }}>
        <Logo size={92} />
        <Text style={styles.title}>Pick the Pack</Text>

        <GlassPanel style={styles.panel}>
          <Text style={styles.noticeTitle}>© {year} Rosario Stanley / Visionnaire Ent</Text>
          <Text style={styles.noticeBody}>
            This game, including its design, artwork, and code, is protected by copyright. All
            rights reserved — no reproduction or redistribution without permission.
          </Text>
        </GlassPanel>

        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setAgeConfirmed((v) => !v)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <View style={[styles.checkbox, ageConfirmed && styles.checkboxChecked]}>
            {ageConfirmed ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>I confirm I am 18 years of age or older</Text>
        </TouchableOpacity>

        <View style={styles.enterButtonWrap}>
          <GradientButton onPress={onEnter} disabled={!ageConfirmed}>
            Enter
          </GradientButton>
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
  panel: { width: "100%", padding: 18, marginBottom: 22 },
  noticeTitle: { color: colors.sunGold, fontSize: 15, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  noticeBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center" },
  checkboxRow: { flexDirection: "row", alignItems: "center", width: "100%", paddingHorizontal: 40, marginBottom: 22 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.aquaDim,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxChecked: { backgroundColor: colors.sunAmber, borderColor: colors.sunGold },
  checkmark: { color: "#2a1a0a", fontSize: 14, fontWeight: "900" },
  checkboxLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  enterButtonWrap: { width: "100%", paddingHorizontal: 40 },
});
