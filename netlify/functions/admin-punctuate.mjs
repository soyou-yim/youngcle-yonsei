// 영상 쉐도잉 — 문장부호 없는 자막(YouTube 자동 자막)에 AI로 문장부호를 붙입니다. 관리자 전용.
// POST /api/admin-punctuate { text, title } → { text }
//   text 안의 ‖ 는 말이 0.6초 넘게 끊긴 곳, » 는 말하는 사람이 바뀐 곳이에요(문장 끝일 가능성이 높음).
//   단어는 그대로 두고 문장부호·대소문자만 바꾸게 합니다(js/video-transcript.js가 단어별로 다시 맞춰 붙여요).
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { chat, groqErrorResponse } from './_lib/groq.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const text = String((body && body.text) || '').slice(0, 8000);
  if (!text.trim()) return jsonResponse({ error: 'text_required' }, 400);
  const title = String((body && body.title) || '').slice(0, 200);

  try {
    const out = await chat([
      { role: 'system', content: 'You restore punctuation and capitalization in English speech transcripts. Keep every word in the same order. Do not add, remove, or reorder words, except you may correct an obviously misheard proper name using the video title. Marks: ‖ means a pause and » means a speaker change; both are likely sentence ends. Remove the ‖ and » marks in your output. Output only the punctuated text.' },
      { role: 'user', content: (title ? `Video title: ${title}\n\n` : '') + text },
    ]);
    const clean = out.replace(/[‖»]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return jsonResponse({ error: 'empty' }, 502);
    return jsonResponse({ text: clean });
  } catch (e) {
    return groqErrorResponse(e, jsonResponse);
  }
};

export const config = { path: '/api/admin-punctuate' };
