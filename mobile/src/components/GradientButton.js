import React, { useRef } from "react";
import { Text, StyleSheet, Pressable, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { colors, gradients } from "../theme";

/**
 * Shared button used across every screen so the app has one consistent,
 * "modern" tap target: a gold gradient for the primary action, a subtle
 * outlined glass look for the secondary one — both with a soft press-down
 * animation instead of the flat opacity blink TouchableOpacity gives you
 * by default.
 */
export default function GradientButton({ onPress, disabled, children, variant = "primary", style }) {
  const scale = useRef(new Animated.Value(1)).current;

  function onPressIn() {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  }
  function onPressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
  }

  const label = typeof children === "string" ? <Text style={variant === "primary" ? styles.primaryText : styles.secondaryText}>{children}</Text> : children;

  if (variant === "secondary") {
    return (
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}>
        <Animated.View style={[styles.secondary, disabled && styles.disabledSecondary, { transform: [{ scale }] }, style]}>
          {label}
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}>
      <Animated.View style={[{ transform: [{ scale }] }, style]}>
        {disabled ? (
          <Animated.View style={[styles.primary, styles.disabledPrimary]}>{label}</Animated.View>
        ) : (
          <LinearGradient colors={gradients.sunset} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.primary}>
            {label}
          </LinearGradient>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.sunCoral,
    shadowOpacity: 0.32,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 5,
  },
  disabledPrimary: { backgroundColor: "#4a4640", shadowOpacity: 0 },
  primaryText: { color: "#2a1a0a", fontWeight: "800", fontSize: 16, letterSpacing: 0.2 },
  secondary: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.aquaDim,
    backgroundColor: "rgba(94,231,208,0.05)",
  },
  disabledSecondary: { opacity: 0.5 },
  secondaryText: { color: colors.textPrimary, fontWeight: "700", fontSize: 16 },
});
