// 예약 페이지·플레이어가 같이 쓰는 조각
'use client';
import { useEffect } from 'react';

export const thumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

async function call(url, init) {
  const r = await fetch(url, { cache: 'no-store', ...init });
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
  if (!now) return <div className="now empty">재생 중인 곡이 없어요. 노래를 신청하거나 관리자가 기본 리스트를 등록해주세요.</div>;
  return (
    <div className="now">
      <img src={thumb(now.id)} alt="" />
      <div>
        <div className="k">{paused ? '⏸ 일시정지' : <><b>●</b> 지금 재생 중</>}</div>
        <div className="v">{now.title}</div>
        <div className="s">{now.by ? `${now.by} 님 신청` : '기본 리스트'}</div>
      </div>
    </div>
  );
}

// 받은 신청곡 전체: 접수 순서대로, 재생 중 / 재생됨 / 대기
export function RequestList({ s, extra }) {
  const q = s?.queue || [];
  const playingIdx = s?.now?.by ? q.findLastIndex(x => x.played && x.id === s.now.id) : -1;
  return (
    <>
      <h2>받은 신청곡 <small>총 {q.length}곡 · 대기 {q.filter(x => !x.played).length}곡</small></h2>
      <ul className="list">
        {q.length ? q.map((x, i) => (
          <Row key={`${x.id}-${i}`} v={x} sub={`${x.by} 님`}
            chip={i === playingIdx ? '재생 중' : x.played ? '재생됨' : '대기'} red={i === playingIdx}
            cls={i === playingIdx ? 'playing' : x.played ? 'done' : ''}>
            {extra?.(x)}
          </Row>
        )) : <li className="empty-msg">아직 신청곡이 없어요<br />신청하면 다음 곡으로 나와요</li>}
      </ul>
    </>
  );
}

export function BaseList({ s }) {
  const list = s?.fallback || [];
  return (
    <ul className="list">
      {list.length ? list.map((v, i) => {
        const playing = !s.now?.by && s.now?.id === v.id;
        return <Row key={`${v.id}-${i}`} v={v} chip={playing ? '재생 중' : i === s.fallbackPos ? '다음' : ''} red={playing} cls={playing ? 'playing' : ''} />;
      }) : <li className="empty-msg">비어 있어요</li>}
    </ul>
  );
}
