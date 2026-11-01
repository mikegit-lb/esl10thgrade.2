/* ============================================================
   app.js — tab routing, master timers, teacher-mode state,
   notes drawer, lexical bank, and boot/data loading.
   Loaded as a classic script so the unit folder works from a
   plain file server with no build step.
   ============================================================ */
(function () {
  'use strict';

  const ESL = (window.ESL = window.ESL || {});

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  const pad2 = (n) => (n < 10 ? '0' + n : String(n));
  const mmss = (secs) => {
    const s = Math.max(0, Math.round(secs));
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  };

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

  ESL.util = { $, $$, esc, mmss, norm, slug, pad2 };

  /* ---------------- storage ---------------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('unit02.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('unit02.' + key, JSON.stringify(value));
      } catch (e) {
        /* private mode — the tool still works, it just forgets */
      }
    }
  };
  ESL.store = store;

  /* ---------------- tiny event bus ---------------- */
  const listeners = {};
  ESL.on = (evt, fn) => {
    (listeners[evt] = listeners[evt] || []).push(fn);
  };
  ESL.emit = (evt, payload) => {
    (listeners[evt] || []).forEach((fn) => fn(payload));
  };

  /* ---------------- audio tick ---------------- */
  const AudioKit = {
    ctx: null,
    ensure() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) {
        return null;
      }
    },
    beep(freq, dur, gain, delay) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    tick() { this.beep(1180, 0.035, 0.045); },
    warn() { this.beep(820, 0.06, 0.06); },
    end() { this.beep(560, 0.12, 0.07); this.beep(400, 0.24, 0.07, 0.14); }
  };
  ESL.audio = AudioKit;

  /* ---------------- master countdown ---------------- */
  class Countdown {
    constructor(opts) {
      this.duration = opts.duration || 60;
      this.onTick = opts.onTick || function () {};
      this.onFinish = opts.onFinish || function () {};
      this.onState = opts.onState || function () {};
      this.remaining = this.duration;
      this.running = false;
      this._raf = null;
      this._lastWhole = null;
      this._lastAt = 0;
    }
    setDuration(sec) {
      this.duration = sec;
      this.reset();
    }
    reset() {
      this.pause();
      this.remaining = this.duration;
      this._lastWhole = null;
      this.onTick(this.remaining, this);
      this.onState('idle', this);
    }
    start() {
      if (this.running) return;
      if (this.remaining <= 0) this.remaining = this.duration;
      this.running = true;
      this._lastAt = performance.now();
      this.onState('running', this);
      const step = (now) => {
        if (!this.running) return;
        const dt = (now - this._lastAt) / 1000;
        this._lastAt = now;
        this.remaining = Math.max(0, this.remaining - dt);

        const whole = Math.ceil(this.remaining);
        if (whole !== this._lastWhole) {
          this._lastWhole = whole;
          if (whole <= 10 && whole > 0) AudioKit.tick();
          else if (whole === 0) AudioKit.end();
        }
        if (this.remaining <= 10 && this.remaining > 0) this.onState('warn', this);
        this.onTick(this.remaining, this);
        if (this.remaining <= 0) {
          this.running = false;
          this.onState('done', this);
          this.onFinish(this);
          return;
        }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }
    pause() {
      if (!this.running) return;
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      this.onState('paused', this);
    }
    toggle() {
      if (this.running) this.pause();
      else this.start();
    }
  }
  ESL.Countdown = Countdown;

  /* ---------------- state ---------------- */
  ESL.state = {
    teacherMode: store.get('teacherMode', false),
    tab: store.get('tab', 'speaking'),
    data: {}
  };

  /* ---------------- teacher mode ---------------- */
  function applyTeacherMode() {
    document.body.classList.toggle('teacher-mode', ESL.state.teacherMode);
    const btn = $('#teacherToggle');
    if (btn) btn.setAttribute('aria-pressed', ESL.state.teacherMode ? 'true' : 'false');
    store.set('teacherMode', ESL.state.teacherMode);
    ESL.emit('teacher-mode', ESL.state.teacherMode);
  }
  ESL.applyTeacherMode = applyTeacherMode;

  /* ---------------- tab routing ---------------- */
  function activateTab(name) {
    ESL.state.tab = name;
    store.set('tab', name);
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel').forEach((p) => {
      const on = p.id === 'panel-' + name;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
    ESL.emit('tab', name);
  }
  ESL.activateTab = activateTab;

  /* ---------------- correction pad ---------------- */
  const NOTES_KEY = 'notes';
  const notes = {
    el: null,
    text: null,
    badge: null,
    saved: null,
    dirty: false,

    init() {
      this.el = $('#notesText');
      this.badge = $('#notesBadge');
      this.saved = $('#notesSaved');
      this.text = store.get(NOTES_KEY, '');
      this.el.value = this.text;
      this.updateBadge();

      this.el.addEventListener('input', () => {
        this.dirty = true;
        this.updateBadge();
        this.scheduleSave();
      });

      $$('.quicktag').forEach((btn) => {
        btn.addEventListener('click', () => this.insertTag(btn.dataset.tag));
      });

      $('#notesOpen').addEventListener('click', () => this.open());
      $('#notesClose').addEventListener('click', () => this.close());
      $('#scrim').addEventListener('click', () => this.close());
      window.addEventListener('pagehide', () => {
        if (this.dirty) this.persist();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.el.closest('.drawer').classList.contains('is-open')) this.close();
      });

      $('#notesCopy').addEventListener('click', () => this.copy());
      $('#notesDownload').addEventListener('click', () => this.download());
      $('#notesClear').addEventListener('click', () => {
        if (!this.el.value.trim()) return;
        this.el.value = '';
        this.save();
        this.flash('Pad cleared');
      });
    },

    context() {
      const ctx = ESL.currentContext ? ESL.currentContext() : '';
      $('#notesContext').textContent = ctx || 'No item selected yet.';
    },

    insertTag(tag) {
      const stamp = tag === 'Card ref' && ESL.currentRef ? ESL.currentRef() : tag;
      const token = '[' + stamp + '] ';
      const ta = this.el;
      const start = ta.selectionStart || 0;
      const before = ta.value.slice(0, start);
      const needsBreak = before && !before.endsWith('\n') && !before.endsWith(' ');
      const insert = (needsBreak ? '\n' : '') + token;
      ta.value = before + insert + ta.value.slice(ta.selectionEnd || start);
      const pos = before.length + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      this.save();
    },

    scheduleSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.persist(), 500);
    },

    persist() {
      store.set(NOTES_KEY, this.el.value);
      this.dirty = false;
      this.updateBadge();
    },

    save() {
      this.persist();
      this.flash('Saved');
    },

    updateBadge() {
      const lines = this.el.value.split('\n').filter((l) => l.trim()).length;
      this.badge.textContent = String(lines);
    },

    flash(msg) {
      this.saved.textContent = msg;
      clearTimeout(this._t);
      this._t = setTimeout(() => { this.saved.textContent = ''; }, 2200);
    },

    open() {
      this.context();
      const drawer = this.el.closest('.drawer');
      drawer.hidden = false;
      $('#scrim').hidden = false;
      void drawer.offsetWidth;
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      $('#notesOpen').setAttribute('aria-expanded', 'true');
      this.el.focus();
    },

    close() {
      const drawer = this.el.closest('.drawer');
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      $('#notesOpen').setAttribute('aria-expanded', 'false');
      this.save();
      setTimeout(() => {
        if (drawer.classList.contains('is-open')) return;
        drawer.hidden = true;
        $('#scrim').hidden = true;
      }, 260);
    },

    copy() {
      const text = this.el.value;
      const done = () => this.flash('Copied to clipboard');
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, () => this._copyFallback(text, done));
      } else {
        this._copyFallback(text, done);
      }
    },

    _copyFallback(text, done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        this.flash('Copy failed — select the text manually');
      }
      document.body.removeChild(ta);
    },

    download() {
      const blob = new Blob([this.el.value], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'unit02-correction-pad.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.flash('Saved as .txt');
    }
  };
  ESL.notes = notes;

  /* ---------------- lexical bank ---------------- */
  ESL.lexicon = {
    data: null,
    filter: 'all',
    query: '',
    hide: false,

    domainLabel(id) {
      const d = this.data.domains.find((x) => x.id === id);
      return d ? d.label : id;
    },

    init(data) {
      this.data = data;
      const filters = $('#lxFilters');
      filters.innerHTML = '';
      const domains = [{ id: 'all', label: 'All domains' }].concat(data.domains);
      domains.forEach((d) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filt' + (d.id === 'all' ? ' is-on' : '');
        b.dataset.domain = d.id;
        const count = d.id === 'all'
          ? data.items.length
          : data.items.filter((i) => i.domain === d.id).length;
        b.innerHTML = esc(d.label) + ' <span>' + count + '</span>';
        filters.appendChild(b);
      });
      filters.addEventListener('click', (e) => {
        const b = e.target.closest('.filt');
        if (!b) return;
        this.filter = b.dataset.domain;
        $$('.filt', filters).forEach((x) => x.classList.toggle('is-on', x === b));
        this.render();
      });

      const search = $('#lxSearch');
      search.addEventListener('input', () => {
        this.query = search.value.trim().toLowerCase();
        this.render();
      });

      $('#lxHideGloss').addEventListener('change', (e) => {
        this.hide = e.target.checked;
        this.render();
      });

      const domainLabel = (id) => this.domainLabel(id);
      $('#lxSubtitle').textContent =
        data.items.length + ' entries across ' + data.domains.length +
        ' domains: ' + data.domains.map((d) => domainLabel(d.id)).join(', ') + '.';

      this.render();
    },

    render() {
      const grid = $('#lxGrid');
      const q = this.query;
      const items = this.data.items.filter((item) => {
        if (this.filter !== 'all' && item.domain !== this.filter) return false;
        if (!q) return true;
        const hay = [
          item.term, item.definition, item.example, item.note, item.phonetic,
          (item.collocations || []).join(' ')
        ].join(' ').toLowerCase();
        return hay.indexOf(q) !== -1;
      });

      $('#lxCount').textContent =
        items.length + ' of ' + this.data.items.length + ' entries' +
        (q ? ' matching "' + this.query + '"' : '');

      grid.innerHTML = '';
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'sheet';
        empty.innerHTML =
          '<p class="stimulus stimulus--sm">Nothing matches that search.</p>' +
          '<p class="hintline">Try a single stem, a collocation, or switch the domain filter back to all.</p>';
        grid.appendChild(empty);
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'lx' + (this.hide ? ' is-hidden' : '');
        card.innerHTML =
          '<div class="lx__top">' +
            '<h3 class="lx__term">' + esc(item.term) + '</h3>' +
            '<span class="lx__ipa">' + esc(item.phonetic) + '</span>' +
          '</div>' +
          '<p class="lx__domain">' + esc(this.domainLabel(item.domain)) + '</p>' +
          '<p class="lx__def">' + esc(item.definition) + '</p>' +
          '<div class="lx__coll">' +
            (item.collocations || []).map((c) => '<span>' + esc(c) + '</span>').join('') +
          '</div>' +
          '<p class="lx__ex">' + esc(item.example) + '</p>' +
          (item.note ? '<p class="lx__note">' + esc(item.note) + '</p>' : '');
        grid.appendChild(card);
      });
    }
  };

  /* ---------------- boot ---------------- */
  function bootError(title, text) {
    const boot = $('#boot');
    boot.hidden = false;
    $('#bootTitle').textContent = title;
    $('#bootText').innerHTML = text;
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
    return res.json();
  }

  async function boot() {
    notes.init();

    $('#teacherToggle').addEventListener('click', () => {
      ESL.state.teacherMode = !ESL.state.teacherMode;
      applyTeacherMode();
      ESL.notes.context();
    });

    $$('.tab').forEach((t) => {
      t.addEventListener('click', () => activateTab(t.dataset.tab));
    });

    applyTeacherMode();

    try {
      const [speaking, grammar, reading, vocabulary] = await Promise.all([
        loadJSON('data/speaking-data.json'),
        loadJSON('data/grammar-data.json'),
        loadJSON('data/reading.json'),
        loadJSON('data/vocabulary.json')
      ]);

      ESL.state.data = { speaking, grammar, reading, vocabulary };
      ESL.lexicon.init(vocabulary);
      ESL.speaking.init(speaking);
      ESL.grammar.init(grammar);
      ESL.reading.init(reading);

      activateTab(ESL.state.tab);
      ESL.notes.context();
      $('#boot').hidden = true;
    } catch (err) {
      bootError(
        'Unit data could not be loaded',
        '<p>' + esc(err.message) + '</p>' +
        '<p>Browsers block reading local files over <code>file://</code>, so this unit needs to be ' +
        'served over a tiny local server. From the unit folder run:</p>' +
        '<p><code>node serve.mjs</code> &nbsp;then open <code>http://localhost:5177</code></p>' +
        '<p style="margin-top:.6rem">On Windows you can also double-click <code>start.bat</code>.</p>'
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
