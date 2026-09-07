import React, { useEffect, useState } from "react";
import { StyleSheet, StatusBar } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import HomeScreen from "./src/screens/HomeScreen";
import LobbyScreen from "./src/screens/LobbyScreen";
import GameScreen from "./src/screens/GameScreen";
import { emitWithAck } from "./src/socket";

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

    return () => {
      socket.off("room-state", onRoomState);
      socket.off("game-error", onGameError);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
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
      <LinearGradient colors={["#1a5a44", "#123f30", "#061a14"]} locations={[0, 0.45, 1]} style={styles.safe}>
        <SafeAreaView style={styles.safe}>
          <StatusBar barStyle="light-content" />
          {content}
        </SafeAreaView>
      </LinearGradient>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
