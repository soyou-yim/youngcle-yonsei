// Groq 호출 공용 함수 — 영상 쉐도잉 만들기(문장부호 복원 · 번역 · 받아쓰기)에서 사용합니다.
// API 키는 다른 기능과 같은 Netlify 환경변수 GROQ_API_KEY 를 씁니다.
const CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const CHAT_MODEL = 'llama-3.3-70b-versatile';
export const STT_MODEL = 'whisper-large-v3-turbo';

export class GroqError extends Error {
  constructor(status, retryAfter) { super('groq HTTP ' + status); this.status = status; this.retryAfter = retryAfter; }
}

function key() {
  const k = process.env.GROQ_API_KEY;
  if (!k) throw new GroqError(500);
  return k;
}

async function call(url, init, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, init));
    if (!r.ok) throw new GroqError(r.status, Number(r.headers.get('retry-after')) || 0);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function chat(messages, { json = false, temperature = 0, timeoutMs = 24000 } = {}) {
  const data = await call(CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ model: CHAT_MODEL, messages, temperature, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
  }, timeoutMs);
  return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
}

export async function transcribe(buf, contentType, prompt) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: contentType }), 'audio.wav');
  form.append('model', STT_MODEL);
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', String(prompt).slice(-300));
  return call(STT, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form }, 25000);
}

// 실패 응답: 사용량 한도(429)면 몇 초 뒤 다시 하라고 알려줘요
export function groqErrorResponse(e, jsonResponse) {
  if (e instanceof GroqError) {
    if (e.status === 500) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);
    if (e.status === 429) return jsonResponse({ error: 'rate_limited', retryAfter: e.retryAfter || 10 }, 429);
    return jsonResponse({ error: e.message }, 502);
  }
  return jsonResponse({ error: e && e.name === 'AbortError' ? 'groq timeout' : 'groq request failed' }, 502);
}
