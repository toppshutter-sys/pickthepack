import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Easing, Alert } from "react-native";
import Hand from "../components/Hand";
import Card from "../components/Card";
import GradientButton from "../components/GradientButton";
import GlassPanel from "../components/GlassPanel";
import { emitWithAck } from "../socket";

function isFlipTurn(round, isInstantWin, isRoundOver, playerIndex) {
  const placementPending =
    round.pendingPlacement !== null && round.pendingPlacement !== undefined;
  return !isInstantWin && !isRoundOver && !placementPending && round.turnIndex === playerIndex;
}

const CATEGORY_LABEL = {
  royal: "Royal Sequence (K-Q-J)",
  ace23: "Ace-2-3 Sequence",
  sequential: "Sequence",
  flush: "Same-Suit (Flush)",
};

export default function GameScreen({ socket, roomState, code, onLeaveRoom }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Matching is a free-for-all, not turn-based: you tap the target card
  // first to say "I want to try matching this", THEN tap the card in your
  // own hand that you believe matches. Two steps instead of one tap,
  // because a single tap on your own card (with no target selected first)
  // reads ambiguously — this makes the "I'm claiming this match" gesture
  // explicit, and lets you cancel by tapping the target again.
  const [selectingMatch, setSelectingMatch] = useState(false);

  const { round, players, you, potAmount, packAmount } = roomState;

  // Reset the selection whenever the target card changes for any reason —
  // your own successful action, someone else racing you to it, or a flip —
  // so the UI never shows a stale "selected" state.
  useEffect(() => {
    setSelectingMatch(false);
  }, [round && round.faceUpCard && round.faceUpCard.id, round && round.phase, roomState.status]);

  // A quick scale "bump" every time the pot actually changes (a fresh ante,
  // a payout) so the number feels alive instead of just silently updating.
  const potBump = useRef(new Animated.Value(1)).current;
  const lastPotAmount = useRef(potAmount);
  useEffect(() => {
    if (lastPotAmount.current !== potAmount) {
      potBump.setValue(1);
      Animated.sequence([
        Animated.timing(potBump, { toValue: 1.18, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(potBump, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }),
      ]).start();
    }
    lastPotAmount.current = potAmount;
  }, [potAmount]);

  async function act(event, payload) {
    setError("");
    setBusy(true);
    try {
      await emitWithAck(socket, event, { code, ...payload });
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function tapDeck() {
    const ok = await act("tap-deck");
    if (ok) setSelectingMatch(false);
  }

  function tapTargetCard() {
    if (!round || round.phase !== "matching" || roomState.status === "round-over" || !round.faceUpCard) return;
    setSelectingMatch((prev) => !prev);
  }

  async function tapCard(card) {
    if (!card || !selectingMatch) return;
    const targetCardId = round.faceUpCard ? round.faceUpCard.id : null;
    const ok = await act("tap-card", { cardId: card.id, targetCardId });
    if (ok) setSelectingMatch(false);
    // On a rejected guess, stay in selecting mode so they can try another card.
  }

  // After you knock a card in and have 2+ cards left, there's no deck draw —
  // you choose one of your OWN remaining cards to place face-up as the next
  // target for everyone else to try to match.
  async function placeCard(card) {
    if (!card) return;
    await act("place-target", { cardId: card.id });
  }

  async function leaveRoom() {
    setError("");
    setBusy(true);
    try {
      await emitWithAck(socket, "leave-room", { code });
      onLeaveRoom();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  // Mid-round, the server can't cleanly drop a seat — every player's hand,
  // the pot, and turn order are indexed by seat position. Instead this
  // disconnects the socket (same as the app crashing or losing signal,
  // which the server already tolerates via markDisconnected) and returns
  // to the home screen locally; the ante already in the pot stays there.
  function forfeitAndLeave() {
    socket.disconnect();
    onLeaveRoom();
  }

  function handleLeave() {
    const midRound = roomState.status === "round-active";
    Alert.alert(
      "Leave table?",
      midRound
        ? "You'll forfeit this hand — your ante stays in the pot — and your seat will show as disconnected."
        : "You'll give up your seat.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: midRound ? forfeitAndLeave : leaveRoom },
      ]
    );
  }

  if (!round) {
    return (
      <View style={styles.container}>
        <Text style={styles.info}>Waiting for the next round…</Text>
      </View>
    );
  }

  const isInstantWin = round.phase === "instant-win";
  const isRoundOver = roomState.status === "round-over";
  // A knock that leaves someone with 2+ cards blocks everything else (no
  // flips, no other knocks) until that player places their next target.
  const pendingPlacement = round.pendingPlacement;
  const placementPending =
    !isInstantWin && !isRoundOver && pendingPlacement !== null && pendingPlacement !== undefined;
  const isMyPendingPlacement = placementPending && pendingPlacement === you;
  // turnIndex only ever controls who's on the hook to flip the deck when
  // nobody has a match — matching itself is open to everyone, any time.
  const isMyFlipTurn = !isInstantWin && !isRoundOver && !placementPending && round.turnIndex === you;

  // The table layout (deck, target card, everyone's hand) is ALWAYS shown,
  // regardless of how the round resolves — an instant win just adds a
  // banner on top instead of replacing the table with a different view.
  const winnerSet = isInstantWin
    ? new Set(round.winnerIndices || [])
    : typeof round.winnerIndex === "number"
    ? new Set([round.winnerIndex])
    : new Set();
  const isSplit = winnerSet.size > 1;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Animated.Text style={[styles.potText, { transform: [{ scale: potBump }] }]}>Pot: ${potAmount}</Animated.Text>
        <GlassPanel style={styles.packBadge} radius={999}>
          <Text style={styles.packText}>Pack {packAmount}</Text>
        </GlassPanel>
      </View>

      <TouchableOpacity onPress={handleLeave} disabled={busy} activeOpacity={0.7} style={styles.leaveTopButton}>
        <Text style={styles.leaveText}>Leave table</Text>
      </TouchableOpacity>

      {winnerSet.size > 0 && (
        <WinnerBanner
          isSplit={isSplit}
          names={[...winnerSet].map((i) => players[i].name).join(" & ")}
          categoryText={
            isInstantWin ? `Instant win — ${CATEGORY_LABEL[round.category] || round.category}` : "Matched their whole hand"
          }
        />
      )}

      <View style={styles.opponents}>
        {players.map((p, i) =>
          i === you ? null : (
            <View key={i} style={styles.opponentBlock}>
              <Text
                style={[
                  styles.opponentName,
                  (isFlipTurn(round, isInstantWin, isRoundOver, i) || round.pendingPlacement === i) && styles.activeName,
                ]}
              >
                {p.name}
                {isFlipTurn(round, isInstantWin, isRoundOver, i) ? " (flip turn)" : ""}
                {round.pendingPlacement === i ? " (placing…)" : ""}
                {winnerSet.has(i) ? " 🏆" : ""}
              </Text>
              <Hand cards={round.hands[i] || []} size="small" />
            </View>
          )
        )}
      </View>

      <View style={styles.tableRow}>
        <View style={styles.pileBlock}>
          <Text style={styles.pileLabel}>Deck</Text>
          <Card card={null} onPress={tapDeck} tappable={isMyFlipTurn} disabled={!isMyFlipTurn || busy} />
          <Text style={styles.pileCount}>{round.deckCount} left</Text>
          {isMyFlipTurn ? <Text style={styles.tapHint}>tap if no match</Text> : null}
        </View>

        <View style={styles.pileBlock}>
          <Text style={styles.pileLabel}>
            {round.faceUpCard ? "Match this card" : placementPending ? "Choosing new target…" : "No flip needed"}
          </Text>
          {round.faceUpCard ? (
            <Card
              card={round.faceUpCard}
              onPress={tapTargetCard}
              tappable={!isInstantWin && !isRoundOver}
              selected={selectingMatch}
              disabled={isInstantWin || isRoundOver || busy}
            />
          ) : (
            <View style={styles.emptyPileSlot}>
              <Text style={styles.emptyPileText}>—</Text>
            </View>
          )}
          <Text style={styles.pileCount}>{round.tablePileCount} retired</Text>
          {!isInstantWin && !isRoundOver && round.faceUpCard ? (
            <Text style={styles.tapHint}>{selectingMatch ? "tap again to cancel" : "tap if you have a match"}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.yourBlock}>
        <Text style={styles.yourLabel}>
          Your hand
          {winnerSet.has(you) ? " 🏆" : ""}
        </Text>
        {!isInstantWin && !isRoundOver ? (
          <Text style={styles.turnHint}>
            {isMyPendingPlacement
              ? "You matched! Tap a card from your hand to place as the new target"
              : selectingMatch
              ? "Now tap the card in your hand that matches"
              : placementPending
              ? `Waiting for ${players[pendingPlacement].name} to place a new target card`
              : "Tap the target card any time you think you have a match"}
          </Text>
        ) : null}
        <Hand
          cards={round.hands[you] || []}
          onCardPress={isMyPendingPlacement ? placeCard : selectingMatch ? tapCard : undefined}
          disabled={busy}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!isInstantWin && !isRoundOver && !selectingMatch && !placementPending && (
        <Text style={styles.waitingText}>
          {isMyFlipTurn ? "Nobody's matched yet — tap the deck to flip if you have none" : `${players[round.turnIndex].name} flips next if nobody matches`}
        </Text>
      )}

      {(isInstantWin || isRoundOver) && (
        <GradientButton onPress={() => act("start-round")} disabled={busy} style={styles.actionButton}>
          {busy ? "…" : `Deal Next Round ($${packAmount} ante)`}
        </GradientButton>
      )}

      <GlassPanel style={styles.log}>
        <Text style={styles.logTitle}>Table log</Text>
        {roomState.log
          .slice()
          .reverse()
          .map((entry, i) => (
            <Text key={i} style={styles.logLine}>
              {entry.message}
            </Text>
          ))}
      </GlassPanel>
    </ScrollView>
  );
}

/** The gold "someone won" banner — pops and settles into place the moment it appears. */
function WinnerBanner({ isSplit, names, categoryText }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.winnerBanner,
        {
          opacity: enter,
          transform: [
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
          ],
        },
      ]}
    >
      <Text style={styles.winnerTitle}>
        🏆 {isSplit ? "Split Pot!" : "Winner!"} {names}
      </Text>
      <Text style={styles.winnerCategory}>{categoryText}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 56, alignItems: "center" },
  info: { color: "#fff", fontSize: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: 16 },
  potText: { color: "#f0cd7a", fontSize: 20, fontWeight: "800", textShadowColor: "rgba(201,162,75,0.4)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  packBadge: { paddingHorizontal: 12, paddingVertical: 4 },
  packText: { color: "#e6efe9", fontSize: 13 },
  winnerBanner: {
    borderRadius: 12, padding: 16, marginBottom: 16, width: "100%", alignItems: "center",
    backgroundColor: "#c9a24b",
    shadowColor: "#c9a24b", shadowOpacity: 0.4, shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, elevation: 6,
  },
  winnerTitle: { color: "#2a2107", fontWeight: "800", fontSize: 17, textAlign: "center" },
  winnerCategory: { color: "#4a3a10", fontSize: 13, marginTop: 4 },
  opponents: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginBottom: 20 },
  opponentBlock: { alignItems: "center", marginHorizontal: 10, marginBottom: 10 },
  opponentName: { color: "#e6efe9", marginBottom: 4, fontSize: 13 },
  activeName: { color: "#f0cd7a", fontWeight: "700" },
  tableRow: { flexDirection: "row", justifyContent: "center", gap: 30, marginBottom: 20 },
  pileBlock: { alignItems: "center", marginHorizontal: 10 },
  pileLabel: { color: "#93a99c", marginBottom: 6, fontSize: 12 },
  pileCount: { color: "#93a99c", fontSize: 11, marginTop: 6 },
  emptyPileSlot: {
    width: 56, height: 78, borderRadius: 9, borderWidth: 1.5, borderColor: "#3a6455", borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
  emptyPileText: { color: "#4a7864", fontSize: 20 },
  tapHint: { color: "#f0cd7a", fontSize: 10.5, marginTop: 4, fontStyle: "italic" },
  yourBlock: { alignItems: "center", marginBottom: 20 },
  yourLabel: { color: "#fff", fontWeight: "700", marginBottom: 8, fontSize: 15 },
  turnHint: { color: "#f0cd7a", fontSize: 12.5, marginBottom: 10, textAlign: "center" },
  waitingText: { color: "#93a99c", fontSize: 13, marginBottom: 16, textAlign: "center" },
  error: { color: "#ffb4b4", marginBottom: 12 },
  actionButton: { width: "100%", marginBottom: 24 },
  leaveTopButton: { marginBottom: 16 },
  leaveText: { color: "#ffb4b4", fontSize: 14 },
  log: { width: "100%", padding: 14 },
  logTitle: { color: "#93a99c", fontWeight: "700", marginBottom: 6 },
  logLine: { color: "#c9d8cf", fontSize: 12, marginBottom: 4 },
});
