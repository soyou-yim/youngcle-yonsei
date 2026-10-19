// 교재 쉐도잉 — 관리자용 교재/유닛 보기. 반드시 관리자 토큰이 필요합니다.
// GET /api/admin-textbooks                 → { books: [{ id, title, units:[{ id, title, sentenceCount, wordCount }] }] }
// GET /api/admin-textbooks?id=book-gp-u1   → { set: {...} }
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listTextbooks, getTextbookSet } from './_lib/textbooks.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const set = getTextbookSet(id);
    if (!set) return jsonResponse({ error: 'set_not_found' }, 404);
    return jsonResponse({ set });
  }
  return jsonResponse({ books: listTextbooks() });
};

export const config = { path: '/api/admin-textbooks' };
