// 영상 쉐도잉 — 직접 올린 영상의 소리 조각(WAV, 약 100초)을 Whisper로 받아씁니다. 관리자 전용.
// POST /api/admin-transcribe?prompt=앞 조각 마지막 말   (본문: audio/wav)
//   → { segments:[{ s, e, text }], words:[{ w, s, e }] }   (시간은 이 조각 안에서의 초)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { transcribe, groqErrorResponse } from './_lib/groq.mjs';

const MAX_BYTES = 5.5 * 1024 * 1024;
const NO_SPEECH_PROB = 0.6; // 말소리가 없는 구간에서 지어낸 문장은 버려요

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return jsonResponse({ error: 'empty audio' }, 400);
  if (buf.byteLength > MAX_BYTES) return jsonResponse({ error: 'audio too large' }, 413);
  const prompt = new URL(req.url).searchParams.get('prompt') || '';

  try {
    const d = await transcribe(buf, req.headers.get('content-type') || 'audio/wav', prompt);
    const segments = (d.segments || [])
      .filter(x => !(typeof x.no_speech_prob === 'number' && x.no_speech_prob > NO_SPEECH_PROB))
      .map(x => ({ s: x.start, e: x.end, text: String(x.text || '').trim() }))
      .filter(x => x.text);
    const words = (d.words || []).map(x => ({ w: String(x.word || '').trim(), s: x.start, e: x.end })).filter(x => x.w);
    return jsonResponse({ segments, words });
  } catch (e) {
    return groqErrorResponse(e, jsonResponse);
  }
};

export const config = { path: '/api/admin-transcribe' };
