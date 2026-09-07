"use strict";

/**
 * Pick the Pack — core game engine (v4).
 *
 * Merges two rule sets the user asked for at different points:
 *   1. Instant-win categories (Royal Sequence, Ace-2-3, plain Sequences,
 *      Same-Suit/flush) — checked ONCE, immediately after dealing.
 *   2. The Matching Phase (deck, face-up target card, knock/flip) — the
 *      fallback when nobody qualifies for #1. This is NOT a void round;
 *      it's simply how the hand gets played out. Matching itself is a
 *      free-for-all (first player to tap a matching card gets it, whoever's
 *      turn it "is"); turnIndex only controls who's on the hook to flip
 *      the next card when nobody has matched. Hands shrink as they're
 *      matched away — no replacement is drawn — and the knocker chooses
 *      one of their own remaining cards to place face-up as the next
 *      target (see attemptKnock/placeTarget).
 *
 * See rules-spec.md for the full plain-English rules and history of how
 * this settled (there were two "start over"s before landing here).
 *
 * Pure functions, no I/O — server/src/rooms.js wires this up to sockets
 * and the pot. Deterministic given an rng() => [0,1) function.
 */

const SUITS = ["clubs", "diamonds", "spades", "hearts"];
// hearts > diamonds > spades > clubs — used only for instant-win tiebreaks.
const SUIT_RANK = { clubs: 1, diamonds: 2, spades: 3, hearts: 4 };

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
// Ace is LOW-ONLY for instant-win purposes — never high. A=1.
const RANK_VALUE = RANKS.reduce((map, rank, i) => {
  map[rank] = i + 1; // A=1, 2=2, ..., 10=10, J=11, Q=12, K=13
  return map;
}, {});

// Instant-win category score bands. Higher score = better category.
const CATEGORY = {
  NONE: 0,
  FLUSH: 100,
  SEQUENTIAL_BASE: 500, // + (lowestValue - 1), lowestValue 2..10 -> 501..509
  ACE23: 900,
  ROYAL: 1000,
};

function makeCard(rank, suit) {
  return { rank, suit, id: `${rank}-${suit}` };
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function deal(deck, numPlayers) {
  const hands = Array.from({ length: numPlayers }, () => []);
  const remaining = deck.slice();
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < numPlayers; p++) {
      const card = remaining.shift();
      if (!card) throw new Error("Deck ran out while dealing — too many players");
      hands[p].push(card);
    }
  }
  return { hands, deck: remaining };
}

// ---------------------------------------------------------------------
// Instant-win detection (Royal Sequence / Ace-2-3 / Sequential / Flush)
// ---------------------------------------------------------------------

/**
 * Classifies a 3-card hand for the instant-win check. Returns
 * { category: 'royal'|'ace23'|'sequential'|'flush'|'none', score: number }.
 * A straight flush is classified by its sequence, not additionally as a
 * flush — sequence categories all outrank Same-Suit.
 */
function classifyInstantWin(cards) {
  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => a - b);
  const [a, b, c] = values;
  const isConsecutive = b === a + 1 && c === b + 1;

  if (isConsecutive) {
    if (a === 1) return { category: "ace23", score: CATEGORY.ACE23 };
    if (a === 11) return { category: "royal", score: CATEGORY.ROYAL };
    return { category: "sequential", score: CATEGORY.SEQUENTIAL_BASE + (a - 1) };
  }

  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  if (isFlush) return { category: "flush", score: CATEGORY.FLUSH };

  return { category: "none", score: CATEGORY.NONE };
}

/** Sum of rank values (A=1..K=13) — used as the flush same-suit tiebreak. */
function combinedTotal(cards) {
  return cards.reduce((sum, c) => sum + RANK_VALUE[c.rank], 0);
}

/**
 * Breaks a tie between two hands in the exact same specific combo (same
 * category AND same score). Returns a comparator-style number (positive
 * means handA wins). 0 means genuinely unresolvable (split the win).
 */
function breakInstantWinTie(handA, handB, category) {
  if (category === "flush") {
    const suitDiff = SUIT_RANK[handA[0].suit] - SUIT_RANK[handB[0].suit];
    if (suitDiff !== 0) return suitDiff;
    return combinedTotal(handA) - combinedTotal(handB);
  }
  // Sequence categories: cards are unique across a single deck, so two
  // different players' cards at the same rank always differ in suit —
  // compare rank-descending, suit at each position.
  const sortedA = handA.slice().sort((x, y) => RANK_VALUE[y.rank] - RANK_VALUE[x.rank]);
  const sortedB = handB.slice().sort((x, y) => RANK_VALUE[y.rank] - RANK_VALUE[x.rank]);
  for (let i = 0; i < sortedA.length; i++) {
    const diff = SUIT_RANK[sortedA[i].suit] - SUIT_RANK[sortedB[i].suit];
    if (diff !== 0) return diff;
  }
  return 0; // defensive — shouldn't happen with unique cards in a single deck
}

/**
 * Checks every hand for an instant win. Returns:
 *   { hasWinner: false }
 *   or
 *   { hasWinner: true, winnerIndices: number[], category }
 * winnerIndices has more than one entry only on a genuine split-pot tie.
 */
function evaluateInstantWin(hands) {
  const classifications = hands.map((h) => classifyInstantWin(h));
  const bestScore = Math.max(...classifications.map((c) => c.score));

  if (bestScore === CATEGORY.NONE) {
    return { hasWinner: false, classifications };
  }

  let winners = classifications
    .map((c, i) => (c.score === bestScore ? i : -1))
    .filter((i) => i !== -1);

  if (winners.length > 1) {
    const category = classifications[winners[0]].category;
    let best = [winners[0]];
    for (let idx = 1; idx < winners.length; idx++) {
      const challenger = winners[idx];
      const cmp = breakInstantWinTie(hands[challenger], hands[best[0]], category);
      if (cmp > 0) best = [challenger];
      else if (cmp === 0) best.push(challenger);
    }
    winners = best;
  }

  return { hasWinner: true, winnerIndices: winners, category: classifications[winners[0]].category, classifications };
}

// ---------------------------------------------------------------------
// Matching Phase (fallback when nobody has an instant win)
// ---------------------------------------------------------------------

/**
 * Looks at a hand and classifies it for the Matching Phase (NOT the same
 * thing as classifyInstantWin above — this is about natural pairs, not
 * sequences/flushes):
 *  - 'trips': all 3 cards share a rank -> 0 active cards, already settled.
 *  - 'pair': exactly 2 cards share a rank -> the odd one out is active.
 *  - 'none': 3 distinct ranks -> all 3 are active.
 */
function classifyHandForMatching(hand) {
  const counts = {};
  for (const c of hand) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const tripsRank = Object.keys(counts).find((r) => counts[r] === 3);
  if (tripsRank) return { type: "trips", active: [] };
  const pairRank = Object.keys(counts).find((r) => counts[r] === 2);
  if (pairRank) {
    const odd = hand.find((c) => c.rank !== pairRank);
    return { type: "pair", active: odd ? [odd] : [] };
  }
  return { type: "none", active: hand.slice() };
}

function findMandatoryKnock(hand, faceUpRank) {
  const { active } = classifyHandForMatching(hand);
  return active.find((c) => c.rank === faceUpRank) || null;
}

function drawWithReshuffle(deck, tablePile, count, rng = Math.random) {
  let d = deck.slice();
  let pile = tablePile.slice();
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (d.length === 0) {
      if (pile.length === 0) {
        throw new Error("No cards left to draw — deck and table pile both empty");
      }
      d = shuffle(pile, rng);
      pile = [];
    }
    drawn.push(d.shift());
  }
  return { drawn, deck: d, tablePile: pile };
}

/**
 * IMPORTANT invariant: there is ALWAYS exactly one face-up target card
 * visible once the Matching Phase starts (until the round ends) — EXCEPT
 * for the brief window right after a non-winning knock, while
 * `pendingPlacement` is set to the knocker's player index: hands no longer
 * get replacement draws, so the player who just knocked must choose which
 * of their OWN remaining cards becomes the new target (see placeTarget
 * below) before anyone can act again.
 *
 * Matching is a FREE-FOR-ALL, not a turn: any player can tap the target
 * card at any moment they think they have a match — first tap in wins it,
 * whoever's turn it "is" otherwise. `turnIndex` controls whose job it is to
 * flip the next card from the deck if nobody has matched — every knock OR
 * flip advances it by one, regardless of who performed it, same as passing
 * a discard pile in a normal turn-based card game would. So:
 *   - Tap a card in your own hand -> attemptKnock(state, playerIdx, cardId):
 *     you're asserting that card matches the target rank, right now, no
 *     matter whose flip-turn it is. Validated server-side; a wrong guess is
 *     rejected with an error and nothing about the game state changes. If
 *     someone else's tap reached the server microseconds earlier and the
 *     target has already moved on, you get a distinct "someone already
 *     matched that" rejection instead (pass the target card's id you saw
 *     as `expectedTargetId` to get this friendlier message on a race loss).
 *     Your hand SHRINKS when you knock — no replacement is drawn. If you
 *     still have 2+ cards left afterward, YOU then choose one of them
 *     (placeTarget) to place face-up as the new target everyone else can
 *     try to match; if only 1 card would be left to choose from, you keep
 *     it instead (placing your only card wouldn't be a real "match win")
 *     and the deck supplies the next target automatically. Either way,
 *     turnIndex advances by one from wherever it currently was — a knock
 *     is still "an action on the target," so the flip obligation rotates
 *     the same way a flip itself would, rather than staying put.
 *   - Tap the deck -> flipFromDeck(state, playerIdx): only the player whose
 *     turn it is to flip may do this, and only if THEY personally have no
 *     mandatory match sitting in their own hand (the mandatory-knock rule
 *     still applies to whoever is about to flip). PRIORITY: if the card
 *     they reveal matches something in their OWN hand, it's immediately
 *     theirs — auto-knocked on their behalf rather than opening to the
 *     free-for-all (and that can chain again if the resulting refill also
 *     matches them). Flipping, with or without a chained auto-knock,
 *     still only ever advances turnIndex by exactly one, to the player
 *     after the flipper.
 */
/**
 * Core knock resolution, shared by attemptKnock and the auto-match chain
 * below — assumes `matchCard` has ALREADY been validated as a legal match
 * (attemptKnock validates before calling this; the auto-match chain only
 * ever calls it with a card findMandatoryKnock itself confirmed). Never
 * touches turnIndex — callers decide when and how far to advance it, since
 * a knock can happen standalone (advance once) or chained after a flip
 * (the whole chain counts as a single advance, from the flipper).
 */
function _resolveKnock(state, playerIdx, matchCard, rng) {
  const hand = state.hands[playerIdx];
  const handAfterRemoval = hand.filter((c) => c.id !== matchCard.id);
  const newTablePile = [...state.tablePile, matchCard, state.faceUpCard];
  const { active: remainingActive } = classifyHandForMatching(handAfterRemoval);

  if (remainingActive.length === 0) {
    // Hand fully resolved (either truly empty, or what's left is a settled
    // pair) — a real win by matching your card(s) away.
    const newHands = state.hands.map((h, i) => (i === playerIdx ? [] : h));
    return {
      ...state,
      hands: newHands,
      tablePile: newTablePile,
      faceUpCard: null,
      pendingPlacement: null,
      winnerIndex: playerIdx,
      action: { type: "knock-win", playerIdx, card: matchCard },
    };
  }

  const newHandsAfterKnock = state.hands.map((h, i) => (i === playerIdx ? handAfterRemoval : h));

  if (handAfterRemoval.length === 1) {
    // Only one card would be left to "choose" for placement — forcing that
    // choice would empty your hand by DISCARDING it, not by matching it
    // away, which shouldn't count as winning. Keep it, and draw the next
    // target from the deck instead (same source a flip would use).
    const { drawn, deck, tablePile } = drawWithReshuffle(state.deck, newTablePile, 1, rng);
    return {
      ...state,
      hands: newHandsAfterKnock,
      deck,
      tablePile,
      faceUpCard: drawn[0],
      pendingPlacement: null,
      winnerIndex: null,
      action: { type: "knock-deck-refill", playerIdx, card: matchCard, newTarget: drawn[0] },
    };
  }

  // 2+ cards remain — no target is drawn from the deck at all. The knocker
  // must choose which of their OWN remaining cards becomes the new target
  // (see placeTarget). Until they do, faceUpCard is null and nobody else
  // can act.
  return {
    ...state,
    hands: newHandsAfterKnock,
    tablePile: newTablePile,
    faceUpCard: null,
    pendingPlacement: playerIdx,
    winnerIndex: null,
    action: { type: "knock-awaiting-placement", playerIdx, card: matchCard },
  };
}

/**
 * Priority rule: whenever a new card is revealed from the deck — a manual
 * flip, or a knock's own 1-card-left refill — the player who caused that
 * reveal gets it immediately if it's theirs to take, rather than it opening
 * up to the free-for-all. Repeatedly applies _resolveKnock for `playerIdx`
 * as long as their hand still has a mandatory match for whatever card is
 * currently face-up (their own refill can chain into another match, and so
 * on), stopping as soon as there's no card to check against (a
 * pendingPlacement), the round ends (a win), or they simply don't match.
 */
function _resolveAutoMatchChain(state, playerIdx, rng) {
  let current = state;
  while ((current.winnerIndex === null || current.winnerIndex === undefined) && current.faceUpCard) {
    const match = findMandatoryKnock(current.hands[playerIdx], current.faceUpCard.rank);
    if (!match) break;
    current = _resolveKnock(current, playerIdx, match, rng);
  }
  return current;
}

function attemptKnock(state, playerIdx, cardId, expectedTargetId, rng = Math.random) {
  if (state.winnerIndex !== null && state.winnerIndex !== undefined) {
    throw new Error("This round is already over");
  }
  if (state.pendingPlacement !== null && state.pendingPlacement !== undefined) {
    throw new Error("Waiting for a new target card to be placed — try again in a moment");
  }
  if (expectedTargetId && state.faceUpCard && state.faceUpCard.id !== expectedTargetId) {
    throw new Error("Someone already matched that card — there's a new target now");
  }

  const hand = state.hands[playerIdx];
  const faceUpRank = state.faceUpCard.rank;

  const card = hand.find((c) => c.id === cardId);
  if (!card) {
    throw new Error("That card isn't in your hand");
  }
  const { active } = classifyHandForMatching(hand);
  const isValidKnock = card.rank === faceUpRank && active.some((c) => c.id === cardId);
  if (!isValidKnock) {
    throw new Error(`That card doesn't match the target (${faceUpRank}) — tap the deck instead if you have no match`);
  }

  const numPlayers = state.hands.length;
  // A knock's own 1-card-left refill can chain into more auto-matches for
  // the same player (see _resolveAutoMatchChain) before this settles.
  let result = _resolveAutoMatchChain(_resolveKnock(state, playerIdx, card, rng), playerIdx, rng);

  // A knock still advances the flip-turn by one, from wherever it
  // currently is — independent of who actually knocked. A knock is still
  // "an action on the target," same as a flip, so the obligation to flip
  // next rotates the same way; it doesn't hand the turn to the knocker.
  if (result.winnerIndex === null || result.winnerIndex === undefined) {
    result = { ...result, turnIndex: (state.turnIndex + 1) % numPlayers };
  }
  return result;
}

/**
 * Resolves a pending placement (see attemptKnock above): the player who
 * just knocked, and ONLY that player, chooses one of their remaining cards
 * to place face-up as the new target for everyone else to try to match.
 */
function placeTarget(state, playerIdx, cardId) {
  if (state.winnerIndex !== null && state.winnerIndex !== undefined) {
    throw new Error("This round is already over");
  }
  if (state.pendingPlacement !== playerIdx) {
    throw new Error(
      state.pendingPlacement === null || state.pendingPlacement === undefined
        ? "There's nothing to place right now"
        : "It's not your card to place — someone else needs to place theirs first"
    );
  }
  const hand = state.hands[playerIdx];
  const card = hand.find((c) => c.id === cardId);
  if (!card) {
    throw new Error("That card isn't in your hand");
  }
  const newHand = hand.filter((c) => c.id !== cardId);
  const newHands = state.hands.map((h, i) => (i === playerIdx ? newHand : h));
  return {
    ...state,
    hands: newHands,
    faceUpCard: card,
    pendingPlacement: null,
    winnerIndex: null,
    action: { type: "place-target", playerIdx, card },
  };
}

function flipFromDeck(state, playerIdx, rng = Math.random) {
  if (state.winnerIndex !== null && state.winnerIndex !== undefined) {
    throw new Error("This round is already over");
  }
  if (state.pendingPlacement !== null && state.pendingPlacement !== undefined) {
    throw new Error("Waiting for a new target card to be placed — try again in a moment");
  }
  if (playerIdx !== state.turnIndex) {
    throw new Error("It's not your turn to flip yet — you can still tap a matching card at any time, though");
  }

  const numPlayers = state.hands.length;
  const hand = state.hands[playerIdx];
  const faceUpRank = state.faceUpCard.rank;

  const mandatoryMatch = findMandatoryKnock(hand, faceUpRank);
  if (mandatoryMatch) {
    throw new Error(`You have a ${mandatoryMatch.rank} — that matches the target, so you must knock with it instead of flipping`);
  }

  const oldFaceUp = state.faceUpCard;
  const { drawn, deck, tablePile } = drawWithReshuffle(
    state.deck,
    oldFaceUp ? [...state.tablePile, oldFaceUp] : state.tablePile,
    1,
    rng
  );

  const flipped = {
    ...state,
    deck,
    tablePile,
    faceUpCard: drawn[0],
    winnerIndex: null,
    action: { type: "flip", playerIdx, card: drawn[0] },
  };

  // Priority: if the flipper's own hand matches the card they just
  // revealed, it's immediately theirs — auto-knocked (and able to chain
  // further, per _resolveAutoMatchChain) rather than opening to the
  // free-for-all. Either way, flipping (with or without a chained
  // auto-knock) advances the flip-turn exactly once, to the player after
  // the flipper.
  const resolved = _resolveAutoMatchChain(flipped, playerIdx, rng);
  return { ...resolved, turnIndex: (playerIdx + 1) % numPlayers };
}

/**
 * Auto-decides knock vs. flip for whoever's flip-turn it is, and
 * auto-resolves any resulting placement by placing the first remaining
 * card — used by bots (and by tests that don't care about the tap-driven
 * UI/free-for-all matching) rather than by real human players, who instead
 * call attemptKnock/flipFromDeck/placeTarget directly, and aren't limited
 * to acting only on their own flip-turn. A flip can now ALSO land on a
 * pendingPlacement (the flip-priority auto-knock chain can leave 2+ cards,
 * same as a direct knock can), so both branches resolve it the same way.
 */
function playMatchingTurn(state, rng = Math.random) {
  if (state.winnerIndex !== null && state.winnerIndex !== undefined) {
    return state;
  }
  const playerIdx = state.turnIndex;
  const hand = state.hands[playerIdx];
  const faceUpRank = state.faceUpCard.rank;
  const matchCard = findMandatoryKnock(hand, faceUpRank);
  let next = matchCard ? attemptKnock(state, playerIdx, matchCard.id, null, rng) : flipFromDeck(state, playerIdx, rng);
  if (next.pendingPlacement !== null && next.pendingPlacement !== undefined) {
    const placerIdx = next.pendingPlacement;
    const cardToPlace = next.hands[placerIdx][0];
    next = placeTarget(next, placerIdx, cardToPlace.id);
  }
  return next;
}

// ---------------------------------------------------------------------
// Orchestration: deal, check instant win, otherwise start the Matching Phase
// ---------------------------------------------------------------------

/** Shuffles a fresh deck and deals hands — the ONE deal for a round-cycle. */
function dealHands(numPlayers, rng = Math.random) {
  const shuffled = shuffle(createDeck(), rng);
  return deal(shuffled, numPlayers);
}

/**
 * Resolves the opening state for already-dealt hands against the given
 * remaining deck, checking (in priority order): the dealer's card (a J or
 * 6 as the would-be target wins the CURRENT pot for the dealer outright,
 * before any hand is looked at), then the instant-win categories, then
 * falling into the Matching Phase.
 *
 * A dealer's-card win does NOT end the round or re-deal — the same hands
 * are still in play, waiting on everyone to recast their bet. The caller
 * (rooms.js) collects that recast, then calls this again with these same
 * `hands` and the deck already advanced past the consumed card, to check
 * the next one — repeating for as long as it keeps coming up J/6.
 *
 * Returns one of:
 *   { phase: 'dealer-card-win', hands, deck, faceUpCard, dealerIndex }
 *   { phase: 'instant-win', hands, deck, winnerIndices, category, dealerIndex }
 *   { phase: 'matching', hands, deck, tablePile, faceUpCard, dealerIndex, turnIndex, winnerIndex: null, pendingPlacement: null }
 */
function resolveOpeningTarget({ hands, deck, dealerIndex }) {
  const numPlayers = hands.length;
  const targetCard = deck[0];
  const deckAfterFlip = deck.slice(1);

  if (targetCard.rank === "J" || targetCard.rank === "6") {
    return {
      phase: "dealer-card-win",
      hands,
      deck: deckAfterFlip,
      faceUpCard: targetCard,
      dealerIndex,
    };
  }

  const instant = evaluateInstantWin(hands);
  if (instant.hasWinner) {
    return {
      phase: "instant-win",
      hands,
      // No card gets flipped on a hand-based instant win, but the deck
      // itself should still be shown at the table (its count, face-down)
      // — this is the full remaining deck after dealing, untouched.
      deck,
      winnerIndices: instant.winnerIndices,
      category: instant.category,
      dealerIndex,
    };
  }

  return {
    phase: "matching",
    hands,
    deck: deckAfterFlip,
    tablePile: [],
    faceUpCard: targetCard,
    dealerIndex,
    turnIndex: (dealerIndex + 1) % numPlayers,
    winnerIndex: null,
    pendingPlacement: null,
  };
}

/**
 * Convenience one-shot wrapper: deals fresh hands and resolves the
 * opening state, exactly once. Used by simple callers/tests that don't
 * need to simulate a dealer-card-win's recast cycle — rooms.js calls
 * dealHands/resolveOpeningTarget separately instead, since it needs to
 * hold the state open across that cycle's socket round-trips.
 */
function dealAndStartRound({ numPlayers, dealerIndex, rng = Math.random }) {
  const { hands, deck } = dealHands(numPlayers, rng);
  return resolveOpeningTarget({ hands, deck, dealerIndex });
}

module.exports = {
  SUITS,
  RANKS,
  SUIT_RANK,
  RANK_VALUE,
  CATEGORY,
  makeCard,
  createDeck,
  shuffle,
  deal,
  classifyInstantWin,
  combinedTotal,
  breakInstantWinTie,
  evaluateInstantWin,
  classifyHandForMatching,
  findMandatoryKnock,
  drawWithReshuffle,
  attemptKnock,
  placeTarget,
  flipFromDeck,
  playMatchingTurn,
  dealHands,
  resolveOpeningTarget,
  dealAndStartRound,
};
