import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated } from "react-native";
import { emitWithAck } from "../socket";
import GradientButton from "../components/GradientButton";
import GlassPanel from "../components/GlassPanel";
import InviteButton from "../components/InviteButton";
import { centeredContent } from "../responsive";
import { confirmAsync } from "../confirm";
import { shareInvite } from "../inviteLink";
import { colors } from "../theme";

export default function LobbyScreen({ socket, roomState, code, onLeaveRoom }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  async function handleStart() {
    setError("");
    setBusy(true);
    try {
      await emitWithAck(socket, "start-round", { code });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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

  async function handleLeave() {
    const confirmed = await confirmAsync("Leave table?", "You'll give up your seat.", "Leave");
    if (confirmed) leaveRoom();
  }

  const canStart = roomState.players.length >= 2;
  const hasRoomForMore = roomState.players.length < 6;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View style={{ opacity: fadeIn, alignItems: "center", width: "100%" }}>
        <Text style={styles.title}>Table {code}</Text>
        {hasRoomForMore ? (
          <View style={styles.inviteBlock}>
            <InviteButton onPress={handleShare} copied={linkCopied} />
            <Text style={styles.shareHint}>WhatsApp, iMessage, text, email…</Text>
          </View>
        ) : (
          <Text style={styles.shareHint}>Table full (6/6)</Text>
        )}

        <Text style={styles.packLabel}>Pack {roomState.packAmount} — ${roomState.packAmount} buy-in per round</Text>

        <View style={styles.playerList}>
          {roomState.players.map((p, i) => (
            <PlayerRow key={i} index={i} name={p.name} isDealer={i === roomState.dealerIndex} connected={p.connected} />
          ))}
        </View>

        {!canStart && <Text style={styles.hint}>Need at least 2 players to start.</Text>}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton onPress={handleStart} disabled={!canStart || busy} style={styles.startButton}>
          {busy ? "Dealing…" : "Start Round"}
        </GradientButton>

        <TouchableOpacity onPress={handleLeave} disabled={busy} activeOpacity={0.7} style={styles.leaveButton}>
          <Text style={styles.leaveText}>Leave table</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Everyone antes ${roomState.packAmount} into the pot when the round starts. Go around the
          table matching cards until someone matches their whole hand and takes the pot.
        </Text>
      </Animated.View>
    </ScrollView>
  );
}

/** One seated player's row — settles in with a slight per-row stagger. */
function PlayerRow({ index, name, isDealer, connected }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 320, delay: index * 70, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View
      style={{ opacity: enter, transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }], marginBottom: 8 }}
    >
      <GlassPanel style={styles.playerRow}>
        <Text style={styles.playerName}>
          {name} {isDealer ? "♠ (deals first)" : ""}
        </Text>
        <Text style={[styles.playerStatus, !connected && styles.playerStatusOffline]}>{connected ? "ready" : "disconnected"}</Text>
      </GlassPanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { ...centeredContent, padding: 24, paddingTop: 64, alignItems: "center" },
  title: { fontSize: 28, fontWeight: "800", color: colors.sunGold, letterSpacing: 0.3, textShadowColor: "rgba(245,167,90,0.4)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  inviteBlock: { alignItems: "center", marginTop: 10, marginBottom: 18 },
  shareHint: { color: colors.textMuted, fontSize: 12, marginTop: 8 },
  packLabel: { color: colors.textPrimary, fontSize: 16, marginBottom: 20 },
  playerList: { width: "100%", marginBottom: 20 },
  playerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  playerName: { color: "#fff", fontSize: 16 },
  playerStatus: { color: colors.positive, fontSize: 13 },
  playerStatusOffline: { color: colors.textMuted },
  hint: { color: colors.textMuted, marginBottom: 12 },
  error: { color: colors.negative, marginBottom: 12 },
  startButton: { width: "100%", paddingHorizontal: 40 },
  leaveButton: { marginTop: 16 },
  leaveText: { color: colors.negative, fontSize: 14 },
  footnote: { color: colors.textMuted, fontSize: 12, marginTop: 20, textAlign: "center" },
});
