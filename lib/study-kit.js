/*
 * StudyKit — shared library for every megasurvey study app.
 *
 * A study is a single HTML page that does:
 *
 *   const kit = await StudyKit.start({ id: 'my-study', conditions: ['a', 'b'] });
 *   await kit.show({ title: 'Instructions', html: '<p>…</p>' });
 *   const answers = await kit.ask({ questions: [ … ] });
 *   kit.finish();
 *
 * Inside the wrapper, the wrapper tells the study who the participant is and
 * which condition they were assigned. Opened directly in a browser, the study
 * runs in TEST MODE: a yellow bar lets you pick the condition, and at the end
 * the data that would have been saved is printed on screen. Nothing is sent.
 */
(function () {
  'use strict';

  // ---------- small utilities ----------
  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function qs(name) { return new URLSearchParams(location.search).get(name); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => (performance && performance.now ? performance.now() : Date.now());

  // ---------- handshake with the wrapper ----------
  function handshake(id, timeoutMs) {
    return new Promise(resolve => {
      if (window.parent === window) return resolve(null);
      let done = false;
      function onMsg(ev) {
        const m = ev.data;
        if (!m || m.sk !== 1 || m.type !== 'init') return;
        if (ev.origin !== location.origin && !(ev.origin === 'null' && location.origin === 'null')) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(m);
      }
      window.addEventListener('message', onMsg);
      window.parent.postMessage({ sk: 1, type: 'hello', id }, '*');
      setTimeout(() => { if (!done) { window.removeEventListener('message', onMsg); resolve(null); } }, timeoutMs);
    });
  }

  // ---------- the Kit ----------
  class Kit {
    constructor(opts, init) {
      this.id = opts.id;
      this.conditions = opts.conditions || [];
      this.standalone = !init;
      this.t0 = now();
      this.startedAt = new Date().toISOString();
      this.data = {};
      this.events = [];
      this.pages = [];

      if (init) {
        this.pid = init.pid;
        this.condition = init.condition;
        this.seed = init.seed >>> 0;
        this.position = init.position;
        this.total = init.total;
        this.debug = !!init.debug;
      } else {
        this.pid = 'TEST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const c = qs('cond');
        this.condition = c != null ? c : (this.conditions.length ? this.conditions[Math.floor(Math.random() * this.conditions.length)] : null);
        this.seed = hashString(this.pid + '|' + this.id);
        this.debug = true;
      }
      this.rng = mulberry32(this.seed);

      document.documentElement.classList.add('sk-root');
      if (this.standalone) this._testBar();
      this.el = document.createElement('div');
      this.el.className = 'sk-wrap';
      document.body.appendChild(this.el);
      this.mark('start');
    }

    // ----- randomness (seeded, so it can be reproduced from the saved seed) -----
    random() { return this.rng(); }
    pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    }

    // ----- recording -----
    elapsed() { return Math.round(now() - this.t0); }
    mark(name, extra) { this.events.push(Object.assign({ e: name, t: this.elapsed() }, extra || {})); }
    set(key, value) { this.data[key] = value; }

    // ----- screens -----
    _render(html) {
      this.el.innerHTML = html;
      window.scrollTo(0, 0);
      return this.el;
    }

    /** Show an information/instruction page. Resolves when Continue is clicked.
     *  opts: { title, html, button='Continue', minMs=0, id } */
    show(opts) {
      const o = Object.assign({ button: 'Continue', minMs: 0 }, opts);
      const pageId = o.id || ('page' + (this.pages.length + 1));
      const root = this._render(
        `<div class="sk-card">${o.title ? `<h2>${esc(o.title)}</h2>` : ''}${o.html || ''}
         <div class="sk-actions"><button class="sk-btn" type="button">${esc(o.button)}</button></div></div>`);
      const btn = root.querySelector('.sk-btn');
      const t = now();
      if (o.minMs > 0) { btn.disabled = true; setTimeout(() => { btn.disabled = false; }, o.minMs); }
      return new Promise(resolve => {
        btn.addEventListener('click', () => {
          btn.disabled = true;
          const ms = Math.round(now() - t);
          this.pages.push({ page: pageId, ms });
          resolve(ms);
        }, { once: true });
      });
    }

    /** Show a bare stage (for stimuli, countdowns). Returns the stage element. */
    stage(html) {
      return this._render(`<div class="sk-stage">${html || ''}</div>`).firstElementChild;
    }

    /** Flash items one at a time. render(item, i) returns HTML. */
    async sequence(items, opts) {
      const o = Object.assign({ ms: 1000, gapMs: 0, render: x => `<div class="sk-big">${esc(x)}</div>` }, opts);
      const st = this.stage('');
      for (let i = 0; i < items.length; i++) {
        st.innerHTML = o.render(items[i], i);
        this.mark('stim', { i });
        await sleep(o.ms);
        if (o.gapMs) { st.innerHTML = ''; await sleep(o.gapMs); }
      }
      st.innerHTML = '';
    }

    /** Visible countdown. opts: { seconds, label } */
    async countdown(opts) {
      const o = Object.assign({ seconds: 3, label: '' }, opts);
      const st = this.stage(`${o.label ? `<p>${esc(o.label)}</p>` : ''}<div class="sk-big sk-timer"></div>`);
      const n = st.querySelector('.sk-timer');
      const end = now() + o.seconds * 1000;
      while (true) {
        const left = Math.max(0, end - now());
        n.textContent = Math.ceil(left / 1000);
        if (left <= 0) break;
        await sleep(Math.min(200, left));
      }
    }

    wait(ms) { return sleep(ms); }

    /**
     * Ask a page of questions. Resolves with { [question.id]: answer }.
     * Answers are also merged into kit.data automatically.
     *
     * opts: { id, title, intro (html), button='Continue', questions: [...], timeLimitSec, onTimeout: 'submit' }
     *
     * Question fields: { id, type, prompt, note, required=true, ... }
     *   type 'mc'       options:[...], shuffle:false           -> string
     *   type 'multi'    options:[...], min, max, shuffle       -> string[]
     *   type 'text'     placeholder                             -> string
     *   type 'textarea' placeholder                             -> string
     *   type 'number'   min, max, integer:true                  -> number
     *   type 'scale'    min=1, max=5, labels:[left,right]       -> number
     *   type 'slider'   min, max, step=1, labels:[l,r], suffix  -> number (must be moved)
 *   optOut: true | 'label'   (mc, scale) adds a "Prefer not to answer" choice -> 'prefer_not'
     * Options may be strings or { value, label }.
     */
    ask(opts) {
      const o = Object.assign({ button: 'Continue', questions: [] }, opts);
      const pageId = o.id || ('page' + (this.pages.length + 1));
      const qs = o.questions.map(q => Object.assign({ required: true }, q));
      const order = {};
      const body = qs.map(q => this._qHtml(q, order)).join('');
      const timer = o.timeLimitSec ? `<span class="sk-hint sk-muted">Time left: <span class="sk-timer" data-left>${o.timeLimitSec}</span>s</span>` : '<span class="sk-hint"></span>';
      const root = this._render(
        `<form class="sk-card" novalidate>${o.title ? `<h2>${esc(o.title)}</h2>` : ''}${o.intro || ''}
         ${body}
         <div class="sk-actions">${timer}<button class="sk-btn" type="submit">${esc(o.button)}</button></div></form>`);
      const form = root.querySelector('form');
      this._wireInputs(form);
      const t = now();

      return new Promise(resolve => {
        let finished = false;
        let tick = null;
        const finish = (timedOut) => {
          if (finished) return;
          finished = true;
          if (tick) clearInterval(tick);
          const ans = {};
          qs.forEach(q => { ans[q.id] = this._read(form, q); });
          const ms = Math.round(now() - t);
          this.pages.push(Object.assign({ page: pageId, ms }, timedOut ? { timed_out: true } : {}));
          Object.keys(order).forEach(k => { this.data[k + '__order'] = order[k]; });
          Object.assign(this.data, ans);
          resolve(ans);
        };
        form.addEventListener('submit', ev => {
          ev.preventDefault();
          const bad = qs.filter(q => !this._valid(form, q));
          form.querySelectorAll('.sk-q').forEach(n => n.classList.remove('sk-invalid'));
          if (bad.length) {
            bad.forEach(q => form.querySelector(`[data-q="${q.id}"]`).classList.add('sk-invalid'));
            const first = form.querySelector('.sk-invalid');
            first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          finish(false);
        });
        if (o.timeLimitSec) {
          const left = form.querySelector('[data-left]');
          const end = now() + o.timeLimitSec * 1000;
          tick = setInterval(() => {
            const s = Math.max(0, Math.ceil((end - now()) / 1000));
            left.textContent = s;
            if (s <= 0) finish(true);
          }, 200);
        }
      });
    }

    _opts(q, order) {
      let opts = (q.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: x }));
      if (q.shuffle) { opts = this.shuffle(opts); order[q.id] = opts.map(x => x.value); }
      return opts;
    }

    _qHtml(q, order) {
      const req = q.required ? '<span class="sk-req" aria-hidden="true">*</span>' : '';
      const head = `<div class="sk-q-prompt">${q.prompt || ''}${req}</div>${q.note ? `<div class="sk-q-note">${q.note}</div>` : ''}`;
      const name = esc(q.id);
      let input = '';
      switch (q.type) {
        case 'mc':
        case 'multi': {
          const t = q.type === 'mc' ? 'radio' : 'checkbox';
          input = `<div class="sk-options">${this._opts(q, order).map(op =>
            `<label class="sk-option"><input type="${t}" name="${name}" value="${esc(op.value)}"><span>${op.label}</span></label>`).join('')}</div>`;
          break;
        }
        case 'text':
          input = `<input class="sk-input" type="text" name="${name}" autocomplete="off" placeholder="${esc(q.placeholder || '')}">`;
          break;
        case 'textarea':
          input = `<textarea class="sk-textarea" name="${name}" placeholder="${esc(q.placeholder || '')}"></textarea>`;
          break;
        case 'number':
          input = `<input class="sk-input" type="number" inputmode="${q.integer === false ? 'decimal' : 'numeric'}" name="${name}"
                    ${q.min != null ? `min="${q.min}"` : ''} ${q.max != null ? `max="${q.max}"` : ''} step="${q.integer === false ? 'any' : 1}"
                    placeholder="${esc(q.placeholder || '')}" style="max-width:12rem">${q.suffix ? ` <span class="sk-muted">${esc(q.suffix)}</span>` : ''}`;
          break;
        case 'scale': {
          const min = q.min != null ? q.min : 1, max = q.max != null ? q.max : 5;
          let cells = '';
          for (let v = min; v <= max; v++) cells += `<label><input type="radio" name="${name}" value="${v}">${v}</label>`;
          const ends = q.labels ? `<div class="sk-scale-ends"><span>${esc(q.labels[0])}</span><span>${esc(q.labels[1])}</span></div>` : '';
          input = `<div class="sk-scale">${cells}</div>${ends}`;
          break;
        }
        case 'slider': {
          const min = q.min != null ? q.min : 0, max = q.max != null ? q.max : 100, step = q.step || 1;
          const start = q.start != null ? q.start : Math.round((min + max) / 2 / step) * step;
          const ends = q.labels ? `<div class="sk-scale-ends"><span>${esc(q.labels[0])}</span><span>${esc(q.labels[1])}</span></div>` : '';
          input = `<div class="sk-slider-row sk-slider-untouched"><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${start}">
                   <span class="sk-slider-val">–</span></div>${ends}`;
          break;
        }
        default:
          input = `<div class="sk-muted">Unknown question type: ${esc(q.type)}</div>`;
      }
      if (q.optOut && (q.type === 'scale' || q.type === 'mc')) {
        const lab = typeof q.optOut === 'string' ? q.optOut : 'Prefer not to answer';
        input += `<label class="sk-optout"><input type="radio" name="${name}" value="__optout__"><span>${esc(lab)}</span></label>`;
      }
      return `<div class="sk-q" data-q="${name}">${head}${input}</div>`;
    }

    _wireInputs(form) {
      form.addEventListener('change', ev => {
        const t = ev.target;
        if (t.type === 'radio' || t.type === 'checkbox') {
          form.querySelectorAll(`input[name="${CSS.escape(t.name)}"]`).forEach(i => i.parentElement.classList.toggle('sk-checked', i.checked));
        }
      });
      form.querySelectorAll('input[type=range]').forEach(r => {
        const row = r.parentElement, out = row.querySelector('.sk-slider-val');
        const q = r.name;
        const upd = () => {
          row.classList.remove('sk-slider-untouched');
          r.dataset.touched = '1';
          const spec = this._currentQs && this._currentQs[q];
          out.textContent = r.value + (spec && spec.suffix ? spec.suffix : '');
        };
        r.addEventListener('input', upd);
        r.addEventListener('change', upd);
      });
      // Enter in a single-line field shouldn't submit the whole page by accident on mobile
      form.querySelectorAll('input.sk-input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); }));
    }

    _read(form, q) {
      const n = form.elements[q.id];
      switch (q.type) {
        case 'mc': { const c = form.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`); return c ? (c.value === '__optout__' ? 'prefer_not' : c.value) : null; }
        case 'multi': return Array.from(form.querySelectorAll(`input[name="${CSS.escape(q.id)}"]:checked`)).map(i => i.value);
        case 'scale': { const c = form.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`); return c ? (c.value === '__optout__' ? 'prefer_not' : Number(c.value)) : null; }
        case 'number': return n.value === '' ? null : Number(n.value);
        case 'slider': return n.dataset.touched ? Number(n.value) : null;
        default: return n.value.trim();
      }
    }

    _valid(form, q) {
      const v = this._read(form, q);
      if (q.type === 'number' && v != null) {
        if (Number.isNaN(v)) return false;
        if (q.min != null && v < q.min) return false;
        if (q.max != null && v > q.max) return false;
        if (q.integer !== false && !Number.isInteger(v)) return false;
      }
      if (q.type === 'multi' && v.length) {
        if (q.min && v.length < q.min) return false;
        if (q.max && v.length > q.max) return false;
      }
      if (!q.required) return true;
      if (v == null) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.length > 0;
      return true;
    }

    // ----- finishing -----
    /** Send the collected data to the wrapper (or print it in test mode). */
    finish(extra) {
      if (extra) Object.assign(this.data, extra);
      this.mark('end');
      const payload = {
        study_id: this.id,
        pid: this.pid,
        condition: this.condition,
        seed: this.seed,
        started_at: this.startedAt,
        ended_at: new Date().toISOString(),
        duration_ms: this.elapsed(),
        data: this.data,
        pages: this.pages,
        events: this.events,
      };
      if (this.standalone) {
        this._render(`<div class="sk-card"><h2>Test run complete</h2>
          <p class="sk-muted">In the real survey this would be saved and the participant moved on. Here's what would be saved:</p>
          <pre class="sk-dump"></pre>
          <div class="sk-actions"><button class="sk-btn" type="button">Run again</button></div></div>`);
        this.el.querySelector('.sk-dump').textContent = JSON.stringify(payload, null, 2);
        this.el.querySelector('.sk-btn').onclick = () => location.reload();
        console.log('[StudyKit] complete', payload);
      } else {
        this.stage('<p class="sk-muted">Saving…</p>');
        window.parent.postMessage({ sk: 1, type: 'complete', payload }, '*');
      }
      return payload;
    }

    _testBar() {
      const bar = document.createElement('div');
      bar.className = 'sk-testbar';
      const conds = this.conditions;
      const sel = conds.length
        ? `<label>Condition <select>${conds.map(c => `<option${c === this.condition ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`
        : '<span>No conditions</span>';
      bar.innerHTML = `<strong>TEST MODE</strong><span>${esc(this.id)}</span>${sel}<a href="#" data-restart>Restart</a><span class="sk-muted" style="color:inherit;opacity:.7">Nothing is saved.</span>`;
      document.body.appendChild(bar);
      const s = bar.querySelector('select');
      if (s) s.onchange = () => { const u = new URL(location.href); u.searchParams.set('cond', s.value); location.href = u.toString(); };
      bar.querySelector('[data-restart]').onclick = e => { e.preventDefault(); location.reload(); };
    }
  }

  // Slider suffix lookup needs the question specs; patch ask() to stash them.
  const _ask = Kit.prototype.ask;
  Kit.prototype.ask = function (opts) {
    this._currentQs = {};
    (opts.questions || []).forEach(q => { this._currentQs[q.id] = q; });
    return _ask.call(this, opts);
  };

  window.StudyKit = {
    /** Start a study. Resolves to a Kit once the wrapper (or test mode) has provided pid/condition. */
    async start(opts) {
      if (!opts || !opts.id) throw new Error('StudyKit.start needs an id');
      if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));
      const init = await handshake(opts.id, 2500);
      return new Kit(opts, init);
    },
    esc,
  };
})();
