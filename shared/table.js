/* Shared table view + input for both prototypes. Reads engine views only. */
(function (root) {
  'use strict';
  var S = root.Spades;
  var DIRS = ['s', 'w', 'n', 'e'];

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function cardNode(card, tag) {
    var s = S.suitOf(card);
    var red = s === 'H' || s === 'D';
    var n = el(tag || 'div', 'card ' + (red ? 'red' : 'black'));
    n.innerHTML = '<span class="ci"><b>' + S.rankLabel(card) + '</b><i>' + S.SYM[s] + '</i></span><span class="cs">' + S.SYM[s] + '</span>';
    n.dataset.card = card;
    return n;
  }

  function Table(host, opts) {
    this.host = host;
    this.opts = opts;
    this.names = opts.names;
    this.trickCards = [];
    this.pending = null;
    this.timer = null;
    this.build();
  }

  Table.prototype.build = function () {
    var h = this.host;
    h.innerHTML = '';
    var table = el('div', 'table');
    this.seats = [];
    for (var s = 0; s < 4; s++) {
      var seat = el('div', 'seat' + (s === 0 ? ' seat-me' : ''));
      seat.dataset.dir = DIRS[s];
      seat.dataset.team = String(s % 2);
      seat.innerHTML =
        '<div class="plate"><span class="avatar">' + this.names[s].charAt(0) + '</span>' +
        '<span class="who"><b>' + this.names[s] + '<span class="dealer" hidden>D</span></b><span class="chip">—</span></span></div>' +
        (s === 0 ? '' : '<div class="backs"></div><div class="peek" hidden></div>');
      this.seats.push(seat);
      if (s !== 0) table.appendChild(seat);
    }
    this.trick = el('div', 'trick');
    table.appendChild(this.trick);
    this.infoEl = el('div', 'tinfo');
    table.appendChild(this.infoEl);
    this.toastEl = el('div', 'toast');
    this.toastEl.hidden = true;
    table.appendChild(this.toastEl);

    var me = el('div', 'me pad');
    var meRow = el('div', 'me-row');
    meRow.appendChild(this.seats[0]);
    me.appendChild(meRow);
    this.timerEl = el('div', 'timer', '<i></i>');
    this.timerEl.hidden = true;
    me.appendChild(this.timerEl);
    this.bidEl = el('div', 'bidpanel');
    this.bidEl.hidden = true;
    me.appendChild(this.bidEl);
    this.handEl = el('div', 'hand');
    this.handEl.setAttribute('role', 'group');
    this.handEl.setAttribute('aria-label', 'Your hand');
    me.appendChild(this.handEl);

    h.appendChild(table);
    h.appendChild(me);

    var self = this;
    this.handEl.addEventListener('click', function (e) {
      var b = e.target.closest('.card');
      if (!b || !self.pending || self.pending.kind !== 'play') return;
      var c = b.dataset.card;
      if (self.pending.legal.indexOf(c) === -1) {
        self.toast(self.pending.reason(c));
        return;
      }
      self.resolve({ card: c, auto: false });
    });
    window.addEventListener('resize', function () { self.layoutHand(); });
  };

  Table.prototype.chipText = function (v, s) {
    var b = v.bids[s];
    if (b === null) return v.phase === 'bidding' && v.turn === s ? 'Bidding…' : 'No bid yet';
    var won = v.tricks[s];
    return (b === 0 ? 'Nil' : 'Bid ' + b) + ' · Won ' + won;
  };

  Table.prototype.render = function (v, extra) {
    if (extra) this.lastExtra = extra;
    extra = this.lastExtra || {};
    for (var s = 0; s < 4; s++) {
      var seat = this.seats[s];
      seat.classList.toggle('active', (v.phase === 'bidding' || v.phase === 'playing') && v.turn === s);
      seat.querySelector('.chip').textContent = this.chipText(v, s);
      seat.querySelector('.dealer').hidden = v.dealer !== s;
      if (s !== 0) {
        var backs = seat.querySelector('.backs');
        var n = Math.min(v.counts[s], 13);
        if (backs.childElementCount !== n) {
          backs.innerHTML = new Array(n + 1).join('<i></i>');
        }
        var pk = seat.querySelector('.peek');
        var pc = v.peeks && v.peeks[s];
        pk.hidden = !pc;
        if (pc && pk.dataset.card !== pc) {
          pk.dataset.card = pc;
          pk.innerHTML = 'Peek';
          pk.appendChild(cardNode(pc));
        }
      }
    }
    this.renderHand(v, extra);
  };

  Table.prototype.renderHand = function (v, extra) {
    var myTurn = !!(this.pending && this.pending.kind === 'play');
    var legal = myTurn ? this.pending.legal : [];
    var have = Array.prototype.map.call(this.handEl.children, function (c) { return c.dataset.card; }).join(',');
    if (have !== v.hand.join(',')) {
      this.handEl.innerHTML = '';
      var boost = extra.boostCard;
      for (var i = 0; i < v.hand.length; i++) {
        var c = v.hand[i];
        var b = cardNode(c, 'button');
        b.type = 'button';
        b.setAttribute('aria-label', S.speak(c));
        if (c === boost) { b.classList.add('boost'); b.insertAdjacentHTML('beforeend', '<span class="tag">Top</span>'); }
        this.handEl.appendChild(b);
      }
    }
    this.handEl.classList.toggle('turn', myTurn);
    Array.prototype.forEach.call(this.handEl.children, function (b) {
      var ok = legal.indexOf(b.dataset.card) !== -1;
      b.classList.toggle('ok', myTurn && ok);
      b.classList.toggle('no', myTurn && !ok);
      b.disabled = false;
    });
    this.layoutHand();
  };

  Table.prototype.layoutHand = function () {
    var n = this.handEl.childElementCount;
    if (!n) return;
    var cw = this.handEl.firstChild.getBoundingClientRect().width || 60;
    var avail = this.handEl.clientWidth - 8;
    var step = n > 1 ? Math.min(cw + 6, (avail - cw) / (n - 1)) : cw;
    this.handEl.style.setProperty('--overlap', (step - cw).toFixed(1) + 'px');
  };

  Table.prototype.addPlay = function (seat, card) {
    var c = cardNode(card);
    c.dataset.dir = DIRS[seat];
    this.trick.appendChild(c);
    this.trickCards.push({ seat: seat, card: card, node: c });
  };

  Table.prototype.collect = function (winner, holdMs) {
    var self = this;
    var w = this.trickCards.filter(function (t) { return t.seat === winner; })[0];
    if (w) w.node.classList.add('win');
    return sleep(holdMs).then(function () {
      self.trick.dataset.to = DIRS[winner];
      self.trick.classList.add('collect');
      return sleep(320);
    }).then(function () {
      self.trick.classList.remove('collect');
      self.trick.innerHTML = '';
      self.trickCards = [];
    });
  };

  Table.prototype.clearTrick = function () {
    this.trick.classList.remove('collect');
    this.trick.innerHTML = '';
    this.trickCards = [];
  };

  Table.prototype.setInfo = function (text) {
    if (this.infoEl.textContent !== text) this.infoEl.textContent = text;
  };

  Table.prototype.toast = function (text, ms) {
    var t = this.toastEl;
    t.textContent = text;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(this.toastT);
    this.toastT = setTimeout(function () { t.hidden = true; }, ms || 1500);
  };

  Table.prototype.startTimer = function (ms, onLate, onDone) {
    var self = this;
    this.stopTimer();
    if (!ms) return;
    this.timerEl.hidden = false;
    this.timerEl.classList.remove('late');
    var bar = this.timerEl.firstChild;
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.setProperty('--dur', ms + 'ms');
    bar.style.animation = '';
    this.lateT = setTimeout(function () { self.timerEl.classList.add('late'); if (onLate) onLate(); }, Math.max(0, ms - 3000));
    this.timer = setTimeout(onDone, ms);
  };
  Table.prototype.stopTimer = function () {
    clearTimeout(this.timer);
    clearTimeout(this.lateT);
    this.timer = null;
    this.timerEl.hidden = true;
  };

  Table.prototype.resolve = function (val) {
    if (!this.pending) return;
    var p = this.pending;
    this.pending = null;
    this.stopTimer();
    this.bidEl.hidden = true;
    this.handEl.classList.remove('turn');
    p.done(val);
  };

  Table.prototype.cancel = function () {
    this.pending = null;
    this.stopTimer();
    this.bidEl.hidden = true;
    this.handEl.classList.remove('turn');
  };

  // Resolves {card, auto}. With timeoutMs, the lowest legal card plays itself.
  Table.prototype.awaitPlay = function (v, timeoutMs) {
    var self = this;
    return new Promise(function (done) {
      var led = v.trick.length ? S.suitOf(v.trick[0].card) : null;
      self.pending = {
        kind: 'play', legal: v.legal.slice(), done: done,
        reason: function (c) {
          if (led && S.suitOf(c) !== led) return 'Follow suit: play a ' + S.SYM[led];
          if (!led && S.suitOf(c) === 'S') return 'Spades aren’t broken yet';
          return 'You can’t play that card';
        }
      };
      self.render(v, self.lastExtra);
      if (timeoutMs) {
        self.startTimer(timeoutMs, null, function () {
          var auto = v.legal.slice().sort(function (a, b) {
            var sa = S.suitOf(a) === 'S' ? 1 : 0, sb = S.suitOf(b) === 'S' ? 1 : 0;
            return (sa - sb) || (S.rankOf(a) - S.rankOf(b));
          })[0];
          self.resolve({ card: auto, auto: true });
        });
      }
    });
  };

  // Resolves {value, auto}.
  Table.prototype.awaitBid = function (v, suggested, timeoutMs) {
    var self = this;
    return new Promise(function (done) {
      self.pending = { kind: 'bid', done: done };
      var p = self.bidEl;
      var mate = self.names[2];
      var mb = v.bids[2];
      var line = mb === null ? mate + ' bids after you.' : mate + ' bid <b>' + (mb === 0 ? 'Nil' : mb) + '</b>.';
      p.innerHTML = '<p>How many tricks will you take? ' + line + '</p><div class="bids"></div>';
      var row = p.querySelector('.bids');
      for (var b = 0; b <= v.handSize; b++) {
        if (b === 0 && !v.nilAllowed) continue;
        var btn = el('button', b === 0 ? 'nil' : '');
        btn.type = 'button';
        btn.dataset.v = String(b);
        btn.innerHTML = (b === 0 ? 'Nil' : String(b)) + (b === suggested ? '<small>Suggested</small>' : '');
        if (b === suggested) btn.classList.add('sug');
        btn.setAttribute('aria-label', b === 0 ? 'Bid nil' : 'Bid ' + b);
        row.appendChild(btn);
      }
      row.onclick = function (e) {
        var t = e.target.closest('button');
        if (t) self.resolve({ value: +t.dataset.v, auto: false });
      };
      p.hidden = false;
      self.render(v, self.lastExtra);
      if (timeoutMs) self.startTimer(timeoutMs, null, function () { self.resolve({ value: suggested, auto: true }); });
    });
  };

  // Bottom sheet. buttons: [{id,label,kind}] ; autoMs counts down on the first button.
  function sheet(host, o) {
    return new Promise(function (resolve) {
      var wrap = el('div', 'sheet-wrap');
      var sh = el('div', 'sheet pad');
      sh.innerHTML = (o.title ? '<h3>' + o.title + '</h3>' : '') + (o.sub ? '<p class="sub">' + o.sub + '</p>' : '') + (o.body || '');
      var row = el('div', 'row');
      var timer = null, left = o.autoMs ? Math.ceil(o.autoMs / 1000) : 0;
      (o.buttons || []).forEach(function (b, i) {
        var btn = el('button', 'btn ' + (b.kind || (i === 0 ? 'primary' : 'ghost')));
        btn.type = 'button';
        btn.textContent = b.label;
        btn.dataset.base = b.label;
        btn.onclick = function () { close(b.id); };
        row.appendChild(btn);
      });
      sh.appendChild(row);
      wrap.appendChild(sh);
      host.appendChild(wrap);
      var first = row.firstChild;
      if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) {} }, 50);
      if (o.autoMs && first) {
        first.textContent = first.dataset.base + ' (' + left + ')';
        timer = setInterval(function () {
          left--;
          if (left <= 0) { close(o.buttons[0].id); return; }
          first.textContent = first.dataset.base + ' (' + left + ')';
        }, 1000);
      }
      function close(id) {
        clearInterval(timer);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(id);
      }
      sheet.closeAll = function () { close(null); };
    });
  }

  // Tiny local event log. In a live test, swap track() for PostHog,
  // GameAnalytics or a POST to your own collector; nothing else changes.
  function telemetry(key) {
    var data = { events: [] };
    try { data = JSON.parse(localStorage.getItem(key)) || data; } catch (e) {}
    var session = Math.random().toString(36).slice(2, 8);
    function save() { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {} }
    return {
      session: session,
      track: function (name, props) {
        var ev = { t: Date.now(), s: session, e: name };
        for (var k in props) ev[k] = props[k];
        data.events.push(ev);
        if (data.events.length > 3000) data.events.splice(0, data.events.length - 3000);
        save();
      },
      events: function () { return data.events; },
      reset: function () { data = { events: [] }; save(); }
    };
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function copyText(text, fallbackHost) {
    var done = function () { return true; };
    try {
      return navigator.clipboard.writeText(text).then(done, function () { return showFallback(); });
    } catch (e) { return Promise.resolve(showFallback()); }
    function showFallback() {
      var ta = fallbackHost.querySelector('textarea') || el('textarea');
      ta.value = text;
      ta.rows = 5;
      ta.readOnly = true;
      ta.style.width = '100%';
      fallbackHost.appendChild(ta);
      ta.focus();
      ta.select();
      return false;
    }
  }

  root.SpadesUI = { Table: Table, sheet: sheet, telemetry: telemetry, cardNode: cardNode, sleep: sleep, fmtTime: fmtTime, copyText: copyText, el: el };
})(self);
