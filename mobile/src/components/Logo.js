import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, gradients } from "../theme";

/**
 * The app's hero mark — shaped like one of its own cards (same teal
 * lagoon back, same sun-over-waves medallion players see all game long)
 * with Ace-of-Spades corner indices, so the brand and the game are
 * visually the same object rather than two unrelated designs. A slow
 * breathing glow plus an occasional light sweep make it read as "the
 * inviting thing" the moment the app opens, instead of a static badge.
 */
export default function Logo({ size = 96 }) {
  const width = size;
  const height = Math.round(size * 1.42);
  const radius = Math.round(size * 0.16);

  const glow = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(1600),
        Animated.timing(shimmer, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    glowLoop.start();
    shimmerLoop.start();
    return () => {
      glowLoop.stop();
      shimmerLoop.stop();
    };
  }, []);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
  const glowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [16, 28] });
  const shimmerTranslate = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-width * 1.1, width * 1.6] });

  return (
    <Animated.View
      style={{
        shadowColor: colors.sunCoral,
        shadowOpacity: glowOpacity,
        shadowRadius: glowRadius,
        shadowOffset: { width: 0, height: 0 },
        elevation: 10,
      }}
    >
      <LinearGradient
        colors={gradients.cardBack}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.card, { width, height, borderRadius: radius }]}
      >
        <View style={[styles.rim, { borderRadius: radius }]} pointerEvents="none" />

        <View style={styles.cornerTL} pointerEvents="none">
          <Text style={[styles.cornerRank, { fontSize: Math.round(size * 0.15) }]}>A</Text>
          <Text style={[styles.cornerSuit, { fontSize: Math.round(size * 0.13) }]}>♠</Text>
        </View>
        <View style={styles.cornerBR} pointerEvents="none">
          <Text style={[styles.cornerRank, { fontSize: Math.round(size * 0.15) }]}>A</Text>
          <Text style={[styles.cornerSuit, { fontSize: Math.round(size * 0.13) }]}>♠</Text>
        </View>

        {/* Sun-over-waves medallion — the same motif as the card backs,
            scaled up here for more presence as the app's hero mark. */}
        <View style={[styles.medallion, { width: size * 0.58, height: size * 0.58, borderRadius: (size * 0.58) / 2 }]}>
          <View style={styles.sun} />
          <View style={styles.waveBack} />
          <View style={styles.waveFront} />
        </View>

        <Animated.View style={[styles.shimmerMask, { borderRadius: radius }]} pointerEvents="none">
          <Animated.View
            style={[
              styles.shimmerBeam,
              { width: width * 0.55, transform: [{ translateX: shimmerTranslate }, { rotate: "18deg" }] },
            ]}
          >
            <LinearGradient
              colors={["transparent", "rgba(255,255,255,0.4)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 6,
  },
  rim: { ...StyleSheet.absoluteFillObject, borderWidth: 2.5, borderColor: colors.sunGold },
  cornerTL: { position: "absolute", top: 8, left: 9, alignItems: "center" },
  cornerBR: { position: "absolute", bottom: 8, right: 9, alignItems: "center", transform: [{ rotate: "180deg" }] },
  cornerRank: { color: colors.sunGold, fontWeight: "800" },
  cornerSuit: { color: colors.sunGold, marginTop: -2 },
  medallion: {
    borderWidth: 2,
    borderColor: colors.aquaDim,
    overflow: "hidden",
    alignItems: "center",
  },
  sun: {
    position: "absolute",
    top: "16%",
    width: "36%",
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: colors.sunGold,
  },
  waveBack: {
    position: "absolute",
    bottom: "-134%",
    width: "160%",
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: "rgba(94,231,208,0.32)",
  },
  waveFront: {
    position: "absolute",
    bottom: "-166%",
    width: "180%",
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: "rgba(6,47,44,0.6)",
  },
  shimmerMask: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  shimmerBeam: { position: "absolute", top: -30, bottom: -30 },
});
