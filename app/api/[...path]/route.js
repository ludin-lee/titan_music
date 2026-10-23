// 노래 예약 API 전부: /api/state, /api/search, /api/queue, /api/next, /api/prev, /api/admin/*
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PLAYER_PASSWORD = process.env.PLAYER_PASSWORD || ADMIN_PASSWORD; // 플레이어 시작용, 없으면 관리자 비밀번호
const DATA = path.join(process.cwd(), 'data.json');
// Vercel 마켓플레이스에서 Upstash를 연결하면 둘 중 한 이름으로 들어온다
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const EMPTY = { now: null, queue: [], history: [], replayPos: 0, cmd: { seq: 0 }, volume: 100 };

async function redis(...cmd) {
  const r = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body: JSON.stringify(cmd), cache: 'no-store' });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// ponytail: 상태 전체를 JSON 한 덩어리로 읽고 씀. 동시에 두 명이 바꾸면 한쪽이 덮일 수 있음 — 사무실 규모에선 드묾, 문제되면 항목별 키로 쪼갤 것
// 재생 위치(progress)는 플레이어가 자주 쓰므로 state와 덮어쓰기 경쟁이 없게 따로 둔다
let localProgress = null; // 로컬 실행용
async function load() {
  if (REDIS_URL) {
    const [state, progress] = await redis('MGET', 'state', 'progress');
    return [{ ...EMPTY, ...JSON.parse(state || '{}') }, JSON.parse(progress || 'null')];
  }
  if (process.env.VERCEL) throw new Error('저장소가 연결되지 않았어요. Vercel 프로젝트 Storage에서 Upstash Redis를 연결해주세요');
  try { return [{ ...EMPTY, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }, localProgress]; } catch { return [{ ...EMPTY }, localProgress]; }
}
async function saveProgress(progress) {
  if (REDIS_URL) return redis('SET', 'progress', JSON.stringify(progress));
  localProgress = progress;
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
  else if (state.queue.length) {
    // 새 신청곡이 없으면 지금까지 받은 신청곡을 처음부터 순서대로 다시
    state.now = { ...state.queue[state.replayPos % state.queue.length], replay: true };
    state.replayPos = (state.replayPos + 1) % state.queue.length;
  } else state.now = null;
  return state.now;
}

// 지금 곡을 원래 자리(새 신청곡이면 맨 앞 / 다시 듣기면 다음 차례)로 돌려놓고 직전 곡을 다시 튼다. 기록 없으면 지금 곡 처음부터
function prev(state) {
  const cur = state.now;
  if (!state.history.length) return cur;
  if (cur?.replay) state.replayPos = (state.replayPos - 1 + state.queue.length) % (state.queue.length || 1);
  else if (cur) { const q = state.queue.findLast(q => q.played && q.id === cur.id); if (q) q.played = false; }
  state.now = state.history.pop();
  return state.now;
}

// 먼저 켠 플레이어가 아직 살아 있는지. 마지막 신호(시작·다음곡·위치 보고) 후 2분,
// 또는 재생 중이던 곡이 끝날 시간 + 2분까지는 살아 있다고 본다 (브라우저 탭 절전으로 보고가 끊겨도 곡은 계속 나오므로)
const GRACE = 2 * 60 * 1000;
function ownerAlive(state, progress, now = Date.now()) {
  if (!state.playerId) return false;
  const seen = Math.max(state.playerSeen || 0, progress?.at || 0);
  if (now - seen < GRACE) return true;
  return !!progress?.playing && now < progress.at + (progress.d - progress.t) * 1000 + GRACE;
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });
// serverNow: 화면이 서버 시계 기준으로 진행률을 계산하도록
const publicState = (s, progress) => ({ playerId: s.playerId, now: s.now, queue: s.queue, replayPos: s.replayPos, cmd: s.cmd, volume: s.volume, progress, serverNow: Date.now() });

async function route(req, p) {
  if (req.method === 'GET' && p === 'search') {
    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 100);
    return json(q ? await search(q) : []);
  }
  const [state, progress] = await load();
  const pub = () => publicState(state, progress);
  if (req.method === 'GET' && p === 'state') return json(pub());
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  const b = await req.json().catch(() => ({}));
  const done = async out => { await save(state); return json(out); };

  // 플레이어는 한 곳만: 먼저 켠 플레이어(pid)가 주인. 주인이 살아 있으면 나중에 켠 쪽은 거절하되,
  // 비밀번호를 아는 사람이 force로 "기존 플레이어 끊고 여기서 틀기"를 고르면 넘겨준다 (중복 로그인 처리처럼)
  if (p === 'claim') {
    if (!/^[\w-]{8,64}$/.test(b.pid || '')) return json({ error: 'bad pid' }, 400);
    if (b.password !== PLAYER_PASSWORD) return json({ error: '플레이어 비밀번호가 틀렸어요' }, 403);
    if (!b.force && b.pid !== state.playerId && ownerAlive(state, progress)) {
      return json({ error: '이미 다른 곳에서 플레이어가 켜져 있어요', busy: true }, 409);
    }
    state.playerId = b.pid;
    state.playerSeen = Date.now();
    return done(pub());
  }
  if (['progress', 'next', 'prev'].includes(p) && state.playerId && b.pid !== state.playerId) {
    return json({ error: '다른 곳에서 플레이어가 켜져 있어요', taken: true }, 409);
  }

  // 플레이어가 지금 재생 위치를 알림 (곡 id, 현재 초, 전체 초, 재생 중인지)
  if (p === 'progress') {
    const t = Number(b.t), d = Number(b.d);
    if (!/^[\w-]{11}$/.test(b.id || '') || !(t >= 0) || !(d >= 0)) return json({ error: 'bad progress' }, 400);
    await saveProgress({ id: b.id, t, d, playing: !!b.playing, at: Date.now() });
    return json({ ok: true });
  }

  if (p === 'queue') {
    const by = String(b.by || '').trim().slice(0, 20);
    if (!by) return json({ error: '이름을 입력해주세요' }, 400);
    // 안내 문구를 그대로 따라 친 경우 ("이름(필수)" 등)
    if (['이름', '이름필수', '필수', '익명', 'name'].includes(by.replace(/[\s()]/g, '').toLowerCase())) return json({ error: '본인 이름을 입력해주세요' }, 400);
    const id = videoId(b.url);
    if (!id) return json({ error: '유튜브 링크를 확인해주세요' }, 400);
    const v = await lookup(id).catch(() => null);
    if (!v) return json({ error: '영상을 찾을 수 없어요 (비공개/삭제됨?)' }, 400);
    if (state.queue.some(q => q.id === id && !q.played)) return json({ error: '이미 예약된 곡이에요' }, 400);
    state.queue.push({ ...v, by });
    return done(pub());
  }
  // ponytail: 플레이어 페이지용이라 비밀번호 없음. 장난치는 사람 생기면 플레이어 전용 토큰 추가
  if (p === 'next' || p === 'prev') {
    state.playerSeen = Date.now();
    const now = (p === 'next' ? next : prev)(state);
    return done({ now });
  }

  // 이하 관리자 전용
  if (b.password !== ADMIN_PASSWORD) return json({ error: '비밀번호가 틀렸어요' }, 403);

  if (p === 'admin/check') return json({ ok: true });
  // 원격 조작: 플레이어가 3초마다 cmd.seq·volume 변화를 보고 실행
  if (p === 'admin/cmd' && ['prev', 'toggle', 'next', 'seek'].includes(b.type)) {
    const t = Number(b.t);
    if (b.type === 'seek' && !(t >= 0)) return json({ error: '이동할 시간이 잘못됐어요' }, 400);
    state.cmd = { seq: state.cmd.seq + 1, type: b.type, ...(b.type === 'seek' && { t }) };
    return done(pub());
  }
  if (p === 'admin/volume') {
    const v = Math.round(Number(b.volume));
    if (!(v >= 0 && v <= 100)) return json({ error: '음량은 0~100' }, 400);
    state.volume = v;
    return done(pub());
  }
  if (p === 'admin/remove') { state.queue = state.queue.filter(q => q.id !== b.id); return done(pub()); }
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
