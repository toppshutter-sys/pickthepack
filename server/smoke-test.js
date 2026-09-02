"use strict";
/**
 * End-to-end smoke test (v4 — instant win + matching-phase fallback):
 * boots the real server, connects two socket.io clients, and drives many
 * full rounds via start-round -> (immediate result OR repeated take-turn)
 * -> next round, asserting:
 *   - each client only ever sees ITS OWN hand's real card values during
 *     an active matching phase, never an opponent's
 *   - instant-win rounds reveal all hands immediately (nothing to hide —
 *     the deal itself decided it)
 *   - the pot math (ante in, full payout out) is correct for both outcomes
 * Run with: node smoke-test.js
 */

const http = require("http");
const { Server } = require("socket.io");
const Client = require("socket.io-client");
const { RoomManager } = require("./src/rooms");
const { findMandatoryKnock } = require("./src/gameEngine");

const PORT = 4504;

function buildServer() {
  const server = http.createServer();
  const io = new Server(server, { cors: { origin: "*" } });
  const rooms = new RoomManager();

  io.on("connection", (socket) => {
    socket.on("create-room", ({ playerName, packAmount }, ack) => {
      try {
        const room = rooms.createRoom({ hostSocketId: socket.id, hostName: playerName, packAmount });
        socket.join(room.code);
        ack({ ok: true, code: room.code });
        rooms.broadcastState(room, io);
      } catch (e) { ack({ ok: false, error: e.message }); }
    });
    socket.on("join-room", ({ code, playerName }, ack) => {
      try {
        const room = rooms.joinRoom({ code, socketId: socket.id, playerName });
        socket.join(room.code);
        ack({ ok: true, code: room.code });
        rooms.broadcastState(room, io);
      } catch (e) { ack({ ok: false, error: e.message }); }
    });
    socket.on("start-round", ({ code }, ack) => {
      try {
        const room = rooms.startRound(code);
        ack({ ok: true });
        rooms.broadcastState(room, io);
      } catch (e) { ack({ ok: false, error: e.message }); }
    });
    socket.on("tap-card", ({ code, cardId, targetCardId }, ack) => {
      try {
        const room = rooms.tapCard(code, socket.id, cardId, targetCardId);
        ack({ ok: true });
        rooms.broadcastState(room, io);
      } catch (e) { ack({ ok: false, error: e.message }); }
    });
    socket.on("tap-deck", ({ code }, ack) => {
      try {
        const room = rooms.tapDeck(code, socket.id);
        ack({ ok: true });
        rooms.broadcastState(room, io);
      } catch (e) { ack({ ok: false, error: e.message }); }
    });
    socket.on("place-target", ({ code, cardId }, ack) => {
      try {
        const room = rooms.placeTarget(code, socket.id, cardId);
        ack({ ok: true });
        rooms.broadcastState(room, io);
      } catch (e) { ack({ ok: false, error: e.message }); }
    });
  });

  return { server };
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => {
      if (res && res.ok === false) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

function checkHandPrivacyDuringMatching(state, viewerIdx) {
  if (state.round.phase !== "matching" || state.status === "round-over") return; // nothing to hide otherwise
  state.round.hands.forEach((hand, i) => {
    if (i === viewerIdx) return;
    for (const card of hand) {
      assert(card === null, `viewer ${viewerIdx} should NOT see opponent ${i}'s real card mid-match, got ${JSON.stringify(card)}`);
    }
  });
}

let offTurnKnockCount = 0; // how many times a non-flip-turn player successfully knocked (free-for-all proof)
let placementCount = 0; // how many times a knocker had to choose their own next target card
let deckRefillOnOneCardCount = 0; // how many times the "only one card left" edge case drew from the deck instead

function checkHandsRevealed(state) {
  for (const hand of state.round.hands) {
    for (const card of hand) {
      assert(card !== null, "every hand should be fully revealed once the round is over");
    }
  }
}

async function playOneRound(alice, bob, code, packAmount) {
  const startP1 = new Promise((r) => alice.once("room-state", r));
  const startP2 = new Promise((r) => bob.once("room-state", r));
  await emitAck(alice, "start-round", { code });
  let [aliceState, bobState] = await Promise.all([startP1, startP2]);

  assert(aliceState.potAmount === (aliceState.round.phase === "instant-win" ? 0 : packAmount * 2),
    "pot should reflect both antes (already paid out if instant win)");
  checkHandPrivacyDuringMatching(aliceState, aliceState.you);
  checkHandPrivacyDuringMatching(bobState, bobState.you);

  if (aliceState.round.phase === "instant-win") {
    assert(aliceState.status === "round-over", "instant-win should resolve the round immediately");
    checkHandsRevealed(aliceState);
    checkHandsRevealed(bobState);
    assert(aliceState.round.winnerIndices && aliceState.round.winnerIndices.length >= 1, "should have winner(s)");
    console.log(`  INSTANT WIN: category=${aliceState.round.category} winners=[${aliceState.round.winnerIndices}]`);
    return aliceState;
  }

  let guard = 0;
  while (aliceState.status !== "round-over" && guard < 500) {
    guard++;
    const turnIdx = aliceState.round.turnIndex;
    const targetRank = aliceState.round.faceUpCard.rank;
    const targetId = aliceState.round.faceUpCard.id;

    // Matching is now a free-for-all: check BOTH players' own hands (each
    // only sees their own real cards, opponents are masked) for a
    // mandatory match, regardless of whose flip-turn it is — mirrors a real
    // player noticing their own match and tapping it at any moment.
    const aliceMatch = findMandatoryKnock(aliceState.round.hands[aliceState.you], targetRank);
    const bobMatch = findMandatoryKnock(bobState.round.hands[bobState.you], targetRank);

    // Extra coverage, once per round: confirm the player who does NOT hold
    // the flip-turn is rejected if they try to flip the deck anyway — the
    // free-for-all only applies to matching, never to flipping.
    if (guard === 1) {
      const nonTurnActor = turnIdx === aliceState.you ? bob : alice;
      try {
        await emitAck(nonTurnActor, "tap-deck", { code });
        throw new Error("expected tap-deck to be rejected for the non-flip-turn player");
      } catch (e) {
        assert(/not your turn to flip/.test(e.message), `expected a turn-order rejection, got: ${e.message}`);
      }
    }

    const p1 = new Promise((r) => alice.once("room-state", r));
    const p2 = new Promise((r) => bob.once("room-state", r));

    if (aliceMatch) {
      if (turnIdx !== aliceState.you) offTurnKnockCount++;
      await emitAck(alice, "tap-card", { code, cardId: aliceMatch.id, targetCardId: targetId });
    } else if (bobMatch) {
      if (turnIdx !== bobState.you) offTurnKnockCount++;
      await emitAck(bob, "tap-card", { code, cardId: bobMatch.id, targetCardId: targetId });
    } else {
      // Nobody has a match — only the flip-turn player may flip.
      const flipActor = turnIdx === aliceState.you ? alice : bob;
      await emitAck(flipActor, "tap-deck", { code });
    }
    [aliceState, bobState] = await Promise.all([p1, p2]);
    checkHandPrivacyDuringMatching(aliceState, aliceState.you);
    checkHandPrivacyDuringMatching(bobState, bobState.you);

    const latestLog = aliceState.log.length ? aliceState.log[aliceState.log.length - 1].message : "";
    if (/deck flipped a new target/.test(latestLog)) deckRefillOnOneCardCount++;

    // A knock that leaves 2+ cards no longer draws from the deck — the
    // knocker must choose one of their OWN remaining cards to place face-up
    // as the next target. Resolve that here before continuing the loop.
    while (aliceState.round.pendingPlacement !== null && aliceState.status !== "round-over") {
      placementCount++;
      const placerIdx = aliceState.round.pendingPlacement;
      const placer = placerIdx === aliceState.you ? alice : bob;
      const placerState = placerIdx === aliceState.you ? aliceState : bobState;
      const remainingHand = placerState.round.hands[placerState.you];
      assert(remainingHand.length >= 2, "a pending placement should only occur with 2+ cards left in hand");

      // Extra coverage: confirm the OTHER (non-placing) player is rejected
      // if they try to place instead.
      const otherActor = placer === alice ? bob : alice;
      try {
        await emitAck(otherActor, "place-target", { code, cardId: remainingHand[0].id });
        throw new Error("expected place-target to be rejected for the non-placing player");
      } catch (e) {
        assert(/not your card to place|nothing to place/.test(e.message), `expected a placement rejection, got: ${e.message}`);
      }

      const pp1 = new Promise((r) => alice.once("room-state", r));
      const pp2 = new Promise((r) => bob.once("room-state", r));
      await emitAck(placer, "place-target", { code, cardId: remainingHand[0].id });
      [aliceState, bobState] = await Promise.all([pp1, pp2]);
      checkHandPrivacyDuringMatching(aliceState, aliceState.you);
      checkHandPrivacyDuringMatching(bobState, bobState.you);
      assert(aliceState.round.pendingPlacement === null, "placement should be resolved after place-target");
    }
  }

  assert(guard < 500, "matching phase did not converge — possible infinite loop");
  assert(aliceState.status === "round-over", "round should be over");
  checkHandsRevealed(aliceState);
  checkHandsRevealed(bobState);
  console.log(`  MATCHING PHASE: resolved after ${guard} turns, winner index ${aliceState.round.winnerIndex}`);
  return aliceState;
}

async function main() {
  const { server } = buildServer();
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`smoke-test server up on :${PORT}`);

  const url = `http://localhost:${PORT}`;
  const alice = Client(url, { transports: ["websocket"] });
  const bob = Client(url, { transports: ["websocket"] });

  await Promise.all([
    new Promise((r) => alice.on("connect", r)),
    new Promise((r) => bob.on("connect", r)),
  ]);
  console.log("both clients connected");

  const aliceStatePromise = new Promise((r) => alice.once("room-state", r));
  const created = await emitAck(alice, "create-room", { playerName: "Alice", packAmount: 5 });
  const code = created.code;
  await aliceStatePromise;
  console.log("room created:", code);

  const bobStatePromise = new Promise((r) => bob.once("room-state", r));
  const aliceSeesJoinPromise = new Promise((r) => alice.once("room-state", r));
  await emitAck(bob, "join-room", { code, playerName: "Bob" });
  await Promise.all([bobStatePromise, aliceSeesJoinPromise]);
  console.log("bob joined");

  const outcomes = { "instant-win": 0, matching: 0 };
  const N = 25;
  for (let i = 0; i < N; i++) {
    console.log(`--- round ${i + 1}/${N} ---`);
    const state = await playOneRound(alice, bob, code, 5);
    outcomes[state.round.phase]++;
  }

  console.log("\noutcome distribution over", N, "rounds:", outcomes);
  console.log("off-turn (free-for-all) knocks proven:", offTurnKnockCount, "times");
  console.log("knocker chose their own next target card:", placementCount, "times");
  console.log("one-card-left edge case (deck refilled instead of a placement):", deckRefillOnOneCardCount, "times");
  assert(outcomes.matching > 0, "expected at least one matching-phase round across 25 tries");
  // instant-win is comparatively rare per-player per-hand; don't hard-assert it occurred,
  // just report the distribution for visibility. Same for off-turn knocks — it depends on
  // the random deal, so we log it rather than hard-failing a lucky run of 25 rounds.

  alice.close();
  bob.close();
  server.close();
  console.log("\nSMOKE TEST PASSED");
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED:", err);
  process.exit(1);
});
