// 영상 쉐도잉 — 회원(또는 로그인 없이 '전체 공개' 영상만) 영상 목록/상세. (video.html이 사용)
// GET /api/member-videos          → { lessons:[요약], progress:{ [id]:{ done, last } }, loggedIn, username }
// GET /api/member-videos?id=xxx   → { lesson, streamUrl }   ('회원 공개' 영상인데 로그인 안 했으면 401)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listLessons, getLesson, summarize, streamUrlFor, listProgress } from './_lib/videos.mjs';

const visible = (l, loggedIn) => l.status === 'ready' && (l.visibility === 'public' || (loggedIn && l.visibility === 'members'));

export default async (req) => {
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const auth = requireAuth(req, 'member');
  const loggedIn = !!auth;
  const id = new URL(req.url).searchParams.get('id');

  if (id) {
    const lesson = await getLesson(id);
    if (!lesson || lesson.status !== 'ready' || lesson.visibility === 'draft') return jsonResponse({ error: 'lesson_not_found' }, 404);
    if (!visible(lesson, loggedIn)) return jsonResponse({ error: 'login_required' }, 401);
    return jsonResponse({ lesson, streamUrl: streamUrlFor(lesson) });
  }

  const lessons = (await listLessons()).filter(l => visible(l, loggedIn)).map(summarize);
  const progress = loggedIn ? await listProgress(auth.username).catch(() => ({})) : {};
  return jsonResponse({ lessons, progress, loggedIn, username: loggedIn ? auth.username : null });
};

export const config = { path: '/api/member-videos' };
