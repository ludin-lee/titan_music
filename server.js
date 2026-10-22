// 사무실 노래 예약 서버. 의존성 없음: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DATA = path.join(__dirname, 'data.json');

// ponytail: 단일 프로세스 메모리 + JSON 파일 저장. 사무실 규모엔 충분
// queue: 신청곡은 재생 후에도 played 표시로 남김. history: 이전곡용
let state = { now: null, queue: [], history: [], fallback: [], fallbackPos: 0, cmd: { seq: 0 } };
try { state = { ...state, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
const save = () => fs.writeFile(DATA, JSON.stringify(state, null, 2), () => {});

function videoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// oEmbed로 제목 조회 + 존재 확인
async function lookup(id) {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
  if (!r.ok) return null;
  return { id, title: (await r.json()).title };
}

// ponytail: API 키 없이 유튜브 검색결과 페이지의 ytInitialData를 파싱. 유튜브가 구조를 바꾸면 깨짐 → 그때 YouTube Data API(키 필요)로 교체
async function search(q) {
  const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
    headers: { 'Accept-Language': 'ko' },
  }).then(r => r.text());
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length >= 10) return;
    const v = o.videoRenderer;
    if (v) {
      // 1시간 이상(h:mm:ss) 모음집은 독점 방지로 제외
      if (v.lengthText && v.lengthText.simpleText.split(':').length < 3) out.push({ id: v.videoId, title: v.title?.runs?.[0]?.text, channel: v.ownerText?.runs?.[0]?.text, length: v.lengthText.simpleText });
      return; // lengthText 없으면 라이브 → 제외
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

function next() {
  if (state.now) state.history = [...state.history, state.now].slice(-50);
  const r = state.queue.find(q => !q.played);
  if (r) { r.played = true; state.now = { ...r }; }
  else if (state.fallback.length) {
    // 관리자 목록을 순서대로, 끝까지 다 틀면 처음부터 다시
    state.now = { ...state.fallback[state.fallbackPos % state.fallback.length], by: null };
    state.fallbackPos = (state.fallbackPos + 1) % state.fallback.length;
  } else state.now = null;
  save();
  return state.now;
}

// 지금 곡을 원래 자리(신청곡 맨 앞 / 기본 리스트 다음 차례)로 돌려놓고 직전 곡을 다시 튼다. 기록 없으면 지금 곡 처음부터
function prev() {
  const cur = state.now;
  if (!state.history.length) return cur;
  if (cur?.by) { const q = state.queue.findLast(q => q.played && q.id === cur.id); if (q) q.played = false; }
  else if (cur && state.fallback.length) state.fallbackPos = (state.fallbackPos - 1 + state.fallback.length) % state.fallback.length;
  state.now = state.history.pop();
  save();
  return state.now;
}

function body(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const publicState = () => ({ now: state.now, queue: state.queue, fallback: state.fallback, fallbackPos: state.fallbackPos, cmd: state.cmd });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'], '/player': ['player.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'], '/common.js': ['common.js', 'text/javascript; charset=utf-8'],
    '/logo.png': ['logo.png', 'image/png'],
  };
  if (req.method === 'GET' && files[p]) {
    res.writeHead(200, { 'Content-Type': files[p][1] });
    return fs.createReadStream(path.join(__dirname, files[p][0])).pipe(res);
  }
  if (req.method === 'GET' && p === '/api/state') return send(res, 200, publicState());
  if (req.method === 'GET' && p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (!q) return send(res, 200, []);
    return send(res, 200, await search(q).catch(() => []));
  }

  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  const b = await body(req);

  if (p === '/api/queue') {
    const id = videoId(b.url);
    if (!id) return send(res, 400, { error: '유튜브 링크를 확인해주세요' });
    const v = await lookup(id).catch(() => null);
    if (!v) return send(res, 400, { error: '영상을 찾을 수 없어요 (비공개/삭제됨?)' });
    if (state.queue.some(q => q.id === id && !q.played)) return send(res, 400, { error: '이미 예약된 곡이에요' });
    state.queue.push({ ...v, by: String(b.by || '익명').slice(0, 20) });
    save();
    return send(res, 200, publicState());
  }
  // ponytail: 플레이어 페이지용이라 비밀번호 없음. 장난치는 사람 생기면 플레이어 전용 토큰 추가
  if (p === '/api/next') return send(res, 200, { now: next() });
  if (p === '/api/prev') return send(res, 200, { now: prev() });

  // 이하 관리자 전용
  if (b.password !== ADMIN_PASSWORD) return send(res, 403, { error: '비밀번호가 틀렸어요' });

  if (p === '/api/admin/check') return send(res, 200, { fallback: state.fallback });
  // 원격 조작: 플레이어가 3초마다 cmd.seq 변화를 보고 실행
  if (p === '/api/admin/cmd' && ['prev', 'toggle', 'next'].includes(b.type)) {
    state.cmd = { seq: state.cmd.seq + 1, type: b.type }; save(); return send(res, 200, publicState());
  }
  if (p === '/api/admin/remove') { state.queue = state.queue.filter(q => q.id !== b.id); save(); return send(res, 200, publicState()); }
  if (p === '/api/admin/fallback') {
    const ids = [...new Set(String(b.urls || '').split('\n').map(videoId).filter(Boolean))];
    const found = (await Promise.all(ids.map(id => lookup(id).catch(() => null)))).filter(Boolean);
    state.fallback = found;
    state.fallbackPos = 0;
    save();
    return send(res, 200, { fallback: found, skipped: ids.length - found.length });
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`예약: http://localhost:${PORT}  /  플레이어: http://localhost:${PORT}/player`));
