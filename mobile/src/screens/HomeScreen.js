import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSocket, emitWithAck } from "../socket";
import GradientButton from "../components/GradientButton";

const STORAGE_KEY = "pick-the-pack:home-form";

export default function HomeScreen({ onEnterRoom }) {
  const [serverUrl, setServerUrl] = useState("https://pickthepack.onrender.com");
  const [playerName, setPlayerName] = useState("");
  const [packAmount, setPackAmount] = useState(5);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showServerField, setShowServerField] = useState(false);

  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (saved.serverUrl) setServerUrl(saved.serverUrl);
        if (saved.playerName) setPlayerName(saved.playerName);
      } catch {
        // ignore corrupt cache
      }
    });
  }, []);

  function persist(next) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }

  async function handleCreate() {
    setError("");
    if (!playerName.trim()) return setError("Enter your name first.");
    setBusy(true);
    try {
      const socket = getSocket(serverUrl.trim());
      await waitForConnect(socket);
      // Attach this BEFORE emitting create-room: the server sends the
      // ack and the first room-state back to back, and App.js's listener
      // only gets subscribed after this promise resolves and triggers a
      // re-render — on a fast connection that room-state can arrive and
      // be lost before that subscription exists. Listening first closes
      // the race entirely.
      const initialRoomState = new Promise((resolve) => socket.once("room-state", resolve));
      const res = await emitWithAck(socket, "create-room", { playerName, packAmount });
      persist({ serverUrl, playerName });
      onEnterRoom({ socket, code: res.code, playerName, serverUrl, initialRoomState: await initialRoomState });
    } catch (e) {
      setError(e.message || "Could not create room. Check the server address.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setError("");
    if (!playerName.trim()) return setError("Enter your name first.");
    if (!joinCode.trim()) return setError("Enter a room code.");
    setBusy(true);
    try {
      const socket = getSocket(serverUrl.trim());
      await waitForConnect(socket);
      const initialRoomState = new Promise((resolve) => socket.once("room-state", resolve));
      const res = await emitWithAck(socket, "join-room", { code: joinCode.trim(), playerName });
      persist({ serverUrl, playerName });
      onEnterRoom({ socket, code: res.code, playerName, serverUrl, initialRoomState: await initialRoomState });
    } catch (e) {
      setError(e.message || "Could not join room. Check the code and server address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: fadeIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <View style={styles.titleBadge}>
            <Text style={styles.titleBadgeText}>A♠</Text>
          </View>
          <Text style={styles.title}>Pick the Pack</Text>
          <Text style={styles.subtitle}>Choose your pack, join the table.</Text>
        </Animated.View>

        {showServerField ? (
          <>
            <Text style={styles.label}>Server address</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://pickthepack.onrender.com"
              placeholderTextColor="#8b8b8b"
            />
            <Text style={styles.hint}>
              Your computer's LAN IP + port while the server runs locally (not "localhost" — see the
              README), or a hosted "https://..." address if you've deployed the server — see DEPLOYMENT.md.
            </Text>
          </>
        ) : (
          <TouchableOpacity onPress={() => setShowServerField(true)} activeOpacity={0.7}>
            <Text style={styles.advancedLink}>Advanced: change server address</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={playerName}
          onChangeText={setPlayerName}
          placeholder="e.g. Rosario"
          placeholderTextColor="#8b8b8b"
        />

        <Text style={styles.label}>Pack</Text>
        <View style={styles.packRow}>
          {[5, 10].map((amt) => (
            <TouchableOpacity
              key={amt}
              style={[styles.packButton, packAmount === amt && styles.packButtonActive]}
              onPress={() => setPackAmount(amt)}
              activeOpacity={0.8}
            >
              <Text style={[styles.packButtonText, packAmount === amt && styles.packButtonTextActive]}>
                Pack {amt} — ${amt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton onPress={handleCreate} disabled={busy} style={styles.primaryButton}>
          {busy ? "Working…" : "Create Room"}
        </GradientButton>

        <View style={styles.divider} />

        <Text style={styles.label}>Room code</Text>
        <TextInput
          style={styles.input}
          value={joinCode}
          onChangeText={(t) => setJoinCode(t.toUpperCase())}
          autoCapitalize="characters"
          placeholder="ABCDE"
          placeholderTextColor="#8b8b8b"
        />
        <GradientButton onPress={handleJoin} disabled={busy} variant="secondary" style={styles.secondaryButton}>
          {busy ? "Working…" : "Join Room"}
        </GradientButton>

        <Text style={styles.footnote}>
          Buy-ins and the pot are tracked in-app as numbers only — no real money moves through this app.
          Settle up with each other however you normally would.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function waitForConnect(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Couldn't reach the server. Check the address and that it's running."));
    }, 6000);
    function onConnect() {
      cleanup();
      resolve();
    }
    function onError(err) {
      cleanup();
      reject(new Error("Connection failed: " + (err.message || "unknown error")));
    }
    function cleanup() {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }
    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 24, paddingTop: 64, paddingBottom: 48 },
  titleBadge: {
    alignSelf: "center", width: 46, height: 54, borderRadius: 8, backgroundColor: "#f5f7f5",
    alignItems: "center", justifyContent: "center", marginBottom: 10,
    shadowColor: "#000", shadowOpacity: 0.35, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 4,
  },
  titleBadgeText: { color: "#1a1a1a", fontWeight: "800", fontSize: 20 },
  title: { fontSize: 32, fontWeight: "800", color: "#f0cd7a", textAlign: "center", textShadowColor: "rgba(201,162,75,0.4)", textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
  subtitle: { fontSize: 14, color: "#c9d8cf", textAlign: "center", marginBottom: 24 },
  label: { color: "#e6efe9", marginTop: 12, marginBottom: 4, fontWeight: "600" },
  hint: { color: "#93a99c", fontSize: 12, marginBottom: 4 },
  advancedLink: { color: "#93a99c", fontSize: 12, marginTop: 8, textDecorationLine: "underline" },
  input: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 16,
    color: "#1a1a1a",
  },
  packRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  packButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(201,162,75,0.5)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginRight: 8,
  },
  packButtonActive: { backgroundColor: "#c9a24b", borderColor: "#f0cd7a" },
  packButtonText: { color: "#f0cd7a", fontWeight: "700" },
  packButtonTextActive: { color: "#2a2107" },
  primaryButton: { marginTop: 20 },
  secondaryButton: { marginTop: 12 },
  divider: { height: 1, backgroundColor: "rgba(201,162,75,0.2)", marginVertical: 24 },
  error: { color: "#ffb4b4", marginTop: 12, textAlign: "center" },
  footnote: { color: "#93a99c", fontSize: 12, textAlign: "center", marginTop: 32 },
});
