(function () {
  'use strict';
  var S = self.Spades, UI = self.SpadesUI;
  var $ = function (id) { return document.getElementById(id); };

  // Targets tuned with tools/sim.js (15,000 simulated tables): roughly
  // 69% / 63% / 56% / 50% / 42% clear rates for a solid player, ~31% full runs.
  var TABLES = [
    { name: 'Corner Café', rivals: ['Mo', 'Ada'], target: 40, skill: 0.55 },
    { name: 'Night Shift', rivals: ['Kai', 'Rue'], target: 50, skill: 0.65 },
    { name: 'The Old Club', rivals: ['Vera', 'Hugo'], target: 60, skill: 0.75 },
    { name: 'Penthouse', rivals: ['Iris', 'Dax'], target: 70, skill: 0.85 },
    { name: 'The House', rivals: ['Dealer', 'Pit Boss'], target: 75, skill: 0.95, boss: true,
      twist: 'No nil bids for your team. A failed bid costs double.' }
  ];
  var PARTNER = 'Nadia', PARTNER_SKILL = 0.85;
  var HAND_SIZE = 7, HANDS = 2, BOT_MS = 480, HOLD_MS = 750, CHIPS = 2;
  var EDGE_GLYPH = {
    lowTrump: ['2♠', false], earlySpades: ['♠', false], loadedDeal: ['A', false], peek: ['♦', true],
    bagCollector: ['+5', false], heartHunter: ['♥', true], exactChange: ['=', false], safetyNet: ['♣', false], nilSpecialist: ['0', true]
  };
  var T = UI.telemetry('spades-run-events-v1');

  var run = null, st = null, table = null, gen = 0, inTable = false, abandoned = false, tableStarted = 0;

  function show(id) { ['lobby', 'ladder', 'game', 'pick', 'end'].forEach(function (s) { $(s).hidden = s !== id; }); }
  function num(n) { return n < 0 ? '−' + Math.abs(n) : String(n); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadBest() { try { return JSON.parse(localStorage.getItem('spades-run-best')) || null; } catch (e) { return null; } }
  function saveBest(b) { try { localStorage.setItem('spades-run-best', JSON.stringify(b)); } catch (e) {} }

  function rungsHTML(state) {
    return TABLES.map(function (t, i) {
      var cls = 'rung' + (t.boss ? ' boss' : '');
      var status = '';
      if (state) {
        if (i < state.tableIdx || (state.done && state.results[i] && state.results[i].cleared)) { cls += ' done'; status = state.results[i] ? 'Scored ' + num(state.results[i].score) : 'Cleared'; }
        else if (i === state.tableIdx && !state.done) cls += ' now';
        else cls += ' locked';
        if (state.done && i === state.tableIdx && !state.won) status = state.results[i] ? 'Stopped here at ' + num(state.results[i].score) : 'Stopped here';
      }
      var sub = t.boss ? t.twist : 'vs ' + t.rivals.join(' & ');
      return '<li class="' + cls + '"><span class="n">' + (i + 1) + '</span><span class="nm"><b>' + esc(t.name) + '</b><span>' + esc(status || sub) + '</span></span>' +
        '<span class="tg"><b class="num">' + t.target + '</b><span>target</span></span></li>';
    }).join('');
  }

  function ownedHTML(edges) {
    if (!edges.length) return '<span class="none">None yet. Clear a table to pick one.</span>';
    return edges.map(function (id) { return '<span class="edge-mini" title="' + esc(S.EDGES[id].text) + '">' + esc(S.EDGES[id].name) + '</span>'; }).join('');
  }

  /* ---------------- Run flow ---------------- */
  function startRun(source) {
    run = { id: Math.random().toString(36).slice(2, 9), tableIdx: 0, chips: CHIPS, edges: [], results: [], attempts: 0, startedAt: Date.now(), done: false, won: false };
    T.track('run_start', { r: run.id, source: source });
    showLadder();
  }

  function showLadder() {
    var t = TABLES[run.tableIdx];
    $('ladderEyebrow').textContent = 'Your run · table ' + (run.tableIdx + 1) + ' of ' + TABLES.length;
    $('ladderTitle').textContent = t.name;
    var c = '';
    for (var i = 0; i < CHIPS; i++) c += '<i class="' + (i < run.chips ? '' : 'used') + '"></i>';
    $('chipsLeft').innerHTML = c + '<span>' + run.chips + ' retry chip' + (run.chips === 1 ? '' : 's') + ' left</span>';
    $('runRungs').innerHTML = rungsHTML(run);
    $('owned').innerHTML = ownedHTML(run.edges);
    $('sitDown').textContent = 'Sit down at ' + t.name;
    show('ladder');
  }

  function playTable() {
    gen++;
    var t = TABLES[run.tableIdx];
    run.attempts++;
    var seed = (Math.random() * 2147483647) | 0;
    st = S.createMatch({ handSize: HAND_SIZE, hands: HANDS, suddenDeath: false, mods: run.edges, boss: !!t.boss, seed: seed });
    table = new UI.Table($('tableHost'), { names: ['You', t.rivals[0], PARTNER, t.rivals[1]] });
    $('tName').textContent = 'Table ' + (run.tableIdx + 1) + ' · ' + t.name;
    var strip = run.edges.map(function (id) { return '<button type="button" data-e="' + id + '">' + esc(S.EDGES[id].name) + '</button>'; }).join('');
    if (t.boss) strip = '<button type="button" class="boss" data-e="boss">Boss rules</button>' + strip;
    $('edgeStrip').innerHTML = strip || '<span style="font-size:12px;color:var(--muted)">No Edges yet</span>';
    inTable = true;
    abandoned = false;
    tableStarted = Date.now();
    T.track('table_start', { r: run.id, table: run.tableIdx, attempt: run.attempts, edges: run.edges.slice(), seed: seed });
    show('game');
    render();
    loop(gen);
  }

  function hud() {
    var t = TABLES[run.tableIdx];
    var sc = st.scores[0];
    var pct = Math.max(0, Math.min(100, (sc / t.target) * 100));
    var bar = $('progBar');
    bar.style.width = pct + '%';
    bar.classList.toggle('met', sc >= t.target);
    $('progTxt').innerHTML = num(sc) + '<span> / ' + t.target + '</span>';
    $('handLbl').textContent = (st.handNo + 1) + '/' + HANDS;
    if (st.phase === 'bidding') table.setInfo('Bidding');
    else if (st.phase === 'playing') table.setInfo('Trick ' + Math.min(st.trickNo + 1, HAND_SIZE) + ' of ' + HAND_SIZE + (st.spadesBroken ? ' · ♠ broken' : ''));
    else table.setInfo('');
  }
  function view() { return S.viewFor(st, 0); }
  function render() {
    table.render(view(), { boostCard: run.edges.indexOf('lowTrump') !== -1 ? 'S2' : null });
    hud();
  }

  async function loop(g) {
    while (g === gen) {
      if (st.phase === 'bidding') {
        var seat = st.turn;
        render();
        if (seat === 0) {
          var v = view();
          var sug = S.suggestBid(v);
          var r = await table.awaitBid(v, sug, 0);
          if (g !== gen) return;
          S.applyAction(st, 0, { type: 'bid', value: r.value });
          T.track('bid', { r: run.id, table: run.tableIdx, hand: st.handNo, value: r.value, suggested: sug });
        } else {
          await UI.sleep(BOT_MS);
          if (g !== gen) return;
          var a = S.botAction(S.viewFor(st, seat), seat === 2 ? PARTNER_SKILL : TABLES[run.tableIdx].skill);
          S.applyAction(st, seat, a);
          if (a.value === 0) table.toast(table.names[seat] + ' bids Nil');
        }
        continue;
      }
      if (st.phase === 'playing') {
        var p = st.turn, card;
        render();
        if (p === 0) {
          var pr = await table.awaitPlay(view(), 0);
          if (g !== gen) return;
          card = pr.card;
        } else {
          await UI.sleep(BOT_MS);
          if (g !== gen) return;
          card = S.botAction(S.viewFor(st, p), p === 2 ? PARTNER_SKILL : TABLES[run.tableIdx].skill).card;
        }
        var res = S.applyAction(st, p, { type: 'play', card: card });
        table.addPlay(p, card);
        render();
        if (res.spadesBroken && !res.trick) table.toast('Spades are broken');
        if (res.trick) {
          if (res.trick.cards.some(function (x) { return x.seat === 0 && x.card === 'S2'; }) && res.trick.winner === 0 && run.edges.indexOf('lowTrump') !== -1) table.toast('Low Trump!');
          await table.collect(res.trick.winner, HOLD_MS);
          if (g !== gen) return;
        }
        continue;
      }
      if (st.phase === 'handDone') {
        render();
        var entry = st.results[st.results.length - 1];
        T.track('hand_end', { r: run.id, table: run.tableIdx, hand: entry.hand, us: entry.res[0].total, bid: entry.bids[0], won: entry.tricks[0] });
        await handSheet(entry);
        if (g !== gen) return;
        S.applyAction(st, 0, { type: 'next' });
        continue;
      }
      if (st.phase === 'matchDone') { tableDone(); return; }
      return;
    }
  }

  function handSheet(entry) {
    var t = TABLES[run.tableIdx];
    var r = entry.res[0];
    var rows = [
      ['Team bid', r.bid ? String(r.bid) : '—'],
      ['Tricks won', String(r.won)],
      ['Bid points', num(r.base)]
    ];
    if (r.bags) rows.push(['Overtricks', '+' + r.bagPts]);
    var nilVal = run.edges.indexOf('nilSpecialist') !== -1 ? 100 : 50;
    r.nil.forEach(function (n) { rows.push([table.names[n.seat] + (n.ok ? ' made Nil' : ' missed Nil'), (n.ok ? '+' : '−') + nilVal]); });
    if (r.penalty) rows.push(['Bag penalty', num(r.penalty)]);
    if (r.bonus) rows.push(['Edge bonus', '+' + r.bonus]);
    var body = '<table class="tally"><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + x[1] + '</td></tr>'; }).join('') +
      '<tr><td><b>This hand</b></td><td class="' + (r.total >= 0 ? 'pos' : 'neg') + '">' + (r.total >= 0 ? '+' : '') + num(r.total) + '</td></tr></tbody></table>' +
      (r.notes.length ? '<ul class="notes">' + r.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '');
    var last = st.matchOver;
    var left = t.target - st.scores[0];
    var sub = last ? '' : left > 0 ? 'You need ' + left + ' more next hand to clear ' + t.name + '.' : 'Target already met. Keep your bid safe.';
    return UI.sheet($('app'), {
      title: 'Hand ' + (entry.hand + 1) + ' · ' + num(st.scores[0]) + ' / ' + t.target,
      sub: sub, body: body, autoMs: last ? 0 : 6000,
      buttons: [{ id: 'next', label: last ? 'See the table result' : 'Next hand' }]
    });
  }

  function tableDone() {
    inTable = false;
    var t = TABLES[run.tableIdx];
    var score = st.scores[0];
    var cleared = score >= t.target;
    run.results[run.tableIdx] = { score: score, cleared: cleared };
    T.track('table_end', { r: run.id, table: run.tableIdx, score: score, target: t.target, cleared: cleared, ms: Date.now() - tableStarted, attempt: run.attempts });
    if (cleared) {
      if (run.tableIdx === TABLES.length - 1) { finishRun(true, 'cleared'); return; }
      offerEdges(score);
      return;
    }
    var short = t.target - score;
    if (run.chips > 0) {
      UI.sheet($('app'), {
        title: 'Short by ' + short,
        sub: 'You scored ' + num(score) + ' of ' + t.target + ' at ' + t.name + '. Spend a chip for a fresh deal at the same table?',
        body: '', buttons: [{ id: 'retry', label: 'Retry (' + (run.chips - 1) + ' left)' }, { id: 'end', label: 'End run' }]
      }).then(function (id) {
        if (id === 'retry') { run.chips--; T.track('retry', { r: run.id, table: run.tableIdx, chipsLeft: run.chips }); playTable(); }
        else finishRun(false, 'declined_retry');
      });
    } else {
      finishRun(false, 'out_of_chips');
    }
  }

  function offerEdges(score) {
    var pool = Object.keys(S.EDGES).filter(function (id) { return run.edges.indexOf(id) === -1; });
    var offer = [];
    while (offer.length < 3 && pool.length) offer.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    T.track('edge_offer', { r: run.id, table: run.tableIdx, offer: offer });
    $('pickEyebrow').textContent = TABLES[run.tableIdx].name + ' cleared';
    $('pickScore').innerHTML = num(score) + '<span> / ' + TABLES[run.tableIdx].target + '</span>';
    $('pickGrid').innerHTML = offer.map(function (id) {
      var g = EDGE_GLYPH[id] || ['♠', false];
      return '<button class="edgecard" type="button" data-e="' + id + '"><span class="glyph' + (g[1] ? ' red' : '') + '">' + g[0] + '</span><span class="ec"><b>' + esc(S.EDGES[id].name) + '</b><i>' + esc(S.EDGES[id].text) + '</i></span></button>';
    }).join('');
    show('pick');
    setTimeout(function () { var f = $('pickGrid').firstChild; if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  $('pickGrid').onclick = function (e) {
    var b = e.target.closest('.edgecard');
    if (!b) return;
    run.edges.push(b.dataset.e);
    T.track('edge_pick', { r: run.id, table: run.tableIdx, edge: b.dataset.e });
    run.tableIdx++;
    showLadder();
  };

  function finishRun(won, reason) {
    run.done = true;
    run.won = won;
    var cleared = run.results.filter(function (x) { return x && x.cleared; }).length;
    var ms = Date.now() - run.startedAt;
    T.track('run_end', { r: run.id, won: won, reason: reason, cleared: cleared, ms: ms, edges: run.edges.slice(), attempts: run.attempts });
    var best = loadBest();
    var isBest = !best || cleared > best.cleared;
    if (isBest) saveBest({ cleared: cleared, at: Date.now() });
    $('endEyebrow').textContent = (won ? 'Run complete' : 'Run over') + ' · ' + UI.fmtTime(ms);
    $('endResult').textContent = won ? 'Beat the House' : cleared + ' of ' + TABLES.length;
    $('endResult').classList.toggle('win', won);
    $('endLine').textContent = won ? 'All five tables cleared with ' + run.chips + ' chip' + (run.chips === 1 ? '' : 's') + ' to spare.' :
      'Tables cleared before the run ended.' + (isBest && cleared ? ' New best on this device.' : '');
    $('endRungs').innerHTML = rungsHTML(run);
    $('endEdges').innerHTML = ownedHTML(run.edges);
    Array.prototype.forEach.call($('diffChips').children, function (b) { b.setAttribute('aria-pressed', 'false'); });
    show('end');
    renderLobby();
  }

  function leaveTable() {
    if (inTable) T.track('table_quit', { r: run.id, table: run.tableIdx, hand: st.handNo, trick: st.trickNo, ms: Date.now() - tableStarted });
    inTable = false;
    gen++;
    if (table) { table.cancel(); table.clearTrick(); }
    UI.sheet.closeAll && UI.sheet.closeAll();
    showLadder();
  }

  function onHide() {
    if (inTable && !abandoned) {
      abandoned = true;
      T.track('table_abandon', { r: run.id, table: run.tableIdx, hand: st.handNo, trick: st.trickNo, ms: Date.now() - tableStarted });
    }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onHide(); });
  window.addEventListener('pagehide', onHide);

  /* ---------------- Lobby + data ---------------- */
  function summary() {
    var ev = T.events();
    var starts = ev.filter(function (e) { return e.e === 'run_start'; });
    var ends = ev.filter(function (e) { return e.e === 'run_end'; });
    var again = starts.filter(function (e) { return e.source === 'again'; }).length;
    var picks = {};
    ev.filter(function (e) { return e.e === 'edge_pick'; }).forEach(function (e) { picks[e.edge] = (picks[e.edge] || 0) + 1; });
    var offers = {};
    ev.filter(function (e) { return e.e === 'edge_offer'; }).forEach(function (e) { e.offer.forEach(function (id) { offers[id] = (offers[id] || 0) + 1; }); });
    var stops = [0, 0, 0, 0, 0];
    ends.forEach(function (e) { if (!e.won) stops[Math.min(4, e.cleared)]++; });
    var tables = ev.filter(function (e) { return e.e === 'table_end'; });
    var fb = { easy: 0, right: 0, hard: 0 };
    ev.forEach(function (e) { if (e.e === 'difficulty_feedback' && fb[e.v] != null) fb[e.v]++; });
    return {
      runsStarted: starts.length, runsFinished: ends.length,
      fullClears: ends.filter(function (e) { return e.won; }).length,
      avgCleared: ends.length ? ends.reduce(function (a, e) { return a + e.cleared; }, 0) / ends.length : null,
      runAgainRate: ends.length ? again / ends.length : null,
      avgRunMs: ends.length ? ends.reduce(function (a, e) { return a + e.ms; }, 0) / ends.length : null,
      avgTableMs: tables.length ? tables.reduce(function (a, e) { return a + e.ms; }, 0) / tables.length : null,
      tableClearRate: tables.length ? tables.filter(function (e) { return e.cleared; }).length / tables.length : null,
      runsEndedAtTable: stops, edgePicks: picks, edgeOffers: offers, difficulty: fb
    };
  }

  function renderStats() {
    var s = summary();
    function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }
    var pickRate = Object.keys(s.edgeOffers).map(function (id) {
      return { id: id, rate: (s.edgePicks[id] || 0) / s.edgeOffers[id], n: s.edgeOffers[id] };
    }).sort(function (a, b) { return b.rate - a.rate; }).slice(0, 3);
    var rows = [
      ['Runs started', s.runsStarted],
      ['Runs finished', s.runsFinished],
      ['Run-again rate', pct(s.runAgainRate)],
      ['Average tables cleared', s.avgCleared == null ? '—' : s.avgCleared.toFixed(1) + ' of 5'],
      ['Full clears', s.fullClears],
      ['Table clear rate', pct(s.tableClearRate)],
      ['Average table length', s.avgTableMs == null ? '—' : UI.fmtTime(s.avgTableMs)],
      ['Runs that ended at table 1/2/3/4/5', s.runsEndedAtTable.join(' / ')],
      ['Most-picked Edges (pick rate when offered)', pickRate.length ? pickRate.map(function (p) { return esc(S.EDGES[p.id].name) + ' ' + pct(p.rate); }).join(', ') : '—'],
      ['Difficulty felt (easy / right / hard)', s.difficulty.easy + ' / ' + s.difficulty.right + ' / ' + s.difficulty.hard]
    ];
    $('statsHost').innerHTML = '<table class="stats"><tbody>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function renderLobby() {
    $('lobbyRungs').innerHTML = rungsHTML(null);
    var best = loadBest();
    $('bestLine').innerHTML = best ? 'Best run on this device: <b>' + best.cleared + ' of 5 tables</b>' : 'No runs yet on this device.';
    renderStats();
  }

  /* ---------------- Wiring ---------------- */
  $('startRun').onclick = function () { startRun('lobby'); };
  $('sitDown').onclick = function () { playTable(); };
  $('abandonRun').onclick = function () { finishRun(false, 'ended_from_ladder'); };
  $('leave').onclick = function () { leaveTable(); };
  $('runAgain').onclick = function () { startRun('again'); };
  $('toLobby').onclick = function () { renderLobby(); show('lobby'); };
  $('edgeStrip').onclick = function (e) {
    var b = e.target.closest('button');
    if (!b || !table) return;
    var id = b.dataset.e;
    table.toast(id === 'boss' ? TABLES[4].twist : S.EDGES[id].text, 2600);
  };
  $('diffChips').onclick = function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    T.track('difficulty_feedback', { r: run && run.id, v: b.dataset.v });
  };
  $('copyData').onclick = function () {
    var payload = JSON.stringify({ game: 'spades-run', exported: new Date().toISOString(), summary: summary(), events: T.events() });
    UI.copyText(payload, $('dataBox')).then(function (ok) {
      $('dataHint').textContent = ok ? 'Copied ' + T.events().length + ' events to the clipboard.' : 'Clipboard blocked here. Select the text below and copy it.';
    });
  };
  $('resetData').onclick = function () {
    T.reset();
    try { localStorage.removeItem('spades-run-best'); } catch (e) {}
    renderLobby();
    $('dataHint').textContent = 'Cleared. New sessions start from zero.';
  };
  renderLobby();
  T.track('open', { ua: navigator.userAgent.slice(0, 80), w: window.innerWidth });
})();
