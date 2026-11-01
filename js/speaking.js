/* ============================================================
   speaking.js — prompted-speaking card engine.
   Card index, constraint tracking, dual timer suite, tutor probes.
   ============================================================ */
(function () {
  'use strict';

  const ESL = window.ESL;
  const { $, $$, esc } = ESL.util;

  ESL.speaking = {
    data: null,
    cards: [],
    index: 0,
    filter: 'all',
    timer: null,
    stage: { stage: 'prep', dur: 30 },
    lastDur: { prep: 30, produce: 60 },
    used: {},          // { cardId: [constraintId, ...] }
    done: [],          // card ids where every constraint was used

    /* ---------------- init ---------------- */
    init(data) {
      this.data = data;
      this.cards = data.cards.slice().sort((a, b) => a.id - b.id);
      this.used = ESL.store.get('spUsed', {});
      this.done = ESL.store.get('spDone', []);

      this.buildFilters();
      this.buildList();
      this.bind();
      this.show(0);
      this.buildTimer();
    },

    buildFilters() {
      const host = $('#cardFilters');
      host.innerHTML = '';
      const SHORT = {
        long_turn: 'Long-turn',
        scenario: 'Scenario',
        visual_data: 'Visual / POV'
      };
      const options = [{ id: 'all', label: 'All' }].concat(
        this.data.categories.map((c) => ({ id: c.id, label: SHORT[c.id] || c.label, count: c.count }))
      );
      options.forEach((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filt' + (o.id === 'all' ? ' is-on' : '');
        b.dataset.filter = o.id;
        const n = o.id === 'all'
          ? this.cards.length
          : this.cards.filter((c) => c.category === o.id).length;
        b.innerHTML = esc(o.label) + ' <span>' + n + '</span>';
        host.appendChild(b);
      });
      host.addEventListener('click', (e) => {
        const b = e.target.closest('.filt');
        if (!b) return;
        this.filter = b.dataset.filter;
        $$('.filt', host).forEach((x) => x.classList.toggle('is-on', x === b));
        this.buildList();
      });
    },

    buildList() {
      const host = $('#cardList');
      host.innerHTML = '';
      const visible = this.cards.filter(
        (c) => this.filter === 'all' || c.category === this.filter
      );
      const groups = this.filter === 'all'
        ? this.data.categories.map((c) => c.id)
        : [this.filter];

      groups.forEach((gid) => {
        const meta = this.data.categories.find((c) => c.id === gid);
        if (this.filter === 'all') {
          const h = document.createElement('p');
          h.className = 'rail__group';
          h.textContent = meta.label;
          host.appendChild(h);
        }
        visible
          .filter((c) => c.category === gid)
          .forEach((card) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rail__item';
            b.dataset.id = card.id;
            b.textContent = pad(card.id);
            b.setAttribute('role', 'option');
            b.setAttribute('aria-label', 'Card ' + card.id + ': ' + card.title);
            if (this.done.indexOf(card.id) !== -1) b.classList.add('is-done');
            if (card.id === this.cards[this.index].id) {
              b.classList.add('is-active');
              b.setAttribute('aria-selected', 'true');
            }
            host.appendChild(b);
          });
      });

      $$('.rail__item', host).forEach((b) => {
        b.addEventListener('click', () => this.goToCard(Number(b.dataset.id)));
      });
    },

    bind() {
      $('#spPrev').addEventListener('click', () => this.step(-1));
      $('#spNext').addEventListener('click', () => this.step(1));

      const jump = $('#cardJump');
      jump.max = String(this.cards.length);
      jump.addEventListener('change', () => {
        const n = Number(jump.value);
        if (n >= 1 && n <= this.cards.length) {
          this.goToCard(n);
          jump.value = '';
        }
      });

      $('#spStemsToggle').addEventListener('click', (e) => {
        const list = $('#spStems');
        const open = list.hidden;
        list.hidden = !open;
        e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
        e.currentTarget.textContent = open ? 'Hide sentence stems' : 'Show sentence stems';
      });

      $$('.stage').forEach((b) => {
        b.addEventListener('click', () => {
          const stage = b.dataset.stage;
          const dur = Number(b.dataset.dur);
          this.lastDur[stage] = dur;
          this.setStage(stage, dur);
        });
      });

      $('#spStart').addEventListener('click', () => {
        if (this.timer.running) {
          this.timer.pause();
        } else {
          if (this.stage.stage === 'prep' && this.timer.remaining >= this.timer.duration) {
            $('#spCue').textContent = '';
          }
          this.timer.start();
        }
      });
      $('#spReset').addEventListener('click', () => {
        this.timer.reset();
        $('#spCue').textContent = '';
      });
      $('#spAdvance').addEventListener('click', () => {
        this.setStage('produce', this.lastDur.produce);
        $('#spCue').textContent = 'Production round — the student speaks now.';
      });

      ESL.on('teacher-mode', () => this.renderTeacher());
    },

    /* ---------------- navigation ---------------- */
    step(dir) {
      const list = this.visibleCards();
      const current = list.findIndex((c) => c.id === this.cards[this.index].id);
      const next = current + dir;
      if (next < 0 || next >= list.length) return;
      this.show(this.cards.indexOf(list[next]));
    },

    visibleCards() {
      return this.cards.filter((c) => this.filter === 'all' || c.category === this.filter);
    },

    goToCard(id) {
      const i = this.cards.findIndex((c) => c.id === id);
      if (i !== -1) this.show(i);
    },

    show(i) {
      this.index = Math.max(0, Math.min(this.cards.length - 1, i));
      const card = this.cards[this.index];
      const meta = this.data.categories.find((c) => c.id === card.category);

      $('#spRef').textContent = 'Card ' + pad(card.id);
      $('#spCat').textContent = meta ? meta.label : card.category;
      $('#spTitle').textContent = card.title;
      $('#spStimulus').textContent = card.stimulus;
      $('#spContext').textContent = card.context || '';
      $('#spProgress').textContent = pad(card.id) + ' / ' + this.cards.length;

      const subs = $('#spSubprompts');
      subs.innerHTML = '';
      (card.sub_prompts || []).forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        subs.appendChild(li);
      });

      const stems = $('#spStems');
      stems.innerHTML = '';
      (card.functional_stems || []).forEach((s) => {
        const li = document.createElement('li');
        li.textContent = s;
        stems.appendChild(li);
      });

      this.renderChips();
      this.renderTeacher(card);

      $$('.rail__item').forEach((b) => {
        const on = Number(b.dataset.id) === card.id;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-selected', 'true');
        else b.removeAttribute('aria-selected');
      });

      ESL.notes.context();
    },

    /* ---------------- constraint chips ---------------- */
    renderChips() {
      const card = this.cards[this.index];
      const host = $('#spConstraints');
      host.innerHTML = '';
      this.chipEls = {};
      const used = this.used[card.id] || [];

      (card.mandatory_constraints || []).forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip chip--' + c.type;
        b.setAttribute('aria-pressed', used.indexOf(c.id) !== -1 ? 'true' : 'false');
        b.innerHTML =
          '<span class="chip__type">' + esc(c.type) + '</span>' +
          '<span class="chip__text">' + esc(c.label) + '</span>' +
          '<span class="chip__tick">' + (used.indexOf(c.id) !== -1 ? '✓' : '○') + '</span>';
        if (used.indexOf(c.id) !== -1) b.classList.add('is-used');
        b.addEventListener('click', () => this.toggleConstraint(c.id));
        this.chipEls[c.id] = b;
        host.appendChild(b);
      });

      this.updateConstraintCount();
    },

    toggleConstraint(cid) {
      const card = this.cards[this.index];
      const list = this.used[card.id] ? this.used[card.id].slice() : [];
      const at = list.indexOf(cid);
      if (at === -1) list.push(cid);
      else list.splice(at, 1);
      this.used[card.id] = list;
      ESL.store.set('spUsed', this.used);

      const total = (card.mandatory_constraints || []).length;
      const all = list.length >= total && total > 0;
      if (all && this.done.indexOf(card.id) === -1) {
        this.done.push(card.id);
        ESL.store.set('spDone', this.done);
      } else if (!all && this.done.indexOf(card.id) !== -1) {
        this.done = this.done.filter((x) => x !== card.id);
        ESL.store.set('spDone', this.done);
      }

      const el = this.chipEls && this.chipEls[cid];
      if (el) {
        const on = list.indexOf(cid) !== -1;
        el.classList.toggle('is-used', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.querySelector('.chip__tick').textContent = on ? '✓' : '○';
      }
      this.updateConstraintCount();

      const railItem = $('.rail__item[data-id="' + card.id + '"]');
      if (railItem) railItem.classList.toggle('is-done', all);
    },

    updateConstraintCount() {
      const card = this.cards[this.index];
      const list = this.used[card.id] || [];
      const total = (card.mandatory_constraints || []).length;
      $('#spConstraintCount').textContent = list.length + ' of ' + total + ' used';
    },

    /* ---------------- teacher panel ---------------- */
    renderTeacher() {
      const card = this.cards[this.index];
      const probes = $('#spProbes');
      probes.innerHTML = '';
      (card.tutor_follow_up || []).forEach((p) => {
        const li = document.createElement('li');
        li.innerHTML =
          '<p class="probes__q">' + esc(p.q) + '</p>' +
          '<p class="probes__probe">' + esc(p.probe) + '</p>';
        probes.appendChild(li);
      });

      const rub = $('#spRubric');
      rub.innerHTML = '';
      const r = card.rubric || {};
      [['Fluency', r.fluency], ['Grammar accuracy', r.grammar_accuracy], ['Lexical range', r.lexical_range]]
        .forEach((pair) => {
          if (!pair[1]) return;
          const wrap = document.createElement('div');
          const dt = document.createElement('dt');
          dt.textContent = pair[0];
          const dd = document.createElement('dd');
          dd.textContent = pair[1];
          wrap.appendChild(dt);
          wrap.appendChild(dd);
          rub.appendChild(wrap);
        });
    },

    /* ---------------- timer ---------------- */
    buildTimer() {
      this.timer = new ESL.Countdown({
        duration: this.stage.dur,
        onTick: (remaining) => {
          $('#spDigits').textContent = ESL.util.mmss(remaining);
          const ratio = this.timer.duration ? remaining / this.timer.duration : 0;
          $('#spFill').style.transform = 'scaleX(' + ratio + ')';
        },
        onState: (state) => {
          const clock = $('#spClock');
          clock.dataset.state = state;
          const btn = $('#spStart');
          btn.textContent = state === 'running' ? 'Pause' : (state === 'paused' ? 'Resume' : 'Start');
        },
        onFinish: () => {
          if (this.stage.stage === 'prep') {
            $('#spCue').textContent =
              'Prep finished — switch to production and let the student talk.';
            this.setStage('produce', this.lastDur.produce);
          } else {
            $('#spCue').textContent =
              'Time. Move straight to the two tutor probes.';
          }
        }
      });
      this.setStage('prep', this.lastDur.prep);
    },

    setStage(stage, dur) {
      this.stage = { stage, dur };
      this.lastDur[stage] = dur;
      $$('.stage').forEach((b) => {
        const on = b.dataset.stage === stage && Number(b.dataset.dur) === dur;
        b.classList.toggle('is-on', on);
      });
      $('#spClock').dataset.stage = stage;
      $('#spDigits').textContent = ESL.util.mmss(dur);
      $('#spFill').style.transform = 'scaleX(1)';
      this.timer.setDuration(dur);
      this.timer.onState('idle', this.timer);
      $('#spStart').textContent = 'Start';
      $('#spClockLabel').innerHTML = stage === 'prep'
        ? 'Preparation &mdash; no speaking yet'
        : 'Production &mdash; the student speaks';
    }
  };

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* ---------------- shared context for the correction pad ---------------- */
  ESL.currentContext = function () {
    const tab = ESL.state.tab;
    if (tab === 'speaking' && ESL.speaking.cards[ESL.speaking.index]) {
      const c = ESL.speaking.cards[ESL.speaking.index];
      const meta = ESL.speaking.data.categories.find((x) => x.id === c.category);
      return 'Card ' + pad(c.id) + ' · ' + (meta ? meta.label : c.category) + ' — ' + c.title;
    }
    if (tab === 'grammar' && ESL.grammar.items[ESL.grammar.index]) {
      const it = ESL.grammar.items[ESL.grammar.index];
      return 'Item ' + pad(it.id) + ' · ' + it.type.replace('_', ' ') + ' — ' + it.target;
    }
    if (tab === 'reading') return 'Analytical reading — ' + (ESL.reading.title || '');
    return '';
  };

  ESL.currentRef = function () {
    if (ESL.state.tab === 'speaking' && ESL.speaking.cards[ESL.speaking.index]) {
      return 'Card ' + pad(ESL.speaking.cards[ESL.speaking.index].id);
    }
    if (ESL.state.tab === 'grammar' && ESL.grammar.items[ESL.grammar.index]) {
      return 'Item ' + pad(ESL.grammar.items[ESL.grammar.index].id);
    }
    return 'Note';
  };
})();
