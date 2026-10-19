// 직접 올린 영상 재생 — <video src>가 Range 요청으로 조금씩 가져갑니다.
// GET /api/video-stream?id=xxx&k=서명   (서명은 admin-videos / member-videos가 6시간짜리로 만들어 줘요)
// 한 번에 저장 조각(3.5MB) 하나 안에서만 돌려줘서 함수 응답 크기 제한에 걸리지 않게 합니다.
import { getLesson, getChunk, verifyStreamKey, CHUNK } from './_lib/videos.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!verifyStreamKey(id, url.searchParams.get('k'))) return new Response('forbidden', { status: 403 });
  const l = await getLesson(id);
  if (!l || !l.size || l.youtubeId) return new Response('not found', { status: 404 });

  const size = l.size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = m && m[1] ? Number(m[1]) : 0;
  if (m && !m[1] && m[2]) start = Math.max(0, size - Number(m[2])); // bytes=-500 (끝에서 500바이트)
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });

  const n = Math.floor(start / CHUNK);
  const buf = await getChunk(id, n);
  if (!buf) return new Response('chunk missing', { status: 404 });
  const offset = start - n * CHUNK;
  let end = n * CHUNK + buf.byteLength - 1;
  if (m && m[1] && m[2]) end = Math.min(end, Number(m[2]));
  const body = buf.slice(offset, end - n * CHUNK + 1);

  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': l.mime || 'video/mp4',
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  });
};

export const config = { path: '/api/video-stream' };
