import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Hand from "../components/Hand";
import Card from "../components/Card";
import GradientButton from "../components/GradientButton";
import GlassPanel from "../components/GlassPanel";
import InviteButton from "../components/InviteButton";
import { emitWithAck } from "../socket";
import { centeredContent, useScale } from "../responsive";
import { confirmAsync } from "../confirm";
import { shareInvite } from "../inviteLink";
import { colors, gradients } from "../theme";

function isFlipTurn(round, isInstantWin, isRoundOver, playerIndex) {
  const placementPending =
    round.pendingPlacement !== null && round.pendingPlacement !== undefined;
  return !isInstantWin && !isRoundOver && !placementPending && round.turnIndex === playerIndex;
}

// Seats opponents along the top arc of an oval table (you sit at the
// bottom, implicitly, via the "Your hand" block below the table surface).
// Horizontal position is a plain even spread by seat index — simple and
// predictable. Vertical position is a shallow "dome": highest (smallest
// top%) at dead center, easing down toward TOP_SIDE at the outer seats —
// capped there deliberately (an ellipse's sin() would let outer seats sink
// toward the container's vertical center regardless of how shallow the
// curve is meant to be, which let them dip down into the felt table below
// once the horizontal spread widened for more opponents).
function seatPosition(seatIndex, seatCount) {
  const t = seatCount === 1 ? 0.5 : seatIndex / (seatCount - 1);
  // Fewer opponents sit closer together and higher up — spread wide/low
  // only kicks in once there are enough seats that they'd otherwise
  // collide. Without this, exactly 2 opponents end up stuck flush in the
  // far corners with a big empty gap between them, barely reading as an
  // arc at all.
  const LEFT_MARGIN = seatCount <= 2 ? 28 : seatCount === 3 ? 18 : 10; // %
  const TOP_SIDE = seatCount <= 2 ? 14 : seatCount === 3 ? 20 : 28; // % — hard ceiling, however wide the spread gets
  const TOP_CENTER = 4; // %
  const left = seatCount === 1 ? 50 : LEFT_MARGIN + (100 - 2 * LEFT_MARGIN) * t;
  const top = TOP_CENTER + (TOP_SIDE - TOP_CENTER) * Math.pow(Math.abs(2 * t - 1), 1.4);
  return {
    left: `${left}%`,
    top: `${top}%`,
  };
}

const CATEGORY_LABEL = {
  royal: "Royal Sequence (K-Q-J)",
  ace23: "Ace-2-3 Sequence",
  sequential: "Sequence",
  flush: "Same-Suit (Flush)",
  dealerCard: "Dealer's Card (J or 6)",
};

// Running net position for one table, for the length of one game night —
// how much a player has won minus how much they've anted in, computed
// straight from data the server already tracks and broadcasts. No account
// or profile is involved; this resets whenever the table itself resets.
function netFor(p) {
  return (p && p.totalWon ? p.totalWon : 0) - (p && p.totalContributed ? p.totalContributed : 0);
}

function formatNet(n) {
  if (n > 0) return `+$${n}`;
  if (n < 0) return `-$${Math.abs(n)}`;
  return "$0";
}

function netPillBorderColor(n) {
  if (n > 0) return "rgba(92,214,138,0.45)";
  if (n < 0) return "rgba(255,145,132,0.4)";
  return colors.aquaDim;
}

function netTextStyle(n) {
  if (n > 0) return styles.netTextPositive;
  if (n < 0) return styles.netTextNegative;
  return styles.netTextZero;
}

/** The small pill shown next to a player's name — their running net for this table. */
function NetPill({ player, size = "small" }) {
  const n = netFor(player);
  return (
    <GlassPanel
      style={[styles.netPill, size === "large" && styles.netPillLarge, size === "tiny" && styles.netPillTiny]}
      radius={999}
      borderColor={netPillBorderColor(n)}
    >
      <Text
        style={[styles.netPillText, size === "large" && styles.netPillTextLarge, size === "tiny" && styles.netPillTextTiny, netTextStyle(n)]}
        numberOfLines={1}
      >
        {size === "tiny" ? formatNet(n) : `Net ${formatNet(n)}`}
      </Text>
    </GlassPanel>
  );
}

export default function GameScreen({ socket, roomState, code, onLeaveRoom }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  // Matching is a free-for-all, not turn-based: you tap the target card
  // first to say "I want to try matching this", THEN tap the card in your
  // own hand that you believe matches. Two steps instead of one tap,
  // because a single tap on your own card (with no target selected first)
  // reads ambiguously — this makes the "I'm claiming this match" gesture
  // explicit, and lets you cancel by tapping the target again.
  const [selectingMatch, setSelectingMatch] = useState(false);
  // Drives the deck's cooldown countdown — ticks while a round is live so
  // every player's screen (not just the flipper's) shows the same "wait a
  // second" state, derived from the server's synchronized flipAvailableAt.
  const [now, setNow] = useState(Date.now());

  const { round, players, you, potAmount, packAmount } = roomState;
  const scale = useScale();

  const roundIsLive = roomState.status === "round-active";
  useEffect(() => {
    if (!roundIsLive) return;
    const id = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(id);
  }, [roundIsLive]);

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

  async function handleLeave() {
    const midRound = roomState.status === "round-active" || roomState.status === "awaiting-recast";
    const confirmed = await confirmAsync(
      "Leave table?",
      midRound
        ? "You'll forfeit this hand — your ante stays in the pot — and your seat will show as disconnected."
        : "You'll give up your seat.",
      "Leave"
    );
    if (!confirmed) return;
    if (midRound) forfeitAndLeave();
    else leaveRoom();
  }

  function handleShare() {
    setLinkCopied(false);
    shareInvite(code, {
      onCopied: () => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 3000);
      },
    });
  }

  if (!round) {
    return (
      <View style={styles.container}>
        <Text style={styles.info}>Waiting for the next round…</Text>
      </View>
    );
  }

  // A dealer's-card (J/6) win pauses here instead of ending the round —
  // same dealt hands, no re-deal — until everyone's recast their bet.
  if (roomState.status === "awaiting-recast") {
    const iHaveRecast = round.recastReady && round.recastReady[you];
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.potText}>Pot: $0</Text>
          <GlassPanel style={styles.packBadge} radius={999}>
            <Text style={styles.packText}>Pack {packAmount}</Text>
          </GlassPanel>
        </View>

        <TouchableOpacity onPress={handleLeave} disabled={busy} activeOpacity={0.7} style={styles.leaveTopButton}>
          <Text style={styles.leaveText}>Leave table</Text>
        </TouchableOpacity>

        <LinearGradient colors={gradients.sunset} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.dealerCardBanner}>
          <Text style={styles.dealerCardTitle}>
            🃏 {players[roomState.dealerIndex].name} deals the {round.faceUpCard.rank} of {round.faceUpCard.suit}
          </Text>
          <View style={styles.dealerCardImageWrap}>
            <Card card={round.faceUpCard} />
          </View>
          <Text style={styles.dealerCardSubtitle}>
            Dealer wins ${round.wonAmount} instantly! Recast your bet to continue with the same hand.
          </Text>
        </LinearGradient>

        <View style={styles.playerList}>
          {players.map((p, i) => (
            <GlassPanel key={i} style={styles.recastRow}>
              <View style={styles.recastNameCol}>
                <Text style={styles.recastName}>
                  {p.name}
                  {i === you ? " (you)" : ""}
                </Text>
                <NetPill player={p} />
              </View>
              <Text style={round.recastReady[i] ? styles.recastDone : styles.recastPending}>
                {round.recastReady[i] ? "✓ recast" : p.connected ? "waiting…" : "disconnected"}
              </Text>
            </GlassPanel>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {iHaveRecast ? (
          <Text style={styles.waitingText}>Waiting for everyone else to recast…</Text>
        ) : (
          <GradientButton onPress={() => act("recast-bet")} disabled={busy} style={styles.actionButton}>
            {busy ? "…" : `Recast $${packAmount} ante`}
          </GradientButton>
        )}
      </ScrollView>
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
  // A brief global cooldown between flips (see FLIP_COOLDOWN_MS on the
  // server) so cards can't be rapid-tapped through faster than anyone can
  // actually see them — flipAvailableAt is a shared server timestamp, so
  // this shows the same countdown on every player's screen, not just the
  // flip-turn player's.
  const flipCooldownRemainingMs = round.flipAvailableAt ? Math.max(0, round.flipAvailableAt - now) : 0;
  const flipOnCooldown = flipCooldownRemainingMs > 0;

  // The table layout (deck, target card, everyone's hand) is ALWAYS shown,
  // regardless of how the round resolves — an instant win just adds a
  // banner on top instead of replacing the table with a different view.
  const winnerSet = isInstantWin
    ? new Set(round.winnerIndices || [])
    : typeof round.winnerIndex === "number"
    ? new Set([round.winnerIndex])
    : new Set();
  const isSplit = winnerSet.size > 1;
  const opponents = players.map((p, i) => ({ p, i })).filter((o) => o.i !== you);
  // Narrower per seat as more opponents crowd the arc, so up to 5 still
  // fit around the oval without piling on top of each other.
  const seatWidth = Math.round((opponents.length >= 5 ? 58 : opponents.length >= 4 ? 66 : opponents.length >= 3 ? 76 : 84) * scale);
  // Matches seatPosition's TOP_SIDE tiers plus room for a seat's content
  // (name + net pill + fanned hand) — fewer opponents sit higher, so they
  // don't need as tall a container.
  const ovalHeight = Math.round((opponents.length <= 2 ? 112 : opponents.length === 3 ? 128 : opponents.length === 4 ? 142 : 152) * scale);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Animated.Text style={[styles.potText, { transform: [{ scale: potBump }] }]}>Pot: ${potAmount}</Animated.Text>
        <GlassPanel style={styles.packBadge} radius={999}>
          <Text style={styles.packText}>Pack {packAmount}</Text>
        </GlassPanel>
      </View>

      <View style={styles.topLinksRow}>
        <TouchableOpacity onPress={handleLeave} disabled={busy} activeOpacity={0.7}>
          <Text style={styles.leaveText}>Leave table</Text>
        </TouchableOpacity>
        {isRoundOver && players.length < 6 && <InviteButton onPress={handleShare} copied={linkCopied} />}
      </View>

      {winnerSet.size > 0 && (
        <WinnerBanner
          isSplit={isSplit}
          names={[...winnerSet].map((i) => players[i].name).join(" & ")}
          categoryText={
            isInstantWin ? `Instant win — ${CATEGORY_LABEL[round.category] || round.category}` : "Matched their whole hand"
          }
        />
      )}

      {/* Opponents seated around the top arc of an oval table — you sit at
          the bottom (see "Your hand" below the table surface). */}
      <View style={[styles.tableOval, { height: ovalHeight }]}>
        {opponents.map(({ p, i }, seatIdx) => (
          <View key={i} style={[styles.seat, { width: seatWidth, marginLeft: -seatWidth / 2 }, seatPosition(seatIdx, opponents.length)]}>
            {/* Whose flip-turn/placing it is reads from the gold name color
                alone here — a text suffix doesn't fit once seats get tight
                with 4-5 opponents; the recast screen's player list still
                spells it out in full since it has room to. */}
            <Text
              style={[
                styles.opponentName,
                (isFlipTurn(round, isInstantWin, isRoundOver, i) || round.pendingPlacement === i) && styles.activeName,
              ]}
              numberOfLines={1}
            >
              {p.name}
              {winnerSet.has(i) ? " 🏆" : ""}
            </Text>
            <NetPill player={p} size="tiny" />
            <Hand cards={round.hands[i] || []} size="small" fan dealFrom="below" maxWidth={seatWidth} />
          </View>
        ))}
      </View>

      {!isInstantWin && !isRoundOver && round.lastKnock && (
        <KnockBanner playerName={round.lastKnock.playerName} card={round.lastKnock.card} />
      )}

      {/* The actual "table" — a felt surface the deck and target card sit
          on, with a warm rail trim, instead of cards floating directly on
          the app's ambient background. */}
      <LinearGradient colors={gradients.felt} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.tableSurface}>
        <View style={styles.tableRow}>
          <View style={styles.pileBlock}>
            <Text style={styles.pileLabel}>Deck</Text>
            <Card card={null} onPress={tapDeck} tappable={isMyFlipTurn && !flipOnCooldown} disabled={!isMyFlipTurn || busy || flipOnCooldown} />
            <Text style={styles.pileCount}>{round.deckCount} left</Text>
            {isMyFlipTurn ? (
              <Text style={styles.tapHint}>
                {flipOnCooldown ? `wait ${Math.ceil(flipCooldownRemainingMs / 1000)}s…` : "tap if no match"}
              </Text>
            ) : null}
          </View>

          <View style={styles.pileBlock}>
            <Text style={styles.pileLabel}>
              {isInstantWin && round.faceUpCard
                ? "Dealer's card"
                : round.faceUpCard
                ? "Match this card"
                : placementPending
                ? "Choosing new target…"
                : "No flip needed"}
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
      </LinearGradient>

      <View style={styles.yourBlock}>
        <Text style={styles.yourLabel}>
          Your hand
          {winnerSet.has(you) ? " 🏆" : ""}
        </Text>
        <NetPill player={players[you]} size="large" />
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
          dealFrom="above"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!isInstantWin && !isRoundOver && !selectingMatch && !placementPending && (
        <Text style={styles.waitingText}>
          {isMyFlipTurn
            ? flipOnCooldown
              ? "Nobody's matched yet — give everyone a moment before the next flip"
              : "Nobody's matched yet — tap the deck to flip if you have none"
            : `${players[round.turnIndex].name} flips next if nobody matches`}
        </Text>
      )}

      {(isInstantWin || isRoundOver) &&
        (you === roomState.dealerIndex ? (
          <GradientButton onPress={() => act("start-round")} disabled={busy} style={styles.actionButton}>
            {busy ? "…" : `Deal Next Round ($${packAmount} ante)`}
          </GradientButton>
        ) : (
          <Text style={styles.waitingText}>
            Waiting for {players[roomState.dealerIndex].name} — winner of the last round — to deal the next one
          </Text>
        ))}
    </ScrollView>
  );
}

/** A clear, dedicated callout for the most recent knock — pops in fresh each time. */
function KnockBanner({ playerName, card }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8 }).start();
  }, [card.id, playerName]);

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
        width: "100%",
        marginBottom: 16,
      }}
    >
      <GlassPanel style={styles.knockBanner} borderColor={colors.sunGold}>
        <Text style={styles.knockText}>
          🔔 {playerName} knocked the {card.rank} of {card.suit}
        </Text>
      </GlassPanel>
    </Animated.View>
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
      style={{
        opacity: enter,
        width: "100%",
        marginBottom: 16,
        transform: [
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
        ],
      }}
    >
      <LinearGradient colors={gradients.sunset} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.winnerBanner}>
        <Text style={styles.winnerTitle}>
          🏆 {isSplit ? "Split Pot!" : "Winner!"} {names}
        </Text>
        <Text style={styles.winnerCategory}>{categoryText}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { ...centeredContent, padding: 20, paddingTop: 56, alignItems: "center" },
  info: { color: "#fff", fontSize: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: 16 },
  potText: { color: colors.sunGold, fontSize: 20, fontWeight: "800", letterSpacing: 0.2, textShadowColor: "rgba(245,167,90,0.4)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  packBadge: { paddingHorizontal: 12, paddingVertical: 4 },
  packText: { color: colors.textPrimary, fontSize: 13 },
  winnerBanner: {
    borderRadius: 16, padding: 16, width: "100%", alignItems: "center",
    shadowColor: colors.sunCoral, shadowOpacity: 0.4, shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, elevation: 6,
  },
  winnerTitle: { color: "#2a1a0a", fontWeight: "800", fontSize: 17, textAlign: "center" },
  winnerCategory: { color: "#4a2f14", fontSize: 13, marginTop: 4 },
  knockBanner: { paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  knockText: { color: colors.sunGold, fontWeight: "700", fontSize: 13 },
  dealerCardBanner: {
    borderRadius: 16, padding: 16, marginBottom: 16, width: "100%", alignItems: "center",
    shadowColor: colors.sunCoral, shadowOpacity: 0.4, shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, elevation: 6,
  },
  dealerCardTitle: { color: "#2a1a0a", fontWeight: "800", fontSize: 16, textAlign: "center" },
  dealerCardImageWrap: { marginTop: 10 },
  dealerCardSubtitle: { color: "#4a2f14", fontSize: 13, marginTop: 6, textAlign: "center" },
  playerList: { width: "100%", marginBottom: 20 },
  recastRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  recastName: { color: "#fff", fontSize: 16 },
  recastNameCol: { alignItems: "flex-start" },
  recastDone: { color: colors.positive, fontSize: 13, fontWeight: "700" },
  recastPending: { color: colors.textMuted, fontSize: 13 },
  netPill: { paddingHorizontal: 10, paddingVertical: 3, marginTop: 3, marginBottom: 6 },
  netPillLarge: { paddingHorizontal: 14, paddingVertical: 5, marginBottom: 10 },
  netPillTiny: { paddingHorizontal: 6, paddingVertical: 1, marginTop: 1, marginBottom: 3 },
  netPillText: { fontSize: 11, fontWeight: "700" },
  netPillTextLarge: { fontSize: 13.5 },
  netPillTextTiny: { fontSize: 9 },
  netTextPositive: { color: colors.positive },
  netTextNegative: { color: colors.negative },
  netTextZero: { color: colors.textMuted },
  // The oval opponents sit around — position:relative so each seat's
  // position:absolute + percentage left/top resolves against ITS bounds,
  // not the whole screen.
  tableOval: { width: "100%", position: "relative", marginBottom: 10 },
  seat: { position: "absolute", alignItems: "center" },
  opponentName: { color: colors.textPrimary, marginBottom: 4, fontSize: 12 },
  activeName: { color: colors.sunGold, fontWeight: "700" },
  tableSurface: {
    width: "100%",
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: colors.rail,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 6,
  },
  tableRow: { flexDirection: "row", justifyContent: "center", gap: 30 },
  pileBlock: { alignItems: "center", marginHorizontal: 10 },
  pileLabel: { color: colors.textMuted, marginBottom: 6, fontSize: 12 },
  pileCount: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  emptyPileSlot: {
    width: 56, height: 78, borderRadius: 11, borderWidth: 1.5, borderColor: colors.aquaDim, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
  emptyPileText: { color: colors.aqua, fontSize: 20 },
  tapHint: { color: colors.sunGold, fontSize: 10.5, marginTop: 4, fontStyle: "italic" },
  yourBlock: { alignItems: "center", marginBottom: 20 },
  yourLabel: { color: "#fff", fontWeight: "700", marginBottom: 8, fontSize: 15 },
  turnHint: { color: colors.sunGold, fontSize: 12.5, marginBottom: 10, textAlign: "center" },
  waitingText: { color: colors.textMuted, fontSize: 13, marginBottom: 16, textAlign: "center" },
  error: { color: colors.negative, marginBottom: 12 },
  actionButton: { width: "100%", marginBottom: 24 },
  leaveTopButton: { marginBottom: 16 },
  topLinksRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 20, marginBottom: 16 },
  leaveText: { color: colors.negative, fontSize: 14 },
});
