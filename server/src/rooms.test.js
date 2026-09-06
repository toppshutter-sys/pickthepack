"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager } = require("./rooms");

function seatRoom(names) {
  const rooms = new RoomManager();
  const room = rooms.createRoom({ hostSocketId: "s0", hostName: names[0], packAmount: 5 });
  for (let i = 1; i < names.length; i++) {
    rooms.joinRoom({ code: room.code, socketId: `s${i}`, playerName: names[i] });
  }
  return { rooms, room };
}

test("leaveRoom: removes the player from the lobby", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const after = rooms.leaveRoom(room.code, "s1");
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Cy"]);
});

test("leaveRoom: the last player leaving deletes the room", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  rooms.leaveRoom(room.code, "s0");
  const after = rooms.leaveRoom(room.code, "s1");
  assert.equal(after, null);
  assert.throws(() => rooms.startRound(room.code), /Room not found/);
});

test("leaveRoom: rejected mid-round — indices are load-bearing for an active hand", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  // Keep re-dealing until we land on a matching-phase round rather than an instant win.
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-active");
  assert.throws(() => rooms.leaveRoom(room.code, "s1"), /Can't leave mid-round/);
});

test("leaveRoom: dealerIndex shifts down when someone before the dealer leaves", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  room.dealerIndex = 2; // Cy deals
  const after = rooms.leaveRoom(room.code, "s0"); // Ann (index 0) leaves
  assert.deepEqual(after.players.map((p) => p.name), ["Bo", "Cy"]);
  assert.equal(after.dealerIndex, 1); // still points at Cy
});

test("leaveRoom: dealerIndex clamps to 0 when the last-seated dealer leaves", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  room.dealerIndex = 2; // Cy deals
  const after = rooms.leaveRoom(room.code, "s2"); // Cy leaves
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Bo"]);
  assert.equal(after.dealerIndex, 0);
});

test("leaveRoom: leaving between hands (round-over) resets the room to a fresh lobby", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-over");
  const after = rooms.leaveRoom(room.code, "s1");
  assert.equal(after.status, "lobby");
  assert.equal(after.round, null);
});

test("leaveRoom: unknown room throws", () => {
  const rooms = new RoomManager();
  assert.throws(() => rooms.leaveRoom("NOPE1", "s0"), /Room not found/);
});

test("leaveRoom: a socket not seated in the room throws", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  assert.throws(() => rooms.leaveRoom(room.code, "stranger"), /not seated/);
});

test("startRound: from the lobby (no winner yet), any seated player may start it", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  // Any of the three socket ids should be accepted for the very first round.
  const after = rooms.startRound(room.code, "s2");
  assert.notEqual(after.status, "lobby");
});

test("startRound: after a round ends, only the winner (now dealerIndex) may deal the next one", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r;
  do {
    r = rooms.startRound(room.code, "s0");
  } while (r.status !== "round-over");

  const winnerSocketId = `s${r.dealerIndex}`;
  const loserSocketId = r.dealerIndex === 0 ? "s1" : "s0";

  assert.throws(
    () => rooms.startRound(room.code, loserSocketId),
    /who won the last round, can deal the next one/
  );
  // The winner themself is unaffected by that rejection and can still deal.
  assert.doesNotThrow(() => rooms.startRound(room.code, winnerSocketId));
});

test("startRound: omitting socketId (internal/test callers) skips the winner check", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-over");
  // No socketId passed — should not throw even though a winner is set.
  assert.doesNotThrow(() => rooms.startRound(room.code));
});
