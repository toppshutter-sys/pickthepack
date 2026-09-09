import React from "react";
import { StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "../theme";

/**
 * Shared frosted-glass surface — used anywhere content sits on top of the
 * lagoon-gradient background (player rows, badges, the table log) so it
 * reads as a raised panel instead of a flat translucent rectangle. Tinted
 * a cool teal/aqua by default to match the island theme.
 */
export default function GlassPanel({ children, style, radius = 16, borderColor = colors.glassBorder }) {
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
    backgroundColor: colors.glassBg,
  },
});
