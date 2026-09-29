/**
 * Chatbot proxy for chat-based studies (currently: hedgehog-1010).
 *
 * The browser never sees the API key or the prompts: it sends only the study id,
 * condition, turn number and the transcript so far; the prompts live here.
 * Setup: Project Settings → Script properties → ANTHROPIC_API_KEY.
 * Editing prompts: change this file, then Deploy → Manage deployments → new version.
 */

const CHAT_MODEL = 'claude-haiku-4-5';
const CHAT_MAX_TOKENS = 160;           // ~100 words; messages are asked to be 15–35 words
const CHAT_MAX_CALLS_PER_PID = 8;      // 4 needed per participant; leaves room for retries
const CHAT_MAX_CALLS_PER_DAY = 3000;   // spending guard (~$0.002/call → ≤ ~$6/day worst case)
const CHAT_MAX_CHARS = 600;            // longest participant message accepted

const CHATBOTS = {
  'hedgehog-1010': {
    persona:
      'You are role-playing Jordan, a Columbia sophomore. It is the first day of a new class, and you are ' +
      'sitting next to another student (the participant), making small talk before class starts. ' +
      'Jordan\'s details, to use only if relevant: thinking about majoring in either economics or environmental ' +
      'science; taking four classes this semester, including statistics and a Spanish class; likes cooking and ' +
      'running along the river; favorite spot is a small café near campus.',
    rules: [
      'Each message: react briefly and specifically to what they just said (you may add a short related detail about yourself), then do the step below.',
      'Every message must be 15 to 35 words. Never longer.',
      'Be equally friendly, interested and warm no matter what they write.',
      'Keep it light. Never ask about feelings, mental health, family, relationships, money, politics, religion or identity.',
      'If they mention something sensitive, acknowledge it kindly in a few words and move on to the step below.',
      'If they ask whether you are an AI, say honestly that you are an AI playing a classmate for this survey, then continue.',
      'Do not copy their writing style: always write in the style described below, whatever they do.',
      'Output only the message text: no name label, no quotation marks, no stage directions.',
    ],
    styles: {
      casual:
        'STYLE: a relaxed college student texting. All lowercase. One or two bits of casual slang per message ' +
        '(e.g. "lol", "ngl", "lowkey", "fr", "tbh"), not more. Contractions and dropped apostrophes are fine ("im", ' +
        '"thats"). Use an exclamation mark or two. At most one emoji per message, in about half of your messages.',
      formal:
        'STYLE: a polished, formal register. Standard capitalization and punctuation, complete sentences. No ' +
        'contractions (write "I am", "that is"). No slang, no emoji, no exclamation marks. Formal but warm and ' +
        'polite, never cold.',
    },
    // Step for the reply after the participant's Nth message. (The opening question is fixed in the study page.)
    steps: {
      1: 'Then ask what other classes they are taking this semester.',
      2: 'Then ask what they like to do for fun outside of class.',
      3: 'Then ask if they have a favorite spot on or around campus they would recommend (food, studying, anything).',
      4: 'Do not ask anything. The professor has just walked in, so wrap up the chat in a friendly way.',
    },
  },
};

function chat_(b) {
  const bot = CHATBOTS[b.study_id];
  if (!bot) return { ok: false, error: 'unknown study' };
  const style = bot.styles[b.condition];
  if (!style) return { ok: false, error: 'unknown condition' };
  const turn = Number(b.turn);
  if (!bot.steps[turn]) return { ok: false, error: 'bad turn' };
  const tr = Array.isArray(b.transcript) ? b.transcript.slice(-12) : [];
  if (!tr.length) return { ok: false, error: 'empty transcript' };

  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'no api key' };

  // Caps: per participant, and per day.
  const cache = CacheService.getScriptCache();
  const pidKey = 'chat_' + String(b.pid || 'anon').slice(0, 40);
  const used = Number(cache.get(pidKey) || 0);
  if (used >= CHAT_MAX_CALLS_PER_PID) return { ok: false, error: 'participant cap' };
  cache.put(pidKey, String(used + 1), 21600);
  if (!bumpDaily_()) return { ok: false, error: 'daily cap' };

  const lines = tr.map(function (m) {
    const who = m.role === 'bot' ? 'Jordan (you)' : 'Classmate';
    return who + ': ' + String(m.text || '').slice(0, CHAT_MAX_CHARS).replace(/\s+/g, ' ').trim();
  });
  const system = bot.persona + '\n\nRULES:\n- ' + bot.rules.join('\n- ') + '\n\n' + style;
  const user = 'Conversation so far:\n' + lines.join('\n') + '\n\nWrite Jordan\'s next message. ' + bot.steps[turn];

  const t0 = Date.now();
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: CHAT_MODEL, max_tokens: CHAT_MAX_TOKENS, system: system,
                              messages: [{ role: 'user', content: user }] }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) return { ok: false, error: 'api ' + code + ': ' + res.getContentText().slice(0, 200) };
  const j = JSON.parse(res.getContentText());
  let text = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(' ').trim();
  text = text.replace(/^Jordan[^:]{0,10}:\s*/i, '').replace(/^["“]|["”]$/g, '').trim().slice(0, 500);
  if (!text) return { ok: false, error: 'empty reply' };
  return { ok: true, text: text, model: j.model, usage: j.usage, ms: Date.now() - t0 };
}

function bumpDaily_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return true;   // don't block a participant over bookkeeping
  try {
    const props = PropertiesService.getScriptProperties();
    const k = 'chat_day_' + Utilities.formatDate(new Date(), 'America/New_York', 'yyyyMMdd');
    const n = Number(props.getProperty(k) || 0);
    if (n >= CHAT_MAX_CALLS_PER_DAY) return false;
    props.setProperty(k, String(n + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Run from the editor after adding the key: prints one reply in each style. */
function chatSelfTest() {
  ['casual', 'formal'].forEach(function (c) {
    const out = chat_({ study_id: 'hedgehog-1010', condition: c, pid: 'T-CHATTEST-' + Date.now(), turn: 1, transcript: [
      { role: 'bot', text: c === 'casual' ? 'hey! im jordan lol. what are you majoring in?' : 'Hello, I am Jordan. What are you majoring in?' },
      { role: 'user', text: 'probably biology, maybe neuroscience' },
    ] });
    Logger.log(c + ': ' + JSON.stringify(out));
  });
}
