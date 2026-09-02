import React from "react";
import { View, StyleSheet } from "react-native";
import Card from "./Card";

/**
 * Pass `onCardPress(card)` to make every card in this hand tappable (used
 * for your own hand during the Matching Phase, so you can tap the card you
 * believe matches the target to knock it in, or the card you want to place
 * as the next target). Leave it unset for a read-only hand (opponents, or
 * your hand once the round is over).
 */
export default function Hand({ cards, size = "normal", onCardPress, disabled }) {
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
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
});
