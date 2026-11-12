# Spades Prototype Lab

Two small Spades prototypes, each built to answer one question about card games on mobile. Both are playable on a phone, both log what players do, and both run on one rules engine that can move to a server without a rewrite.

Built by Muhammad Abdullah for the Senior Game Prototype Developer role at YallaPlay.

| Prototype | The question | Play |
|---|---|---|
| **Spades Blitz** | If a Spades match fits in three minutes, do more players hit Rematch? | `docs/blitz/` |
| **Spades Run** | Does a run structure with rule-bending upgrades give solo players a reason to start another session? | `docs/run/` |

The full write-up (scope cuts, metrics, decision rules, tuning, handoff) is `docs/index.html`, which is also the GitHub Pages home page.

## What's in each one

**Spades Blitz.** Team Spades cut to four hands of five tricks. Nil and bags, 8-second turns that auto-play your lowest legal card, sudden death on ties, three bots, a suggested bid. A standard-length control arm (13 tricks × 3 hands) runs on the same code so the two can be compared.

**Spades Run.** Five tables with rising targets, two seven-card hands per table. Clear a table, pick one of three Edges that bend the rules for the rest of the run (Low Trump, Peek, Bag Collector, Heart Hunter and five more). Two retry chips. The fifth table is a boss with its own rules.

## How it's built

```
engine/spades-engine.js   rules, scoring, Edges, bots. No DOM, runs in browser or Node
shared/table.js           table view and touch input, reads engine views only
shared/table.css          shared table styling
blitz/                    Blitz template + game flow, timers, telemetry
run/                      Run template + run flow, Edge picker, telemetry
tools/sim.js              bot-vs-bot rule checks and tuning
tools/build.js            inlines everything into single-file builds
docs/                     GitHub Pages output (lab page + both games)
```

- **Server-ready.** The engine is a pure state machine. `viewFor(state, seat)` returns only what that seat may know, and `applyAction` throws on anything illegal. Drop it into a Colyseus or Nakama room and it's server-authoritative as written.
- **Fair bots.** Bots decide from the same per-seat view a human gets. Difficulty is one skill number per seat.
- **Replayable.** Matches use a seeded RNG and the seed is logged, so any playtest moment can be reproduced.
- **Tested by simulation.** `node tools/sim.js` plays 5,300 full matches through the engine's legality checks with zero illegal moves. It also caught bots underbidding by 2.4 tricks per team in 13-card hands; after the fix they take about 0.6 more than they bid.
- **Tuned by simulation.** Spades Run's targets (40 / 50 / 60 / 70 / 75) came from 15,000 simulated tables: clear rates of roughly 69%, 63%, 56%, 50% and 42%, so about a third of runs clear all five.

## Analytics

Each game logs events to the device (`localStorage`) and shows a summary in its lobby under "Playtest data on this device", with a button to copy the raw events as JSON. To collect from real playtesters, point `track()` in `shared/table.js` at PostHog, GameAnalytics or your own endpoint. Nothing else changes.

Blitz events: `match_start` (mode, source, seed), `bid`, `play` (time to act, auto-played or not), `hand_end`, `match_end`, `match_quit`, `match_abandon` (tab closed mid-match), `length_feedback`, `to_lobby`.

Run events: `run_start` (source: lobby or again), `table_start`, `bid`, `hand_end`, `table_end`, `edge_offer`, `edge_pick`, `retry`, `run_end` (reason, tables cleared, edges), `table_quit`, `table_abandon`, `difficulty_feedback`.

## Run it

```bash
node tools/sim.js     # rule checks + tuning numbers
node tools/build.js   # rebuild dist/ and docs/
```

Or just open `docs/index.html` in a browser.

## Publish on GitHub Pages

Settings → Pages → Deploy from a branch → `main` / `docs`. The lab page becomes the site's home page with both games linked beside it.

## How this was made

Built AI-first in one morning. An AI coding agent wrote most of the code; the questions, scope cuts, decision rules and tuning targets in the write-up are what steered it. Both games are original variants of Spades, a public-domain card game.
