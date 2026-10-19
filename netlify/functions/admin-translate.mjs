// 영상 쉐도잉 — 문장들을 앞뒤 문맥과 함께 자연스러운 한국어로 번역합니다. 관리자 전용.
// POST /api/admin-translate { sentences:[영어 문장...], title } → { ko:[한국어 문장...] }  (같은 순서, 못 한 칸은 '')
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { chat, groqErrorResponse } from './_lib/groq.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const sentences = (Array.isArray(body && body.sentences) ? body.sentences : []).slice(0, 40).map(x => String(x || '').slice(0, 600));
  if (!sentences.length) return jsonResponse({ ko: [] });
  const title = String((body && body.title) || '').slice(0, 200);

  try {
    const out = await chat([
      { role: 'system', content: 'Translate each English line from a video script into natural, spoken Korean for Korean learners of English. Use the surrounding lines as context. Return JSON: {"ko": [..]} with exactly one Korean string per input line, in the same order.' },
      { role: 'user', content: JSON.stringify({ title, lines: sentences }) },
    ], { json: true });
    let ko = [];
    try { ko = JSON.parse(out).ko; } catch (e) {}
    if (!Array.isArray(ko)) ko = [];
    return jsonResponse({ ko: sentences.map((_, i) => String(ko[i] || '').trim()) });
  } catch (e) {
    return groqErrorResponse(e, jsonResponse);
  }
};

export const config = { path: '/api/admin-translate' };
