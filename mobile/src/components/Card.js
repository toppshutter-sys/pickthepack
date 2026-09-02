import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

const RED_SUITS = new Set(["hearts", "diamonds"]);
const SUIT_SYMBOL = { hearts: "♥", diamonds: "♦", spades: "♠", clubs: "♣" };

const GOLD = "#c9a24b";
const GOLD_BRIGHT = "#f0cd7a";

/**
 * Renders one playing card. Pass `card = null` for a hidden opponent card
 * (renders a face-down back).
 *
 * Pass `onPress` to make the card tappable (used on your own hand during
 * the Matching Phase — tapping a card is how you knock it in, asserting it
 * matches the target rank; the server validates that and rejects a bad
 * guess). Pass `disabled` to visually dim a tappable card without removing
 * the handler entirely (kept for a11y/consistency with the deck pile).
 *
 * `tappable` draws a soft pulsing gold glow to say "you can act on this
 * right now" (deck on your flip-turn, target card any time, hand cards
 * while you're selecting a match or placing a target). `selected` draws a
 * brighter, faster pulse for "this is the one you've picked." `index`
 * staggers the entrance animation when a whole hand renders at once.
 */
export default function Card({ card, size = "normal", onPress, disabled, tappable, selected, index = 0 }) {
  const dims = size === "small" ? styles.small : styles.normal;
  const isRed = card && RED_SUITS.has(card.suit);

  // Entrance: a quick pop-and-settle, staggered by `index` so a hand deals
  // in one card after another instead of all snapping in at once.
  const entrance = useRef(new Animated.Value(0)).current;
  // Re-key the entrance animation to the card's identity (or "back" for a
  // hidden card) so a genuinely new card in this slot re-plays the pop,
  // while re-renders of the SAME card don't restart it from scratch.
  const identity = card ? card.id : "back";
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current !== identity) {
      entrance.setValue(0);
      lastIdentity.current = identity;
    }
    const anim = Animated.timing(entrance, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, 8) * 55,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // Press feedback: a small tactile squash on press-in, spring back on release.
  const pressScale = useRef(new Animated.Value(1)).current;
  function onPressIn() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(pressScale, { toValue: 0.93, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  }
  function onPressOut() {
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
  }

  // A soft breathing glow for anything currently actionable, faster/brighter
  // when it's the one you've selected.
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!tappable && !selected) {
      glow.setValue(0);
      return undefined;
    }
    const duration = selected ? 550 : 850;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tappable, selected]);

  const glowShadowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [selected ? 0.45 : 0.18, selected ? 0.9 : 0.55] });
  const glowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [selected ? 6 : 3, selected ? 14 : 8] });

  const entranceStyle = {
    opacity: entrance,
    transform: [
      { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
      { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };

  const face = !card ? (
    <LinearGradient colors={["#1c5442", "#0a2a20"]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.card, dims, styles.back]}>
      <View style={styles.backEmblem}>
        <Text style={styles.backEmblemText}>♠</Text>
      </View>
    </LinearGradient>
  ) : (
    <LinearGradient colors={["#ffffff", "#edf1ee"]} start={{ x: 0.2, y: 0 }} end={{ x: 0.85, y: 1 }} style={[styles.card, dims, styles.face]}>
      <Text style={[styles.rank, size === "small" && styles.rankSmall, isRed ? styles.red : styles.black]}>{card.rank}</Text>
      <Text style={[styles.suit, size === "small" && styles.suitSmall, isRed ? styles.red : styles.black]}>{SUIT_SYMBOL[card.suit]}</Text>
    </LinearGradient>
  );

  // Two separate Animated.View layers, not one with a combined style array:
  // `entrance` is native-driven (opacity/transform) and `glow` is JS-driven
  // (shadowOpacity/shadowRadius aren't supported by the native driver) — RN
  // can't have a single view be partially native- and partially JS-driven,
  // and mixing them in one style array crashes under the New Architecture.
  const content = (
    <Animated.View style={entranceStyle}>
      <Animated.View
        style={[
          (tappable || selected) && {
            shadowColor: selected ? GOLD_BRIGHT : GOLD,
            shadowOpacity: glowShadowOpacity,
            shadowRadius: glowRadius,
            shadowOffset: { width: 0, height: 0 },
            elevation: selected ? 10 : 6,
          },
          (tappable || selected) && { borderRadius: 11, borderWidth: selected ? 2.5 : 2, borderColor: selected ? "#ffd76a" : GOLD },
        ]}
      >
        {face}
      </Animated.View>
    </Animated.View>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}>
      <Animated.View style={{ transform: [{ scale: pressScale }], opacity: disabled ? 0.5 : 1 }}>{content}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 9,
    elevation: 3,
  },
  normal: { width: 64, height: 90 },
  small: { width: 44, height: 62 },
  face: {},
  back: { borderWidth: 1, borderColor: "rgba(201,162,75,0.35)" },
  backEmblem: {
    width: "58%",
    height: "58%",
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "rgba(201,162,75,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  backEmblemText: { color: "rgba(240,205,122,0.85)", fontSize: 18, fontWeight: "800" },
  rank: { fontSize: 20, fontWeight: "800" },
  rankSmall: { fontSize: 14 },
  suit: { fontSize: 19 },
  suitSmall: { fontSize: 13 },
  red: { color: "#d9463c" },
  black: { color: "#20242a" },
});
