'use client';
import { useEffect, useRef, useState } from 'react';
import { BaseList, NowCard, RequestList, Row, Topbar, getState, post, searchYT, usePoll } from './ui';

const fbText = list => list.map(v => `https://youtu.be/${v.id}  ${v.title}`).join('\n');

export default function Home() {
  const [s, setS] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [by, setBy] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState({ text: '', err: false });
  const [results, setResults] = useState([]);

  const [pw, setPw] = useState('');
  const [admin, setAdmin] = useState(false);
  const [fb, setFb] = useState('');
  const [fbMsg, setFbMsg] = useState('');
  const [aq, setAq] = useState('');
  const [aResults, setAResults] = useState([]);
  const [aMsg, setAMsg] = useState({ text: '' });
  const [vol, setVol] = useState(100);
  const volTimer = useRef();

  const refresh = () => getState().then(x => { setS(x); setLoadErr(''); }).catch(e => setLoadErr(e.message));
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
    if (!by.trim()) return setMsg({ text: '이름을 먼저 입력해주세요', err: true });
    localStorage.setItem('by', by);
    try {
      setS(await post('/api/queue', { url, by }));
      setQ(''); setResults([]); setMsg({ text: '✅ 신청됐어요' });
    } catch (err) { setMsg({ text: err.message, err: true }); }
  }

  async function login() {
    try {
      const r = await post('/api/admin/check', { password: pw });
      setFb(fbText(r.fallback)); setVol(s?.volume ?? 100); setAdmin(true);
    } catch (err) { alert(err.message); }
  }

  async function saveFb(text = fb) {
    setFbMsg('저장 중…');
    try {
      const r = await post('/api/admin/fallback', { password: pw, urls: text });
      setFb(fbText(r.fallback));
      setFbMsg(`${r.fallback.length}곡 저장` + (r.skipped ? `, ${r.skipped}개는 못 찾음` : ''));
      refresh();
    } catch (err) { setFbMsg(err.message); }
  }

  // 관리자: 검색해서 기본 리스트 맨 뒤에 추가
  async function onAdminSearch(e) {
    e.preventDefault();
    const v = aq.trim();
    if (/youtu\.?be|^[\w-]{11}$/.test(v)) { addToList(v); setAq(''); return; }
    setAMsg({ text: '검색 중…' });
    try {
      const list = await searchYT(v);
      setAResults(list);
      setAMsg(list.length ? { text: '' } : { text: '검색 결과가 없어요', err: true });
    } catch (err) { setAResults([]); setAMsg({ text: err.message, err: true }); }
  }

  function addToList(urlOrId) {
    const text = `${fb.trim()}\n${urlOrId.includes('/') ? urlOrId : `https://youtu.be/${urlOrId}`}`.trim();
    setFb(text); saveFb(text);
  }
  const inList = id => (s?.fallback || []).some(v => v.id === id);

  const cmd = type => post('/api/admin/cmd', { password: pw, type }).then(() => setTimeout(refresh, 3500));

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

          <section className="card">
            <h2>신청하기 <small>노래 제목으로 검색하거나 유튜브 링크를 붙여넣으세요</small></h2>
            <form onSubmit={onSearch}>
              <input value={by} onChange={e => setBy(e.target.value)} placeholder="이름 (필수)" maxLength={20} required aria-label="이름" style={{ marginBottom: 8 }} />
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

          <section className="card">
            <h2>기본 리스트 <small>신청곡이 없을 때 순서대로 반복</small></h2>
            <BaseList s={s} />
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
                <div className="note">버튼과 음량은 사무실 플레이어에 3초 안에 반영돼요.</div>

                <h3 className="sub-h">기본 리스트에 곡 추가</h3>
                <form className="search" onSubmit={onAdminSearch}>
                  <input type="search" value={aq} onChange={e => setAq(e.target.value)} placeholder="노래 제목 검색 또는 유튜브 링크" required />
                  <button className="btn red">검색</button>
                </form>
                <div className={`msg ${aMsg.err ? 'err' : ''}`} role="status">{aMsg.text}</div>
                <ul className="list">
                  {aResults.map(r => (
                    <Row key={r.id} v={r} sub={`${r.channel} · ${r.length}`}>
                      {inList(r.id)
                        ? <span className="chip">추가됨</span>
                        : <button className="btn sm red" onClick={() => addToList(r.id)}>추가</button>}
                    </Row>
                  ))}
                </ul>

                <h3 className="sub-h">기본 리스트 편집</h3>
                <div className="note">한 줄에 곡 하나, 위에서부터 순서대로 재생돼요. 줄을 지우거나 옮긴 뒤 저장하세요.</div>
                <textarea rows={10} value={fb} onChange={e => setFb(e.target.value)} />
                <div className="ctrl" style={{ marginTop: 8, alignItems: 'center' }}>
                  <button className="btn red" type="button" onClick={() => saveFb()}>저장</button>
                  <span className="msg" style={{ margin: 0 }}>{fbMsg}</span>
                </div>
              </>
            )}
          </details>
        </main>

        <aside className="card">
          <RequestList s={s} extra={admin ? x => (
            <button className="btn sm line" onClick={() => post('/api/admin/remove', { password: pw, id: x.id }).then(setS)}>삭제</button>
          ) : undefined} />
        </aside>
      </div>
    </>
  );
}
