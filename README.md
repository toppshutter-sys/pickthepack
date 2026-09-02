# Pick the Pack

A real-time multiplayer card game. Players join a table, pick **Pack 5** ($5) or **Pack 10** ($10),
and play a hand of "Pick the Pack": 3 cards each, dealt and checked instantly for a Royal Sequence
(K-Q-J), Ace-2-3, a Sequence, or Same-Suit (flush) — any of those wins the pot right away. If nobody
qualifies, play falls into the Matching Phase: a face-up target card sits next to the deck, and
matching is a free-for-all — tap the target card any time you think you have a match, then tap the
card in your own hand that matches it; whoever taps first gets it, no matter whose "turn" it
technically is. If nobody has a match, whoever's flip-turn it is taps the deck to flip the next card
(that part alone still goes in order around the table). A knock removes that card from your hand with
no replacement drawn — hands get smaller as the round goes on — and then you choose one of your own
remaining cards to place face-up as the next target for everyone else to try to match (unless it would
leave you with only one card, in which case you keep it and the deck flips a fresh target instead —
only a match can win, never a placement). A wrong guess (a card that doesn't match, or a target
someone else already claimed a moment earlier) is rejected with an on-screen message instead of doing
anything. First player to match their whole hand wins the pot. The app tracks the pot as numbers only
— no real payments move through it; settle up with each other however you normally would (cash,
Venmo, etc).

The look is a dark, glassy casino-table theme with gold accents — cards deal in with a staggered pop
animation, tappable cards (your hand, the deck on your turn, the target card) breathe with a soft gold
glow, a selected card pulses brighter, the pot bumps when it changes, and the winner banner springs in.
Both the mobile app and the standalone browser demo (`pick-the-pack-demo.html`) share this look. The
mobile app uses `expo-linear-gradient` for the gradients — run `npm install` in `mobile/` after
pulling this update so it gets picked up.

The full rules this app implements are in `rules-spec.md` — read it for the exact instant-win
tiebreaks, turn mechanics, the "settled pair" rule, and the deck-reshuffle behavior.

This is two projects in one repo:

- `server/` — a small Node.js + Socket.io backend that runs the game logic and keeps everyone's
  view of the table in sync in real time. One person runs this (see below).
- `mobile/` — an Expo (React Native) app everyone runs on their own phone to actually play.

## Opening this in VS Code

1. Install [VS Code](https://code.visualstudio.com/) and [Node.js 18+](https://nodejs.org/) if you don't have them.
2. Unzip this project, then in VS Code: **File → Open Folder…** and select the `pick-the-pack` folder.
   You'll see `server/` and `mobile/` as two subfolders — that's expected, it's one repo with two apps.
3. Open a terminal in VS Code (``Ctrl+` `` / ``Cmd+` ``) for the commands below.

## 1. Run the server

The server needs to run somewhere every player's phone can reach — the simplest setup is running it
on your own laptop while everyone is on the same wifi network.

```bash
cd server
npm install
npm start
```

You should see `Pick the Pack server listening on port 4000`.

**Find your computer's LAN IP address** (the mobile app needs this — "localhost" won't work from a
phone):

- Mac: `ipconfig getifaddr en0` (or check Wi-Fi settings → Details)
- Windows: `ipconfig` and look for "IPv4 Address" under your active Wi-Fi adapter
- Linux: `hostname -I`

It'll look like `192.168.1.23`. The server address everyone enters in the app is then
`http://192.168.1.23:4000`.

Leave this terminal running for the whole game session.

## 2. Run the mobile app

In a second terminal:

```bash
cd mobile
npm install
npm start
```

This starts Expo and prints a QR code. Install **Expo Go** on your phone (App Store / Google Play),
then:

- **iPhone**: open the Camera app and scan the QR code, tap the notification.
- **Android**: open Expo Go and use its built-in QR scanner.

Do this on every player's phone, pointed at the same computer running `npm start` in `mobile/`
(they all need to be on the same wifi network as each other and as the server).

Each player:
1. Opens the app, enters the **server address** from step 1 (e.g. `http://192.168.1.23:4000`).
2. Enters their name.
3. First player picks a pack and taps **Create Room** — this gives a 5-letter room code.
4. Everyone else enters that code and taps **Join Room**.
5. Once at least 2 players are in, anyone can tap **Start Round** — everyone antes, hands are
   dealt, and the deck/target card appear. Matching is a free-for-all: at any moment, tap the target
   card if you think you have a match, then tap the card in your hand that matches it — first to tap
   wins it, whoever's turn it "is". A knock removes that card from your hand (no replacement drawn),
   and if you still have 2+ cards left, you then tap one of your own remaining cards to place it
   face-up as the next target for everyone else to match (with only one card left, you keep it and
   the deck flips a fresh target instead). If nobody has a match, only the player whose flip-turn it
   is can tap the deck to flip the next card. Guess wrong (or tap the deck out of turn, or race-lose a
   target to someone else) and it's rejected with an on-screen message instead of doing anything.
   First to match their whole hand wins the pot and deals next via **Deal Next Round**.

## Project structure

```
pick-the-pack/
  rules-spec.md          # the confirmed rules — source of truth for the game logic
  server/
    src/gameEngine.js     # pure game-logic functions (dealing, matching-phase turns, win detection)
    src/gameEngine.test.js
    smoke-test.js          # end-to-end test: boots a real server, plays several full rounds over sockets
    src/rooms.js          # room/lobby/pot management, wraps gameEngine.js
    src/index.js           # Express + Socket.io server
  mobile/
    App.js                 # top-level screen router
    src/socket.js           # socket.io-client connection helper
    src/components/         # Card, Hand
    src/screens/             # Home, Lobby, Game
```

## Running the game-engine tests

```bash
cd server
npm test          # unit tests for the matching-phase logic (pairs, knocks, win condition)
node smoke-test.js  # end-to-end: real server + two simulated players, several full rounds
```

## Notes / known limitations (good next steps if you keep building this)

- Everything is in-memory on the server — restarting it clears all active rooms. Fine for a casual
  game night; would need a database for anything longer-lived.
- No authentication — anyone with the room code and reachable server address can join.
- No reconnect-with-same-seat handling yet if a player's app is killed mid-round; they can rejoin
  the room but won't be slotted back into an in-progress hand.
- Deploying the server somewhere public (instead of your laptop on local wifi) would let players
  join from anywhere, not just the same network — that's a reasonable next step if this becomes a
  regular game. See `DEPLOYMENT.md` for two ready-to-use options (Render and Fly.io) — the mobile
  app just needs the hosted `https://...` address typed into the same server-address field, no code
  changes required.
