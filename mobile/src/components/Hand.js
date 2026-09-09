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
 * `fan` tightly overlaps the cards (used for opponent seats around the
 * table, which don't have room for a fully spread-out hand) instead of the
 * normal spaced-out row.
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
  return (
    <View style={styles.row}>
      {cards.map((card, i) => (
        <Card
          key={card ? card.id : `hidden-${i}`}
          card={card}
          size={size}
          index={i}
          onPress={onCardPress ? () => onCardPress(card) : undefined}
          tappable={!!onCardPress && !disabled}
          disabled={disabled}
          dealFrom={dealFrom}
          cardStyle={fan ? { marginHorizontal: 0, marginLeft: i > 0 ? overlap : 0 } : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
});
