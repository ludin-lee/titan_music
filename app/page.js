'use client';
import { useEffect, useRef, useState } from 'react';
import { NowCard, RequestList, Row, Top5, Topbar, getState, post, searchYT, usePoll } from './ui';

const fmt = sec => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

// 관리자: 지금 곡 진행률 + 끌어서 시간 이동.
// 플레이어는 15초마다·재생/일시정지 때만 위치를 보내므로 그 사이 시간은 여기서 이어 계산한다
function Progress({ s, offset, onSeek }) {
  const [, tick] = useState(0);
  const [drag, setDrag] = useState(null);  // 끄는 중인 값
  const [hold, setHold] = useState(null);  // 이동 요청 후 플레이어가 반영할 때까지 보여줄 값 {t, at}
  useEffect(() => { const i = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(i); }, []);

  const p = s?.progress;
  if (!p || p.id !== s.now?.id || !p.d) return <div className="prog wait">재생 위치를 기다리는 중… (최대 15초)</div>;
  const nowMs = Date.now() + offset;
  const since = at => (p.playing ? (nowMs - at) / 1000 : 0);
  const useHold = hold && p.at < hold.at && nowMs - hold.at < 10000;
  const t = Math.min(p.d, useHold ? hold.t + since(hold.at) : p.t + since(p.at));
  const commit = () => {
    if (drag == null) return;
    onSeek(drag); setHold({ t: drag, at: nowMs }); setDrag(null);
  };

  return (
    <div className="prog">
      <span>{fmt(drag ?? t)}</span>
      <input type="range" min="0" max={Math.floor(p.d)} step="1" value={Math.floor(drag ?? t)} aria-label="재생 위치"
        onChange={e => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
      <span>{fmt(p.d)}</span>
    </div>
  );
}

export default function Home() {
  const [s, setS] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [by, setBy] = useState('');
  const byRef = useRef();
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState({ text: '', err: false });
  const [results, setResults] = useState([]);

  const [pw, setPw] = useState('');
  const [admin, setAdmin] = useState(false);
  const [vol, setVol] = useState(100);
  const volTimer = useRef();
  const offset = useRef(0); // 서버 시계 - 내 시계

  const refresh = () => getState().then(x => { setS(x); setLoadErr(''); offset.current = x.serverNow - Date.now(); }).catch(e => setLoadErr(e.message));
  usePoll(refresh, 5000);
  useEffect(() => setBy(localStorage.getItem('by') || ''), []);

  async function onSearch(e) {
    e.preventDefault();
    localStorage.setItem('by', by);
    const v = q.trim();
    if (/youtu\.?be|^[\w-]{11}$/.test(v)) return reserve(v);
    setMsg({ text: '검색 중…' });
    try {
      const list = await searchYT(v);
      setResults(list);
      setMsg(list.length ? { text: '' } : { text: '검색 결과가 없어요', err: true });
    } catch (err) { setResults([]); setMsg({ text: err.message, err: true }); }
  }

  async function reserve(url) {
    if (!by.trim()) { byRef.current?.focus(); return setMsg({ text: '신청자 이름을 먼저 입력해주세요', err: true }); }
    localStorage.setItem('by', by);
    try {
      setS(await post('/api/queue', { url, by }));
      setQ(''); setResults([]); setMsg({ text: '✅ 신청됐어요' });
    } catch (err) { setMsg({ text: err.message, err: true }); }
  }

  async function login() {
    try {
      await post('/api/admin/check', { password: pw });
      setVol(s?.volume ?? 100); setAdmin(true);
    } catch (err) { alert(err.message); }
  }

  const cmd = (type, extra) => post('/api/admin/cmd', { password: pw, type, ...extra }).then(() => setTimeout(refresh, 3500)).catch(e => alert(e.message));

  // 슬라이더를 움직이는 동안은 마지막 값만 0.3초 뒤에 저장
  function changeVol(v) {
    setVol(v);
    clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => post('/api/admin/volume', { password: pw, volume: v }).then(setS).catch(e => alert(e.message)), 300);
  }

  return (
    <>
      <Topbar title="노래 예약" sub="사무실 스피커 · 누구나 듣고 싶은 노래를 신청해요" />
      <div className="wrap">
        <main>
          {loadErr && <div className="note err">⚠️ {loadErr}</div>}
          <NowCard now={s?.now} />
          <Top5 s={s} />

          <section className="card">
            <h2>신청하기 <small>노래 제목으로 검색하거나 유튜브 링크를 붙여넣으세요</small></h2>
            <form onSubmit={onSearch}>
              <label className="field">
                <span>신청자 이름 <em>*</em></span>
                <input ref={byRef} value={by} onChange={e => setBy(e.target.value)} placeholder="예) 홍길동" maxLength={20} required />
              </label>
              <div className="search">
                <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="예) 아이유 밤편지" required />
                <button className="btn red">검색</button>
              </div>
            </form>
            <div className={`msg ${msg.err ? 'err' : ''}`} role="status">{msg.text}</div>
            <ul className="list">
              {results.map(r => (
                <Row key={r.id} v={r} sub={`${r.channel} · ${r.length}`}>
                  <button className="btn sm red" onClick={() => reserve(r.id)}>신청</button>
                </Row>
              ))}
            </ul>
          </section>

          <details className="card">
            <summary>관리자</summary>
            {!admin ? (
              <div className="search" style={{ marginTop: 14 }}>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="관리자 비밀번호" />
                <button className="btn" type="button" onClick={login}>확인</button>
              </div>
            ) : (
              <>
                <Progress s={s} offset={offset.current} onSeek={t => cmd('seek', { t })} />
                <div className="ctrl" style={{ marginTop: 14 }}>
                  <button className="btn line" onClick={() => cmd('prev')}>⏮ 이전곡</button>
                  <button className="btn red" onClick={() => cmd('toggle')}>⏯ 재생/일시정지</button>
                  <button className="btn line" onClick={() => cmd('next')}>⏭ 다음곡</button>
                </div>
                <label className="vol">
                  <span>{vol === 0 ? '🔇' : '🔊'} 음량</span>
                  <input type="range" min="0" max="100" value={vol} onChange={e => changeVol(Number(e.target.value))} />
                  <b>{vol}</b>
                </label>
                <button className="btn sm line" style={{ marginTop: 14 }} onClick={() => confirm('신청곡을 전부 삭제할까요?') && post('/api/admin/clear', { password: pw }).then(setS).catch(e => alert(e.message))}>신청곡 전체삭제</button>
                <div className="note">시간 이동·버튼·음량은 사무실 플레이어에 3초 안에 반영돼요.</div>
              </>
            )}
          </details>
        </main>

        <aside className="card">
          <RequestList s={s} onState={setS} extra={admin ? (x, i) => (<>
            <button className="btn sm line" onClick={() => post('/api/admin/play', { password: pw, id: x.id, index: i }).then(setS).catch(e => alert(e.message))}>▶ 재생</button>
            <button className="btn sm line" onClick={() => post('/api/admin/remove', { password: pw, id: x.id }).then(setS)}>삭제</button>
          </>) : undefined} />
        </aside>
      </div>
    </>
  );
}
