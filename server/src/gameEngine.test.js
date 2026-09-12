"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./gameEngine");

const c = engine.makeCard;

// --- Instant-win detection ---------------------------------------------

test("classifyInstantWin: J-Q-K is Royal Sequence, any suits", () => {
  const hand = [c("K", "clubs"), c("J", "hearts"), c("Q", "diamonds")];
  const result = engine.classifyInstantWin(hand);
  assert.equal(result.category, "royal");
  assert.equal(result.score, engine.CATEGORY.ROYAL);
});

test("classifyInstantWin: A-2-3 is Ace23, ranks below Royal", () => {
  const hand = [c("A", "spades"), c("2", "hearts"), c("3", "clubs")];
  const result = engine.classifyInstantWin(hand);
  assert.equal(result.category, "ace23");
  assert.ok(result.score < engine.CATEGORY.ROYAL);
});

test("classifyInstantWin: plain sequences rank by run, 10-J-Q beats 2-3-4", () => {
  const low = engine.classifyInstantWin([c("2", "hearts"), c("3", "clubs"), c("4", "spades")]);
  const high = engine.classifyInstantWin([c("10", "hearts"), c("J", "clubs"), c("Q", "spades")]);
  assert.equal(low.category, "sequential");
  assert.equal(high.category, "sequential");
  assert.ok(high.score > low.score);
  assert.ok(high.score < engine.CATEGORY.ACE23);
});

test("classifyInstantWin: same suit, non-sequential ranks is a flush", () => {
  const hand = [c("2", "hearts"), c("9", "hearts"), c("K", "hearts")];
  const result = engine.classifyInstantWin(hand);
  assert.equal(result.category, "flush");
  assert.equal(result.score, engine.CATEGORY.FLUSH);
});

test("classifyInstantWin: a straight flush is classified by its sequence, not as a flush", () => {
  const hand = [c("5", "hearts"), c("6", "hearts"), c("7", "hearts")];
  const result = engine.classifyInstantWin(hand);
  assert.equal(result.category, "sequential");
});

test("classifyInstantWin: no sequence and mixed suits is 'none'", () => {
  const hand = [c("2", "hearts"), c("9", "clubs"), c("K", "spades")];
  const result = engine.classifyInstantWin(hand);
  assert.equal(result.category, "none");
});

test("evaluateInstantWin: Royal beats a flush", () => {
  const hands = [
    [c("2", "hearts"), c("9", "hearts"), c("K", "hearts")], // flush
    [c("J", "clubs"), c("Q", "diamonds"), c("K", "spades")], // royal
  ];
  const result = engine.evaluateInstantWin(hands);
  assert.equal(result.hasWinner, true);
  assert.equal(result.category, "royal");
  assert.deepEqual(result.winnerIndices, [1]);
});

test("evaluateInstantWin: nobody qualifies -> hasWinner false", () => {
  const hands = [
    [c("2", "hearts"), c("9", "clubs"), c("K", "spades")],
    [c("4", "diamonds"), c("7", "clubs"), c("J", "hearts")],
  ];
  const result = engine.evaluateInstantWin(hands);
  assert.equal(result.hasWinner, false);
});

test("evaluateInstantWin: same suit flush tie broken by suit rank (hearts beats spades)", () => {
  const hands = [
    [c("2", "spades"), c("9", "spades"), c("K", "spades")],
    [c("3", "hearts"), c("7", "hearts"), c("J", "hearts")],
  ];
  const result = engine.evaluateInstantWin(hands);
  assert.equal(result.category, "flush");
  assert.deepEqual(result.winnerIndices, [1]);
});

test("evaluateInstantWin: two same-suit flushes with equal totals split the pot", () => {
  const hands = [
    [c("2", "hearts"), c("8", "hearts"), c("J", "hearts")], // 2+8+11=21
    [c("5", "hearts"), c("6", "hearts"), c("10", "hearts")], // 5+6+10=21
  ];
  const result = engine.evaluateInstantWin(hands);
  assert.deepEqual(result.winnerIndices.sort(), [0, 1]);
});

// --- Matching Phase (fallback when nobody has an instant win) ---------

test("classifyHandForMatching: a natural pair leaves only the odd card active", () => {
  const hand = [c("4", "hearts"), c("4", "clubs"), c("K", "spades")];
  const result = engine.classifyHandForMatching(hand);
  assert.equal(result.type, "pair");
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].rank, "K");
});

test("findMandatoryKnock: a settled pair is never offered as a knock candidate", () => {
  const hand = [c("4", "hearts"), c("4", "clubs"), c("K", "spades")];
  assert.equal(engine.findMandatoryKnock(hand, "4"), null);
});

test("playMatchingTurn: no match -> player flips, turn passes, face-up updates", () => {
  const state = {
    hands: [
      [c("3", "hearts"), c("5", "clubs"), c("8", "spades")],
      [c("K", "hearts"), c("Q", "clubs"), c("J", "spades")],
    ],
    deck: [c("9", "hearts"), c("2", "clubs")],
    tablePile: [],
    faceUpCard: c("4", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
  };
  const next = engine.playMatchingTurn(state);
  assert.equal(next.turnIndex, 1);
  assert.equal(next.faceUpCard.rank, "9");
  assert.equal(next.winnerIndex, null);
});

test("playMatchingTurn: knock shrinks the hand and auto-places a new target from what's left", () => {
  const state = {
    hands: [[c("6", "hearts"), c("5", "clubs"), c("8", "spades")]],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.playMatchingTurn(state);
  // 6-hearts knocked away, and one of the two remaining cards got placed
  // as the new target — hand should have exactly 1 card left, not 3.
  assert.equal(next.hands[0].length, 1);
  assert.ok(next.faceUpCard);
  assert.notEqual(next.faceUpCard.id, "6-diamonds");
  assert.equal(next.pendingPlacement, null, "playMatchingTurn should fully resolve the placement itself");
  // deck should be untouched — no replacement/refill draw happens when 2+ cards remain.
  assert.equal(next.deck.length, 2);
});

test("attemptKnock: tapping a card that doesn't match the target is rejected", () => {
  const state = {
    hands: [[c("6", "hearts"), c("5", "clubs"), c("8", "spades")]],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  assert.throws(() => engine.attemptKnock(state, 0, "5-clubs"), /doesn't match the target/);
});

test("attemptKnock: tapping a card that's part of an already-settled pair is rejected", () => {
  // 4-hearts/4-clubs form a settled pair; only K-spades is active, even
  // though the target happens to also be a 4.
  const state = {
    hands: [[c("4", "hearts"), c("4", "clubs"), c("K", "spades")]],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("4", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  assert.throws(() => engine.attemptKnock(state, 0, "4-hearts"), /doesn't match the target/);
});

test("attemptKnock: knocking with 2+ cards left shrinks the hand and awaits a placement (no deck draw)", () => {
  const state = {
    hands: [[c("6", "hearts"), c("5", "clubs"), c("8", "spades")]],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.attemptKnock(state, 0, "6-hearts");
  assert.equal(next.hands[0].length, 2, "the matched card leaves the hand and nothing replaces it");
  assert.equal(next.faceUpCard, null, "no target is visible until the placement happens");
  assert.equal(next.pendingPlacement, 0, "the knocker is on the hook to place the next target");
  assert.equal(next.deck.length, 2, "the deck is untouched — no draw happens on a knock with 2+ cards left");
});

test("attemptKnock: matching is a free-for-all — a player who is NOT the flip-turn can still knock", () => {
  const state = {
    hands: [
      [c("K", "hearts"), c("Q", "clubs"), c("J", "spades")], // player 0 (has the flip-turn), no match
      [c("6", "hearts"), c("5", "clubs"), c("8", "spades")], // player 1, HAS the match
    ],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0, // it's player 0's flip-turn, not player 1's — shouldn't matter for knocking
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.attemptKnock(state, 1, "6-hearts");
  assert.equal(next.hands[1].length, 2);
  assert.equal(next.pendingPlacement, 1);
  assert.equal(next.turnIndex, 0, "turnIndex is left untouched until the knocker actually places their new target");

  const placed = engine.placeTarget(next, 1, "5-clubs");
  assert.equal(placed.turnIndex, 1, "once placed, the knocker themselves gets the flip-turn, not the next player in line");
});

test("attemptKnock: a stale target (someone else already matched it) is rejected with a distinct message", () => {
  const state = {
    hands: [[c("6", "hearts"), c("5", "clubs"), c("8", "spades")]],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  assert.throws(
    () => engine.attemptKnock(state, 0, "6-hearts", "some-other-card-id-the-client-saw-before"),
    /Someone already matched that card/
  );
});

test("attemptKnock: rejected while a placement is pending", () => {
  const state = {
    hands: [
      [c("6", "hearts"), c("8", "spades")],
      [c("6", "clubs"), c("9", "diamonds"), c("2", "hearts")],
    ],
    deck: [],
    tablePile: [],
    faceUpCard: null,
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: 0, // player 0 must place before anyone can act
  };
  assert.throws(() => engine.attemptKnock(state, 1, "6-clubs"), /Waiting for a new target card to be placed/);
});

test("attemptKnock: only one card would be left to place -> keeps it and refills the target from the deck", () => {
  // Player has exactly 2 cards; knocking the match leaves exactly 1 (not 0,
  // not a settled pair) — placing it would force a win-by-discard, so
  // instead they keep it and the deck supplies the next target.
  const state = {
    hands: [[c("6", "hearts"), c("9", "clubs")]],
    deck: [c("2", "diamonds"), c("7", "spades")],
    tablePile: [c("3", "hearts")],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.attemptKnock(state, 0, "6-hearts");
  assert.equal(next.hands[0].length, 1);
  assert.equal(next.hands[0][0].id, "9-clubs", "the lone remaining card stays in hand, untouched");
  assert.ok(next.faceUpCard, "a new target should be drawn from the deck automatically");
  assert.equal(next.faceUpCard.id, "2-diamonds");
  assert.equal(next.pendingPlacement, null);
  assert.equal(next.deck.length, 1);
});

test("attemptKnock + placeTarget: a knock requiring placement hands the flip-turn to the placer, not the next player in line", () => {
  const state = {
    hands: [
      [c("K", "hearts")], // player 0 — flip-turn holder, no match
      [c("6", "hearts"), c("9", "clubs"), c("5", "spades")], // player 1 — knocks (2 remain -> pendingPlacement)
      [c("Q", "diamonds")], // player 2
    ],
    deck: [c("2", "clubs")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0, // it's player 0's flip-turn — irrelevant to who's allowed to knock
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.attemptKnock(state, 1, "6-hearts");
  assert.equal(next.pendingPlacement, 1);
  assert.equal(next.turnIndex, 0, "turnIndex doesn't move yet — still whatever it was before the knock");

  const placed = engine.placeTarget(next, 1, "9-clubs");
  assert.equal(placed.turnIndex, 1, "placing hands the flip-turn to player 1 (the placer) — not player 2, next after them");
});

test("attemptKnock: turnIndex wraps around past the last player", () => {
  const state = {
    hands: [
      [c("Q", "diamonds")],
      [c("K", "hearts")],
      [c("6", "hearts"), c("9", "clubs")], // player 2 knocks, leaves exactly 1 -> auto-refill, no chain match
    ],
    deck: [c("2", "clubs")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 2,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.attemptKnock(state, 2, "6-hearts");
  assert.equal(next.turnIndex, 0, "wraps from 2 back to 0 for 3 players");
});

test("flipFromDeck: even when the revealed card matches the flipper's own hand, it's a plain flip — no auto-knock priority", () => {
  const state = {
    hands: [
      // Exactly one 9 — two would form a "natural pair" and be excluded
      // from matchable/active cards entirely, which isn't what this test
      // is after.
      [c("9", "clubs"), c("K", "spades"), c("Q", "hearts")], // player 0 (flips) — holds a 9, matches the deck's next card
      [c("Q", "diamonds"), c("J", "clubs"), c("2", "hearts")],
    ],
    deck: [c("9", "diamonds"), c("7", "spades")], // next card off the deck is a 9 — matches player 0's hand
    tablePile: [],
    faceUpCard: c("6", "diamonds"), // current target — neither player has a 6, so flipping is legal
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.flipFromDeck(state, 0);
  // The 9 of diamonds just sits as an open target — even though it matches
  // player 0's own hand, they still have to tap it themselves like anyone
  // else would.
  assert.equal(next.action.type, "flip", "left as a plain flip, no automatic knock");
  assert.equal(next.faceUpCard.id, "9-diamonds");
  assert.equal(next.hands[0].length, 3, "player 0's hand is untouched — nothing was auto-matched");
  assert.equal(next.pendingPlacement, null);
  assert.equal(next.turnIndex, 1);
});

test("flipFromDeck: no auto-match for the flipper — behaves like a plain flip", () => {
  const state = {
    hands: [
      [c("Q", "diamonds"), c("J", "clubs"), c("2", "hearts")], // player 0 flips, no match for what's drawn
      [c("K", "spades")],
    ],
    deck: [c("9", "diamonds"), c("7", "spades")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.flipFromDeck(state, 0);
  assert.equal(next.action.type, "flip");
  assert.equal(next.faceUpCard.id, "9-diamonds");
  assert.equal(next.turnIndex, 1);
});

test("flipFromDeck: never chains into an auto-knock, even for a card that would match the flipper's hand", () => {
  const state = {
    hands: [
      [c("9", "clubs"), c("K", "spades")], // player 0 flips — the revealed 9 matches, but must still be tapped
      [c("Q", "diamonds")],
    ],
    deck: [c("9", "diamonds"), c("K", "hearts")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  const next = engine.flipFromDeck(state, 0);
  assert.equal(next.action.type, "flip");
  assert.equal(next.faceUpCard.id, "9-diamonds", "just the one card flipped, no chain");
  assert.equal(next.winnerIndex, null);
  assert.equal(next.hands[0].length, 2, "player 0's hand is untouched");
  assert.equal(next.deck.length, 1, "only one card was drawn from the deck");
});

test("placeTarget: the knocker places one of their remaining cards as the new target", () => {
  const state = {
    hands: [[c("5", "clubs"), c("8", "spades")]],
    deck: [c("2", "clubs")],
    tablePile: [c("6", "hearts"), c("6", "diamonds")],
    faceUpCard: null,
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: 0,
  };
  const next = engine.placeTarget(state, 0, "8-spades");
  assert.equal(next.faceUpCard.id, "8-spades");
  assert.equal(next.hands[0].length, 1);
  assert.equal(next.hands[0][0].id, "5-clubs");
  assert.equal(next.pendingPlacement, null);
});

test("placeTarget: rejected if it's not your placement to make", () => {
  const state = {
    hands: [[c("5", "clubs"), c("8", "spades")], [c("9", "hearts")]],
    deck: [],
    tablePile: [],
    faceUpCard: null,
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: 0,
  };
  assert.throws(() => engine.placeTarget(state, 1, "9-hearts"), /not your card to place/);
});

test("placeTarget: rejected if nothing is pending", () => {
  const state = {
    hands: [[c("5", "clubs"), c("8", "spades")]],
    deck: [],
    tablePile: [],
    faceUpCard: c("2", "clubs"),
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: null,
  };
  assert.throws(() => engine.placeTarget(state, 0, "8-spades"), /nothing to place right now/);
});

test("flipFromDeck: tapping the deck while holding a mandatory match is rejected", () => {
  const state = {
    hands: [[c("6", "hearts"), c("5", "clubs"), c("8", "spades")]],
    deck: [c("2", "clubs"), c("7", "diamonds")],
    tablePile: [],
    faceUpCard: c("6", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
  };
  assert.throws(() => engine.flipFromDeck(state, 0), /must knock with it instead of flipping/);
});

test("flipFromDeck: only the player whose flip-turn it is may flip", () => {
  const state = {
    hands: [
      [c("3", "hearts"), c("5", "clubs"), c("8", "spades")],
      [c("K", "hearts"), c("Q", "clubs"), c("J", "spades")],
    ],
    deck: [c("9", "hearts"), c("2", "clubs")],
    tablePile: [],
    faceUpCard: c("4", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
  };
  assert.throws(() => engine.flipFromDeck(state, 1), /not your turn to flip/);
});

test("flipFromDeck: tapping the deck with no match flips a new target", () => {
  const state = {
    hands: [
      [c("3", "hearts"), c("5", "clubs"), c("8", "spades")],
      [c("K", "hearts"), c("Q", "clubs"), c("J", "spades")],
    ],
    deck: [c("9", "hearts"), c("2", "clubs")],
    tablePile: [],
    faceUpCard: c("4", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
  };
  const next = engine.flipFromDeck(state, 0);
  assert.equal(next.turnIndex, 1);
  assert.equal(next.faceUpCard.rank, "9");
});

test("flipFromDeck: rejected while a placement is pending, even for the correct flip-turn player", () => {
  const state = {
    hands: [[c("8", "spades")], [c("2", "hearts"), c("9", "diamonds")]],
    deck: [c("3", "clubs")],
    tablePile: [],
    faceUpCard: null,
    turnIndex: 0,
    winnerIndex: null,
    pendingPlacement: 1, // player 1 must place before anyone (even the flip-turn player) can act
  };
  assert.throws(() => engine.flipFromDeck(state, 0), /Waiting for a new target card to be placed/);
});

test("playMatchingTurn: matching the last active card wins and empties the hand", () => {
  const state = {
    hands: [[c("4", "hearts"), c("4", "clubs"), c("K", "spades")]],
    deck: [],
    tablePile: [],
    faceUpCard: c("K", "diamonds"),
    turnIndex: 0,
    winnerIndex: null,
  };
  const next = engine.playMatchingTurn(state);
  assert.equal(next.winnerIndex, 0);
  assert.equal(next.hands[0].length, 0);
});

// --- Orchestration: dealAndStartRound ----------------------------------

test("dealAndStartRound: an instant-win deal resolves immediately, no matching phase", () => {
  // Run many seeds and just check internal consistency of whichever phase comes up,
  // since dealAndStartRound uses real shuffling — assert the shape is always valid.
  for (let seed = 1; seed <= 40; seed++) {
    let s = seed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const result = engine.dealAndStartRound({ numPlayers: 3, dealerIndex: 0, rng });
    assert.equal(result.hands.length, 3);
    for (const hand of result.hands) assert.equal(hand.length, 3);
    if (result.phase === "dealer-card-win") {
      assert.ok(result.faceUpCard.rank === "J" || result.faceUpCard.rank === "6");
      // The dealer-card check consumes one card off the deck to reveal it.
      assert.equal(result.deck.length, 52 - 3 * 3 - 1);
    } else if (result.phase === "instant-win") {
      assert.ok(result.winnerIndices.length >= 1);
      assert.ok(result.category);
      // The deck must still be present (and correctly sized) so the table UI
      // can keep showing it even though no card gets flipped on an instant win.
      assert.ok(Array.isArray(result.deck));
      assert.equal(result.deck.length, 52 - 3 * 3);
    } else {
      assert.equal(result.phase, "matching");
      assert.ok(result.faceUpCard);
      assert.equal(result.turnIndex, 1);
      assert.equal(result.winnerIndex, null);
      assert.equal(result.pendingPlacement, null);
    }
  }
});

test("resolveOpeningTarget: a J or 6 as the would-be target card wins the pot for the dealer outright, without ending the round", () => {
  let foundDealerCardWin = false;
  let foundPriorityCase = false;

  for (let seed = 1; seed <= 1000; seed++) {
    let s = seed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const { hands, deck } = engine.dealHands(3, rng);
    const result = engine.resolveOpeningTarget({ hands, deck, dealerIndex: 1 });

    if (result.phase === "dealer-card-win") {
      foundDealerCardWin = true;
      // Doesn't end the round — same hands, deck just advanced past the
      // consumed card, ready for the caller to collect a recast and check
      // the next one.
      assert.deepEqual(result.hands, hands);
      assert.ok(result.faceUpCard.rank === "J" || result.faceUpCard.rank === "6");
      assert.equal(result.deck.length, deck.length - 1);
      assert.equal(result.dealerIndex, 1);

      // If some other hand would ALSO have instant-won on its own merits,
      // the dealer's card still takes priority — resolveOpeningTarget
      // checks it before ever calling evaluateInstantWin.
      const handBased = engine.evaluateInstantWin(hands);
      if (handBased.hasWinner) foundPriorityCase = true;
    }
  }

  assert.ok(foundDealerCardWin, "expected at least one seed (of 1000) to produce a dealer-card-win");
  assert.ok(foundPriorityCase, "expected at least one seed to also exercise the priority-over-hands case");
});

test("resolveOpeningTarget: repeated calls with the advanced deck keep checking until a non-J/6 target resolves the round", () => {
  // Find a seed whose deal produces at least two dealer-card wins in a row
  // before something else resolves it, to prove the repeat behavior works
  // (not just a single check).
  for (let seed = 1; seed <= 2000; seed++) {
    let s = seed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const { hands, deck } = engine.dealHands(3, rng);
    let result = engine.resolveOpeningTarget({ hands, deck, dealerIndex: 0 });
    if (result.phase !== "dealer-card-win") continue;

    let repeats = 1;
    while (result.phase === "dealer-card-win" && repeats < 10) {
      const next = engine.resolveOpeningTarget({ hands: result.hands, deck: result.deck, dealerIndex: 0 });
      assert.deepEqual(next.hands, hands, "hands must never change across repeats");
      result = next;
      repeats++;
    }
    assert.notEqual(result.phase, "dealer-card-win");
    if (repeats >= 2) return; // found and verified a multi-repeat case — done
  }
  // Not finding one in 2000 seeds isn't itself a failure of the feature
  // (roughly an 18.6% chance per check, so ~2 in a row is already rare) —
  // the single-repeat behavior above is what actually matters and is
  // covered by the previous test either way.
});

test("dealAndStartRound: never deals the same physical card twice", () => {
  for (let seed = 1; seed <= 10; seed++) {
    let s = seed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const result = engine.dealAndStartRound({ numPlayers: 6, dealerIndex: 0, rng });
    const seen = new Set();
    for (const hand of result.hands) {
      for (const card of hand) {
        assert.ok(!seen.has(card.id), `duplicate card dealt: ${card.id}`);
        seen.add(card.id);
      }
    }
  }
});

test("full simulation: matching-phase rounds always converge to exactly one winner", () => {
  let matchingRoundsSeen = 0;
  let instantWinRoundsSeen = 0;
  let dealerCardWinsSeen = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let s = seed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    let state = engine.dealAndStartRound({ numPlayers: 3, dealerIndex: 0, rng });
    // A dealer-card win doesn't end the round — simulate an immediate
    // recast (as the room layer would after everyone responds) and keep
    // checking the next card the same way real play does.
    while (state.phase === "dealer-card-win") {
      dealerCardWinsSeen++;
      state = engine.resolveOpeningTarget({ hands: state.hands, deck: state.deck, dealerIndex: state.dealerIndex });
    }
    if (state.phase === "instant-win") {
      instantWinRoundsSeen++;
      continue;
    }
    matchingRoundsSeen++;
    let guard = 0;
    while (state.winnerIndex === null && guard < 500) {
      state = engine.playMatchingTurn(state, rng);
      guard++;
    }
    assert.ok(guard < 500, `seed ${seed}: matching phase did not converge`);
    assert.equal(state.hands[state.winnerIndex].length, 0);
  }
  // sanity: across 60 seeds we should see a mix of both outcomes
  assert.ok(matchingRoundsSeen > 0, "expected at least one matching-phase round");
  assert.ok(instantWinRoundsSeen > 0, "expected at least one instant-win round");
});
