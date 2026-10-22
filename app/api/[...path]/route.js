// 노래 예약 API 전부: /api/state, /api/search, /api/queue, /api/next, /api/prev, /api/admin/*
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DATA = path.join(process.cwd(), 'data.json');
// Vercel 마켓플레이스에서 Upstash를 연결하면 둘 중 한 이름으로 들어온다
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const EMPTY = { now: null, queue: [], history: [], fallback: [], fallbackPos: 0, cmd: { seq: 0 }, volume: 100 };

async function redis(...cmd) {
  const r = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body: JSON.stringify(cmd), cache: 'no-store' });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// ponytail: 상태 전체를 JSON 한 덩어리로 읽고 씀. 동시에 두 명이 바꾸면 한쪽이 덮일 수 있음 — 사무실 규모에선 드묾, 문제되면 항목별 키로 쪼갤 것
async function load() {
  if (REDIS_URL) return { ...EMPTY, ...JSON.parse((await redis('GET', 'state')) || '{}') };
  if (process.env.VERCEL) throw new Error('저장소가 연결되지 않았어요. Vercel 프로젝트 Storage에서 Upstash Redis를 연결해주세요');
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch { return { ...EMPTY }; }
}
async function save(state) {
  if (REDIS_URL) return redis('SET', 'state', JSON.stringify(state));
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
}

function videoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// oEmbed로 제목 조회 + 존재 확인
async function lookup(id) {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`, { cache: 'no-store' });
  if (!r.ok) return null;
  return { id, title: (await r.json()).title };
}

// ponytail: API 키 없이 유튜브 검색결과 페이지의 ytInitialData를 파싱. 유튜브가 구조를 바꾸거나 서버 IP를 막으면 깨짐 → 그때 YouTube Data API(키 필요)로 교체
async function search(q) {
  const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
    cache: 'no-store',
    headers: {
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      Cookie: 'SOCS=CAI; CONSENT=YES+', // 해외 서버에서 뜨는 쿠키 동의 화면 건너뛰기
    },
  }).then(r => r.text());
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('유튜브 검색 응답을 읽지 못했어요. 유튜브 링크를 붙여넣어 신청해주세요');
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length >= 10) return;
    const v = o.videoRenderer;
    if (v) {
      // 1시간 이상(h:mm:ss) 모음집은 독점 방지로 제외, lengthText 없으면 라이브 → 제외
      if (v.lengthText && v.lengthText.simpleText.split(':').length < 3) out.push({ id: v.videoId, title: v.title?.runs?.[0]?.text, channel: v.ownerText?.runs?.[0]?.text, length: v.lengthText.simpleText });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

function next(state) {
  if (state.now) state.history = [...state.history, state.now].slice(-50);
  const r = state.queue.find(q => !q.played);
  if (r) { r.played = true; state.now = { ...r }; }
  else if (state.fallback.length) {
    // 기본 리스트를 순서대로, 끝까지 다 틀면 처음부터 다시
    state.now = { ...state.fallback[state.fallbackPos % state.fallback.length], by: null };
    state.fallbackPos = (state.fallbackPos + 1) % state.fallback.length;
  } else state.now = null;
  return state.now;
}

// 지금 곡을 원래 자리(신청곡 맨 앞 / 기본 리스트 다음 차례)로 돌려놓고 직전 곡을 다시 튼다. 기록 없으면 지금 곡 처음부터
function prev(state) {
  const cur = state.now;
  if (!state.history.length) return cur;
  if (cur?.by) { const q = state.queue.findLast(q => q.played && q.id === cur.id); if (q) q.played = false; }
  else if (cur && state.fallback.length) state.fallbackPos = (state.fallbackPos - 1 + state.fallback.length) % state.fallback.length;
  state.now = state.history.pop();
  return state.now;
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });
const publicState = s => ({ now: s.now, queue: s.queue, fallback: s.fallback, fallbackPos: s.fallbackPos, cmd: s.cmd, volume: s.volume });

async function route(req, p) {
  if (req.method === 'GET' && p === 'search') {
    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 100);
    return json(q ? await search(q) : []);
  }
  const state = await load();
  if (req.method === 'GET' && p === 'state') return json(publicState(state));
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  const b = await req.json().catch(() => ({}));
  const done = async out => { await save(state); return json(out); };

  if (p === 'queue') {
    const id = videoId(b.url);
    if (!id) return json({ error: '유튜브 링크를 확인해주세요' }, 400);
    const v = await lookup(id).catch(() => null);
    if (!v) return json({ error: '영상을 찾을 수 없어요 (비공개/삭제됨?)' }, 400);
    if (state.queue.some(q => q.id === id && !q.played)) return json({ error: '이미 예약된 곡이에요' }, 400);
    state.queue.push({ ...v, by: String(b.by || '익명').slice(0, 20) });
    return done(publicState(state));
  }
  // ponytail: 플레이어 페이지용이라 비밀번호 없음. 장난치는 사람 생기면 플레이어 전용 토큰 추가
  if (p === 'next') { const now = next(state); return done({ now }); }
  if (p === 'prev') { const now = prev(state); return done({ now }); }

  // 이하 관리자 전용
  if (b.password !== ADMIN_PASSWORD) return json({ error: '비밀번호가 틀렸어요' }, 403);

  if (p === 'admin/check') return json({ fallback: state.fallback });
  // 원격 조작: 플레이어가 3초마다 cmd.seq·volume 변화를 보고 실행
  if (p === 'admin/cmd' && ['prev', 'toggle', 'next'].includes(b.type)) {
    state.cmd = { seq: state.cmd.seq + 1, type: b.type };
    return done(publicState(state));
  }
  if (p === 'admin/volume') {
    const v = Math.round(Number(b.volume));
    if (!(v >= 0 && v <= 100)) return json({ error: '음량은 0~100' }, 400);
    state.volume = v;
    return done(publicState(state));
  }
  if (p === 'admin/remove') { state.queue = state.queue.filter(q => q.id !== b.id); return done(publicState(state)); }
  if (p === 'admin/fallback') {
    const ids = [...new Set(String(b.urls || '').split('\n').map(videoId).filter(Boolean))];
    const found = (await Promise.all(ids.map(id => lookup(id).catch(() => null)))).filter(Boolean);
    state.fallback = found;
    state.fallbackPos = 0;
    return done({ fallback: found, skipped: ids.length - found.length });
  }
  return json({ error: 'not found' }, 404);
}

async function handle(req, { params }) {
  try {
    return await route(req, (await params).path.join('/'));
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500); // 에러를 숨기지 않고 화면에 보여준다
  }
}
export { handle as GET, handle as POST };
