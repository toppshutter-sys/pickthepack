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
        { id: hostSocketId, name: hostName, connected: true, totalContributed: 0, totalWon: 0 },
      ],
      potAmount: 0,
      dealerIndex: 0,
      status: "lobby", // lobby | round-active | round-over
      round: null, // engine state (phase: 'instant-win' | 'matching')
      log: [],
      lastKnock: null, // { playerIdx, card } — the most recent knock this round, for the client's knock indicator
    };
    this.rooms.set(code, room);
    return room;
  }

  joinRoom({ code, socketId, playerName }) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (room.status !== "lobby") throw new Error("Round already in progress — wait for it to finish");
    if (room.players.length >= 6) throw new Error("Room is full (max 6 players)");
    if (room.players.some((p) => p.id === socketId)) throw new Error("Already in this room");
    room.players.push({ id: socketId, name: playerName, connected: true, totalContributed: 0, totalWon: 0 });
    return room;
  }

  /**
   * Removes a player from a room. Not allowed mid-round — cards, pot math,
   * and turn order are all indexed by player position, so someone vanishing
   * mid-hand would desync everyone else's view. Between hands (round-over)
   * the previous hand's cards are just a recap with nothing left to protect,
   * so a leave there resets the room to a fresh lobby rather than leaving
   * stale, now-mis-indexed hands on screen.
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
      return null;
    }

    if (idx < room.dealerIndex) room.dealerIndex -= 1;
    else if (room.dealerIndex >= room.players.length) room.dealerIndex = 0;

    if (room.status === "round-over") {
      room.status = "lobby";
      room.round = null;
    }

    this.addLog(room, `${leavingName} left the table.`);
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
      this.addLog(
        room,
        `${actingPlayer.name} tapped a matching ${after.action.card.rank} to knock it in and is choosing a new target card from their hand.`
      );
    } else if (after.action && after.action.type === "knock-deck-refill") {
      this.addLog(
        room,
        `${actingPlayer.name} tapped a matching ${after.action.card.rank} to knock it in — with one card left, the deck flipped a new target: ${after.faceUpCard.rank} of ${after.faceUpCard.suit}.`
      );
    } else if (after.action && after.action.type === "place-target") {
      this.addLog(
        room,
        `${actingPlayer.name} placed ${after.faceUpCard.rank} of ${after.faceUpCard.suit} face-up as the new target card.`
      );
    } else {
      this.addLog(room, `${actingPlayer.name} had no match, tapped the deck, and flipped ${after.faceUpCard.rank} of ${after.faceUpCard.suit}.`);
    }
    return room;
  }

  /**
   * Player taps a specific card in their own hand, asserting it matches the
   * target — allowed at any moment, for any seated player, regardless of
   * whose flip-turn it is. `expectedTargetId` (the target card's id the
   * client last saw) is optional but lets the engine give a friendlier
   * "someone already matched that" message if this tap lost a race.
   */
  tapCard(code, socketId, cardId, expectedTargetId) {
    const { room, playerIdx, player } = this._validateActivePlayer(code, socketId);
    const after = engine.attemptKnock(room.round, playerIdx, cardId, expectedTargetId);
    return this._applyTurnResult(room, player, after);
  }

  /** Player taps the deck — only the player whose flip-turn it currently is may do this. */
  tapDeck(code, socketId) {
    const { room, playerIdx, player } = this._validateActivePlayer(code, socketId);
    const after = engine.flipFromDeck(room.round, playerIdx);
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

module.exports = { RoomManager, makeRoomCode };
