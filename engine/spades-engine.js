/*
 * Spades engine
 * Pure rules and state. No DOM, no timers, no network.
 *
 * Clients only ever receive viewFor(state, seat), which strips the other
 * three hands. That keeps hidden information on whoever owns the state,
 * so this file can run unchanged inside an authoritative server room
 * (Colyseus, Nakama, a plain Node websocket) when a prototype graduates.
 *
 * Seats go clockwise: 0 South (you), 1 West, 2 North (partner), 3 East.
 * Team 0 = seats 0 and 2. Team 1 = seats 1 and 3.
 */
(function (root) {
  'use strict';

  var SUITS = ['S', 'H', 'D', 'C'];
  var SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  var RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var RANK_NAME = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
  var HAND_ORDER = { S: 0, H: 1, C: 2, D: 3 }; // alternates colours in a fanned hand

  // Rule-bending "Edges" used by Spades Run. All of them help team 0 only.
  var EDGES = {
    lowTrump:      { name: 'Low Trump',      text: 'Your 2♠ beats every other spade.' },
    earlySpades:   { name: 'Early Spades',   text: 'You can lead spades before they are broken.' },
    loadedDeal:    { name: 'Loaded Deal',    text: 'Each deal, your lowest card is swapped for an ace or king from the deck.' },
    peek:          { name: 'Peek',           text: 'See one card from each rival’s hand every deal.' },
    bagCollector:  { name: 'Bag Collector',  text: 'Overtricks score 5 points each and never cost you a bag penalty.' },
    heartHunter:   { name: 'Heart Hunter',   text: '+5 for every trick your team wins that contains a heart.' },
    exactChange:   { name: 'Exact Change',   text: 'Make your bid with zero overtricks and the bid scores double.' },
    safetyNet:     { name: 'Safety Net',     text: 'A failed team bid scores 0 instead of going negative.' },
    nilSpecialist: { name: 'Nil Specialist', text: 'Your team’s nil bids are worth 100 instead of 50.' }
  };

  function suitOf(c) { return c.charAt(0); }
  function rankOf(c) { return +c.slice(1); }
  function label(c) { var r = rankOf(c); return (RANK_LABEL[r] || r) + SYM[suitOf(c)]; }
  function rankLabel(c) { var r = rankOf(c); return String(RANK_LABEL[r] || r); }
  function speak(c) { var r = rankOf(c); return (RANK_NAME[r] || r) + ' of ' + SUIT_NAME[suitOf(c)]; }
  function team(s) { return s % 2; }
  function partner(s) { return (s + 2) % 4; }

  // Small seeded RNG (mulberry32). State is a plain number so the whole
  // match stays JSON-serialisable and replayable from its seed.
  function rand(st) {
    var t = (st.rng = (st.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(st, a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand(st) * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function freshDeck() {
    var d = [];
    SUITS.forEach(function (s) { for (var r = 2; r <= 14; r++) d.push(s + r); });
    return d;
  }
  function sortHand(h) {
    return h.sort(function (a, b) {
      return (HAND_ORDER[suitOf(a)] - HAND_ORDER[suitOf(b)]) || (rankOf(b) - rankOf(a));
    });
  }
  function hasEdge(cfg, id) { return cfg.mods.indexOf(id) !== -1; }

  // Trick-taking strength of a card. Spades beat everything, the led suit
  // beats off-suit discards, which never win.
  function power(cfg, card, seat, led) {
    var s = suitOf(card), r = rankOf(card);
    if (s === 'S') {
      if (seat === 0 && r === 2 && hasEdge(cfg, 'lowTrump')) return 115;
      return 100 + r;
    }
    return s === led ? r : 0;
  }

  function createMatch(opts) {
    var cfg = {
      handSize: 5, hands: 4, suddenDeath: true, mods: [], boss: false, seed: 1
    };
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) cfg[k] = opts[k];
    cfg.mods = (cfg.mods || []).slice();
    var st = {
      cfg: cfg,
      rng: (cfg.seed >>> 0) || 1,
      handNo: 0,
      dealer: 3, // seat 0 bids and leads first on hand one
      scores: [0, 0],
      bags: [0, 0],
      results: [],
      matchOver: false,
      phase: 'init'
    };
    startHand(st);
    return st;
  }

  function startHand(st) {
    var n = st.cfg.handSize;
    var d = shuffle(st, freshDeck());
    st.hands = [0, 1, 2, 3].map(function (i) { return sortHand(d.slice(i * n, (i + 1) * n)); });
    st.undealt = d.slice(4 * n);
    if (hasEdge(st.cfg, 'loadedDeal')) loadedDeal(st);
    st.peeks = null;
    if (hasEdge(st.cfg, 'peek')) {
      st.peeks = {};
      [1, 3].forEach(function (s) {
        var h = st.hands[s];
        st.peeks[s] = h[Math.floor(rand(st) * h.length)];
      });
    }
    st.bids = [null, null, null, null];
    st.tricks = [0, 0, 0, 0];
    st.heartTricks = [0, 0];
    st.trick = [];
    st.played = [];
    st.trickNo = 0;
    st.spadesBroken = false;
    st.lastTrick = null;
    st.turn = (st.dealer + 1) % 4;
    st.leader = st.turn;
    st.phase = 'bidding';
  }

  // Loaded Deal: swap seat 0's weakest card for the best ace/king left in the deck.
  function loadedDeal(st) {
    var pool = st.undealt.filter(function (c) { return rankOf(c) >= 13; });
    if (!pool.length) return;
    pool.sort(function (a, b) { return rankOf(b) - rankOf(a) || (suitOf(a) === 'S' ? -1 : 1); });
    var give = pool[0];
    var mine = st.hands[0].slice().sort(function (a, b) {
      var sa = suitOf(a) === 'S' ? 1 : 0, sb = suitOf(b) === 'S' ? 1 : 0;
      return (sa - sb) || (rankOf(a) - rankOf(b));
    });
    var take = mine[0];
    st.hands[0] = sortHand(st.hands[0].filter(function (c) { return c !== take; }).concat([give]));
    st.undealt = st.undealt.filter(function (c) { return c !== give; }).concat([take]);
  }

  function nilAllowed(st, seat) {
    return !(st.cfg.boss && team(seat) === 0);
  }

  function legal(st, seat) {
    if (st.phase !== 'playing' || st.turn !== seat) return [];
    var h = st.hands[seat];
    if (st.trick.length === 0) {
      var free = st.spadesBroken || (seat === 0 && hasEdge(st.cfg, 'earlySpades'));
      if (!free) {
        var nonSpades = h.filter(function (c) { return suitOf(c) !== 'S'; });
        if (nonSpades.length) return nonSpades;
      }
      return h.slice();
    }
    var led = suitOf(st.trick[0].card);
    var follow = h.filter(function (c) { return suitOf(c) === led; });
    return follow.length ? follow : h.slice();
  }

  function trickWinner(cfg, trick) {
    var led = suitOf(trick[0].card);
    var best = trick[0], bestP = power(cfg, best.card, best.seat, led);
    for (var i = 1; i < trick.length; i++) {
      var p = power(cfg, trick[i].card, trick[i].seat, led);
      if (p > bestP) { best = trick[i]; bestP = p; }
    }
    return best.seat;
  }

  function scoreTeam(st, t) {
    var cfg = st.cfg;
    var mine = t === 0;
    function edge(id) { return mine && hasEdge(cfg, id); }
    var r = {
      team: t, bid: 0, won: 0, made: null, base: 0, bags: 0, bagPts: 0,
      nil: [], nilPts: 0, penalty: 0, bonus: 0, notes: [], total: 0
    };
    var nilValue = edge('nilSpecialist') ? 100 : 50;
    var nilTricks = 0, contractWon = 0;
    [t, t + 2].forEach(function (s) {
      var b = st.bids[s], w = st.tricks[s];
      r.won += w;
      if (b === 0) {
        var ok = w === 0;
        r.nil.push({ seat: s, ok: ok });
        r.nilPts += ok ? nilValue : -nilValue;
        nilTricks += w;
      } else {
        r.bid += b;
        contractWon += w;
      }
    });
    if (r.bid > 0) {
      if (contractWon >= r.bid) {
        r.made = true;
        r.base = 10 * r.bid;
        r.bags = contractWon - r.bid + nilTricks;
        if (edge('exactChange') && r.bags === 0) {
          r.base *= 2;
          r.notes.push('Exact Change doubled the bid');
        }
      } else {
        r.made = false;
        var mult = (mine && cfg.boss) ? 2 : 1;
        if (edge('safetyNet')) {
          r.base = 0;
          r.notes.push('Safety Net caught the failed bid');
        } else {
          r.base = -10 * r.bid * mult;
          if (mult > 1) r.notes.push('Boss table: failed bid cost double');
        }
        r.bags = nilTricks;
      }
    } else {
      r.bags = nilTricks;
    }
    if (edge('bagCollector')) {
      r.bagPts = r.bags * 5;
      if (r.bags) r.notes.push('Bag Collector: ' + r.bags + ' × 5');
    } else {
      r.bagPts = r.bags;
      st.bags[t] += r.bags;
      while (st.bags[t] >= 5) {
        st.bags[t] -= 5;
        r.penalty -= 50;
        r.notes.push('Five bags: −50');
      }
    }
    if (edge('heartHunter') && st.heartTricks[t]) {
      r.bonus += 5 * st.heartTricks[t];
      r.notes.push('Heart Hunter: ' + st.heartTricks[t] + ' × 5');
    }
    r.total = r.base + r.bagPts + r.nilPts + r.penalty + r.bonus;
    return r;
  }

  function endHand(st) {
    var res = [scoreTeam(st, 0), scoreTeam(st, 1)];
    st.scores[0] += res[0].total;
    st.scores[1] += res[1].total;
    var entry = { hand: st.handNo, res: res, bids: st.bids.slice(), tricks: st.tricks.slice() };
    st.results.push(entry);
    st.phase = 'handDone';
    var played = st.handNo + 1;
    st.matchOver = played >= st.cfg.hands &&
      !(st.cfg.suddenDeath && st.scores[0] === st.scores[1]);
    return entry;
  }

  /*
   * applyAction mutates state and returns what happened, so a UI or a
   * server can broadcast events. Throws on anything illegal, which is
   * exactly what an authoritative server wants.
   */
  function applyAction(st, seat, a) {
    var out = { type: a.type, seat: seat };
    if (a.type === 'bid') {
      if (st.phase !== 'bidding') throw new Error('Not bidding');
      if (st.turn !== seat) throw new Error('Not your turn to bid');
      var v = a.value;
      if (!(v === Math.floor(v) && v >= 0 && v <= st.cfg.handSize)) throw new Error('Bad bid');
      if (v === 0 && !nilAllowed(st, seat)) throw new Error('Nil is not allowed here');
      st.bids[seat] = v;
      out.value = v;
      if (st.bids.every(function (b) { return b !== null; })) {
        st.phase = 'playing';
        st.turn = st.leader;
        out.biddingDone = true;
      } else {
        st.turn = (seat + 1) % 4;
      }
      return out;
    }
    if (a.type === 'play') {
      if (st.phase !== 'playing') throw new Error('Not playing');
      if (st.turn !== seat) throw new Error('Not your turn');
      var ok = legal(st, seat);
      if (ok.indexOf(a.card) === -1) throw new Error('Illegal card ' + a.card);
      st.hands[seat] = st.hands[seat].filter(function (c) { return c !== a.card; });
      if (suitOf(a.card) === 'S' && !st.spadesBroken) {
        st.spadesBroken = true;
        out.spadesBroken = true;
      }
      st.trick.push({ seat: seat, card: a.card });
      st.played.push(a.card);
      out.card = a.card;
      if (st.trick.length === 4) {
        var w = trickWinner(st.cfg, st.trick);
        st.tricks[w]++;
        if (st.trick.some(function (p) { return suitOf(p.card) === 'H'; })) st.heartTricks[team(w)]++;
        st.lastTrick = { cards: st.trick.slice(), winner: w };
        out.trick = st.lastTrick;
        st.trick = [];
        st.trickNo++;
        st.leader = st.turn = w;
        if (st.hands[0].length === 0) out.hand = endHand(st);
      } else {
        st.turn = (seat + 1) % 4;
      }
      return out;
    }
    if (a.type === 'next') {
      if (st.phase !== 'handDone') throw new Error('Hand not finished');
      if (st.matchOver) { st.phase = 'matchDone'; out.matchDone = true; return out; }
      st.dealer = (st.dealer + 1) % 4;
      st.handNo++;
      startHand(st);
      return out;
    }
    throw new Error('Unknown action ' + a.type);
  }

  // What one seat is allowed to know. Never includes another seat's cards
  // (apart from Peek cards, which the rules reveal on purpose).
  function viewFor(st, seat) {
    var peeks = null;
    if (seat === 0 && st.peeks) {
      peeks = {};
      Object.keys(st.peeks).forEach(function (s) {
        var c = st.peeks[s];
        if (st.hands[s].indexOf(c) !== -1) peeks[s] = c;
      });
    }
    return {
      seat: seat,
      cfg: { handSize: st.cfg.handSize, hands: st.cfg.hands, mods: st.cfg.mods.slice(), boss: st.cfg.boss },
      handSize: st.cfg.handSize,
      handNo: st.handNo,
      dealer: st.dealer,
      phase: st.phase,
      turn: st.turn,
      leader: st.leader,
      bids: st.bids.slice(),
      tricks: st.tricks.slice(),
      trick: st.trick.map(function (p) { return { seat: p.seat, card: p.card }; }),
      played: st.played.slice(),
      trickNo: st.trickNo,
      spadesBroken: st.spadesBroken,
      scores: st.scores.slice(),
      bags: st.bags.slice(),
      counts: st.hands.map(function (h) { return h.length; }),
      hand: st.hands[seat].slice(),
      legal: legal(st, seat),
      nilAllowed: nilAllowed(st, seat),
      lastTrick: st.lastTrick,
      results: st.results,
      matchOver: st.matchOver,
      peeks: peeks
    };
  }

  /* ---------------- Bots ----------------
   * Bots read a view, never the full state, so they play with exactly the
   * information a human in that seat would have.
   */
  function estimateTricks(hand, n) {
    var by = { S: [], H: [], D: [], C: [] };
    hand.forEach(function (c) { by[suitOf(c)].push(rankOf(c)); });
    var e = 0, sp = by.S.length;
    by.S.forEach(function (r) {
      if (r === 14) e += 1;
      else if (r === 13) e += sp >= 2 ? 0.9 : 0.55;
      else if (r === 12) e += sp >= 3 ? 0.7 : 0.3;
      else if (r === 11) e += sp >= 4 ? 0.5 : 0.15;
    });
    var lowS = by.S.filter(function (r) { return r < 11; }).length;
    var par = Math.max(1, Math.round(n / 4));
    e += Math.max(0, lowS - par) * 0.5;
    ['H', 'D', 'C'].forEach(function (s) {
      var L = by[s].length;
      by[s].forEach(function (r) {
        if (r === 14) e += L <= Math.max(3, n / 3) ? 0.9 : 0.7;
        else if (r === 13) e += L >= 2 ? 0.55 : 0.15;
        else if (r === 12) e += L >= 3 ? 0.25 : 0.05;
      });
      if (L === 0 && sp >= 2) e += 0.45;
      if (L === 1 && sp >= 3 && n > 7) e += 0.2;
    });
    // Longer hands win more tricks with middling cards; scale so bots
    // don't sandbag (tuned with tools/sim.js).
    if (n > 5) e = e * (1 + 0.035 * (n - 5)) + 0.05 * (n - 5);
    return e;
  }

  function suggestBid(view) {
    var n = view.handSize;
    var e = estimateTricks(view.hand, n);
    var pb = view.bids[partner(view.seat)];
    if (view.nilAllowed && e < 0.4 && !view.hand.some(function (c) { return suitOf(c) === 'S' && rankOf(c) >= 10; }) && pb !== 0) return 0;
    var b = Math.max(1, Math.round(e - 0.1));
    if (pb !== null && pb > 0) b = Math.min(b, Math.max(1, n - pb - 1));
    return Math.min(n, b);
  }

  function botBid(view, skill, rng) {
    var b = suggestBid(view);
    if (b === 0 && rng() > 0.75) b = 1;
    if (rng() > skill) b = Math.min(view.handSize, Math.max(1, b + (rng() < 0.5 ? -1 : 1)));
    if (b === 0 && !view.nilAllowed) b = 1;
    return b;
  }

  function currentWinner(view) {
    var t = view.trick;
    if (!t.length) return null;
    var led = suitOf(t[0].card), best = t[0], bp = power(view.cfg, best.card, best.seat, led);
    for (var i = 1; i < t.length; i++) {
      var p = power(view.cfg, t[i].card, t[i].seat, led);
      if (p > bp) { best = t[i]; bp = p; }
    }
    return { seat: best.seat, card: best.card, power: bp, led: led };
  }

  // A card is "boss" when every higher card of its suit is gone or in our hand.
  function isBoss(view, card) {
    var s = suitOf(card), r = rankOf(card);
    for (var x = r + 1; x <= 14; x++) {
      var id = s + x;
      if (view.played.indexOf(id) === -1 && view.hand.indexOf(id) === -1) return false;
    }
    return true;
  }

  function byLow(a, b) {
    var sa = suitOf(a) === 'S' ? 1 : 0, sb = suitOf(b) === 'S' ? 1 : 0;
    return (sa - sb) || (rankOf(a) - rankOf(b));
  }

  function botPlay(view, skill, rng) {
    var me = view.seat, cfg = view.cfg;
    var legalCards = view.legal.slice();
    if (legalCards.length === 1) return legalCards[0];
    if (rng() < (1 - skill) * 0.45) return legalCards[Math.floor(rng() * legalCards.length)];

    var mate = partner(me), myTeam = team(me);
    var amNil = view.bids[me] === 0, mateNil = view.bids[mate] === 0;
    var teamBid = 0, teamWon = 0;
    [myTeam, myTeam + 2].forEach(function (s) {
      if (view.bids[s] > 0) { teamBid += view.bids[s]; teamWon += view.tricks[s]; }
    });
    var need = teamBid - teamWon;
    var low = legalCards.slice().sort(byLow);
    var lowest = low[0], highest = low[low.length - 1];

    if (view.trick.length === 0) {
      if (amNil) return lowest;
      if (mateNil) return highest;
      if (need <= 0) return lowest;
      var bosses = legalCards.filter(function (c) { return suitOf(c) !== 'S' && isBoss(view, c); });
      if (bosses.length) return bosses.sort(function (a, b) { return rankOf(b) - rankOf(a); })[0];
      var counts = {};
      legalCards.forEach(function (c) { counts[suitOf(c)] = (counts[suitOf(c)] || 0) + 1; });
      var side = legalCards.filter(function (c) { return suitOf(c) !== 'S'; });
      if (side.length) {
        side.sort(function (a, b) { return (counts[suitOf(b)] - counts[suitOf(a)]) || (rankOf(a) - rankOf(b)); });
        return side[0];
      }
      return need > 0 ? highest : lowest;
    }

    var cur = currentWinner(view);
    var beats = legalCards.filter(function (c) { return power(cfg, c, me, cur.led) > cur.power; })
      .sort(function (a, b) { return power(cfg, a, me, cur.led) - power(cfg, b, me, cur.led); });
    var losers = legalCards.filter(function (c) { return beats.indexOf(c) === -1; })
      .sort(function (a, b) { return power(cfg, b, me, cur.led) - power(cfg, a, me, cur.led) || byLow(b, a); });
    var last = view.trick.length === 3;

    if (amNil) return losers.length ? losers[0] : beats[0];
    if (mateNil && cur.seat === mate) return beats.length ? beats[0] : lowest;

    var oppNilWinning = view.bids[cur.seat] === 0 && team(cur.seat) !== myTeam;
    if (oppNilWinning) return losers.length ? losers[0] : beats[0];

    if (cur.seat === mate) {
      var safe = last || isBoss(view, cur.card) || suitOf(cur.card) === 'S';
      if (safe) return losers.length ? losers[losers.length - 1] : lowest;
    }
    if (need > 0) {
      if (beats.length) return beats[0];
      return losers.length ? losers[losers.length - 1] : lowest;
    }
    if (losers.length) return losers[0];
    return beats[0];
  }

  function botAction(view, skill, rng) {
    rng = rng || Math.random;
    if (view.phase === 'bidding') return { type: 'bid', value: botBid(view, skill, rng) };
    if (view.phase === 'playing') return { type: 'play', card: botPlay(view, skill, rng) };
    return null;
  }

  var api = {
    SUITS: SUITS, SYM: SYM, EDGES: EDGES,
    createMatch: createMatch, applyAction: applyAction, viewFor: viewFor,
    botAction: botAction, suggestBid: suggestBid, estimateTricks: estimateTricks,
    suitOf: suitOf, rankOf: rankOf, label: label, rankLabel: rankLabel, speak: speak,
    team: team, partner: partner, power: power, currentWinner: currentWinner
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Spades = api;
})(typeof self !== 'undefined' ? self : this);
