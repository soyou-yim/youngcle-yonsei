// 영상 쉐도잉 관리 — 반드시 관리자 토큰이 필요합니다. (js/video-admin.js가 사용)
// GET  /api/admin-videos               → { lessons: [요약] }
// GET  /api/admin-videos?id=xxx        → { lesson, streamUrl }
// POST /api/admin-videos { action:'create', title, mime, size, duration }          → { lesson }  (📁 파일, 업로드 미완료 상태)
// POST /api/admin-videos { action:'create_youtube', youtubeId, title, ... }        → { lesson }
// POST /api/admin-videos { action:'update', id, title, sentences, status, ... }    → { lesson }
// POST /api/admin-videos { action:'delete', id }
// POST /api/admin-videos { action:'import', lessons:[버클리에서 내보낸 YouTube 영상 쉐도잉...] } → { imported, skipped }
// PUT  /api/admin-videos?id=xxx&n=0  (본문: 영상 조각 바이너리)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listLessons, getLesson, summarize, createFileLesson, createYoutubeLesson, importYoutubeLesson, updateLesson, deleteLesson, putChunk, streamUrlFor } from './_lib/videos.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      const lesson = await getLesson(id);
      if (!lesson) return jsonResponse({ error: 'lesson_not_found' }, 404);
      return jsonResponse({ lesson, streamUrl: streamUrlFor(lesson) });
    }
    return jsonResponse({ lessons: (await listLessons()).map(summarize) });
  }

  if (req.method === 'PUT') {
    try {
      await putChunk(url.searchParams.get('id'), Number(url.searchParams.get('n')), await req.arrayBuffer());
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  try {
    if (body.action === 'create') return jsonResponse({ lesson: await createFileLesson(body) });
    if (body.action === 'create_youtube') return jsonResponse({ lesson: await createYoutubeLesson(body) });
    if (body.action === 'update') return jsonResponse({ lesson: await updateLesson(body.id, body) });
    if (body.action === 'delete') { await deleteLesson(body.id); return jsonResponse({ ok: true }); }
    if (body.action === 'import') {
      const existing = await listLessons();
      const done = [], skipped = [];
      for (const src of (Array.isArray(body.lessons) ? body.lessons : []).slice(0, 200)) {
        try { const l = await importYoutubeLesson(src, existing); existing.push(l); done.push(l.title); }
        catch (e) { skipped.push(`${(src && src.title) || '?'} (${e.message})`); }
      }
      return jsonResponse({ imported: done.length, skipped });
    }
    return jsonResponse({ error: 'unknown_action' }, 400);
  } catch (e) {
    return jsonResponse({ error: e.message || 'error' }, 400);
  }
};

export const config = { path: '/api/admin-videos' };
