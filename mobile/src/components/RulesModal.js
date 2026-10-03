import React from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import GlassPanel from "./GlassPanel";
import GradientButton from "./GradientButton";
import { colors } from "../theme";

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

/**
 * A full "How to Play" reference, shown as an overlay (not a navigated-to
 * screen) so it can be opened from the Home screen or the Lobby without
 * losing whatever state the player's already in. Read-only, closes on its
 * own "Got it" button or the backdrop.
 */
export default function RulesModal({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation && e.stopPropagation()} style={styles.cardWrap}>
          <GlassPanel style={styles.card} borderColor={colors.sunGold}>
            <Text style={styles.title}>🃏 How to Play</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <Section title="The Ante">
                Everyone antes the room's pack amount into the pot when a round starts. Win the
                round, win the pot.
              </Section>
              <Section title="Instant Win">
                Each player is dealt 3 cards. If your hand forms a Royal Sequence (K-Q-J), an
                Ace-2-3 run, any other 3-in-a-row sequence, or three of the same suit, you win the
                pot immediately — no play needed. Royal Sequence ranks highest; ties split the pot.
              </Section>
              <Section title="Dealer's Card">
                If the next card off the deck is a Jack or a 6, the dealer wins the pot outright on
                the spot. The hands don't change — everyone antes again (a "recast") and the next
                card is checked the same way, which can repeat.
              </Section>
              <Section title="Matching Phase">
                If nobody's dealt an instant win, play begins: a target card is placed face up.
                Anyone who's holding a card of that same rank can tap it to "knock" it in — matching
                is open to everyone at once, not turn-by-turn, so the fastest tap wins a race. If
                nobody has a match, whoever's turn it is flips the next card from the deck, and the
                turn passes to the next player.
              </Section>
              <Section title="Knocking Your Hand Away">
                Knock in your last card (or your last two, if they already form a matching pair) and
                you win the pot by matching your whole hand away. Knock down to exactly one odd card
                left and the deck refills the target for you automatically. Knock down to two or
                more unmatched cards and you choose one of them to place as the new target yourself.
              </Section>
              <Section title="Net & Running Low">
                Each room tracks everyone's running net for the night, starting at $50. If your net
                ever drops below the room's ante, you're removed before the next hand deals rather
                than let it go negative — settle up and start a fresh room to keep playing.
              </Section>
            </ScrollView>
            <GradientButton onPress={onClose}>Got it</GradientButton>
          </GlassPanel>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,20,18,0.72)", alignItems: "center", justifyContent: "center", padding: 20 },
  cardWrap: { width: "100%", maxWidth: 440, maxHeight: "85%" },
  card: { width: "100%", padding: 20, maxHeight: "100%" },
  title: { color: colors.sunGold, fontSize: 19, fontWeight: "800", textAlign: "center", marginBottom: 14 },
  scroll: { marginBottom: 16 },
  scrollContent: { gap: 16, paddingBottom: 4 },
  section: { gap: 4 },
  sectionTitle: { color: colors.aqua, fontSize: 13.5, fontWeight: "700" },
  sectionBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
});
