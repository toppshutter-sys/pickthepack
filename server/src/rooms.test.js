"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager, FLIP_COOLDOWN_MS, KNOCK_COOLDOWN_MS, HISTORY_LIMIT, STARTING_BALANCE } = require("./rooms");
const engine = require("./gameEngine");
const { findMandatoryKnock } = engine;
const c = engine.makeCard;

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

test("leaveRoom: the very last player leaving deletes the room", () => {
  const { rooms, room } = seatRoom(["Ann"]);
  const after = rooms.leaveRoom(room.code, "s0");
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

test("leaveRoom: when a non-host leaves and only the host remains, the host's table stays open in the lobby", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]); // Ann (s0) is the host
  const after = rooms.leaveRoom(room.code, "s1"); // Bo leaves
  assert.deepEqual(after.players.map((p) => p.name), ["Ann"]);
  assert.equal(after.status, "lobby");
  assert.equal(after.round, null);
});

test("leaveRoom: when the host leaves and only a non-host remains, the table stays open for them too", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]); // Ann (s0) is the host
  const after = rooms.leaveRoom(room.code, "s0"); // Ann (host) leaves
  assert.notEqual(after, null, "the room stays open — the host has no special claim to keep it alive that Bo lacks");
  assert.deepEqual(after.players.map((p) => p.name), ["Bo"]);
  assert.equal(after.status, "lobby");
  assert.equal(after.round, null);
  // Still just one player — a round genuinely can't start yet, but the
  // table itself is alive and waiting, not deleted out from under Bo.
  assert.throws(() => rooms.startRound(room.code), /Need at least 2 players/);
});

test("leaveRoom: a disconnected (not left) player still counts as present — table doesn't close on the other player", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]); // Ann is host
  rooms.markDisconnected("s0"); // Ann's connection dropped, but she's still seated (disconnect, not leave)
  const after = rooms.leaveRoom(room.code, "s1"); // Bo leaves
  // Two players still remain (Ann disconnected + Cy connected) — not
  // actually down to one, so the solo-player lobby-reset never fires.
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Cy"]);
});

test("_netFor: a fresh player's net is STARTING_BALANCE, not 0", () => {
  const { rooms, room } = seatRoom(["Ann"]);
  assert.equal(rooms._netFor(room.players[0]), STARTING_BALANCE);
});

test("bootIneligiblePlayers: leaves everyone alone when every net covers the ante", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]); // packAmount 5, all fresh at STARTING_BALANCE
  const booted = rooms.bootIneligiblePlayers(room.code);
  assert.deepEqual(booted, []);
  assert.equal(room.players.length, 3);
});

test("bootIneligiblePlayers: removes a connected player whose net can't cover the ante", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]); // packAmount 5
  // Drive Bo's net down to 4 (< the $5 ante) without touching anyone else.
  room.players[1].totalContributed = STARTING_BALANCE - 4;
  const booted = rooms.bootIneligiblePlayers(room.code);
  assert.deepEqual(booted, [{ socketId: "s1", name: "Bo" }]);
  assert.deepEqual(room.players.map((p) => p.name), ["Ann", "Cy"]);
});

test("bootIneligiblePlayers: a disconnected player is left alone, not booted", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  room.players[1].totalContributed = STARTING_BALANCE - 4; // Bo can't afford it...
  rooms.markDisconnected("s1"); // ...but is already gone from play, not actively at risk
  const booted = rooms.bootIneligiblePlayers(room.code);
  assert.deepEqual(booted, []);
  assert.equal(room.players.length, 3);
});

test("bootIneligiblePlayers: dealerIndex is reindexed the same way leaveRoom does", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  room.dealerIndex = 2; // Cy deals
  room.players[0].totalContributed = STARTING_BALANCE - 4; // Ann (index 0) can't afford it
  rooms.bootIneligiblePlayers(room.code);
  assert.deepEqual(room.players.map((p) => p.name), ["Bo", "Cy"]);
  assert.equal(room.dealerIndex, 1); // still points at Cy
});

test("bootIneligiblePlayers: booting down to one player resets the table to a fresh lobby", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  room.players[1].totalContributed = STARTING_BALANCE - 4; // Bo can't afford it
  const booted = rooms.bootIneligiblePlayers(room.code);
  assert.deepEqual(booted, [{ socketId: "s1", name: "Bo" }]);
  assert.deepEqual(room.players.map((p) => p.name), ["Ann"]);
  assert.equal(room.status, "lobby");
});

test("bootIneligiblePlayers: booting the last remaining player deletes the room", () => {
  const { rooms, room } = seatRoom(["Ann"]);
  room.players[0].totalContributed = STARTING_BALANCE - 4;
  const booted = rooms.bootIneligiblePlayers(room.code);
  assert.deepEqual(booted, [{ socketId: "s0", name: "Ann" }]);
  assert.throws(() => rooms.startRound(room.code), /Room not found/);
});

test("bootIneligiblePlayers: unknown room returns an empty list rather than throwing", () => {
  const rooms = new RoomManager();
  assert.deepEqual(rooms.bootIneligiblePlayers("NOPE1"), []);
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
  const { room: after } = rooms.markDisconnected("s2");
  if (after.status === "awaiting-recast") {
    assert.equal(after.recastReady.size, 0, "fresh cycle, not still stuck waiting on this one");
  }
});

/** Re-deals until a round resolves outright (instant win or dealer's-card win having already recast through) into round-over. */
function forceRoundOver(rooms, room) {
  let r;
  do {
    // This loop discards a "round-active" attempt wholesale and just
    // redeals — no matching-phase play is simulated — but startRound
    // still antes on every single attempt, not just the one that finally
    // sticks. Reset financials before each try, or a run of bad luck can
    // inflate totalContributed far past what a genuine round ever would,
    // tripping the ante-eligibility check (see bootIneligiblePlayers) on
    // a player who never actually got charged more than once for real.
    room.potAmount = 0;
    for (const p of room.players) {
      p.totalContributed = 0;
      p.totalWon = 0;
    }
    r = rooms.startRound(room.code);
  } while (r.status !== "round-over");
  return r;
}

test("readyForNextRound: the next round only deals once every connected player has readied up", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  const contributedBefore = room.players.map((p) => p.totalContributed);

  let { room: after } = rooms.readyForNextRound(room.code, "s0");
  assert.equal(after.status, "round-over", "still waiting on Bo and Cy");
  ({ room: after } = rooms.readyForNextRound(room.code, "s1"));
  assert.equal(after.status, "round-over", "still waiting on Cy");
  ({ room: after } = rooms.readyForNextRound(room.code, "s2"));
  // Everyone's readied up now — a fresh hand should have dealt. Checked
  // via ante collection, not `status !== "round-over"` — the fresh deal
  // can itself land right back on an instant win (a real, ~1-in-5-ish
  // outcome, not a bug), which would make that assertion flaky.
  after.players.forEach((p, i) => {
    assert.equal(p.totalContributed, contributedBefore[i] + room.packAmount);
  });
});

test("readyForNextRound: ante is collected from everyone once the next round deals", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  const contributedBefore = room.players.map((p) => p.totalContributed);

  rooms.readyForNextRound(room.code, "s0");
  rooms.readyForNextRound(room.code, "s1");
  const { room: after } = rooms.readyForNextRound(room.code, "s2");

  after.players.forEach((p, i) => {
    assert.equal(p.totalContributed, contributedBefore[i] + room.packAmount);
  });
});

test("readyForNextRound: rejected when the round isn't actually over", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  assert.throws(() => rooms.readyForNextRound(room.code, "s0"), /Nothing to ante up for right now/);
});

test("readyForNextRound: rejected for a socket not seated in the room", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  assert.throws(() => rooms.readyForNextRound(room.code, "stranger"), /not seated/);
});

test("readyForNextRound: a disconnected player is skipped, not waited on", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  const contributedBefore = room.players.map((p) => p.totalContributed);
  rooms.markDisconnected("s2"); // Cy vanishes instead of anteing up
  rooms.readyForNextRound(room.code, "s0");
  const { room: after } = rooms.readyForNextRound(room.code, "s1");
  // Only Ann and Bo needed to ready up — Cy being disconnected shouldn't
  // block progress. Checked via ante collection, not `status !==
  // "round-over"` — the fresh deal can itself land right back on an
  // instant win (a real, ~1-in-5-ish outcome, not a bug), which would
  // make that assertion flaky.
  assert.equal(after.players[0].totalContributed, contributedBefore[0] + room.packAmount);
  assert.equal(after.players[1].totalContributed, contributedBefore[1] + room.packAmount);
});

test("readyForNextRound: the last holdout disconnecting resolves the wait automatically", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  const contributedBefore = room.players.map((p) => p.totalContributed);
  rooms.readyForNextRound(room.code, "s0");
  rooms.readyForNextRound(room.code, "s1");
  // Cy is the only holdout — disconnecting them (instead of anteing up)
  // should resolve the wait rather than leaving it stuck forever. Same
  // ante-collection check as above, for the same reason.
  const { room: after } = rooms.markDisconnected("s2");
  assert.equal(after.players[0].totalContributed, contributedBefore[0] + room.packAmount);
  assert.equal(after.players[1].totalContributed, contributedBefore[1] + room.packAmount);
});

test("readyForNextRound: a player who can no longer afford the ante is booted before the next deal", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  const bo = room.players.find((p) => p.name === "Bo");
  // Bo may have won the forced round (forceRoundOver doesn't control who
  // wins) — reset totalWon too, or a large enough win could offset this
  // override and leave Bo eligible after all.
  bo.totalWon = 0;
  bo.totalContributed = STARTING_BALANCE - 4; // net = 50 + 0 - 46 = 4, can't cover the $5 ante

  rooms.readyForNextRound(room.code, "s0");
  const { room: after, booted } = rooms.readyForNextRound(room.code, "s2");
  assert.deepEqual(booted, [{ socketId: "s1", name: "Bo" }]);
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Cy"]);
});

test("toPlayerState: exposes nextRoundReady the same shape as recastReady", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundOver(rooms, room);
  const state = rooms.toPlayerState(room, "s0");
  // 3 players, only one of whom (Ann) has readied up here — with a 3rd
  // player in the mix, one confirmation can never complete the wait on
  // its own, so this can't land on the same "already dealt/booted before
  // we got to look" ambiguity a 2-player table risks (forceRoundOver's
  // own redeal loop collects ante on every failed attempt, same as a
  // real round would — with enough retries that alone can legitimately
  // exhaust STARTING_BALANCE, which is a real, expected interaction with
  // the eligibility check, not a bug in either).
  assert.deepEqual(state.round.nextRoundReady, [false, false, false]);
  rooms.readyForNextRound(room.code, "s0");
  assert.deepEqual(rooms.toPlayerState(room, "s0").round.nextRoundReady, [true, false, false]);
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

/**
 * Re-deals until the round lands in the Matching Phase (round-active) AND
 * the flip-turn player has no mandatory match sitting in their hand — the
 * cooldown tests below need a flip attempt to actually reach tapDeck's
 * cooldown check rather than being turned away first by the engine's own
 * "you must knock instead" rule, which a randomly dealt hand can otherwise
 * trigger and make these tests flaky.
 */
function forceRoundActive(rooms, room) {
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (
    r.status !== "round-active" ||
    findMandatoryKnock(r.round.hands[r.round.turnIndex], r.round.faceUpCard.rank)
  );
  return r;
}

test("tapDeck: rejected when attempted before the flip cooldown has elapsed", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  // The cooldown baseline is set the instant the round starts, so the
  // player whose turn it is can't flip immediately either.
  const turnSocketId = `s${r.round.turnIndex}`;
  assert.throws(() => rooms.tapDeck(room.code, turnSocketId), /moment to look/);
});

test("tapDeck: succeeds once the cooldown has elapsed", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  // Backdate lastFlipAt directly instead of sleeping in the test — same
  // effect as real time having passed, without slowing the suite down.
  room.lastFlipAt = Date.now() - (FLIP_COOLDOWN_MS + 100);
  const turnSocketId = `s${r.round.turnIndex}`;
  assert.doesNotThrow(() => rooms.tapDeck(room.code, turnSocketId));
});

test("tapDeck: a second flip right after a successful one is rejected again", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  room.lastFlipAt = Date.now() - (FLIP_COOLDOWN_MS + 100);
  const after = rooms.tapDeck(room.code, `s${r.round.turnIndex}`);
  // A plain flip never auto-knocks or ends the round (flipping always
  // opens the revealed card to the free-for-all — see gameEngine.js), so
  // the round is always still active here.
  assert.equal(after.status, "round-active");
  // Whoever's turn it is now (advanced by the flip) tries again immediately.
  const nextTurnSocketId = `s${after.round.turnIndex}`;
  assert.throws(() => rooms.tapDeck(room.code, nextTurnSocketId), /moment to look/);
});

test("tapCard: knocking is independent of the flip cooldown (lastFlipAt) — only its own knock cooldown applies", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  // lastFlipAt is fresh (round just started) — knocking should be entirely
  // unaffected by it. Backdate ONLY lastTargetAt (the knock cooldown's own
  // baseline, tested separately below) so this test isolates "the flip
  // cooldown doesn't gate knocking" from the knock cooldown itself. Pick a
  // card whose rank is guaranteed not to match the target (a random card
  // from the hand could legitimately match and knock successfully, which
  // would make this assertion flaky) so we can confirm we get the engine's
  // own "no match" style error, not either cooldown's error.
  room.lastTargetAt = Date.now() - (KNOCK_COOLDOWN_MS + 100);
  const nonTurnPlayerIdx = (r.round.turnIndex + 1) % 3;
  const targetRank = r.round.faceUpCard.rank;
  const nonMatchingCard = r.round.hands[nonTurnPlayerIdx].find((c) => c.rank !== targetRank);
  assert.ok(nonMatchingCard, "expected at least one non-matching card in the test hand");
  assert.throws(
    () => rooms.tapCard(room.code, `s${nonTurnPlayerIdx}`, nonMatchingCard.id, r.round.faceUpCard.id),
    (err) => !/moment to look/.test(err.message) && !/moment to see/.test(err.message)
  );
});

test("tapDeck: flipping is independent of the knock cooldown (lastTargetAt) — only its own flip cooldown applies", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  // lastTargetAt is fresh (round just started) — flipping should be
  // entirely unaffected by it, only by lastFlipAt (backdated here).
  room.lastFlipAt = Date.now() - (FLIP_COOLDOWN_MS + 100);
  assert.doesNotThrow(() => rooms.tapDeck(room.code, `s${r.round.turnIndex}`));
});

test("toPlayerState: exposes flipAvailableAt derived from lastFlipAt", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundActive(rooms, room);
  const state = rooms.toPlayerState(room, "s0");
  assert.equal(state.round.flipAvailableAt, room.lastFlipAt + FLIP_COOLDOWN_MS);
});

test("toPlayerState: exposes knockAvailableAt derived from lastTargetAt", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundActive(rooms, room);
  const state = rooms.toPlayerState(room, "s0");
  assert.equal(state.round.knockAvailableAt, room.lastTargetAt + KNOCK_COOLDOWN_MS);
});

test("startRound: resets the flip cooldown baseline when the Matching Phase begins", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundActive(rooms, room);
  room.lastFlipAt = 0; // simulate a stale baseline from a prior round
  const before = Date.now();
  forceRoundActive(rooms, room); // re-deals until Matching Phase begins again
  assert.ok(room.lastFlipAt >= before);
});

test("startRound: resets the knock cooldown baseline when the Matching Phase begins", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  forceRoundActive(rooms, room);
  room.lastTargetAt = 0; // simulate a stale baseline from a prior round
  const before = Date.now();
  forceRoundActive(rooms, room);
  assert.ok(room.lastTargetAt >= before);
});

/**
 * Re-deals until the round lands in the Matching Phase AND at least one
 * player (any seat, regardless of turn) holds a genuine mandatory match
 * against the target — the knock cooldown tests need a real matching card
 * to knock, not just any card, to isolate the cooldown from the engine's
 * own "doesn't match" rejection.
 */
function forceRoundActiveWithMatch(rooms, room) {
  let r;
  let matchInfo;
  do {
    r = rooms.startRound(room.code);
    matchInfo = undefined;
    if (r.status === "round-active") {
      const targetRank = r.round.faceUpCard.rank;
      for (let i = 0; i < r.round.hands.length; i++) {
        const m = findMandatoryKnock(r.round.hands[i], targetRank);
        if (m) {
          matchInfo = { playerIdx: i, card: m };
          break;
        }
      }
    }
  } while (r.status !== "round-active" || !matchInfo);
  return { r, matchInfo };
}

test("tapCard: rejected when attempted before the knock cooldown has elapsed", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const { matchInfo } = forceRoundActiveWithMatch(rooms, room);
  // lastTargetAt is fresh (round just started) — even a genuinely matching
  // card should be turned away by the cooldown, not accepted.
  assert.throws(
    () => rooms.tapCard(room.code, `s${matchInfo.playerIdx}`, matchInfo.card.id, null),
    /moment to see/
  );
});

test("tapCard: succeeds once the knock cooldown has elapsed", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const { matchInfo } = forceRoundActiveWithMatch(rooms, room);
  room.lastTargetAt = Date.now() - (KNOCK_COOLDOWN_MS + 100);
  assert.doesNotThrow(() => rooms.tapCard(room.code, `s${matchInfo.playerIdx}`, matchInfo.card.id, null));
});

test("tapCard: a pending placement is reported as such, not misreported as the knock cooldown", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const { matchInfo } = forceRoundActiveWithMatch(rooms, room);
  room.lastTargetAt = Date.now() - (KNOCK_COOLDOWN_MS + 100);
  const after = rooms.tapCard(room.code, `s${matchInfo.playerIdx}`, matchInfo.card.id, null);
  if (after.round.pendingPlacement === null || after.round.pendingPlacement === undefined) {
    return; // this particular knock didn't leave a placement pending — nothing to check here
  }
  const anotherPlayerIdx = (matchInfo.playerIdx + 1) % 3;
  assert.throws(
    () => rooms.tapCard(room.code, `s${anotherPlayerIdx}`, "does-not-matter", null),
    /Waiting for a new target card to be placed/
  );
});

test("tapDeck: a pending placement is reported as such, not misreported as the flip cooldown", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const { matchInfo } = forceRoundActiveWithMatch(rooms, room);
  room.lastTargetAt = Date.now() - (KNOCK_COOLDOWN_MS + 100);
  const after = rooms.tapCard(room.code, `s${matchInfo.playerIdx}`, matchInfo.card.id, null);
  if (after.round.pendingPlacement === null || after.round.pendingPlacement === undefined) {
    return; // this particular knock didn't leave a placement pending — nothing to check here
  }
  // lastFlipAt is fresh (round just started) — before this was fixed,
  // tapDeck's cooldown check ran before any pendingPlacement check and
  // would have wrongly reported this as "try again in a second" instead
  // of the accurate "waiting for a new target" message.
  assert.throws(
    () => rooms.tapDeck(room.code, `s${after.round.turnIndex}`),
    /Waiting for a new target card to be placed/
  );
});

test("toPlayerState: flipPriorityIdx is null for the opening dealt target, set to the flipper after a plain flip", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  let state = rooms.toPlayerState(room, "s0");
  assert.equal(state.round.flipPriorityIdx, null, "nobody flipped the opening target — it was dealt");

  room.lastFlipAt = Date.now() - (FLIP_COOLDOWN_MS + 100);
  const flipperIdx = r.round.turnIndex;
  rooms.tapDeck(room.code, `s${flipperIdx}`);
  state = rooms.toPlayerState(room, "s0");
  assert.equal(state.round.flipPriorityIdx, flipperIdx);
});

test("tapCard: the player who just flipped this target may knock it immediately, bypassing the knock cooldown", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  room.lastFlipAt = Date.now() - (FLIP_COOLDOWN_MS + 100);
  const flipperIdx = r.round.turnIndex;
  const after = rooms.tapDeck(room.code, `s${flipperIdx}`);
  // lastTargetAt is fresh (the flip just happened) — an ordinary player
  // would be turned away by the cooldown here. Use a non-matching card so
  // a successful pass-through surfaces the engine's own "doesn't match"
  // rejection, not a cooldown error — proving the cooldown check itself
  // was bypassed, not that this particular tap happened to be legal.
  const nonMatchingCard = after.round.hands[flipperIdx].find((c) => c.rank !== after.round.faceUpCard.rank);
  assert.ok(nonMatchingCard, "expected at least one non-matching card in the flipper's hand");
  assert.throws(
    () => rooms.tapCard(room.code, `s${flipperIdx}`, nonMatchingCard.id, null),
    (err) => !/moment to see/.test(err.message) && /doesn't match the target/.test(err.message)
  );
});

test("tapCard: a different player still has to wait out the cooldown on a card someone else just flipped", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  const r = forceRoundActive(rooms, room);
  room.lastFlipAt = Date.now() - (FLIP_COOLDOWN_MS + 100);
  const flipperIdx = r.round.turnIndex;
  const otherIdx = (flipperIdx + 1) % 3;
  rooms.tapDeck(room.code, `s${flipperIdx}`);
  assert.throws(() => rooms.tapCard(room.code, `s${otherIdx}`, "does-not-matter", null), /moment to see/);
});

test("tapCard: a knock's deck-refill also resets the flip cooldown, not just the knock cooldown", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  // Force the knocker's hand down to exactly 2 cards (the matching card
  // plus one other of a different rank, so it doesn't form a settled pair
  // and turn this into an outright win instead) so this specific knock
  // lands on the "1 card left" refill branch, which draws a real card
  // from the deck. Retried: the refill draw is random and can itself
  // happen to match the remaining card's rank, chaining into an outright
  // win instead (a legitimate, separately-tested behavior — see the
  // "priority chains" test in gameEngine.test.js) — re-roll until this
  // particular attempt lands cleanly on the refill this test cares about.
  let after;
  for (let attempt = 0; attempt < 50; attempt++) {
    const { matchInfo } = forceRoundActiveWithMatch(rooms, room);
    room.lastTargetAt = Date.now() - (KNOCK_COOLDOWN_MS + 100);
    const otherCard = room.round.hands[matchInfo.playerIdx].find(
      (c) => c.id !== matchInfo.card.id && c.rank !== matchInfo.card.rank
    );
    room.round.hands[matchInfo.playerIdx] = [matchInfo.card, otherCard];
    // A stale lastFlipAt, as if the last MANUAL flip was long ago — this is
    // exactly what let tapDeck bypass its own cooldown right after a
    // refill, before this was fixed.
    room.lastFlipAt = Date.now() - 60000;
    after = rooms.tapCard(room.code, `s${matchInfo.playerIdx}`, matchInfo.card.id, null);
    if (after.round.action.type === "knock-deck-refill") break;
  }
  assert.equal(after.round.action.type, "knock-deck-refill", "expected this specific knock to trigger the deck refill");
  assert.ok(room.lastFlipAt > Date.now() - 100, "lastFlipAt should have been reset by the refill's real deck draw");
  assert.throws(() => rooms.tapDeck(room.code, `s${after.round.turnIndex}`), /moment to look/);
});

test("createRoom: starts with an empty round history", () => {
  const { room } = seatRoom(["Ann", "Bo"]);
  assert.deepEqual(room.history, []);
});

test("_resolveTarget: a single-winner instant win appends a history entry", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r, guard = 0;
  do {
    // An intermediate attempt that lands on round-active (matching phase,
    // not yet resolved) leaves its ante uncollected-for — reset before
    // each redeal so a string of failed attempts doesn't pile ante on top
    // of ante and inflate the pot the eventual winning deal reports.
    room.potAmount = 0;
    r = rooms.startRound(room.code);
    guard++;
  } while (
    !(r.status === "round-over" && r.round.phase === "instant-win" && r.round.winnerIndices.length === 1) &&
    guard < 1000
  );
  assert.ok(guard < 1000, "expected a single-winner instant win within the retry budget");

  const entry = room.history[room.history.length - 1];
  const winnerName = room.players[r.round.winnerIndices[0]].name;
  assert.deepEqual(entry.winners, [winnerName]);
  assert.equal(entry.potAmount, room.packAmount * 3, "3 players anted in before this win");
  assert.equal(entry.packAmount, room.packAmount);
  assert.equal(typeof entry.method, "string");
  assert.notEqual(entry.method, "Matched their whole hand", "should use the instant-win category label, not the matching-phase one");
  assert.ok(entry.at <= Date.now() && entry.at > Date.now() - 5000);
});

test("_resolveTarget: an instant-win split pot lists every winner in one history entry", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  // Two same-suit (hearts) flushes with equal totals (21 each) — a genuine
  // tie per evaluateInstantWin's own flush tiebreak (breakInstantWinTie),
  // constructed directly rather than hoping a natural deal produces one,
  // since a genuine tie is rare enough to make a redeal-loop impractical.
  const hands = [
    [c("3", "hearts"), c("8", "hearts"), c("10", "hearts")], // flush, total 21
    [c("4", "hearts"), c("6", "hearts"), c("J", "hearts")], // flush, total 21
  ];
  const deck = [c("2", "spades")]; // dummy — just needs a non-J/6 top card
  rooms._collectAnte(room);
  rooms._resolveTarget(room, hands, deck);

  assert.equal(room.status, "round-over");
  const entry = room.history[room.history.length - 1];
  assert.deepEqual([...entry.winners].sort(), ["Ann", "Bo"]);
  assert.equal(entry.potAmount, room.packAmount * 2);
});

/** Plays the matching phase out (via the bot-style playMatchingTurn helper) until someone wins by matching their whole hand. */
function forceMatchedOutWin(rooms, room) {
  let steps = 0;
  while ((room.round.winnerIndex === null || room.round.winnerIndex === undefined) && steps < 500) {
    const actingPlayer = room.players[room.round.turnIndex];
    const after = engine.playMatchingTurn(room.round);
    rooms._applyTurnResult(room, actingPlayer, after);
    steps++;
  }
  return steps;
}

test("_applyTurnResult: a matched-out win appends a history entry with 'Matched their whole hand'", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r, guard = 0;
  do {
    r = rooms.startRound(room.code);
    guard++;
  } while (r.status !== "round-active" && guard < 500);
  assert.ok(guard < 500, "expected a matching-phase round within the retry budget");

  const steps = forceMatchedOutWin(rooms, room);
  assert.ok(steps < 500, "expected the matching phase to converge to a winner");
  assert.equal(room.status, "round-over");

  const entry = room.history[room.history.length - 1];
  assert.equal(entry.method, "Matched their whole hand");
  assert.deepEqual(entry.winners, [room.players[room.round.winnerIndex].name]);
});

test("history: caps at HISTORY_LIMIT entries, dropping the oldest first", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    rooms._addHistoryEntry(room, { winners: [`Winner${i}`], potAmount: 10, method: "Test" });
  }
  assert.equal(room.history.length, HISTORY_LIMIT);
  assert.equal(room.history[0].winners[0], "Winner5", "the oldest 5 entries should have been dropped");
  assert.equal(room.history[room.history.length - 1].winners[0], `Winner${HISTORY_LIMIT + 4}`);
});

test("toPlayerState: exposes the room's history", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  rooms._addHistoryEntry(room, { winners: ["Ann"], potAmount: 10, method: "Same-Suit (Flush)" });
  const state = rooms.toPlayerState(room, "s0");
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.history[0].winners, ["Ann"]);
  assert.equal(state.history[0].method, "Same-Suit (Flush)");
});

test("toPlayerState: exposes startingBalance so the client can compute each player's real net", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]);
  const state = rooms.toPlayerState(room, "s0");
  assert.equal(state.startingBalance, STARTING_BALANCE);
});

test("toPlayerState: exposes matchedCards so a matched-out winner's cards are still visible once their hand is empty", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r, guard = 0;
  do {
    r = rooms.startRound(room.code);
    guard++;
  } while (r.status !== "round-active" && guard < 500);
  assert.ok(guard < 500, "expected a matching-phase round within the retry budget");

  const steps = forceMatchedOutWin(rooms, room);
  assert.ok(steps < 500, "expected the matching phase to converge to a winner");

  const state = rooms.toPlayerState(room, "s1"); // Bo, a non-winner viewer
  const winnerIdx = room.dealerIndex; // the winner deals next
  assert.equal(state.round.hands[winnerIdx].length, 0, "the winner's hand is empty — everything was matched away");
  assert.ok(
    state.round.matchedCards[winnerIdx].length > 0,
    "but their matched cards are still tracked, visible to every player, not just the winner"
  );
});
