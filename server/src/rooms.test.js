"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager, FLIP_COOLDOWN_MS, KNOCK_COOLDOWN_MS } = require("./rooms");
const { findMandatoryKnock } = require("./gameEngine");

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
  const { room: after } = rooms.leaveRoom(room.code, "s1");
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Cy"]);
});

test("leaveRoom: the very last player leaving deletes the room", () => {
  const { rooms, room } = seatRoom(["Ann"]);
  const { room: after, closedFor } = rooms.leaveRoom(room.code, "s0");
  assert.equal(after, null);
  assert.equal(closedFor, null);
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
  const { room: after } = rooms.leaveRoom(room.code, "s0"); // Ann (index 0) leaves
  assert.deepEqual(after.players.map((p) => p.name), ["Bo", "Cy"]);
  assert.equal(after.dealerIndex, 1); // still points at Cy
});

test("leaveRoom: dealerIndex clamps to 0 when the last-seated dealer leaves", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  room.dealerIndex = 2; // Cy deals
  const { room: after } = rooms.leaveRoom(room.code, "s2"); // Cy leaves
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Bo"]);
  assert.equal(after.dealerIndex, 0);
});

test("leaveRoom: leaving between hands (round-over) resets the room to a fresh lobby", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]);
  let r;
  do {
    r = rooms.startRound(room.code);
  } while (r.status !== "round-over");
  const { room: after } = rooms.leaveRoom(room.code, "s1");
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
  const { room: after, closedFor } = rooms.leaveRoom(room.code, "s1"); // Bo leaves
  assert.equal(closedFor, null);
  assert.deepEqual(after.players.map((p) => p.name), ["Ann"]);
  assert.equal(after.status, "lobby");
  assert.equal(after.round, null);
});

test("leaveRoom: when the host leaves and only a non-host remains, their table closes and they're notified", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo"]); // Ann (s0) is the host
  const { room: after, closedFor } = rooms.leaveRoom(room.code, "s0"); // Ann (host) leaves
  assert.equal(after, null, "the room is gone, not left open for the non-host to sit in alone");
  assert.equal(closedFor, "s1", "Bo (the sole non-host remaining) is the one to notify");
  assert.throws(() => rooms.startRound(room.code), /Room not found/);
});

test("leaveRoom: a disconnected (not left) host still counts as present — table doesn't close on the other player", () => {
  const { rooms, room } = seatRoom(["Ann", "Bo", "Cy"]); // Ann is host
  rooms.markDisconnected("s0"); // host's connection dropped, but they're still seated (disconnect, not leave)
  const { room: after, closedFor } = rooms.leaveRoom(room.code, "s1"); // Bo leaves
  // Two players still remain (Ann disconnected + Cy connected) — not
  // actually down to one, so the solo-player closing logic never fires.
  assert.equal(closedFor, null);
  assert.deepEqual(after.players.map((p) => p.name), ["Ann", "Cy"]);
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
  if (after.status !== "round-active") {
    // Rare but legitimate: the flip's own auto-match chain (see the flip
    // priority rule in gameEngine.js) cleared the flipper's whole hand and
    // won the round outright on this single flip — there's no round left
    // to flip in at all, an even stronger "can't flip again" than the
    // cooldown, so the invariant this test cares about still holds.
    assert.equal(after.status, "round-over");
    return;
  }
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
