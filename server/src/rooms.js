"use strict";

/**
 * In-memory room/game-session manager (v4 — instant-win check + matching-phase fallback).
 *
 * Wraps gameEngine.js (which knows nothing about sockets, players, or the
 * pot) with room lifecycle, ante collection, turn validation, and payout.
 *
 * Money note: `potAmount` / `totalContributed` / `totalWon` are just
 * numbers the app displays — no real payment ever moves. Players settle
 * up outside the app.
 */

const engine = require("./gameEngine");

// Minimum time between deck flips, enforced globally per room (not just per
// player) — so cards can't be rapid-fired through, and everyone gets a
// moment to actually see one before the next is allowed.
const FLIP_COOLDOWN_MS = 1000;

// Minimum time after a target card first appears (from a flip, a knock's
// deck-refill, or a placed target) before ANY knock on it is accepted —
// enforced globally per room, not per player, so the fastest tapper can't
// claim a card before everyone else has even had a chance to see it. Once
// this passes, matching goes back to being a genuine free-for-all — first
// valid tap wins, same as before.
const KNOCK_COOLDOWN_MS = 1000;

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const CATEGORY_LABEL = {
  royal: "Royal Sequence (K-Q-J)",
  ace23: "Ace-2-3 Sequence",
  sequential: "a Sequence",
  flush: "Same-Suit (Flush)",
};

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom({ hostSocketId, hostName, packAmount }) {
    let code;
    do {
      code = makeRoomCode();
    } while (this.rooms.has(code));

    const room = {
      code,
      packAmount, // 5 or 10
      players: [
        { id: hostSocketId, name: hostName, connected: true, totalContributed: 0, totalWon: 0, isHost: true },
      ],
      potAmount: 0,
      dealerIndex: 0,
      status: "lobby", // lobby | round-active | round-over
      round: null, // engine state (phase: 'instant-win' | 'matching')
      log: [],
      lastKnock: null, // { playerIdx, card } — the most recent knock this round, for the client's knock indicator
      lastFlipAt: 0, // timestamp of the most recent successful deck flip — see FLIP_COOLDOWN_MS
      lastTargetAt: 0, // timestamp the current target card first appeared — see KNOCK_COOLDOWN_MS
    };
    this.rooms.set(code, room);
    return room;
  }

  // Joining is allowed from the lobby AND between hands (round-over) — a
  // new player added there just slots into the array everyone else's
  // indices already point into (dealerIndex, etc. are all unaffected,
  // and the next deal simply sizes hands to the new player count). Mid-hand
  // (round-active / awaiting-recast) is blocked for the same load-bearing-
  // indices reason leaveRoom blocks leaving then — every hand, the pot,
  // and turn order are indexed by seat position, and a new player has no
  // hand yet to slot into an already-dealt round.
  joinRoom({ code, socketId, playerName }) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (room.status === "round-active" || room.status === "awaiting-recast") {
      throw new Error("Round already in progress — wait for it to finish");
    }
    if (room.players.length >= 6) throw new Error("Room is full (max 6 players)");
    if (room.players.some((p) => p.id === socketId)) throw new Error("Already in this room");
    if (room.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase())) {
      throw new Error(`"${playerName}" is already at this table — enter a different name`);
    }
    room.players.push({ id: socketId, name: playerName, connected: true, totalContributed: 0, totalWon: 0, isHost: false });
    return room;
  }

  /**
   * Removes a player from a room. Not allowed mid-round — cards, pot math,
   * and turn order are all indexed by player position, so someone vanishing
   * mid-hand would desync everyone else's view. Between hands (round-over)
   * the previous hand's cards are just a recap with nothing left to protect,
   * so a leave there resets the room to a fresh lobby rather than leaving
   * stale, now-mis-indexed hands on screen.
   *
   * Returns { room, closedFor }: `room` is the updated room (or null if it
   * no longer exists), and `closedFor` is a socket id to notify directly —
   * set when leaving drops the table to exactly one other player who isn't
   * the host, since the game can't continue and that player didn't ask to
   * leave themselves (see the one-player-left handling below), so there's
   * no ordinary room-state broadcast that would tell their client to bail
   * out to the home screen.
   */
  leaveRoom(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (room.status === "round-active" || room.status === "awaiting-recast") {
      throw new Error("Can't leave mid-round — finish this hand first");
    }
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) throw new Error("You're not seated in this room");

    const leavingName = room.players[idx].name;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      this.rooms.delete(code);
      return { room: null, closedFor: null };
    }

    if (idx < room.dealerIndex) room.dealerIndex -= 1;
    else if (room.dealerIndex >= room.players.length) room.dealerIndex = 0;

    if (room.status === "round-over") {
      room.status = "lobby";
      room.round = null;
    }

    this.addLog(room, `${leavingName} left the table.`);

    // One player left doesn't leave enough for a game — the host gets to
    // keep the (now-empty) table open in the lobby waiting for others;
    // anyone else left solo has no table to "own", so it closes and they
    // get sent home too, same as everyone else leaving would.
    if (room.players.length === 1) {
      const lastPlayer = room.players[0];
      if (lastPlayer.isHost) {
        room.status = "lobby";
        room.round = null;
        this.addLog(room, `${lastPlayer.name} is the only one left — waiting for more players.`);
        return { room, closedFor: null };
      }
      const closedFor = lastPlayer.id;
      this.rooms.delete(code);
      return { room: null, closedFor };
    }

    return { room, closedFor: null };
  }

  /**
   * Reclaims an existing seat after the socket reconnects with a new id.
   * Socket.IO doesn't preserve the old socket id across a disconnect/
   * reconnect cycle (a brief wifi drop, a tab/app getting backgrounded and
   * resumed, etc.) — without this, the reconnected client is a "zombie":
   * still technically connected to the server, but never re-associated
   * with the room, so it silently stops receiving that room's broadcasts
   * and appears frozen (greyed out, stuck) on whatever screen it was last
   * showing, even as everyone else's game moves on normally. Matched by
   * name (case-insensitive) since there's no persistent session/account
   * system — safe because joinRoom enforces unique names per room for the
   * room's entire lifetime, connected or not.
   */
  rejoinRoom({ code, socketId, playerName }) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    const player = room.players.find((p) => p.name.toLowerCase() === (playerName || "").toLowerCase());
    if (!player) throw new Error("No matching seat found in this room");
    player.id = socketId;
    player.connected = true;
    return room;
  }

  findRoomBySocket(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p.id === socketId)) return room;
    }
    return null;
  }

  markDisconnected(socketId) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === socketId);
    if (player) player.connected = false;
    // If everyone else had already recast and this was the last holdout,
    // their disconnecting shouldn't leave the table stuck waiting forever.
    this._maybeResolveRecast(room);
    return room;
  }

  addLog(room, message) {
    room.log.push({ message, at: Date.now() });
    if (room.log.length > 100) room.log.shift();
  }

  /**
   * Deals a fresh hand (once per round-cycle) and resolves the opening
   * state: a dealer's-card win pauses for a recast (see recastBet below)
   * rather than ending the round; otherwise an instant win pays out
   * immediately, or the Matching Phase begins with those same hands.
   */
  startRound(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (room.players.length < 2) throw new Error("Need at least 2 players");
    // Once a round has been played, dealerIndex IS the winner of it (see
    // below) — only they may deal the next one. The very first round, from
    // the lobby, has no winner yet, so anyone may start it.
    if (room.status === "round-over" && socketId !== undefined) {
      const winner = room.players[room.dealerIndex];
      if (winner.id !== socketId) {
        throw new Error(`Only ${winner.name}, who won the last round, can deal the next one`);
      }
    }

    room.lastKnock = null;
    const { hands, deck } = engine.dealHands(room.players.length);
    this._collectAnte(room);
    this._resolveTarget(room, hands, deck);
    return room;
  }

  /**
   * A player confirms they want to continue after a dealer's-card win —
   * once every still-connected player has done this, the ante is
   * collected again and the SAME hands (no re-deal) are checked against
   * the next card, which may itself be another J/6 (repeats) or the real
   * start of the round. Leaving instead of recasting goes through the
   * normal disconnect path (see forfeit-and-leave client-side), not this.
   */
  recastBet(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (room.status !== "awaiting-recast") throw new Error("Nothing to recast right now");
    const player = room.players.find((p) => p.id === socketId);
    if (!player) throw new Error("You're not seated in this room");
    if (!player.connected) throw new Error("You're disconnected");

    room.recastReady.add(socketId);
    this._maybeResolveRecast(room);
    return room;
  }

  /** If everyone still connected has recast, collects ante and checks the next card. */
  _maybeResolveRecast(room) {
    if (room.status !== "awaiting-recast") return;
    const stillWaiting = room.players.some((p) => p.connected && !room.recastReady.has(p.id));
    if (stillWaiting) return;
    const { hands, deck } = room.round;
    this._collectAnte(room);
    this._resolveTarget(room, hands, deck);
  }

  /** Ante collection, skipping anyone currently disconnected. */
  _collectAnte(room) {
    const activePlayers = room.players.filter((p) => p.connected);
    for (const p of activePlayers) p.totalContributed += room.packAmount;
    room.potAmount += room.packAmount * activePlayers.length;
  }

  /** Checks `hands`/`deck` against the engine and applies whatever phase comes back. */
  _resolveTarget(room, hands, deck) {
    const result = engine.resolveOpeningTarget({ hands, deck, dealerIndex: room.dealerIndex });
    room.round = result;

    if (result.phase === "dealer-card-win") {
      room.status = "awaiting-recast";
      room.recastReady = new Set();
      const dealerName = room.players[room.dealerIndex].name;
      const wonAmount = room.potAmount;
      room.players[room.dealerIndex].totalWon += wonAmount;
      room.round.wonAmount = wonAmount; // stashed for client display before the pot resets below
      this.addLog(
        room,
        `${dealerName} deals a ${result.faceUpCard.rank} of ${result.faceUpCard.suit} — dealer wins the $${wonAmount} pot! Recast your bet to continue.`
      );
      room.potAmount = 0;
      return;
    }

    if (result.phase === "instant-win") {
      room.status = "round-over";
      const potAmount = room.potAmount;
      const winners = result.winnerIndices;
      const share = potAmount / winners.length;
      for (const idx of winners) room.players[idx].totalWon += share;

      const categoryLabel = CATEGORY_LABEL[result.category] || result.category;
      if (winners.length > 1) {
        const names = winners.map((i) => room.players[i].name).join(" and ");
        this.addLog(room, `Split pot! ${names} tied on the deal with ${categoryLabel} and share $${potAmount} ($${share.toFixed(2)} each).`);
      } else {
        const winnerName = room.players[winners[0]].name;
        this.addLog(room, `${winnerName} wins the $${potAmount} pot instantly with ${categoryLabel}!`);
      }
      room.dealerIndex = winners[0]; // winner deals next
      room.potAmount = 0;
      return;
    }

    // matching
    room.status = "round-active";
    // Starts both cooldowns from the moment the Matching Phase begins, not
    // just from the first flip/knock — so nobody can act on the opening
    // target instantly, before everyone's even seen their own hand.
    room.lastFlipAt = Date.now();
    room.lastTargetAt = Date.now();
    this.addLog(
      room,
      `Deal complete — no instant win. Target card: ${result.faceUpCard.rank} of ${result.faceUpCard.suit}. Matching Phase begins.`
    );
  }

/**
   * Looks up the room + acting player for a tap, WITHOUT checking whose
   * flip-turn it is — matching is a free-for-all, any seated player may
   * attempt a knock at any moment. (flipFromDeck enforces the turn-order
   * check itself, since only flipping is turn-gated.)
   */
  _validateActivePlayer(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (!room.round || room.round.phase !== "matching" || room.status !== "round-active") {
      throw new Error("No active round to act on");
    }
    const playerIdx = room.players.findIndex((p) => p.id === socketId);
    if (playerIdx === -1) {
      throw new Error("You're not seated in this room");
    }
    return { room, playerIdx, player: room.players[playerIdx] };
  }

  _applyTurnResult(room, actingPlayer, after) {
    room.round = after;
    if (after.action && after.action.type.startsWith("knock")) {
      room.lastKnock = { playerIdx: after.action.playerIdx, card: after.action.card };
    }
    if (after.winnerIndex !== null && after.winnerIndex !== undefined) {
      room.status = "round-over";
      const potAmount = room.potAmount;
      room.players[after.winnerIndex].totalWon += potAmount;
      const winnerName = room.players[after.winnerIndex].name;
      this.addLog(room, `${winnerName} knocked in their last card and wins the $${potAmount} pot!`);
      room.dealerIndex = after.winnerIndex;
      room.potAmount = 0;
    } else if (after.action && after.action.type === "knock-awaiting-placement") {
      // No new target card yet — faceUpCard is null until placeTarget is
      // called, so there's nothing here for the knock cooldown to time.
      this.addLog(
        room,
        `${actingPlayer.name} tapped a matching ${after.action.card.rank} to knock it in and is choosing a new target card from their hand.`
      );
    } else if (after.action && after.action.type === "knock-deck-refill") {
      room.lastTargetAt = Date.now();
      this.addLog(
        room,
        `${actingPlayer.name} tapped a matching ${after.action.card.rank} to knock it in — with one card left, the deck flipped a new target: ${after.faceUpCard.rank} of ${after.faceUpCard.suit}.`
      );
    } else if (after.action && after.action.type === "place-target") {
      room.lastTargetAt = Date.now();
      this.addLog(
        room,
        `${actingPlayer.name} placed ${after.faceUpCard.rank} of ${after.faceUpCard.suit} face-up as the new target card.`
      );
    } else {
      room.lastTargetAt = Date.now();
      this.addLog(room, `${actingPlayer.name} had no match, tapped the deck, and flipped ${after.faceUpCard.rank} of ${after.faceUpCard.suit}.`);
    }
    return room;
  }

  /**
   * Player taps a specific card in their own hand, asserting it matches the
   * target — allowed at any moment, for any seated player, regardless of
   * whose flip-turn it is, though only once KNOCK_COOLDOWN_MS has passed
   * since the current target first appeared (enforced globally per room,
   * not per player) — so the fastest tapper can't claim a card before
   * everyone else has had a chance to actually see it. `expectedTargetId`
   * (the target card's id the client last saw) is optional but lets the
   * engine give a friendlier "someone already matched that" message if
   * this tap lost a race.
   */
  tapCard(code, socketId, cardId, expectedTargetId) {
    const { room, playerIdx, player } = this._validateActivePlayer(code, socketId);
    // Checked before the cooldown, same reasoning as tapDeck's turn-order
    // check: there's genuinely nothing to knock yet while a placement is
    // pending, so that should never be misreported as "too soon."
    if (room.round.pendingPlacement !== null && room.round.pendingPlacement !== undefined) {
      throw new Error("Waiting for a new target card to be placed — try again in a moment");
    }
    const elapsed = Date.now() - room.lastTargetAt;
    if (elapsed < KNOCK_COOLDOWN_MS) {
      throw new Error("Give everyone a moment to see the card — try again in a second.");
    }
    const after = engine.attemptKnock(room.round, playerIdx, cardId, expectedTargetId);
    return this._applyTurnResult(room, player, after);
  }

  /**
   * Player taps the deck — only the player whose flip-turn it currently is
   * may do this, and only once FLIP_COOLDOWN_MS has passed since the last
   * successful flip (enforced globally per room, not per player) — so
   * cards can't be rapid-fired through without anyone else getting a
   * chance to actually see one and think. Turn ownership is checked before
   * the cooldown so an out-of-turn tap always gets the turn-order message
   * rather than being misreported as "too soon" (which would wrongly imply
   * they'd be allowed to flip once the cooldown passes).
   */
  tapDeck(code, socketId) {
    const { room, playerIdx, player } = this._validateActivePlayer(code, socketId);
    if (playerIdx !== room.round.turnIndex) {
      throw new Error("It's not your turn to flip yet — you can still tap a matching card at any time, though");
    }
    const elapsed = Date.now() - room.lastFlipAt;
    if (elapsed < FLIP_COOLDOWN_MS) {
      throw new Error("Give everyone a moment to look — try again in a second.");
    }
    const after = engine.flipFromDeck(room.round, playerIdx);
    room.lastFlipAt = Date.now();
    return this._applyTurnResult(room, player, after);
  }

  /**
   * After a knock leaves 2+ cards in the knocker's hand, no replacement is
   * drawn from the deck — the knocker instead chooses one of their own
   * remaining cards to place face-up as the next target for everyone else
   * to try to match. Only the player named in round.pendingPlacement may
   * call this, and only with a card still in their own hand.
   */
  placeTarget(code, socketId, cardId) {
    const { room, playerIdx, player } = this._validateActivePlayer(code, socketId);
    const after = engine.placeTarget(room.round, playerIdx, cardId);
    return this._applyTurnResult(room, player, after);
  }

  /**
   * Builds the state sent to ONE specific socket. During an active
   * Matching Phase, other players' hands are hidden (card count only) —
   * real money is on the table. An instant-win result is resolved the
   * instant it's dealt, so every hand is revealed right away for that
   * outcome; a matching-phase round reveals all hands once it ends.
   */
  toPlayerState(room, viewerSocketId) {
    const viewerIndex = room.players.findIndex((p) => p.id === viewerSocketId);
    const revealAll = !room.round || room.round.phase === "instant-win" || room.status === "round-over";

    return {
      code: room.code,
      packAmount: room.packAmount,
      players: room.players.map((p) => ({
        name: p.name,
        connected: p.connected,
        totalContributed: p.totalContributed,
        totalWon: p.totalWon,
      })),
      potAmount: room.potAmount,
      dealerIndex: room.dealerIndex,
      status: room.status,
      you: viewerIndex,
      round: room.round
        ? {
            phase: room.round.phase,
            hands: room.round.hands.map((hand, i) =>
              revealAll || i === viewerIndex ? hand : hand.map(() => null)
            ),
            category: room.round.category || null,
            winnerIndices: room.round.winnerIndices || null,
            faceUpCard: room.round.faceUpCard || null,
            turnIndex: room.round.turnIndex ?? null,
            winnerIndex: room.round.winnerIndex ?? null,
            pendingPlacement: room.round.pendingPlacement ?? null,
            deckCount: room.round.deck ? room.round.deck.length : 0,
            tablePileCount: room.round.tablePile ? room.round.tablePile.length : 0,
            lastKnock: room.lastKnock
              ? { playerIdx: room.lastKnock.playerIdx, playerName: room.players[room.lastKnock.playerIdx].name, card: room.lastKnock.card }
              : null,
            wonAmount: room.round.wonAmount ?? null,
            recastReady: room.recastReady ? room.players.map((p) => room.recastReady.has(p.id)) : null,
            // Client-side timestamps (not durations) so clock-drift- and
            // latency-tolerant countdowns can be shown — the server remains
            // the actual authority via tapDeck/tapCard's own cooldown checks.
            flipAvailableAt: room.lastFlipAt + FLIP_COOLDOWN_MS,
            knockAvailableAt: room.lastTargetAt + KNOCK_COOLDOWN_MS,
          }
        : null,
      log: room.log.slice(-20),
    };
  }

  /** Broadcast helper: emits a personalized 'room-state' to every connected player in the room. */
  broadcastState(room, io) {
    for (const p of room.players) {
      io.to(p.id).emit("room-state", this.toPlayerState(room, p.id));
    }
  }
}

module.exports = { RoomManager, makeRoomCode, FLIP_COOLDOWN_MS, KNOCK_COOLDOWN_MS };
