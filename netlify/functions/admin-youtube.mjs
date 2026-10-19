// 영상 쉐도잉 — YouTube 영상의 영어 자막을 단어별 시간과 함께 가져옵니다. 관리자 전용. (js/video-admin.js가 사용)
// POST /api/admin-youtube { url, infoOnly }  → infoOnly면 { title, duration }
//                         { url, jobId }     → { words:[{ w, s, e, brk? }], punctuated, title, duration, track:{ lang, kind } }
//   · 202 { jobId, message }                 : 자막이 없어 AI가 받아쓰는 중(몇 초 뒤 jobId로 다시 물어봐요)
//   · 4xx { error:'no_captions'|'blocked' }  : 자동으로 못 가져옴 → 관리자 화면이 「스크립트 표시」 붙여넣기로 이어가요
//
// 자막을 가져오는 방법
//   ① SUPADATA_API_KEY 환경변수가 있으면 Supadata 자막 API (서버에서도 잘 됨, 자막 없는 영상은 AI 받아쓰기)
//   ② 없으면 YouTube 페이지에서 직접 (서버 주소를 YouTube가 막는 경우가 많아요 → 붙여넣기로 이어감)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseId(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function fetchT(url, init = {}, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: ctl.signal }, init)); } finally { clearTimeout(t); }
}

async function oembedTitle(id) {
  try {
    const r = await fetchT(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`);
    if (r.ok) return String((await r.json()).title || '');
  } catch (e) {}
  return '';
}

// 자막 줄(cue) → 단어별 시간: 한 줄 안에서 글자 수 비율로 나눠요. 줄 끝은 문장 나눌 후보(brk)
function cuesToWords(cues) {
  const words = [];
  cues.forEach((c, i) => {
    const t = String(c.text || '').replace(/\[[^\]]*\]/g, ' ').replace(/[♪♫]+/g, ' ').replace(/>>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const next = cues[i + 1];
    const end = Math.max(c.s + 0.3, Math.min(c.s + (c.d || 2), next ? next.s : Infinity));
    const ws = t.split(' ');
    const total = ws.reduce((a, w) => a + w.length + 1, 0);
    let tt = c.s;
    ws.forEach(w => { const d = Math.max(0.05, (end - c.s) * (w.length + 1) / total); words.push({ w, s: +tt.toFixed(2), e: +(tt + d * 0.9).toFixed(2) }); tt += d; });
    words[words.length - 1].brk = true;
  });
  return words;
}
const isPunctuated = words => words.length > 0 && words.filter(w => /[.?!]$/.test(w.w)).length / words.length > 0.02;

/* ---- ① Supadata ---- */
async function supadata(id, jobId) {
  const key = process.env.SUPADATA_API_KEY;
  const headers = { 'x-api-key': key };
  const r = jobId
    ? await fetchT(`https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`, { headers })
    : await fetchT(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&lang=en&mode=auto`, { headers }, 20000);
  const d = await r.json().catch(() => ({}));
  if (r.status === 202 || (d.jobId && !d.content) || d.status === 'queued' || d.status === 'active') return { pending: true, jobId: d.jobId || jobId };
  if (!r.ok || d.status === 'failed') return { error: 'no_captions', message: d.message || d.error || ('자막 서비스 HTTP ' + r.status) };
  const content = Array.isArray(d.content) ? d.content : [];
  if (!content.length) return { error: 'no_captions', message: '영어 자막이 없어요.' };
  const cues = content.map(c => ({ s: (c.offset || 0) / 1000, d: (c.duration || 0) / 1000, text: c.text }));
  const words = cuesToWords(cues);
  return { words, punctuated: isPunctuated(words), lang: d.lang || 'en', kind: jobId ? 'ai' : '' };
}

/* ---- ② YouTube 페이지에서 직접 ---- */
async function direct(id) {
  let html = '';
  try {
    const r = await fetchT(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    html = await r.text();
  } catch (e) { return { error: 'blocked', message: 'YouTube에 연결하지 못했어요.' }; }
  const duration = Number((html.match(/"lengthSeconds":"(\d+)"/) || [])[1] || 0);
  const m = html.match(/"captionTracks":(\[.*?\])/);
  if (!m) return { error: /consent|captcha|unusual traffic|Sign in to confirm/i.test(html) ? 'blocked' : 'no_captions', message: '자막 정보를 찾지 못했어요.', duration };
  let tracks = [];
  try { tracks = JSON.parse(m[1]); } catch (e) {}
  const en = tracks.filter(t => /^en/.test(t.languageCode || ''));
  const track = en.find(t => t.kind !== 'asr') || en[0];
  if (!track) return { error: 'no_captions', message: '영어 자막이 없어요.', duration };
  let ev;
  try {
    const r = await fetchT(String(track.baseUrl).replace(/\\u0026/g, '&') + '&fmt=json3', { headers: { 'User-Agent': UA } });
    ev = (await r.json()).events || [];
  } catch (e) { return { error: 'blocked', message: '자막 파일을 받지 못했어요.', duration }; }
  const asr = track.kind === 'asr';
  let words = [];
  if (asr) {
    // 자동 자막은 단어마다 시간이 있어요
    ev.forEach(e => {
      const segs = (e.segs || []).filter(x => x.utf8 && x.utf8.trim());
      segs.forEach((x, k) => {
        const s = (e.tStartMs + (x.tOffsetMs || 0)) / 1000;
        const nx = segs[k + 1];
        const eEnd = nx ? (e.tStartMs + (nx.tOffsetMs || 0)) / 1000 : (e.tStartMs + (e.dDurationMs || 1000)) / 1000;
        words.push({ w: x.utf8.trim(), s: +s.toFixed(2), e: +Math.max(s + 0.05, eEnd).toFixed(2) });
      });
    });
  } else {
    const cues = ev.filter(e => e.segs).map(e => ({ s: e.tStartMs / 1000, d: (e.dDurationMs || 0) / 1000, text: e.segs.map(x => x.utf8 || '').join('') }));
    words = cuesToWords(cues);
  }
  if (!words.length) return { error: 'no_captions', message: '자막이 비어 있어요.', duration };
  return { words, punctuated: !asr && isPunctuated(words), lang: track.languageCode || 'en', kind: asr ? 'auto' : 'manual', duration };
}

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const id = parseId(body && body.url);
  if (!id) return jsonResponse({ error: 'invalid_url', message: 'YouTube 링크를 확인해 주세요.' }, 400);

  const title = await oembedTitle(id);
  if (body.infoOnly) {
    if (!title) return jsonResponse({ error: 'not_found', message: '영상을 찾지 못했어요. 공개(또는 일부 공개) 영상인지 확인해 주세요.' }, 404);
    return jsonResponse({ title, duration: 0 });
  }

  const attempts = [];
  let r = null;
  if (process.env.SUPADATA_API_KEY) {
    try { r = await supadata(id, body.jobId); } catch (e) { r = { error: 'no_captions', message: '자막 서비스 오류' }; }
    if (r.pending) return jsonResponse({ jobId: r.jobId, message: 'AI가 받아쓰는 중…' }, 202);
    if (r.error) { attempts.push('Supadata: ' + (r.message || r.error)); r = null; }
  }
  if (!r) {
    r = await direct(id);
    if (r.error) {
      attempts.push('YouTube: ' + (r.message || r.error));
      return jsonResponse({ error: r.error, message: r.message, title, duration: r.duration || 0, attempts }, 422);
    }
  }
  const duration = r.duration || (r.words.length ? Math.ceil(r.words[r.words.length - 1].e + 1) : 0);
  return jsonResponse({ words: r.words, punctuated: r.punctuated, title, duration, track: { lang: r.lang, kind: r.kind } });
};

export const config = { path: '/api/admin-youtube' };
