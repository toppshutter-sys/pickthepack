import React from "react";
import { View, StyleSheet } from "react-native";
import Card from "./Card";
import { useScale } from "../responsive";

/**
 * Pass `onCardPress(card)` to make every card in this hand tappable (used
 * for your own hand during the Matching Phase, so you can tap the card you
 * believe matches the target to knock it in, or the card you want to place
 * as the next target). Leave it unset for a read-only hand (opponents, or
 * your hand once the round is over).
 *
 * `fan` tightly overlaps the cards in a gentle curved arc — each card
 * rotated a few degrees more than its neighbor and lifted slightly toward
 * the ends — instead of the normal spaced-out row. Used for opponent seats
 * (which don't have room for a spread-out hand) and, with a wider arc, for
 * your own hand too, so it reads as cards fanned in a real hand rather than
 * a flat strip.
 *
 * `dealFrom` — "below" or "above" — sets which direction newly dealt cards
 * animate in from (see Card's `dealFrom`): opponents sit above the table
 * surface so their cards rise up into place; your own hand sits below it
 * so its cards drop down into place. Leave unset for the default subtle
 * settle used elsewhere (the deck pile, the target card).
 *
 * `maxWidth` (fan mode only) — the overlap tightens as needed so the whole
 * fanned hand actually fits within this width, rather than using a fixed
 * guess: a hand can be 1-3+ cards and seats get narrower as more opponents
 * join, so a fixed overlap either wastes space or (worse) overflows into
 * the next seat.
 */
export default function Hand({ cards, size = "normal", onCardPress, disabled, fan, dealFrom, maxWidth }) {
  const scale = useScale();
  const cardWidth = Math.round((size === "small" ? 44 : 64) * scale);
  const looseOverlap = size === "small" ? -26 * scale : -30 * scale;
  let overlap = looseOverlap;
  if (fan && maxWidth && cards.length > 1) {
    const neededOverlap = (maxWidth - cards.length * cardWidth) / (cards.length - 1);
    // Tighter than the loose default if that's what it takes to fit, but
    // never past ~85% overlap (keep a sliver of each card visible).
    overlap = Math.max(Math.min(looseOverlap, neededOverlap), -cardWidth * 0.85);
  }
  // The arc: each card rotates a bit more than the one before it, pivoting
  // around the fan's center, with the two ends lifted slightly — a real
  // hand-of-cards curve rather than a flat overlapping stack. Degrees per
  // step shrink as more cards join so a big hand doesn't fan out into an
  // illegible pinwheel; capped at a narrower angle in opponent seats, which
  // have much less headroom around them than your own hand does.
  const n = cards.length;
  const mid = (n - 1) / 2;
  const degreesPerStep = size === "small" ? Math.min(6, 18 / Math.max(n, 1)) : Math.min(5, 26 / Math.max(n, 1));
  const liftPerStep = size === "small" ? 1.4 : 3;
  return (
    <View style={styles.row}>
      {cards.map((card, i) => {
        const offsetFromCenter = i - mid;
        const arcStyle = fan && n > 1
          ? {
              transform: [{ rotate: `${offsetFromCenter * degreesPerStep}deg` }, { translateY: Math.abs(offsetFromCenter) * liftPerStep }],
            }
          : undefined;
        return (
          <Card
            key={card ? card.id : `hidden-${i}`}
            card={card}
            size={size}
            index={i}
            onPress={onCardPress ? () => onCardPress(card) : undefined}
            tappable={!!onCardPress && !disabled}
            disabled={disabled}
            dealFrom={dealFrom}
            cardStyle={fan ? { marginHorizontal: 0, marginLeft: i > 0 ? overlap : 0, ...arcStyle } : undefined}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
});
