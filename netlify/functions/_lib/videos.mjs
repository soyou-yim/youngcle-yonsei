// 영상 쉐도잉 저장소 (Netlify Blobs)
//   video-lessons  : `${id}`               → 영상 정보 + 문장 [{ s, e, en, ko }]
//   video-chunks   : `${id}/${n}`          → 직접 올린 영상 파일 조각 (3.5MB씩)
//   video-progress : `${username}/${id}`   → { done:[문장번호], last:{ i, at }, resetAt }
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { signToken, verifyToken } from './auth.mjs';

export const CHUNK = 3.5 * 1024 * 1024; // js/video-admin.js의 CHUNK와 같아야 해요
const VIS = ['draft', 'members', 'public'];
const LEVELS = ['', 'kids', '1-2', '3-4', '5-6', '7-9'];

const lessonsStore = () => getStore({ name: 'video-lessons', consistency: 'strong' });
const chunksStore = () => getStore({ name: 'video-chunks', consistency: 'strong' });
const progressStore = () => getStore({ name: 'video-progress', consistency: 'strong' });

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function cleanSentences(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(x => ({ s: +num(x && x.s).toFixed(2), e: +num(x && x.e).toFixed(2), en: String((x && x.en) || '').trim().slice(0, 2000), ko: String((x && x.ko) || '').trim().slice(0, 2000) }))
    .filter(x => x.en && x.e > x.s)
    .sort((a, b) => a.s - b.s);
}

// 목록용 요약 (문장은 빼고 개수만)
export function summarize(l) {
  const { sentences, ...rest } = l;
  return Object.assign(rest, { sentenceCount: (sentences || []).length });
}

// 처음 한 번: 버클리에서 가져온 영상 쉐도잉(video-seed.mjs)을 넣어 둡니다. 관리자가 지운 영상이 다시 생기지 않게 표시를 남겨요.
async function ensureSeeded(store) {
  const meta = getStore({ name: 'video-meta', consistency: 'strong' });
  if (await meta.get('seeded')) return;
  await meta.set('seeded', new Date().toISOString());
  const { default: seed } = await import('./video-seed.mjs');
  const existing = [];
  for (const src of seed) { try { existing.push(await importYoutubeLesson(src, existing)); } catch (e) {} }
}

export async function listLessons() {
  const store = lessonsStore();
  await ensureSeeded(store);
  const { blobs } = await store.list();
  const all = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })))).filter(Boolean);
  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return all;
}

export async function getLesson(id) {
  if (!/^[\w-]{1,64}$/.test(String(id || ''))) return null;
  return lessonsStore().get(String(id), { type: 'json' });
}

// 관리자 입력값 중 저장해도 되는 것만 골라 붙입니다.
function applyFields(l, b) {
  if (b.title != null) l.title = String(b.title).trim().slice(0, 200) || l.title;
  if (b.description != null) l.description = String(b.description).trim().slice(0, 500);
  if (b.visibility != null && VIS.includes(b.visibility)) l.visibility = b.visibility;
  if (b.level != null && LEVELS.includes(String(b.level))) l.level = String(b.level);
  if (b.partMinutes != null) l.partMinutes = Math.max(0, Math.min(30, num(b.partMinutes, 1)));
  if (b.duration != null && num(b.duration) > 0) l.duration = num(b.duration);
  if (b.clipStart != null) l.clipStart = Math.max(0, num(b.clipStart));
  if (b.clipEnd != null) l.clipEnd = Math.max(0, num(b.clipEnd));
  if (b.watchOnly != null) l.watchOnly = !!b.watchOnly;
  if (b.sentences != null) l.sentences = cleanSentences(b.sentences);
  if (b.track && typeof b.track === 'object') { l.captionTrack = { lang: String(b.track.lang || 'en'), kind: String(b.track.kind || '') }; l.caption = l.captionTrack.kind; }
  if (b.status === 'ready') l.status = 'ready';
  return l;
}

async function save(l) {
  l.updatedAt = new Date().toISOString();
  await lessonsStore().setJSON(l.id, l);
  return l;
}

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// 📁 파일 올리기: 정보만 먼저 만들고(업로드 미완료), 조각을 다 올린 뒤 update(status:'ready')
export async function createFileLesson(b) {
  const l = {
    id: newId(), title: String(b.title || '영상').slice(0, 200), description: '', mime: String(b.mime || 'video/mp4'),
    size: Math.max(0, num(b.size)), duration: num(b.duration), youtubeId: null, sentences: [], partMinutes: 1,
    visibility: 'draft', level: '', status: 'uploading', watchOnly: false, clipStart: 0, clipEnd: 0, createdAt: new Date().toISOString(),
  };
  l.chunks = Math.ceil(l.size / CHUNK);
  return save(l);
}

// 🔗 YouTube: 영상은 YouTube로 재생하니 바로 'ready'
export async function createYoutubeLesson(b) {
  if (!/^[\w-]{11}$/.test(String(b.youtubeId || ''))) throw new Error('invalid_youtube_id');
  const l = {
    id: newId(), title: 'YouTube 영상', description: '', youtubeId: b.youtubeId, mime: 'video/youtube', size: 0, duration: 0,
    sentences: [], partMinutes: 1, visibility: 'members', level: '', status: 'ready', watchOnly: false, clipStart: 0, clipEnd: 0,
    createdAt: new Date().toISOString(),
  };
  return save(applyFields(l, b));
}

// 다른 사이트(버클리)에서 내보낸 YouTube 영상 쉐도잉을 그대로 들여오기. 같은 YouTube 영상·구간이 이미 있으면 덮어써요.
export async function importYoutubeLesson(src, existing) {
  if (!src || !/^[\w-]{11}$/.test(String(src.youtubeId || ''))) throw new Error('youtube_only');
  const same = (existing || []).find(l => l.youtubeId === src.youtubeId && (l.clipStart || 0) === (src.clipStart || 0) && (l.clipEnd || 0) === (src.clipEnd || 0));
  const l = same || {
    id: newId(), youtubeId: src.youtubeId, mime: 'video/youtube', size: 0, status: 'ready',
    createdAt: src.createdAt || new Date().toISOString(),
  };
  Object.assign(l, { title: 'YouTube 영상', description: '', sentences: [], partMinutes: 1, visibility: 'members', level: '', watchOnly: false, clipStart: 0, clipEnd: 0, duration: 0 });
  applyFields(l, Object.assign({}, src, { track: src.captionTrack || (src.caption ? { lang: 'en', kind: src.caption } : null) }));
  l.status = 'ready';
  return save(l);
}

export async function updateLesson(id, b) {
  const l = await getLesson(id);
  if (!l) throw new Error('lesson_not_found');
  return save(applyFields(l, b));
}

export async function deleteLesson(id) {
  const l = await getLesson(id);
  if (!l) return;
  const cs = chunksStore();
  const { blobs } = await cs.list({ prefix: `${id}/` });
  await Promise.all(blobs.map(x => cs.delete(x.key)));
  await lessonsStore().delete(id);
}

export async function putChunk(id, n, buf) {
  const l = await getLesson(id);
  if (!l || l.youtubeId) throw new Error('lesson_not_found');
  if (!(n >= 0 && n < (l.chunks || 1)) || buf.byteLength > CHUNK) throw new Error('bad_chunk');
  await chunksStore().set(`${id}/${n}`, buf);
}

export async function getChunk(id, n) {
  return chunksStore().get(`${id}/${n}`, { type: 'arrayBuffer' });
}

// 직접 올린 영상 재생 주소: 6시간짜리 서명을 붙여서 <video src>에 바로 쓸 수 있게
export function streamUrlFor(l) {
  if (!l || l.youtubeId || l.status !== 'ready') return null;
  return `/api/video-stream?id=${encodeURIComponent(l.id)}&k=${encodeURIComponent(signToken({ role: 'stream', id: l.id }, 6 * 3600))}`;
}
export function verifyStreamKey(id, k) {
  const p = verifyToken(k);
  return !!(p && p.role === 'stream' && p.id === id);
}

/* ---- 회원별 공부 표시(✓ 공부함 · 🔖 책갈피) ---- */
export async function getProgress(username, id) {
  return (await progressStore().get(`${username}/${id}`, { type: 'json' })) || { done: [], last: null, resetAt: null };
}
export async function saveProgress(username, id, b) {
  const store = progressStore();
  const key = `${username}/${id}`;
  let p = (await store.get(key, { type: 'json' })) || { done: [], last: null, resetAt: null };
  if (b.reset) p = { done: [], last: null, resetAt: new Date().toISOString() };
  if (Array.isArray(b.done)) {
    const set = new Set(p.done);
    b.done.forEach(i => { if (Number.isInteger(i) && i >= 0 && i < 100000) set.add(i); });
    p.done = [...set].sort((a, c) => a - c);
  }
  if (b.last && Number.isInteger(b.last.i) && (!p.last || String(b.last.at) > String(p.last.at))) p.last = { i: b.last.i, at: String(b.last.at || new Date().toISOString()) };
  await store.setJSON(key, p);
  return p;
}
export async function listProgress(username) {
  const store = progressStore();
  const { blobs } = await store.list({ prefix: `${username}/` });
  const out = {};
  await Promise.all(blobs.map(async x => {
    const p = await store.get(x.key, { type: 'json' });
    if (p) out[x.key.slice(username.length + 1)] = { done: (p.done || []).length, last: p.last ? p.last.i : null };
  }));
  return out;
}

// 연습 기록 회차 ID 'video-<영상ID>' → 관리자 📊 연습 기록에서 쓰는 세트 모양
export async function getVideoSet(setId) {
  const m = /^video-([\w-]+)$/.exec(String(setId || ''));
  const l = m && (await getLesson(m[1]));
  if (!l) return null;
  return { id: setId, title: `🎬 ${l.title}`, sentences: (l.sentences || []).map(x => ({ x: '', o: x.en })), words: [] };
}
export const isVideoSetId = id => /^video-/.test(String(id || ''));
