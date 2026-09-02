import React, { useEffect, useState } from "react";
import { StyleSheet, StatusBar } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import HomeScreen from "./src/screens/HomeScreen";
import LobbyScreen from "./src/screens/LobbyScreen";
import GameScreen from "./src/screens/GameScreen";

export default function App() {
  const [session, setSession] = useState(null); // { socket, code, playerName, serverUrl }
  const [roomState, setRoomState] = useState(null);

  useEffect(() => {
    if (!session) return;
    const { socket } = session;

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

    socket.on("room-state", onRoomState);
    socket.on("game-error", onGameError);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("room-state", onRoomState);
      socket.off("game-error", onGameError);
      socket.off("disconnect", onDisconnect);
    };
  }, [session]);

  function handleEnterRoom({ socket, code, playerName, serverUrl }) {
    setSession({ socket, code, playerName, serverUrl });
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
