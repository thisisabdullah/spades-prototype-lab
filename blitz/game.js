(function () {
  'use strict';
  var S = self.Spades, UI = self.SpadesUI;
  var $ = function (id) { return document.getElementById(id); };

  var NAMES = ['You', 'Lina', 'Sami', 'Omar']; // S, W, N (partner), E
  var SKILL = [0.85, 0.8, 0.85, 0.8];
  var MODES = {
    blitz:   { key: 'blitz',   label: 'Blitz',    handSize: 5,  hands: 4, playMs: 8000,  bidMs: 10000, botMs: 380, holdMs: 650 },
    control: { key: 'control', label: 'Standard', handSize: 13, hands: 3, playMs: 15000, bidMs: 15000, botMs: 380, holdMs: 650 }
  };
  var T = UI.telemetry('spades-blitz-events-v1');
  var table = new UI.Table($('tableHost'), { names: NAMES });

  var gen = 0, st = null, mode = null, matchId = null, startedAt = 0, clockT = null, inMatch = false, abandoned = false;
  var lastMode = 'blitz';

  function show(id) {
    ['lobby', 'game', 'end'].forEach(function (s) { $(s).hidden = s !== id; });
  }

  function num(n) { return n < 0 ? '−' + Math.abs(n) : String(n); }
  function pips(id, bags) {
    var host = $(id);
    var html = '';
    for (var i = 0; i < 5; i++) html += '<i class="' + (i < bags ? 'on' : '') + '"></i>';
    if (host.innerHTML !== html) host.innerHTML = html;
    host.title = bags + ' of 5 bags (five bags cost 50)';
    host.setAttribute('aria-label', host.title);
  }
  function hud() {
    $('sUs').textContent = num(st.scores[0]);
    $('sThem').textContent = num(st.scores[1]);
    pips('bUs', st.bags[0]);
    pips('bThem', st.bags[1]);
    var extraHand = st.handNo + 1 > mode.hands;
    $('handLbl').textContent = extraHand ? 'Sudden death' : 'Hand ' + (st.handNo + 1) + ' of ' + mode.hands;
    if (st.phase === 'bidding') table.setInfo('Bidding');
    else if (st.phase === 'playing') table.setInfo('Trick ' + Math.min(st.trickNo + 1, mode.handSize) + ' of ' + mode.handSize + (st.spadesBroken ? ' · ♠ broken' : ''));
    else table.setInfo('');
  }
  function tick() { $('clock').textContent = UI.fmtTime(Date.now() - startedAt); }
  function view() { return S.viewFor(st, 0); }
  function render() { table.render(view()); hud(); }

  function startMatch(modeKey, source) {
    gen++;
    table.cancel();
    table.clearTrick();
    UI.sheet.closeAll && UI.sheet.closeAll();
    mode = MODES[modeKey];
    lastMode = modeKey;
    var seed = (Math.random() * 2147483647) | 0;
    st = S.createMatch({ handSize: mode.handSize, hands: mode.hands, suddenDeath: true, seed: seed });
    matchId = Math.random().toString(36).slice(2, 9);
    startedAt = Date.now();
    inMatch = true;
    abandoned = false;
    T.track('match_start', { m: matchId, mode: mode.key, source: source, seed: seed });
    clearInterval(clockT);
    clockT = setInterval(tick, 500);
    tick();
    show('game');
    render();
    loop(gen);
  }

  async function loop(g) {
    while (g === gen) {
      if (st.phase === 'bidding') {
        var seat = st.turn;
        render();
        if (seat === 0) {
          var v = view();
          var sug = S.suggestBid(v);
          var t0 = Date.now();
          var r = await table.awaitBid(v, sug, mode.bidMs);
          if (g !== gen) return;
          S.applyAction(st, 0, { type: 'bid', value: r.value });
          T.track('bid', { m: matchId, hand: st.handNo, value: r.value, suggested: sug, auto: r.auto, ms: Date.now() - t0 });
          if (r.auto) table.toast('Time’s up: bid ' + (r.value === 0 ? 'Nil' : r.value));
        } else {
          await UI.sleep(mode.botMs);
          if (g !== gen) return;
          var a = S.botAction(S.viewFor(st, seat), SKILL[seat]);
          S.applyAction(st, seat, a);
          if (a.value === 0) table.toast(NAMES[seat] + ' bids Nil');
        }
        continue;
      }
      if (st.phase === 'playing') {
        var p = st.turn, card, auto = false, ms = 0;
        render();
        if (p === 0) {
          var t1 = Date.now();
          var pr = await table.awaitPlay(view(), mode.playMs);
          if (g !== gen) return;
          card = pr.card; auto = pr.auto; ms = Date.now() - t1;
        } else {
          await UI.sleep(mode.botMs);
          if (g !== gen) return;
          card = S.botAction(S.viewFor(st, p), SKILL[p]).card;
        }
        var res = S.applyAction(st, p, { type: 'play', card: card });
        if (p === 0) {
          T.track('play', { m: matchId, hand: st.handNo, trick: res.trick ? st.trickNo - 1 : st.trickNo, card: card, auto: auto, ms: ms });
          if (auto) table.toast('Auto-played ' + S.label(card));
        }
        table.addPlay(p, card);
        render();
        if (res.spadesBroken && !res.trick) table.toast('Spades are broken');
        if (res.trick) {
          await table.collect(res.trick.winner, mode.holdMs);
          if (g !== gen) return;
        }
        continue;
      }
      if (st.phase === 'handDone') {
        render();
        var entry = st.results[st.results.length - 1];
        T.track('hand_end', {
          m: matchId, hand: entry.hand, us: entry.res[0].total, them: entry.res[1].total,
          bid: entry.bids[0], won: entry.tricks[0], scoreUs: st.scores[0], scoreThem: st.scores[1]
        });
        await handSheet(entry);
        if (g !== gen) return;
        S.applyAction(st, 0, { type: 'next' });
        continue;
      }
      if (st.phase === 'matchDone') { endMatch(); return; }
      return;
    }
  }

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }
  function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }

  function tallyRows(res) {
    var names = ['Us', 'Them'];
    return res.map(function (r, i) {
      var bid = r.bid + (r.nil.length ? (r.bid ? ' + ' : '') + 'Nil' : '');
      return '<tr><td>' + names[i] + '</td><td>' + (bid || '—') + '</td><td>' + r.won + '</td><td>' + (r.bags || '') + '</td><td class="' + cls(r.total) + '">' + signed(r.total) + '</td></tr>';
    }).join('');
  }

  function handSheet(entry) {
    var r = entry.res;
    var notes = [];
    r.forEach(function (x, i) {
      x.nil.forEach(function (n) { notes.push(NAMES[n.seat] + (n.ok ? ' made Nil' : ' missed Nil')); });
      if (x.penalty) notes.push((i === 0 ? 'Us' : 'Them') + ': five bags, −50');
    });
    var made = r[0].made === null ? '' : r[0].made ? 'You made your bid.' : 'You were set.';
    var body =
      '<table class="tally"><thead><tr><th>Team</th><th>Bid</th><th>Won</th><th>Bags</th><th>Points</th></tr></thead><tbody>' +
      tallyRows(r) + '</tbody></table>' +
      (notes.length ? '<ul class="notes">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>' : '');
    var last = st.matchOver;
    return UI.sheet($('app'), {
      title: 'Hand ' + (entry.hand + 1) + ' · ' + num(st.scores[0]) + ' to ' + num(st.scores[1]),
      sub: made,
      body: body,
      autoMs: last ? 0 : 4000,
      buttons: [{ id: 'next', label: last ? 'See result' : 'Next hand' }]
    });
  }

  function endMatch() {
    inMatch = false;
    clearInterval(clockT);
    var dur = Date.now() - startedAt;
    var us = st.scores[0], them = st.scores[1];
    var win = us > them;
    T.track('match_end', { m: matchId, mode: mode.key, ms: dur, us: us, them: them, win: win, hands: st.results.length });
    $('endEyebrow').textContent = mode.label + ' match over · ' + UI.fmtTime(dur);
    $('endResult').textContent = win ? 'You win' : 'You lose';
    $('endResult').classList.toggle('win', win);
    $('endScore').innerHTML = num(us) + ' – ' + num(them) + '<span>' + st.results.length + ' hands</span>';
    var rows = st.results.map(function (e) {
      return '<tr><td>Hand ' + (e.hand + 1) + '</td><td>' + (e.bids[0] === 0 ? 'Nil' : e.bids[0]) + ' / ' + e.tricks[0] + '</td><td class="' + cls(e.res[0].total) + '">' + signed(e.res[0].total) + '</td><td class="' + cls(e.res[1].total) + '">' + signed(e.res[1].total) + '</td></tr>';
    }).join('');
    $('endTable').innerHTML = '<table class="tally"><thead><tr><th>Hand</th><th>Your bid / won</th><th>Us</th><th>Them</th></tr></thead><tbody>' + rows + '</tbody></table>';
    Array.prototype.forEach.call($('lenChips').children, function (b) { b.setAttribute('aria-pressed', 'false'); });
    show('end');
    setTimeout(function () { try { $('rematch').focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  function leave(reason) {
    if (inMatch) {
      T.track('match_quit', { m: matchId, mode: mode.key, ms: Date.now() - startedAt, hand: st.handNo, trick: st.trickNo, reason: reason });
    }
    inMatch = false;
    gen++;
    table.cancel();
    table.clearTrick();
    UI.sheet.closeAll && UI.sheet.closeAll();
    clearInterval(clockT);
    renderStats();
    show('lobby');
  }

  // A player who closes the tab mid-match is the clearest "stop" signal we get.
  function onHide() {
    if (inMatch && !abandoned) {
      abandoned = true;
      T.track('match_abandon', { m: matchId, mode: mode.key, ms: Date.now() - startedAt, hand: st.handNo, trick: st.trickNo });
    }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onHide(); });
  window.addEventListener('pagehide', onHide);

  /* ---------- Playtest summary ---------- */
  function summary() {
    var ev = T.events();
    var out = {};
    ['blitz', 'control'].forEach(function (k) {
      var starts = ev.filter(function (e) { return e.e === 'match_start' && e.mode === k; });
      var ends = ev.filter(function (e) { return e.e === 'match_end' && e.mode === k; });
      var ids = {};
      starts.forEach(function (e) { ids[e.m] = true; });
      var rematches = starts.filter(function (e) { return e.source === 'rematch'; }).length;
      var autos = ev.filter(function (e) { return e.e === 'play' && e.auto && ids[e.m]; }).length;
      var quits = ev.filter(function (e) { return (e.e === 'match_quit') && e.mode === k; }).length;
      var avg = ends.length ? ends.reduce(function (a, e) { return a + e.ms; }, 0) / ends.length : 0;
      out[k] = {
        started: starts.length, finished: ends.length, avg: avg,
        rematchRate: ends.length ? rematches / ends.length : null,
        autoPerMatch: starts.length ? autos / starts.length : null, quits: quits
      };
    });
    var fb = { short: 0, right: 0, long: 0 };
    ev.forEach(function (e) { if (e.e === 'length_feedback' && fb[e.v] != null) fb[e.v]++; });
    out.feedback = fb;
    return out;
  }

  function renderStats() {
    var s = summary();
    function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }
    function n1(x) { return x == null ? '—' : x.toFixed(1); }
    var rows = [
      ['Matches started', s.blitz.started, s.control.started],
      ['Matches finished', s.blitz.finished, s.control.finished],
      ['Average length', s.blitz.finished ? UI.fmtTime(s.blitz.avg) : '—', s.control.finished ? UI.fmtTime(s.control.avg) : '—'],
      ['Rematch rate', pct(s.blitz.rematchRate), pct(s.control.rematchRate)],
      ['Auto-plays per match', n1(s.blitz.autoPerMatch), n1(s.control.autoPerMatch)],
      ['Left mid-match', s.blitz.quits, s.control.quits]
    ];
    $('statsHost').innerHTML =
      '<table class="stats"><thead><tr><th>Metric</th><th>Blitz</th><th>Standard</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') +
      '<tr><td>Length felt (short / right / long)</td><td colspan="2">' + s.feedback.short + ' / ' + s.feedback.right + ' / ' + s.feedback.long + '</td></tr>' +
      '</tbody></table>';
  }

  /* ---------- Lobby decoration ---------- */
  (function fan() {
    var host = $('fan');
    ['S14', 'H13', 'C12', 'D11', 'S10'].forEach(function (c, i) {
      var n = UI.cardNode(c);
      var a = (i - 2) * 11;
      n.style.transform = 'translateX(-50%) rotate(' + a + 'deg) translateY(' + Math.abs(i - 2) * 4 + 'px)';
      host.appendChild(n);
    });
  })();

  /* ---------- Wiring ---------- */
  $('playBlitz').onclick = function () { startMatch('blitz', 'lobby'); };
  $('playControl').onclick = function () { startMatch('control', 'lobby'); };
  $('leave').onclick = function () { leave('button'); };
  $('rematch').onclick = function () { startMatch(lastMode, 'rematch'); };
  $('toLobby').onclick = function () { T.track('to_lobby', { mode: lastMode }); renderStats(); show('lobby'); };
  $('lenChips').onclick = function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    T.track('length_feedback', { m: matchId, mode: lastMode, v: b.dataset.v });
  };
  $('copyData').onclick = function () {
    var payload = JSON.stringify({ game: 'spades-blitz', exported: new Date().toISOString(), summary: summary(), events: T.events() });
    UI.copyText(payload, $('dataBox')).then(function (ok) {
      $('dataHint').textContent = ok ? 'Copied ' + T.events().length + ' events to the clipboard.' : 'Clipboard blocked here. Select the text below and copy it.';
    });
  };
  $('resetData').onclick = function () {
    T.reset();
    renderStats();
    $('dataHint').textContent = 'Cleared. New sessions start from zero.';
  };
  renderStats();
  T.track('open', { ua: navigator.userAgent.slice(0, 80), w: window.innerWidth });
})();
