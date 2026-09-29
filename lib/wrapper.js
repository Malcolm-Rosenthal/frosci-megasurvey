/*
 * Megasurvey wrapper: consent → each study (in an iframe, randomised order) → end.
 *
 * URL options (for us, not participants):
 *   ?debug=1          debug panel: jump between parts, force conditions, see payloads.
 *   ?only=id1,id2     run just these studies, in this order (implies test mode).
 *   ?reset=1          forget saved progress in this browser.
 *   ?src=anything     stored with the session (e.g. which link/section it came from).
 * Debug/only runs are flagged test=true in the data and keep their progress
 * separately, so testing never blocks a real run in the same browser.
 */
(function () {
  'use strict';
  const C = window.MEGASURVEY_CONFIG;
  const P = new URLSearchParams(location.search);
  const DEBUG = P.get('debug') === '1';
  const ONLY = (P.get('only') || '').split(',').map(s => s.trim()).filter(Boolean);
  const TEST = DEBUG || ONLY.length > 0;
  const KEY = 'megasurvey:' + (TEST ? 'test:' : '');
  const STATE_KEY = KEY + 'state', QUEUE_KEY = KEY + 'queue';

  const $ = s => document.querySelector(s);
  const screenEl = $('#screen'), frame = $('#frame');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- storage (never trusted to work: private mode etc.) ----------
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* in-memory only */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- randomness ----------
  function rand32() {
    if (window.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }
  function randInt(n) { return rand32() % n; }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function makeId(prefix, len) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
    for (let i = 0; i < len; i++) s += abc[randInt(abc.length)];
    return prefix + s;
  }
  function completionCode(pid) {
    let h = 5381; for (const ch of pid + '|frosci') h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return h.toString(36).toUpperCase().padStart(7, '0').slice(-6);
  }

  // ---------- device info (Melon-12 needs this; everyone gets it) ----------
  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const touch = navigator.maxTouchPoints || 0;
    const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const uaMobile = navigator.userAgentData ? navigator.userAgentData.mobile : null;
    const ipadOS = /Macintosh/.test(ua) && touch > 1;
    const tablet = /iPad|Tablet/i.test(ua) || ipadOS || (/Android/i.test(ua) && !/Mobile/i.test(ua));
    const phone = !tablet && (uaMobile === true || /iPhone|iPod|Android.*Mobile|Mobi/i.test(ua));
    return {
      device_class: phone ? 'phone' : tablet ? 'tablet' : 'desktop',
      ua, ua_mobile: uaMobile, touch_points: touch, pointer_coarse: coarse,
      screen_w: screen.width, screen_h: screen.height,
      viewport_w: window.innerWidth, viewport_h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      lang: navigator.language, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null,
    };
  }

  // ---------- study list ----------
  const ALL = C.studies.filter(s => s.active !== false);
  const byId = Object.fromEntries(ALL.map(s => [s.id, s]));

  // Linked studies: { after: 'parent-id', minGap: 3 } always run after their parent,
  // with at least minGap other parts in between; { conditionFrom: 'parent-id' } copies its condition.
  function buildOrder() {
    if (ONLY.length) return ONLY.filter(id => byId[id]);
    const isRandom = s => !s.slot || s.slot === 'random';
    const first = ALL.filter(s => s.slot === 'first' && !s.after).map(s => s.id);
    const last = ALL.filter(s => s.slot === 'last' && !s.after).map(s => s.id);
    const mid = shuffle(ALL.filter(s => isRandom(s) && !s.after).map(s => s.id));
    ALL.filter(s => s.after && byId[s.after]).forEach(dep => {
      const gap = dep.minGap || 0;
      let p = mid.indexOf(dep.after);
      if (p < 0) { mid.push(dep.id); return; }            // parent pinned first/last: just append
      if (p + gap + 1 > mid.length) {                     // not enough room after the parent: move it earlier
        mid.splice(p, 1);
        p = randInt(Math.max(1, mid.length - gap + 1));
        mid.splice(p, 0, dep.after);
      }
      const earliest = Math.min(p + gap + 1, mid.length);
      mid.splice(earliest + randInt(mid.length - earliest + 1), 0, dep.id);
    });
    return first.concat(mid, last);
  }

  // ---------- state ----------
  let S = null;
  function save() { store.set(STATE_KEY, S); if (DEBUG) renderDebug(); }
  function newState() {
    const order = buildOrder();
    const conds = {}, seeds = {};
    order.forEach(id => {
      const c = byId[id].conditions;
      conds[id] = c && c.length ? c[randInt(c.length)] : null;
      seeds[id] = rand32();
    });
    order.forEach(id => { const from = byId[id].conditionFrom; if (from && from in conds) conds[id] = conds[from]; });
    return {
      v: 1, pid: makeId(TEST ? 'T-' : 'P-', 10), created_at: new Date().toISOString(),
      consented_at: null, finished_at: null, order, conds, seeds, idx: 0,
      done: {}, skipped: {}, restarts: {}, src: P.get('src') || null, test: TEST,
    };
  }

  // ---------- sending (queue in localStorage, retried until the Sheet says OK) ----------
  let queue = store.get(QUEUE_KEY) || [];
  let flushing = false, retryTimer = null, backoff = 2000, lastError = null;
  window.__megasurveySent = [];          // for debugging / automated tests

  function enqueue(kind, body) {
    const item = Object.assign({ kind, qid: makeId('Q', 12), pid: S.pid, test: TEST, app_version: C.version, sent_at: new Date().toISOString() }, body);
    queue.push(item);
    store.set(QUEUE_KEY, queue);
    lastPayload = item;
    if (DEBUG) renderDebug();
    flush();
  }

  async function flush() {
    if (flushing || !queue.length) return updateSaveStatus();
    if (!C.endpoint) {
      // Development: nothing to send to. Log and drop.
      queue.forEach(i => { console.log('[megasurvey] (no endpoint) would send', i); window.__megasurveySent.push(i); });
      queue = []; store.set(QUEUE_KEY, queue);
      return updateSaveStatus();
    }
    flushing = true;
    const batch = queue.slice();
    try {
      // No Content-Type header → sent as text/plain, which Apps Script accepts without a CORS preflight.
      const res = await fetch(C.endpoint, { method: 'POST', body: JSON.stringify({ items: batch }), redirect: 'follow' });
      const json = await res.json();
      if (!json || !json.ok) throw new Error((json && json.error) || 'Bad response');
      const sent = new Set(batch.map(i => i.qid));
      batch.forEach(i => window.__megasurveySent.push(i));
      queue = queue.filter(i => !sent.has(i.qid));
      store.set(QUEUE_KEY, queue);
      backoff = 2000; lastError = null;
    } catch (e) {
      lastError = String(e && e.message || e);
      console.warn('[megasurvey] send failed, will retry', lastError);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, backoff);
      backoff = Math.min(backoff * 2, 30000);
    } finally {
      flushing = false;
      if (DEBUG) renderDebug();
      updateSaveStatus();
      if (queue.length && !lastError) flush();   // items added while we were sending
    }
  }
  window.addEventListener('online', () => { backoff = 2000; flush(); });

  function updateSaveStatus() {
    const el = document.querySelector('.save-status');
    if (!el) return;
    if (!queue.length) { el.className = 'save-status good'; el.textContent = C.endpoint ? '✓ All responses saved. You can close this page.' : '✓ Done (development mode: nothing was sent).'; }
    else if (lastError) { el.className = 'save-status bad'; el.innerHTML = 'We’re having trouble saving your responses. Please keep this page open and check your internet connection — we’ll keep trying. <button class="sk-btn sk-secondary" type="button" style="margin-top:8px">Try again now</button>'; el.querySelector('button').onclick = () => { backoff = 2000; flush(); }; }
    else { el.className = 'save-status'; el.textContent = 'Saving your responses…'; }
  }

  // ---------- chrome ----------
  $('#top .title').textContent = C.title;
  document.title = C.title;
  function setProgress(done, total, label) {
    $('#bar > div').style.width = (total ? Math.round(100 * done / total) : 0) + '%';
    $('#top .part').textContent = label || '';
  }
  function showScreen(html) {
    frame.style.display = 'none';
    frame.removeAttribute('src');
    screenEl.style.display = '';
    screenEl.innerHTML = `<div class="sk-wrap"><div class="sk-card">${html}</div></div>`;
    window.scrollTo(0, 0);
    return screenEl;
  }
  window.addEventListener('beforeunload', e => {
    if ((S && S.consented_at && !S.finished_at) || queue.length) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- screens ----------
  function consentScreen() {
    setProgress(0, 1, '');
    const checks = (C.consentChecks || []).map((t, i) =>
      `<label class="sk-option"><input type="checkbox" data-c="${i}"><span>${esc(t)}</span></label>`).join('');
    const root = showScreen(`<h1>${esc(C.title)}</h1>${C.consentHtml}
      <div class="checks">${checks}</div>
      <div class="sk-actions"><button class="sk-btn" type="button" disabled>Begin</button></div>`);
    const boxes = [...root.querySelectorAll('input[type=checkbox]')];
    const btn = root.querySelector('.sk-btn');
    const upd = () => { boxes.forEach(b => b.parentElement.classList.toggle('sk-checked', b.checked)); btn.disabled = !boxes.every(b => b.checked); };
    boxes.forEach(b => b.addEventListener('change', upd)); upd();
    btn.onclick = () => {
      S = newState();
      S.consented_at = new Date().toISOString();
      save();
      enqueue('session', {
        started_at: S.created_at, consented_at: S.consented_at, src: S.src,
        order: S.order, conditions: S.conds, device: deviceInfo(),
      });
      runCurrent();
    };
  }

  function resumeScreen() {
    const n = S.order.length;
    setProgress(S.idx, n, `Part ${Math.min(S.idx + 1, n)} of ${n}`);
    const root = showScreen(`<h2>Welcome back</h2><p>You can pick up where you left off (part ${S.idx + 1} of ${n}).</p>
      <p class="sk-muted">If you were partway through a part, it will start again from its beginning.</p>
      <div class="sk-actions"><button class="sk-btn" type="button">Continue</button></div>`);
    root.querySelector('.sk-btn').onclick = () => {
      const id = S.order[S.idx];
      // Only a restart if they had actually begun this part before reloading.
      if (id && S.started && S.started[id]) { S.restarts[id] = (S.restarts[id] || 0) + 1; save(); }
      enqueue('resume', { at: new Date().toISOString(), idx: S.idx, study_id: id || null });
      runCurrent();
    };
  }

  function interstitial(next) {
    const n = S.order.length;
    if (!C.interstitialHtml) return next();
    setProgress(S.idx, n, `Part ${S.idx} of ${n} done`);
    const html = C.interstitialHtml.replace(/\{n\}/g, S.idx).replace(/\{total\}/g, n);
    const root = showScreen(`${html}<div class="sk-actions"><button class="sk-btn" type="button">Next part</button></div>`);
    root.querySelector('.sk-btn').onclick = next;
  }

  function endScreen() {
    const n = S.order.length;
    setProgress(n, n, 'Finished');
    const code = C.showCompletionCode ? `<p>Your completion code:</p><div class="code">${completionCode(S.pid)}</div>` : '';
    showScreen(`<h2>All done</h2>${C.endHtml}${code}<div class="save-status"></div>`);
    updateSaveStatus();
  }

  function errorScreen(id, msg) {
    const root = showScreen(`<h2>Something went wrong</h2><p>This part of the survey didn’t load properly.</p>
      <p class="sk-muted">${esc(msg)}</p>
      <div class="sk-actions"><button class="sk-btn sk-secondary" type="button" data-skip>Skip this part</button>
      <button class="sk-btn" type="button" data-retry>Try again</button></div>`);
    root.querySelector('[data-retry]').onclick = () => runCurrent();
    root.querySelector('[data-skip]').onclick = () => {
      S.skipped[id] = msg; enqueue('skip', { study_id: id, reason: msg, position: S.idx + 1 });
      advance();
    };
  }

  // ---------- running a study ----------
  let current = null;   // { id, position, t0, hello, completed, timer }

  function runCurrent() {
    const n = S.order.length;
    if (S.idx >= n) return finish();
    const id = S.order[S.idx];
    const st = byId[id];
    if (!st) { S.skipped[id] = 'missing from config'; return advance(); }
    setProgress(S.idx, n, `Part ${S.idx + 1} of ${n}`);
    screenEl.style.display = 'none';
    screenEl.innerHTML = '';
    frame.style.display = 'block';
    current = { id, position: S.idx + 1, t0: Date.now(), hello: false, completed: false };
    S.started = S.started || {};
    S.started[id] = true;
    const sep = st.path.includes('?') ? '&' : '?';
    frame.src = st.path + sep + 'v=' + encodeURIComponent(C.version);
    clearTimeout(current.timer);
    current.timer = setTimeout(() => { if (current && current.id === id && !current.hello) errorScreen(id, `No response from “${id}” after 15 s.`); }, 15000);
    save();
  }

  function advance() {
    current = null;
    S.idx += 1;
    save();
    if (S.idx >= S.order.length) return finish();
    interstitial(runCurrent);
  }

  function finish() {
    if (!S.finished_at) {
      S.finished_at = new Date().toISOString();
      save();
      enqueue('session_end', {
        finished_at: S.finished_at, completed: Object.keys(S.done).length, skipped: S.skipped,
        restarts: S.restarts, completion_code: completionCode(S.pid),
      });
    }
    endScreen();
  }

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (!m || m.sk !== 1 || ev.source !== frame.contentWindow) return;
    if (ev.origin !== location.origin && !(ev.origin === 'null' && location.origin === 'null')) return;
    if (!current) return;
    if (m.type === 'hello') {
      if (m.id !== current.id) { console.warn('[megasurvey] study id mismatch', m.id, current.id); }
      current.hello = true;
      clearTimeout(current.timer);
      frame.contentWindow.postMessage({
        sk: 1, type: 'init', pid: S.pid, condition: S.conds[current.id], seed: S.seeds[current.id],
        position: current.position, total: S.order.length, debug: DEBUG,
      }, ev.origin === 'null' ? '*' : ev.origin);
    } else if (m.type === 'complete') {
      if (current.completed) return;
      current.completed = true;
      const p = m.payload || {};
      enqueue('study', Object.assign({}, p, {
        study_id: current.id,
        // Wrapper-assigned condition wins; a study that picks its own (e.g. melon-1210's detected device) keeps it.
        condition: S.conds[current.id] != null ? S.conds[current.id] : (p.condition != null ? p.condition : null),
        seed: S.seeds[current.id],
        position: current.position, restarts: S.restarts[current.id] || 0,
        wrapper_ms: Date.now() - current.t0, team: byId[current.id].team || null,
      }));
      S.done[current.id] = true;
      advance();
    }
  });

  // ---------- debug panel ----------
  let lastPayload = null;
  function renderDebug() {
    let el = document.getElementById('debug');
    if (!el) {
      el = document.createElement('details');
      el.id = 'debug'; el.open = false;
      document.body.appendChild(el);
    }
    const rows = S ? S.order.map((id, i) => {
      const st = byId[id] || {};
      const status = S.done[id] ? '✓' : S.skipped[id] ? 'skip' : i === S.idx ? '▶' : '';
      const sel = st.conditions && st.conditions.length
        ? `<select data-cond="${esc(id)}">${st.conditions.map(c => `<option${c === S.conds[id] ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : '—';
      return `<tr><td>${i + 1}</td><td>${status}</td><td>${esc(id)}</td><td>${sel}</td><td><button data-jump="${i}">go</button></td></tr>`;
    }).join('') : '';
    el.innerHTML = `<summary>DEBUG · ${S ? esc(S.pid) : 'no session'} · queue ${queue.length}${lastError ? ' · ⚠ ' + esc(lastError) : ''}</summary>
      <div class="body">
        ${S ? `<table>${rows}</table>` : '<p>Tick the boxes and Begin to start a test session.</p>'}
        <p><button data-reset>Reset session</button> <a href="${esc(C.endpoint || '#')}" target="_blank">${C.endpoint ? 'endpoint' : 'no endpoint (dev)'}</a></p>
        ${lastPayload ? `<div>Last payload (${esc(lastPayload.kind)}):</div><pre>${esc(JSON.stringify(lastPayload, null, 1))}</pre>` : ''}
      </div>`;
    el.querySelectorAll('[data-cond]').forEach(s => s.onchange = () => {
      S.conds[s.dataset.cond] = s.value;
      ALL.filter(x => x.conditionFrom === s.dataset.cond).forEach(x => { S.conds[x.id] = s.value; });
      save();
    });
    el.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { S.idx = Number(b.dataset.jump); S.finished_at = null; save(); runCurrent(); });
    const r = el.querySelector('[data-reset]');
    if (r) r.onclick = () => { S = null; store.del(STATE_KEY); store.del(QUEUE_KEY); queue = []; location.reload(); };
  }

  // ---------- boot ----------
  if (P.get('reset') === '1') {
    store.del(STATE_KEY); store.del(QUEUE_KEY); queue = [];
    // Remove ?reset=1 so a later reload doesn't wipe progress again.
    const u = new URL(location.href); u.searchParams.delete('reset');
    try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  S = store.get(STATE_KEY);
  if (S && (!S.order || !S.pid)) S = null;
  if (S) {
    // Drop studies that were removed from the config since this session started.
    S.order = S.order.filter(id => byId[id] || S.done[id]);
    if (S.idx > S.order.length) S.idx = S.order.length;
  }
  if (DEBUG) renderDebug();
  if (queue.length) flush();

  if (!S || !S.consented_at) consentScreen();
  else if (S.finished_at) endScreen();
  else resumeScreen();
})();
