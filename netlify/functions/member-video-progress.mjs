// 영상 쉐도잉 — 회원의 공부 표시(✓ 공부함 · 🔖 책갈피)를 서버에 저장해서 다른 기기에서도 같게 보여요.
// GET  /api/member-video-progress?id=xxx                → { done:[문장번호], last:{ i, at }, resetAt }
// POST /api/member-video-progress { id, done:[...], last, reset } → 저장한 결과
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getLesson, getProgress, saveProgress } from './_lib/videos.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return jsonResponse({ error: 'id_required' }, 400);
    return jsonResponse(await getProgress(auth.username, id));
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (!body || !(await getLesson(body.id))) return jsonResponse({ error: 'lesson_not_found' }, 404);
  return jsonResponse(await saveProgress(auth.username, body.id, body));
};

export const config = { path: '/api/member-video-progress' };
