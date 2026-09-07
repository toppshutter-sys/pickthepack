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

/** Re-deals until the round lands on a dealer's-card win (awaiting-recast). */
function forceAwaitingRecast(rooms, room) {
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "awaiting-recast");
  return r;
}

test("recastBet: a dealer's-card win pauses the round without ending it or re-dealing", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceAwaitingRecast(rooms, room);
  assert.equal(r.round.phase, "dealer-card-win");
  assert.ok(r.round.faceUpCard.rank === "J" || r.round.faceUpCard.rank === "6");
  assert.equal(r.potAmount, 0); // paid out to the dealer already
  assert.ok(r.round.wonAmount > 0);
  assert.equal(r.dealerIndex, room.dealerIndex); // dealer unchanged — they keep dealing
});

test("recastBet: the round only proceeds once every connected player has recast", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const before = forceAwaitingRecast(rooms, room);
  const originalHands = before.round.hands;

  let after = rooms.recastBet(room.code, "s0");
  assert.equal(after.status, "awaiting-recast", "still waiting on Bo and Cy");
  after = rooms.recastBet(room.code, "s1");
  assert.equal(after.status, "awaiting-recast", "still waiting on Cy");
  after = rooms.recastBet(room.code, "s2");
  // Everyone's recast now — should have moved on (to another
  // awaiting-recast if it repeated, or to round-active/round-over).
  assert.notEqual(after.status, "lobby");
  if (after.status === "awaiting-recast") {
    assert.deepEqual(after.round.hands, originalHands, "no re-deal on a repeat");
  } else {
    assert.deepEqual(after.round.hands, originalHands, "same hands carried into the real round");
  }
});

test("recastBet: ante is collected again from everyone on the recast", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceAwaitingRecast(rooms, room);
  const contributedBefore = room.players.map((p) => p.totalContributed);

  rooms.recastBet(room.code, "s0");
  rooms.recastBet(room.code, "s1");
  const after = rooms.recastBet(room.code, "s2");

  after.players.forEach((p, i) => {
    assert.equal(p.totalContributed, contributedBefore[i] + room.packAmount);
  });
});

test("recastBet: rejected when nothing is awaiting recast", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  assert.throws(() => rooms.recastBet(room.code, "s0"), /Nothing to recast right now/);
});

test("recastBet: rejected for a socket not seated in the room", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceAwaitingRecast(rooms, room);
  assert.throws(() => rooms.recastBet(room.code, "stranger"), /not seated/);
});

test("recastBet: a disconnected player is skipped, not waited on", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceAwaitingRecast(rooms, room);
  rooms.markDisconnected("s2"); // Cy vanishes instead of recasting
  rooms.recastBet(room.code, "s0");
  const after = rooms.recastBet(room.code, "s1");
  // Only Ann and Bo needed to recast — Cy being disconnected shouldn't
  // block progress. It may legitimately land right back on another
  // dealer-card-win (a fresh cycle) — the thing to prove is that it's a
  // NEW cycle (recastReady reset), not the same one still stuck on Cy.
  if (after.status === "awaiting-recast") {
    assert.equal(after.recastReady.size, 0, "fresh cycle, not still stuck waiting on this one");
  }
});

test("recastBet: the last holdout disconnecting resolves the wait automatically", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceAwaitingRecast(rooms, room);
  rooms.recastBet(room.code, "s0");
  rooms.recastBet(room.code, "s1");
  // Cy is the only holdout — disconnecting them (instead of recasting)
  // should resolve the round rather than leaving it stuck forever (it
  // may legitimately land on a fresh dealer-card-win cycle instead).
  const after = rooms.markDisconnected("s2");
  if (after.status === "awaiting-recast") {
    assert.equal(after.recastReady.size, 0, "fresh cycle, not still stuck waiting on this one");
  }
});

test("leaveRoom: rejected during awaiting-recast — same load-bearing-indices reasoning as round-active", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceAwaitingRecast(rooms, room);
  assert.throws(() => rooms.leaveRoom(room.code, "s1"), /Can't leave mid-round/);
});

test("joinRoom: allowed between hands (round-over), not just from the lobby", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-over");
  const after = rooms.joinRoom({ code: room.code, socketId: "late", playerName: "Cy" });
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Bo", "Cy"]);
});

test("joinRoom: rejected mid-round (round-active) — no hand to slot a new player into", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-active");
  assert.throws(
    () => rooms.joinRoom({ code: room.code, socketId: "late", playerName: "Cy" }),
    /Round already in progress/
  );
});

test("joinRoom: rejected during awaiting-recast", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceAwaitingRecast(rooms, room);
  assert.throws(
    () => rooms.joinRoom({ code: room.code, socketId: "late", playerName: "Dee" }),
    /Round already in progress/
  );
});

test("joinRoom: capped at 6 players even between hands", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy", "Dee", "Eve", "Fay"]);
  assert.throws(
    () => rooms.joinRoom({ code: room.code, socketId: "s6", playerName: "Gus" }),
    /Room is full/
  );
});

test("joinRoom: rejected when the name is already taken at this table", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  assert.throws(
    () => rooms.joinRoom({ code: room.code, socketId: "s2", playerName: "Ann" }),
    /already at this table/
  );
});

test("joinRoom: name uniqueness is case-insensitive", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  assert.throws(
    () => rooms.joinRoom({ code: room.code, socketId: "s2", playerName: "ann" }),
    /already at this table/
  );
  assert.throws(
    () => rooms.joinRoom({ code: room.code, socketId: "s2", playerName: "ANN" }),
    /already at this table/
  );
});

test("joinRoom: a genuinely different name is unaffected by the uniqueness check", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  const after = rooms.joinRoom({ code: room.code, socketId: "s2", playerName: "Cy" });
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Bo", "Cy"]);
});

test("rejoinRoom: reclaims a disconnected player's seat under a new socket id", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  rooms.markDisconnected("s0");
  const after = rooms.rejoinRoom({ code: room.code, socketId: "s0-new", playerName: "Ann" });
  const ann = after.players.find((p) => p.name === "Ann");
  assert.equal(ann.id, "s0-new");
  assert.equal(ann.connected, true);
  assert.equal(after.players.length, 2, "reclaims the existing seat, doesn't add a new one");
});

test("rejoinRoom: matching is case-insensitive", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  rooms.markDisconnected("s0");
  const after = rooms.rejoinRoom({ code: room.code, socketId: "s0-new", playerName: "ann" });
  assert.equal(after.players.find((p) => p.name === "Ann").connected, true);
});

test("rejoinRoom: a socket for a still-connected player can also refresh its id (idempotent)", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  const after = rooms.rejoinRoom({ code: room.code, socketId: "s0-refreshed", playerName: "Ann" });
  assert.equal(after.players.find((p) => p.name === "Ann").id, "s0-refreshed");
});

test("rejoinRoom: throws when no seat matches that name", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  assert.throws(
    () => rooms.rejoinRoom({ code: room.code, socketId: "s9", playerName: "Zed" }),
    /No matching seat/
  );
});

test("rejoinRoom: throws for an unknown room code", () => {
  const rooms = new RoomManager();
  assert.throws(
    () => rooms.rejoinRoom({ code: "NOPE1", socketId: "s0", playerName: "Ann" }),
    /Room not found/
  );
});

test("rejoinRoom: works mid-round too — a reconnect shouldn't be blocked the way a fresh join is", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-active");
  rooms.markDisconnected("s1");
  const after = rooms.rejoinRoom({ code: room.code, socketId: "s1-new", playerName: "Bo" });
  assert.equal(after.players.find((p) => p.name === "Bo").connected, true);
});
