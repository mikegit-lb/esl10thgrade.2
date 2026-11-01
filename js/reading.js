/* ============================================================
   reading.js — timed skimming, targeted scanning, cause-and-effect
   matrix and inference checking.
   ============================================================ */
(function () {
  'use strict';

  const ESL = window.ESL;
  const { $, $$, esc, norm } = ESL.util;

  ESL.reading = {
    data: null,
    title: '',
    timer: null,
    skimOpen: false,
    matrixAnswers: {},

    init(data) {
      this.data = data;
      this.title = data.title;

      $('#rdTitle').textContent = data.title;
      $('#rdSubtitle').textContent =
        (data.subtitle || '') + (data.word_count ? ' · ' + data.word_count + ' words' : '');

      this.renderPassage(data);
      this.renderSkim(data);
      this.renderScan(data);
      this.renderMatrix(data);
      this.renderInference(data);
      this.buildTimer(data);
      ESL.on('teacher-mode', () => this.renderInferenceCCQs());
    },

    /* ---------------- passage ---------------- */
    renderPassage(data) {
      const host = $('#rdPassage');
      host.innerHTML = '';
      (data.passage || []).forEach((p) => {
        const el = document.createElement('p');
        el.textContent = p;
        host.appendChild(el);
      });
    },

    highlight(verbatim) {
      $$('mark', $('#rdPassage')).forEach((m) => {
        const parent = m.parentNode;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
      });
      const paras = $$('#rdPassage p');
      for (let i = 0; i < paras.length; i++) {
        const text = paras[i].textContent;
        const at = text.indexOf(verbatim);
        if (at === -1) continue;
        const mark = document.createElement('mark');
        mark.textContent = verbatim;
        paras[i].textContent = text.slice(0, at);
        paras[i].appendChild(mark);
        paras[i].appendChild(document.createTextNode(text.slice(at + verbatim.length)));
        paras[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    },

    /* ---------------- skim ---------------- */
    renderSkim(data) {
      const host = $('#rdChecklist');
      host.innerHTML = '';
      (data.skim.checklist || []).forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        host.appendChild(li);
      });
      $('#rdGist').textContent = data.skim.prompt || '';
    },

    buildTimer(data) {
      const dur = (data.skim && data.skim.duration_seconds) || 60;
      this.timer = new ESL.Countdown({
        duration: dur,
        onTick: (remaining) => {
          $('#rdDigits').textContent = ESL.util.mmss(remaining);
          const ratio = this.timer.duration ? remaining / this.timer.duration : 0;
          $('#rdFill').style.transform = 'scaleX(' + ratio + ')';
        },
        onState: (state) => {
          const btn = $('#rdStart');
          btn.textContent = state === 'running' ? 'Pause' : (state === 'paused' ? 'Resume' : 'Start ' + dur + '-second skim');
          $('#rdClockLabel').textContent =
            state === 'running' ? 'Reading now — no notes, no dictionary'
              : state === 'done' ? 'Stop. Put the text down and speak.'
              : state === 'paused' ? 'Paused'
              : 'Read for gist — no notes, no dictionary';
        },
        onFinish: () => {
          this.skimOpen = true;
          $('#rdAfter').hidden = false;
          $('#rdAfter').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      $('#rdStart').addEventListener('click', () => this.timer.toggle());
      $('#rdReset').addEventListener('click', () => {
        this.timer.reset();
        $('#rdAfter').hidden = true;
        this.skimOpen = false;
      });
      $('#rdRevealPassage').addEventListener('click', () => {
        const sheet = $('#rdPassageSheet');
        sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
        sheet.animate(
          [{ boxShadow: '0 0 0 3px rgba(228,168,36,.55)' }, { boxShadow: '0 0 0 3px rgba(228,168,36,0)' }],
          { duration: 1200, easing: 'ease-out' }
        );
      });
    },

    /* ---------------- scan hunt ---------------- */
    renderScan(data) {
      const host = $('#rdScan');
      host.innerHTML = '';
      (data.scan_hunt || []).forEach((q) => {
        const li = document.createElement('li');
        li.className = 'scan';
        li.dataset.id = q.id;

        const qp = document.createElement('p');
        qp.className = 'scan__q';
        qp.textContent = q.question;

        const row = document.createElement('div');
        row.className = 'scan__row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Answer in a few words';
        input.setAttribute('aria-label', 'Answer for question ' + q.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = 'Check';
        const fb = document.createElement('p');
        fb.className = 'scan__fb';

        const check = () => {
          const given = norm(input.value);
          if (!given) {
            fb.className = 'scan__fb is-no';
            fb.textContent = 'Write an answer first — a single word or number is enough.';
            return;
          }
          const accepted = [q.answer].concat(q.accept || []).map(norm);
          const ok = accepted.some((a) => a === given || (a.length > 3 && given.indexOf(a) !== -1));
          fb.className = 'scan__fb ' + (ok ? 'is-ok' : 'is-no');
          if (ok) {
            fb.innerHTML = 'Correct. ' + esc(q.explanation || '');
            this.highlight(q.verbatim);
          } else {
            fb.textContent = 'Not this one. ' + (q.explanation || '') +
              ' Look for the sentence that states it directly.';
          }
        };
        btn.addEventListener('click', check);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); check(); }
        });

        row.appendChild(input);
        row.appendChild(btn);
        li.appendChild(qp);
        li.appendChild(row);
        li.appendChild(fb);
        host.appendChild(li);
      });
    },

    /* ---------------- cause & effect matrix ---------------- */
    renderMatrix(data) {
      const ce = data.cause_effect;
      $('#rdMatrixInstruction').textContent = ce.instruction || '';

      const host = $('#rdMatrix');
      host.innerHTML = '';
      this.matrixAnswers = {};

      const effectPool = (ce.effects || []).map((e) => e.id)
        .concat(ce.distractors || []);

      (ce.causes || []).forEach((cause, i) => {
        const row = document.createElement('div');
        row.className = 'matrix__row';
        row.dataset.cause = cause.id;

        const left = document.createElement('div');
        left.className = 'matrix__cause';
        left.innerHTML = '<b>Cause ' + (i + 1) + '</b>' + esc(cause.text);

        const arrow = document.createElement('div');
        arrow.className = 'matrix__arrow';
        arrow.textContent = '→';

        const sel = document.createElement('select');
        sel.setAttribute('aria-label', 'Effect for cause ' + (i + 1));
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'Choose an effect…';
        sel.appendChild(blank);
        effectPool.forEach((id) => {
          const eff = (ce.effects || []).find((e) => e.id === id);
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = eff ? eff.text : id;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
          this.matrixAnswers[cause.id] = sel.value;
          row.classList.remove('is-ok', 'is-no');
        });

        row.appendChild(left);
        row.appendChild(arrow);
        row.appendChild(sel);
        host.appendChild(row);
      });

      $('#rdMatrixCheck').addEventListener('click', () => this.checkMatrix(data));
    },

    checkMatrix(data) {
      const ce = data.cause_effect;
      const fb = $('#rdMatrixFeedback');
      let right = 0;
      const misses = [];

      $$('.matrix__row').forEach((row) => {
        const causeId = row.dataset.cause;
        const pick = row.querySelector('select').value;
        const match = (ce.matches || []).find((m) => m.cause === causeId);
        row.classList.remove('is-ok', 'is-no');
        if (!pick) {
          misses.push({ causeId, reason: 'left blank' });
          return;
        }
        if (match && match.effect === pick) {
          row.classList.add('is-ok');
          right++;
        } else {
          row.classList.add('is-no');
          const eff = (ce.effects || []).find((e) => e.id === pick);
          misses.push({
            causeId,
            reason: eff ? eff.text : pick
          });
        }
      });

      let html = '';
      if (!misses.length) {
        html = '<div class="fb fb--ok"><p class="fb__title">Full marks — all five links hold</p>' +
          '<p>Now ask the student to justify one pair in a full sentence, using a cause-and-effect linker.</p></div>';
      } else {
        html = '<div class="fb fb--no"><p class="fb__title">' + right + ' of 5 correctly linked</p>' +
          '<ul>' + misses.map((m) => {
            const cause = (ce.causes || []).find((c) => c.id === m.causeId);
            return '<li class="is-miss">' + esc(cause ? cause.text : m.causeId) +
              ' — your link was ' + esc(m.reason) + '</li>';
          }).join('') + '</ul>';
        const details = (ce.matches || [])
          .filter((m) => misses.some((x) => x.causeId === m.cause))
          .map((m) => '<li class="is-hit">' + esc(m.explanation) + '</li>').join('');
        if (details) html += '<ul>' + details + '</ul>';
      }
      fb.innerHTML = html;
    },

    /* ---------------- inference ---------------- */
    renderInference(data) {
      const host = $('#rdInfer');
      host.innerHTML = '';
      (data.inference || []).forEach((item) => {
        const li = document.createElement('li');
        li.className = 'inf';
        li.dataset.id = item.id;

        const q = document.createElement('p');
        q.className = 'inf__q';
        q.textContent = item.statement;

        const choices = document.createElement('div');
        choices.className = 'inf__choice';
        const fb = document.createElement('div');

        ['True', 'False', 'Cannot be told'].forEach((label) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'inf__btn';
          b.textContent = label;
          b.addEventListener('click', () => {
            $$('.inf__btn', choices).forEach((x) => x.classList.remove('is-picked'));
            b.classList.add('is-picked');
            const ok = label === item.answer;
            $$('.inf__btn', choices).forEach((x) => x.classList.remove('is-correct', 'is-wrong'));
            if (ok) {
              b.classList.add('is-correct');
              fb.innerHTML =
                '<p class="inf__why"><strong>' + esc(item.answer) + '</strong> — ' + esc(item.why) + '</p>';
            } else {
              b.classList.add('is-wrong');
              fb.innerHTML =
                '<p class="inf__why">The writer supports <strong>' + esc(item.answer) +
                '</strong>. ' + esc(item.why) + '</p>';
            }
            if (ESL.state.teacherMode) this.appendCCQ(fb, item);
          });
          choices.appendChild(b);
        });

        li.appendChild(q);
        li.appendChild(choices);
        li.appendChild(fb);
        if (ESL.state.teacherMode) this.appendCCQ(fb, item);
        host.appendChild(li);
      });
    },

    renderInferenceCCQs() {
      const data = this.data;
      if (!data) return;
      const items = (data.inference || []);
      $$('#rdInfer .inf').forEach((li, i) => {
        const fb = li.querySelector('div:last-child');
        if (!fb || !items[i]) return;
        if (ESL.state.teacherMode) this.appendCCQ(fb, items[i]);
        else {
          const old = fb.querySelector('.inf__ccq');
          if (old) old.remove();
        }
      });
    },

    appendCCQ(fb, item) {
      if (!item.tutor_ccq) return;
      if ($('.inf__ccq', fb)) return;
      const p = document.createElement('p');
      p.className = 'inf__ccq';
      p.textContent = 'Probe: ' + item.tutor_ccq + ' (expected: ' + item.tutor_ccq_answer + ')';
      fb.appendChild(p);
    }
  };
})();
