"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { RoomManager } = require("./rooms");

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "pick-the-pack-server" });
});

// The web build of the mobile app (produced by `npx expo export -p web`)
// is copied into ./public at deploy time — see DEPLOYMENT.md. Serving it
// from this same server means the web app and the game server share one
// origin (no CORS to configure between them) and one Render service.
// No wildcard fallback to index.html here: this app has no client-side
// routing (every screen is in-memory React state, not a URL) — "/" is
// already served by express.static's default index-file behavior, and
// anything else genuinely not found should 404 rather than silently
// return the app shell.
const webBuildDir = path.join(__dirname, "..", "public");
if (fs.existsSync(webBuildDir)) {
  app.use(express.static(webBuildDir));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // fine for a private game among friends running locally / on a LAN
});

const rooms = new RoomManager();

function safeHandler(socket, fn) {
  return (payload, ack) => {
    try {
      fn(payload, ack);
    } catch (err) {
      if (typeof ack === "function") ack({ ok: false, error: err.message });
      else socket.emit("game-error", { error: err.message });
    }
  };
}

io.on("connection", (socket) => {
  socket.on(
    "create-room",
    safeHandler(socket, ({ playerName, packAmount }, ack) => {
      if (!playerName || !playerName.trim()) throw new Error("Enter your name first");
      if (packAmount !== 5 && packAmount !== 10) throw new Error("Pack must be 5 or 10");

      const room = rooms.createRoom({ hostSocketId: socket.id, hostName: playerName.trim(), packAmount });
      socket.join(room.code);
      ack({ ok: true, code: room.code });
      rooms.broadcastState(room, io);
    })
  );

  socket.on(
    "join-room",
    safeHandler(socket, ({ code, playerName }, ack) => {
      if (!playerName || !playerName.trim()) throw new Error("Enter your name first");
      const room = rooms.joinRoom({ code: (code || "").toUpperCase(), socketId: socket.id, playerName: playerName.trim() });
      socket.join(room.code);
      ack({ ok: true, code: room.code });
      rooms.broadcastState(room, io);
    })
  );

  // Fired by the client when its socket reconnects mid-session (see
  // App.js) — reclaims the existing seat by name rather than joining
  // fresh, so a dropped connection doesn't strand the player on a frozen
  // screen or create a duplicate entry.
  socket.on(
    "rejoin-room",
    safeHandler(socket, ({ code, playerName }, ack) => {
      const room = rooms.rejoinRoom({ code: (code || "").toUpperCase(), socketId: socket.id, playerName });
      socket.join(room.code);
      ack && ack({ ok: true });
      rooms.broadcastState(room, io);
    })
  );

  socket.on(
    "leave-room",
    safeHandler(socket, ({ code }, ack) => {
      const { room, closedFor } = rooms.leaveRoom(code, socket.id);
      socket.leave(code);
      ack({ ok: true });
      if (room) rooms.broadcastState(room, io);
      // The last non-host player left solo after someone else left — the
      // table closes; they didn't ask to leave, so there's no room-state
      // broadcast to tell their client to bail out. Tell them directly.
      if (closedFor) {
        io.to(closedFor).emit("room-closed", { reason: "Everyone else left the table." });
      }
    })
  );

  // Used both to deal the first hand from the lobby and for "Play Again"
  // after a round resolves.
  socket.on(
    "start-round",
    safeHandler(socket, ({ code }, ack) => {
      const room = rooms.startRound(code, socket.id);
      ack && ack({ ok: true });
      rooms.broadcastState(room, io);
    })
  );

  // A dealer's-card (J/6) win pauses the round for everyone to confirm
  // they want to re-ante and continue with the same dealt hands.
  socket.on(
    "recast-bet",
    safeHandler(socket, ({ code }, ack) => {
      const room = rooms.recastBet(code, socket.id);
      ack && ack({ ok: true });
      rooms.broadcastState(room, io);
    })
  );

  // Player tapped one of their own cards, asserting it matches the target.
  // Allowed for any seated player at any moment (matching is a free-for-all).
  // targetCardId is the id of the face-up card the client last saw — lets
  // the server give a friendlier "someone already matched that" message if
  // this tap lost a race to another player's.
  socket.on(
    "tap-card",
    safeHandler(socket, ({ code, cardId, targetCardId }, ack) => {
      const room = rooms.tapCard(code, socket.id, cardId, targetCardId);
      ack && ack({ ok: true });
      rooms.broadcastState(room, io);
    })
  );

  // Player tapped the deck, asserting they have no matching card.
  socket.on(
    "tap-deck",
    safeHandler(socket, ({ code }, ack) => {
      const room = rooms.tapDeck(code, socket.id);
      ack && ack({ ok: true });
      rooms.broadcastState(room, io);
    })
  );

  // After a knock leaves 2+ cards in the knocker's hand, they choose one of
  // their own remaining cards to place face-up as the next target — only
  // the player named in round.pendingPlacement may send this.
  socket.on(
    "place-target",
    safeHandler(socket, ({ code, cardId }, ack) => {
      const room = rooms.placeTarget(code, socket.id, cardId);
      ack && ack({ ok: true });
      rooms.broadcastState(room, io);
    })
  );

  socket.on("disconnect", () => {
    const room = rooms.markDisconnected(socket.id);
    if (room) rooms.broadcastState(room, io);
  });
});

server.listen(PORT, () => {
  console.log(`Pick the Pack server listening on port ${PORT}`);
});
