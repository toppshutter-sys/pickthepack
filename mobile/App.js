import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, StatusBar, View, Animated, Easing } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import HomeScreen from "./src/screens/HomeScreen";
import LobbyScreen from "./src/screens/LobbyScreen";
import GameScreen from "./src/screens/GameScreen";
import { emitWithAck } from "./src/socket";
import { notify } from "./src/confirm";
import { gradients } from "./src/theme";

/**
 * Two soft, slowly drifting light blobs behind everything — a warm sun
 * glow and a cool aqua glow, like sunlight moving on lagoon water. Purely
 * ambient (pointerEvents="none") so it never interferes with taps; gives
 * the app a bit of life even on static screens like the home form.
 */
function AmbientGlow() {
  const driftA = useRef(new Animated.Value(0)).current;
  const driftB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loopA = Animated.loop(
      Animated.sequence([
        Animated.timing(driftA, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftA, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const loopB = Animated.loop(
      Animated.sequence([
        Animated.timing(driftB, { toValue: 1, duration: 13000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftB, { toValue: 0, duration: 13000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loopA.start();
    loopB.start();
    return () => {
      loopA.stop();
      loopB.stop();
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.blobSun,
          {
            transform: [
              { translateX: driftA.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) },
              { translateY: driftA.interpolate({ inputRange: [0, 1], outputRange: [0, 35] }) },
            ],
          },
        ]}
      >
        <LinearGradient colors={["rgba(245,167,90,0.24)", "rgba(245,167,90,0)"]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        style={[
          styles.blobAqua,
          {
            transform: [
              { translateX: driftB.interpolate({ inputRange: [0, 1], outputRange: [0, 25] }) },
              { translateY: driftB.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) },
            ],
          },
        ]}
      >
        <LinearGradient colors={["rgba(94,231,208,0.20)", "rgba(94,231,208,0)"]} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState(null); // { socket, code, playerName, serverUrl }
  const [roomState, setRoomState] = useState(null);

  useEffect(() => {
    if (!session) return;
    const { socket, code, playerName } = session;

    function onRoomState(state) {
      setRoomState(state);
    }
    function onGameError(payload) {
      // Surfaced via console for now; screens show their own inline errors
      // for actions they trigger directly.
      console.warn("game-error:", payload.error);
    }
    function onDisconnect() {
      console.warn("Disconnected from server.");
    }
    // Sent when leaving drops the table to just one other, non-host player
    // — the game can't continue and that table closes, but they didn't
    // ask to leave themselves, so there's no ordinary room-state update
    // telling their client to bail out. Send them home directly instead.
    function onRoomClosed(payload) {
      notify("Table closed", payload && payload.reason ? payload.reason : "Everyone else left the table.");
      handleLeaveRoom();
    }
    // The socket is always already connected by the time this effect
    // attaches (HomeScreen awaited that itself before handing off a
    // session), so any "connect" event THIS listener observes is by
    // definition a reconnect — dropped wifi, a backgrounded tab/app
    // resuming, etc. — not the initial connection, which already happened
    // before this listener existed. Socket.IO hands a reconnect a
    // brand-new socket id, so without re-announcing ourselves the server
    // has no idea this connection belongs to our seat, and we'd silently
    // stop receiving this room's updates, frozen on whatever screen we
    // were last on.
    function onConnect() {
      emitWithAck(socket, "rejoin-room", { code, playerName }).catch((e) => {
        console.warn("Could not reclaim seat after reconnect:", e.message);
      });
    }

    socket.on("room-state", onRoomState);
    socket.on("game-error", onGameError);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    socket.on("room-closed", onRoomClosed);

    return () => {
      socket.off("room-state", onRoomState);
      socket.off("game-error", onGameError);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
      socket.off("room-closed", onRoomClosed);
    };
  }, [session]);

  function handleEnterRoom({ socket, code, playerName, serverUrl, initialRoomState }) {
    setSession({ socket, code, playerName, serverUrl });
    if (initialRoomState) setRoomState(initialRoomState);
  }

  function handleLeaveRoom() {
    setSession(null);
    setRoomState(null);
  }

  let content;
  if (!session || !roomState) {
    content = <HomeScreen onEnterRoom={handleEnterRoom} />;
  } else if (roomState.status === "lobby") {
    content = <LobbyScreen socket={session.socket} roomState={roomState} code={session.code} onLeaveRoom={handleLeaveRoom} />;
  } else {
    content = <GameScreen socket={session.socket} roomState={roomState} code={session.code} onLeaveRoom={handleLeaveRoom} />;
  }

  return (
    <SafeAreaProvider>
      <LinearGradient colors={gradients.background} locations={gradients.backgroundLocations} style={styles.safe}>
        <AmbientGlow />
        <SafeAreaView style={styles.safe}>
          <StatusBar barStyle="light-content" />
          {content}
        </SafeAreaView>
      </LinearGradient>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // overflow: "hidden" is load-bearing on web — the ambient glow blobs
  // below are deliberately positioned partly off-screen (negative
  // top/right/bottom/left) to peek in from the edges, and without clipping
  // here that extends the actual page's scrollable width/height rather
  // than just being cropped from view.
  safe: { flex: 1, overflow: "hidden" },
  blobSun: {
    position: "absolute",
    top: -60,
    right: -80,
    width: 340,
    height: 340,
    borderRadius: 170,
    overflow: "hidden",
  },
  blobAqua: {
    position: "absolute",
    bottom: -40,
    left: -90,
    width: 300,
    height: 300,
    borderRadius: 150,
    overflow: "hidden",
  },
});
