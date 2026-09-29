/**
 * Megasurvey → Google Sheets endpoint.
 *
 * SETUP (once):
 *   1. Create a new Google Sheet (e.g. "Megasurvey Fall 2026 — data").
 *   2. Extensions → Apps Script. Replace the contents of Code.gs with this file. Save.
 *   3. Run the `setup` function once (Run ▶). Approve the permissions prompt.
 *   4. Deploy → New deployment → type "Web app".
 *        Execute as: Me       Who has access: Anyone
 *      Copy the Web app URL (ends in /exec) into config.js → endpoint.
 *   5. Open that URL in a browser: you should see {"ok":true,...}.
 *
 * CHATBOT (for the hedgehog-1010 study): also add Chat.gs as a second file in the same project,
 * then Project Settings (⚙) → Script properties → add ANTHROPIC_API_KEY = <your key>.
 * Without a key, the study silently uses its pre-written fallback messages.
 *
 * After editing this script later: Deploy → Manage deployments → ✎ → Version: New version → Deploy.
 * (The /exec URL stays the same.)
 *
 * TABS WRITTEN
 *   raw            one row per item received, full JSON. The source of truth — everything else is derived.
 *   sessions       one row per participant: order, assigned conditions, device info.
 *   session_ends   one row per participant who reached the end.
 *   study_<id>     one tab per study, one row per participant, answers flattened into columns.
 *                  New columns are added automatically when a study sends a new field.
 *   events         resumes and skipped parts.
 */

const SPREADSHEET_ID = '';            // leave blank if this script was created from the Sheet itself
const MAX_CELL = 49000;               // Sheets' per-cell limit is 50,000 characters
const RAW_HEADERS = ['received_at', 'kind', 'pid', 'study_id', 'condition', 'test', 'qid', 'json'];
const STUDY_META = ['received_at', 'pid', 'test', 'condition', 'position', 'duration_ms', 'wrapper_ms',
                    'restarts', 'started_at', 'ended_at', 'seed', 'app_version', 'qid'];

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'megasurvey', time: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  // Chat requests (Chat.gs) must NOT hold the lock: they wait seconds on the AI model.
  if (body && body.action === 'chat') return json_(chat_(body));
  return json_(saveItems_(body));
}

function saveItems_(body) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return { ok: false, error: 'busy' };   // client will retry
  }
  try {
    const items = Array.isArray(body.items) ? body.items : [body];
    const cache = CacheService.getScriptCache();
    const ss = ss_();
    const received = new Date();
    const raw = [];
    let written = 0, dupes = 0;

    items.forEach(function (it) {
      if (!it || !it.qid || !it.kind) return;
      if (cache.get('q_' + it.qid)) { dupes++; return; }   // already stored (client retried)

      raw.push([received, it.kind, it.pid || '', it.study_id || '', it.condition == null ? '' : String(it.condition),
                !!it.test, it.qid, cell_(JSON.stringify(it))]);

      if (it.kind === 'study') appendObject_(ss, 'study_' + it.study_id, studyRow_(it, received), STUDY_META);
      else if (it.kind === 'session') appendObject_(ss, 'sessions', sessionRow_(it, received), ['received_at', 'pid', 'test']);
      else if (it.kind === 'session_end') appendObject_(ss, 'session_ends', flat_(it, received), ['received_at', 'pid', 'test']);
      else appendObject_(ss, 'events', flat_(it, received), ['received_at', 'kind', 'pid', 'test']);

      cache.put('q_' + it.qid, '1', 21600);
      written++;
    });

    if (raw.length) {
      const sh = sheet_(ss, 'raw', RAW_HEADERS);
      sh.getRange(sh.getLastRow() + 1, 1, raw.length, RAW_HEADERS.length).setValues(raw);
    }
    return { ok: true, written: written, duplicates: dupes };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- row builders ----------

function studyRow_(it, received) {
  const row = {
    received_at: received, pid: it.pid, test: !!it.test, condition: it.condition,
    position: it.position, duration_ms: it.duration_ms, wrapper_ms: it.wrapper_ms, restarts: it.restarts,
    started_at: it.started_at, ended_at: it.ended_at, seed: it.seed, app_version: it.app_version, qid: it.qid,
  };
  const data = it.data || {};
  Object.keys(data).forEach(function (k) {
    const col = STUDY_META.indexOf(k) >= 0 ? 'data.' + k : k;
    row[col] = data[k];
  });
  (it.pages || []).forEach(function (p) { row['ms_' + p.page] = p.ms; if (p.timed_out) row['timedout_' + p.page] = true; });
  row.events = it.events;
  return row;
}

function sessionRow_(it, received) {
  const row = {
    received_at: received, pid: it.pid, test: !!it.test, src: it.src, started_at: it.started_at,
    consented_at: it.consented_at, app_version: it.app_version, order: it.order,
  };
  Object.keys(it.conditions || {}).forEach(function (k) { row['cond_' + k] = it.conditions[k]; });
  Object.keys(it.device || {}).forEach(function (k) { row['dev_' + k] = it.device[k]; });
  return row;
}

function flat_(it, received) {
  const row = { received_at: received };
  Object.keys(it).forEach(function (k) { row[k] = it[k]; });
  return row;
}

// ---------- sheet helpers ----------

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && v.length > MAX_CELL) v = v.slice(0, MAX_CELL) + '…[truncated; see raw]';
  // Stop Sheets from treating answers like "=1+1" or "+5" as formulas.
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

function sheet_(ss, name, headers) {
  name = String(name).replace(/[\[\]\*\?\/\\:]/g, '_').slice(0, 99);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Append an object as a row, adding any new keys as new columns at the right. */
function appendObject_(ss, name, obj, firstCols) {
  const sh = sheet_(ss, name, firstCols);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(function (h) { return h !== ''; });
  const missing = Object.keys(obj).filter(function (k) { return headers.indexOf(k) < 0; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    headers = headers.concat(missing);
  }
  const row = headers.map(function (h) { return obj.hasOwnProperty(h) ? cell_(obj[h]) : ''; });
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// ---------- one-time setup & self-test ----------

function setup() {
  const ss = ss_();
  sheet_(ss, 'raw', RAW_HEADERS);
  sheet_(ss, 'sessions', ['received_at', 'pid', 'test']);
  const first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  Logger.log('Ready: ' + ss.getUrl());
}

/** Run from the editor to check that writing works (rows are marked test=true). */
function selfTest() {
  const out = doPost({ postData: { contents: JSON.stringify({ items: [
    { kind: 'session', qid: 'SELFTEST-' + Date.now(), pid: 'T-SELFTEST', test: true, order: ['demo'], conditions: { demo: 'a' }, device: { device_class: 'desktop' } },
    { kind: 'study', qid: 'SELFTEST-S-' + Date.now(), pid: 'T-SELFTEST', test: true, study_id: 'selftest', condition: 'a', data: { q1: 3, q2: ['x', 'y'] }, pages: [{ page: 'p1', ms: 1234 }], events: [] },
  ] }) } });
  Logger.log(out.getContent());
}
