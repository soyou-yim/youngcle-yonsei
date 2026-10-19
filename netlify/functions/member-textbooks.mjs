// 교재 쉐도잉 — 로그인한 회원이 교재 유닛을 봅니다(모든 회원 공통). 반드시 회원 토큰이 필요합니다.
// GET /api/member-textbooks                 → { books: [{ id, title, units:[{ id, title, sentenceCount, wordCount, practice }] }] }
//                                               practice: { count, spoke, best, last } | null — 그 유닛을 공부한 기록 요약
// GET /api/member-textbooks?id=book-gp-u1   → { set: {...} }  (유닛 상세: 문장 포함, 피드백 회차와 같은 모양)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listTextbooks, getTextbookSet } from './_lib/textbooks.mjs';
import { getSummary } from './_lib/practice.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const set = getTextbookSet(id);
    if (!set) return jsonResponse({ error: 'set_not_found' }, 404);
    return jsonResponse({ set });
  }

  const books = listTextbooks();
  const summary = await getSummary(auth.username).catch(() => ({}));
  books.forEach(b => b.units.forEach(u => {
    const p = summary && summary[u.id];
    const count = p ? (p.listen || 0) + (p.spoke || 0) + (p.failed || 0) : 0;
    u.practice = count ? { count, spoke: p.spoke || 0, best: p.best || 0, last: p.last || null } : null;
  }));
  return jsonResponse({ books });
};

export const config = { path: '/api/member-textbooks' };
