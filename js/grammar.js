/* ============================================================
   grammar.js — 1:1 drill engine.
   Reformulation / structural / error-correction items with
   client-side validation, revealable keys and concept checks.
   ============================================================ */
(function () {
  'use strict';

  const ESL = window.ESL;
  const { $, $$, esc, norm } = ESL.util;

  ESL.grammar = {
    data: null,
    items: [],
    index: 0,
    filter: 'all',
    revealed: false,
    checked: false,
    answers: {},
    choices: {},

    init(data) {
      this.data = data;
      this.items = data.items.slice().sort((a, b) => a.id - b.id);

      this.buildFilters();
      this.buildList();
      this.bind();
      this.show(0);
    },

    buildFilters() {
      const host = $('#gramFilters');
      host.innerHTML = '';
      const SHORT = {
        reformulation: 'Reformulations',
        structural: 'Structural drills',
        error_correction: 'Error correction'
      };
      const options = [{ id: 'all', label: 'All' }].concat(
        this.data.types.map((t) => ({ id: t.id, label: SHORT[t.id] || t.label, count: t.count }))
      );
      options.forEach((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filt' + (o.id === 'all' ? ' is-on' : '');
        b.dataset.filter = o.id;
        const n = o.id === 'all'
          ? this.items.length
          : this.items.filter((i) => i.type === o.id).length;
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
      const host = $('#gramList');
      host.innerHTML = '';
      const visible = this.items.filter(
        (i) => this.filter === 'all' || i.type === this.filter
      );
      visible.forEach((item) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rail__row' + (item.id === this.items[this.index].id ? ' is-active' : '');
        b.dataset.id = item.id;
        b.setAttribute('role', 'option');
        b.innerHTML = '<b>' + pad(item.id) + '</b><span>' + esc(item.target) + '</span>';
        b.addEventListener('click', () => {
          const i = this.items.findIndex((x) => x.id === item.id);
          if (i !== -1) this.show(i);
        });
        host.appendChild(b);
      });
    },

    bind() {
      $('#grPrev').addEventListener('click', () => this.step(-1));
      $('#grNext').addEventListener('click', () => this.step(1));
      $('#grCheck').addEventListener('click', () => this.check());
      $('#grReveal').addEventListener('click', () => {
        this.revealed = true;
        this.render();
        this.showSolution();
      });
      ESL.on('teacher-mode', () => this.render());
    },

    isSolutionVisible() {
      return this.revealed || ESL.state.teacherMode;
    },

    step(dir) {
      const list = this.items.filter(
        (i) => this.filter === 'all' || i.type === this.filter
      );
      const current = list.findIndex((i) => i.id === this.items[this.index].id);
      const next = current + dir;
      if (next < 0 || next >= list.length) return;
      this.show(this.items.indexOf(list[next]));
    },

    show(i) {
      this.index = Math.max(0, Math.min(this.items.length - 1, i));
      this.revealed = false;
      this.checked = false;
      this.render();
      $$('.rail__row').forEach((b) => {
        b.classList.toggle('is-active', Number(b.dataset.id) === this.items[this.index].id);
      });
      ESL.notes.context();
    },

    /* ---------------- render ---------------- */
    render() {
      const item = this.items[this.index];
      const meta = this.data.types.find((t) => t.id === item.type);

      $('#grRef').textContent = 'Item ' + pad(item.id);
      $('#grCat').textContent = meta ? meta.label : item.type;
      $('#grTitle').textContent = item.target;
      $('#grPrompt').textContent = item.prompt;
      $('#grInstruction').textContent = item.instruction || '';
      $('#grProgress').textContent = pad(item.id) + ' / ' + this.items.length;
      $('#grTeacherNote').textContent = item.teacher_note || '';

      this.renderInput(item);
      this.renderCCQs(item);
      $('#grCheck').textContent = item.type === 'structural' ? 'Check my choice' : 'Check my answer';

      const sol = $('#grSolution');
      const visible = this.isSolutionVisible();
      sol.hidden = !visible;
      $('#grKey').textContent = item.key || '';
      const alts = $('#grAlts');
      alts.innerHTML = '';
      (item.alternatives || []).forEach((a) => {
        const li = document.createElement('li');
        li.textContent = a;
        alts.appendChild(li);
      });
      const why = item.rationale || item.explanation || '';
      const errType = item.error_type ? ' (' + item.error_type + ')' : '';
      $('#grRationale').textContent = why ? why + errType : errType;

      $('#grFeedback').innerHTML = '';
      $('#grReveal').textContent = visible ? 'Solution shown' : 'Reveal solution';
    },

    renderInput(item) {
      const host = $('#grInputArea');
      host.innerHTML = '';

      if (item.type === 'structural') {
        const wrap = document.createElement('div');
        wrap.className = 'options';
        (item.options || []).forEach((opt, i) => {
          const label = document.createElement('label');
          label.className = 'option';
          const checked = this.choices[item.id] === i;
          label.innerHTML =
            '<input type="radio" name="gr-opt" value="' + i + '"' + (checked ? ' checked' : '') + '>' +
            '<span><span class="option__text">' + esc(opt) + '</span></span>';
          label.querySelector('input').addEventListener('change', (e) => {
            this.choices[item.id] = Number(e.target.value);
            $$('.option', wrap).forEach((o) => o.classList.remove('is-correct', 'is-wrong'));
          });
          wrap.appendChild(label);
        });
        host.appendChild(wrap);
        return;
      }

      const ta = document.createElement('textarea');
      ta.className = 'answerbox';
      ta.id = 'grAnswer';
      ta.rows = 3;
      ta.placeholder = item.input_placeholder || 'Type your answer…';
      ta.spellcheck = false;
      ta.value = this.answers[item.id] || '';
      ta.addEventListener('input', () => { this.answers[item.id] = ta.value; });
      host.appendChild(ta);

      const hint = document.createElement('p');
      hint.className = 'hintline';
      hint.style.marginTop = '.5rem';
      hint.textContent = item.type === 'reformulation'
        ? 'Register matters more than speed. Write one natural sentence.'
        : 'Type the corrected sentence exactly as you would say it.';
      host.appendChild(hint);
    },

    renderCCQs(item) {
      const host = $('#grCCQs');
      host.innerHTML = '';
      const masked = !this.isSolutionVisible();
      (item.ccq || []).forEach((c) => {
        const div = document.createElement('div');
        div.className = 'ccq' + (masked ? ' is-masked' : '');
        div.innerHTML =
          '<p class="ccq__q">' + esc(c.q) + '</p>' +
          '<p class="ccq__a">' + esc(c.a) + '</p>';
        host.appendChild(div);
      });
      if (masked) {
        const note = document.createElement('p');
        note.className = 'hintline';
        note.textContent = 'Answers are hidden. Reveal the solution when you want to check them.';
        host.appendChild(note);
      }
    },

    showSolution() {
      const item = this.items[this.index];
      if (item.type === 'structural') {
        const opts = $$('.option');
        opts.forEach((o, i) => {
          if (i === item.answer_index) o.classList.add('is-correct');
        });
        const radio = opts[item.answer_index] && opts[item.answer_index].querySelector('input');
        if (radio) radio.checked = true;
      }
      $('#grSolution').hidden = false;
    },

    /* ---------------- validation ---------------- */
    check() {
      const item = this.items[this.index];
      const fb = $('#grFeedback');
      fb.innerHTML = '';

      if (item.type === 'structural') {
        const picked = $('input[name="gr-opt"]:checked');
        const opts = $$('.option');
        opts.forEach((o) => o.classList.remove('is-correct', 'is-wrong'));
        if (!picked) {
          fb.innerHTML = '<div class="fb fb--info"><p class="fb__title">Choose an option first</p>' +
            '<p>Read all three, then pick the one a careful speaker would actually say.</p></div>';
          return;
        }
        const idx = Number(picked.value);
        if (idx === item.answer_index) {
          opts[idx].classList.add('is-correct');
          fb.innerHTML =
            '<div class="fb fb--ok"><p class="fb__title">Correct</p><p>' +
            esc(item.rationale || '') + '</p></div>';
        } else {
          opts[idx].classList.add('is-wrong');
          opts[item.answer_index].classList.add('is-correct');
          fb.innerHTML =
            '<div class="fb fb--no"><p class="fb__title">Not quite</p><p>' +
            esc(item.rationale || '') + '</p>' +
            '<p style="margin-top:.35rem">The right answer is highlighted above — check the contrast before you move on.</p></div>';
        }
        this.checked = true;
        return;
      }

      const ta = $('#grAnswer');
      if (!ta) return;
      const answer = norm(ta.value);
      if (!answer) {
        fb.innerHTML = '<div class="fb fb--info"><p class="fb__title">Nothing to check yet</p>' +
          '<p>Write your version in the box, then check it.</p></div>';
        return;
      }

      const required = (item.must_include || []).map(norm);
      const alternatives = (item.accept || []).map(norm);
      const hits = required.filter((r) => answer.indexOf(r) !== -1);
      const misses = required.filter((r) => answer.indexOf(r) === -1);
      const accepted = alternatives.some((a) => a.length > 2 && answer.indexOf(a) !== -1);

      let title, body, cls;
      if (!misses.length) {
        cls = 'fb--ok';
        title = 'That works';
        body = '<p>You have the target form and it reads naturally.</p>';
      } else if (accepted) {
        cls = 'fb--ok';
        title = 'Acceptable, but not the target form';
        body = '<p>Your version is a valid alternative. Accept it, then push the student for the ' +
          'specific form this drill is testing.</p>';
      } else {
        cls = 'fb--no';
        title = 'Needs another pass';
        body = '<p>The target language is still missing. Say it once more with the required form built in.</p>';
      }

      let list = '';
      if (required.length) {
        list = '<ul>' + required.map((r) => {
          const hit = hits.indexOf(r) !== -1;
          return '<li class="' + (hit ? 'is-hit' : 'is-miss') + '">' +
            esc(r) + (hit ? ' — present' : ' — missing') + '</li>';
        }).join('') + '</ul>';
      }

      fb.innerHTML = '<div class="fb ' + cls + '"><p class="fb__title">' + title + '</p>' +
        body + list + '</div>';
      this.checked = true;
    }
  };

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
})();
