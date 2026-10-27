// 예약 페이지·플레이어가 같이 쓰는 조각
'use client';
import { useEffect, useState } from 'react';

export const thumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// 층마다 따로: 신청곡·플레이어가 층별로 돈다. 주소 ?room=3 > 마지막으로 고른 층 > 첫 층
export const FLOORS = ['3', '4'];
const saved = () => { try { return localStorage.getItem('room'); } catch { return null; } };
export const room = () => [new URLSearchParams(location.search).get('room'), saved()].find(f => FLOORS.includes(f)) || FLOORS[0];

// 층을 바꾸면 그 층 주소로 새로 연다 (플레이어는 지금 틀던 곡이 멈추므로 확인)
function FloorPick() {
  const [cur, setCur] = useState(null);
  useEffect(() => setCur(room()), []);
  const pick = f => {
    if (f === cur || (location.pathname.startsWith('/player') && !confirm(`${f}층 플레이어로 바꿀까요? 지금 틀던 곡은 멈추고, ${f}층 비밀번호를 입력해야 시작돼요`))) return;
    try { localStorage.setItem('room', f); } catch {}
    location.search = '?room=' + f;
  };
  return (
    <div className="floor">
      {FLOORS.map(f => <button key={f} className={`btn sm ${f === cur ? 'red' : 'line'}`} onClick={() => pick(f)}>{f}층</button>)}
    </div>
  );
}
async function call(url, init) {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'x-room': room() } });
  const j = await r.json().catch(() => ({ error: `서버 응답 오류 (${r.status})` }));
  if (!r.ok) throw new Error(j.error);
  return j;
}
export const getState = () => call('/api/state');
export const post = (url, data = {}) => call(url, { method: 'POST', body: JSON.stringify(data) });
export const searchYT = q => call('/api/search?q=' + encodeURIComponent(q));

// 탭이 보일 때만 주기적으로 실행
export function usePoll(fn, ms) {
  useEffect(() => {
    fn();
    const t = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Topbar({ title, sub, children }) {
  return (
    <div className="topbar"><div className="in">
      <img className="logo" src="/logo.png" alt="타이탄" />
      <div><h1>{title}</h1><div className="sub">{sub}</div></div>
      {children}
      <FloorPick />
    </div></div>
  );
}

export function Row({ v, sub, chip, red, cls = '', children }) {
  return (
    <li className={`row ${cls}`}>
      <img src={thumb(v.id)} alt="" loading="lazy" />
      <div className="t"><b>{v.title}</b>{sub && <small>{sub}</small>}</div>
      {chip && <span className={`chip ${red ? 'red' : ''}`}>{chip}</span>}
      {children}
    </li>
  );
}

export function NowCard({ now, paused }) {
  if (!now) return <div className="now empty">재생 중인 곡이 없어요. 듣고 싶은 노래를 신청해주세요.</div>;
  return (
    <div className="now">
      <img src={thumb(now.id)} alt="" />
      <div>
        <div className="k">{paused ? '⏸ 일시정지' : <><b>●</b> 지금 재생 중</>}</div>
        <div className="v">{now.title}</div>
        <div className="s">{now.by && `${now.by} 님 신청`}{now.replay && ' · 다시 듣기'}</div>
      </div>
    </div>
  );
}

// 받은 신청곡 전체: 접수 순서대로, 재생 중 / 대기 / 재생됨. 새 신청곡이 없으면 처음부터 다시 재생하므로 그 차례를 '다음'으로
export function RequestList({ s, extra }) {
  const q = s?.queue || [];
  const playingIdx = s?.now ? (s.now.replay
    ? (s.replayPos - 1 + q.length) % (q.length || 1)
    : q.findLastIndex(x => x.played && x.id === s.now.id)) : -1;
  const waiting = q.filter(x => !x.played).length;
  const nextIdx = waiting || !q.length ? -1 : s.replayPos % q.length;
  return (
    <>
      <h2>받은 신청곡 <small>총 {q.length}곡 · 대기 {waiting}곡</small></h2>
      {!waiting && q.length > 0 && <p className="hint">새 신청곡이 없으면 처음부터 다시 재생해요</p>}
      <ul className="list">
        {q.length ? q.map((x, i) => (
          <Row key={`${x.id}-${i}`} v={x} sub={`${x.by} 님`}
            chip={i === playingIdx ? '재생 중' : i === nextIdx ? '다음' : x.played ? '재생됨' : '대기'} red={i === playingIdx}
            cls={i === playingIdx ? 'playing' : x.played ? 'done' : ''}>
            {extra?.(x, i)}
          </Row>
        )) : <li className="empty-msg">아직 신청곡이 없어요<br />신청하면 다음 곡으로 나와요</li>}
      </ul>
    </>
  );
}
