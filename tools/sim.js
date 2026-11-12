// Bot-vs-bot simulation. Two jobs:
// 1) rule check: thousands of full matches, every action goes through the
//    engine's own legality checks, plus invariants on tricks and scores;
// 2) tuning: score distributions used to set Spades Run's table targets.
const S = require('../engine/spades-engine.js');

function rngFrom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function playMatch(cfg, skills, seed) {
  const rng = rngFrom(seed * 7919 + 13);
  const st = S.createMatch(Object.assign({ seed }, cfg));
  let guard = 0;
  const hands = [];
  while (st.phase !== 'matchDone') {
    if (++guard > 5000) throw new Error('runaway match');
    if (st.phase === 'handDone') {
      const sumTricks = st.tricks.reduce((a, b) => a + b, 0);
      if (sumTricks !== cfg.handSize) throw new Error('trick count ' + sumTricks);
      if (st.hands.some(h => h.length)) throw new Error('cards left over');
      hands.push(st.results[st.results.length - 1]);
      S.applyAction(st, 0, { type: 'next' });
      continue;
    }
    const seat = st.turn;
    const v = S.viewFor(st, seat);
    // hidden info check: a view never carries other hands
    if (JSON.stringify(v).length && v.hand.some(c => !st.hands[seat].includes(c))) throw new Error('view leak');
    const a = S.botAction(v, skills[seat], rng);
    S.applyAction(st, seat, a);
  }
  return { st, hands };
}

function check(name, cfg, n) {
  let wins = 0, made = 0, bids = 0, nils = 0, extraHands = 0;
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const { st, hands } = playMatch(cfg, [0.85, 0.85, 0.85, 0.85], i);
    if (st.scores[0] > st.scores[1]) wins++;
    if (hands.length > cfg.hands) extraHands++;
    hands.forEach(h => h.res.forEach(r => { if (r.bid > 0) { bids++; if (r.made) made++; } nils += r.nil.length; }));
  }
  console.log(`${name}: ${n} matches OK in ${Date.now() - t0}ms | team0 win ${(100 * wins / n).toFixed(1)}% | team bids made ${(100 * made / bids).toFixed(1)}% | nil bids ${nils} | sudden-death matches ${extraHands}`);
}

function runTable(mods, skill, seed, boss) {
  const { st } = playMatch({ handSize: 7, hands: 2, suddenDeath: false, mods, boss }, [0.85, skill, 0.85, skill], seed);
  return st.scores[0];
}

function pct(arr, p) { const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; }

if (require.main === module) {
  check('Blitz 5x4', { handSize: 5, hands: 4, suddenDeath: true }, 3000);
  check('Control 13x3', { handSize: 13, hands: 3, suddenDeath: true }, 800);
  const allEdges = Object.keys(S.EDGES);
  check('Run table, every edge on', { handSize: 7, hands: 2, suddenDeath: false, mods: allEdges, boss: true }, 1500);

  // Tuning: two-hand team-0 score with 0, 1, 2, 3 and 4 random edges.
  const N = 3000;
  const skills = [0.55, 0.65, 0.75, 0.85, 0.95];
  for (let k = 0; k <= 4; k++) {
    const scores = [];
    for (let i = 1; i <= N; i++) {
      const r = rngFrom(i * 31 + k);
      const pool = allEdges.slice();
      const mods = [];
      for (let j = 0; j < k; j++) mods.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      scores.push(runTable(mods, skills[Math.min(k, 4)], i + 1000 * k, k === 4));
    }
    console.log(`edges=${k} vs skill ${skills[Math.min(k, 4)]}${k === 4 ? ' (boss)' : ''}: p25 ${pct(scores, 0.25)} | median ${pct(scores, 0.5)} | p75 ${pct(scores, 0.75)} | mean ${(scores.reduce((a, b) => a + b, 0) / N).toFixed(1)}`);
  }
}
module.exports = { playMatch, rngFrom, runTable };
