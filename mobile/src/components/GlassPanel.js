import React from "react";
import { StyleSheet } from "react-native";
import { BlurView } from "expo-blur";

/**
 * Shared frosted-glass surface — used anywhere content sits on top of the
 * table's gradient background (player rows, badges, the table log) so it
 * reads as a raised panel instead of a flat translucent rectangle.
 */
export default function GlassPanel({ children, style, radius = 14, borderColor = "rgba(201,162,75,0.28)" }) {
  return (
    <BlurView intensity={32} tint="dark" style={[styles.panel, { borderRadius: radius, borderColor }, style]}>
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
});
