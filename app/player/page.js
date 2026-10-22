'use client';
import { useEffect, useRef, useState } from 'react';
import { BaseList, NowCard, RequestList, Topbar, getState, post } from '../ui';

export default function Player() {
  const [s, setS] = useState(null);
  const [current, setCurrent] = useState(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const host = useRef(null);
  const yt = useRef(null);
  const cur = useRef(null);
  const cmdSeq = useRef(null);
  const vol = useRef(100);

  const setCur = v => { cur.current = v; setCurrent(v); };

  // 유튜브 플레이어 API 불러오기
  useEffect(() => {
    if (window.YT?.Player) return setReady(true);
    window.onYouTubeIframeAPIReady = () => setReady(true);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
  }, []);

  // 시작 전에도 목록은 보이게
  useEffect(() => { getState().then(x => { setS(x); setCur(x.now); }).catch(() => {}); }, []);

  useEffect(() => { document.title = current ? `🎵 ${current.title}` : '사무실 플레이어'; }, [current]);

  // 영상 없이 플레이어를 만들면 유튜브가 "오류가 발생했습니다" 화면을 띄우므로 첫 곡이 생길 때 만든다
  function play(id) {
    if (yt.current) return yt.current.loadVideoById(id);
    const el = document.createElement('div');
    host.current.appendChild(el);
    yt.current = new window.YT.Player(el, {
      width: '100%', height: '100%', videoId: id,
      playerVars: { autoplay: 1 },
      events: {
        onReady: e => e.target.setVolume(vol.current),
        onStateChange: e => { if (e.data === 0) go('next'); setPaused(e.data === 2); }, // 0 = 끝남, 2 = 일시정지
        onError: () => setTimeout(() => go('next'), 1000), // 임베드 금지/삭제된 영상은 건너뜀
      },
    });
  }

  async function go(dir) {
    const { now } = await post(`/api/${dir}`);
    setCur(now);
    if (now) play(now.id);
  }

  const toggle = () => { const p = yt.current; if (p) p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(); };

  // 브라우저 자동재생 정책 때문에 한 번은 클릭 필요
  async function start() {
    setStarted(true);
    const x = await getState();
    setS(x);
    cmdSeq.current = x.cmd.seq;
    vol.current = x.volume ?? 100;
    if (x.now) { setCur(x.now); play(x.now.id); } else await go('next');
  }

  useEffect(() => {
    if (!started) return;
    const t = setInterval(async () => {
      const x = await getState().catch(() => null);
      if (!x) return;
      setS(x);
      if ((x.volume ?? 100) !== vol.current) { vol.current = x.volume ?? 100; yt.current?.setVolume?.(vol.current); } // 관리자 음량
      if (x.cmd.seq !== cmdSeq.current) { // 관리자 원격 조작
        cmdSeq.current = x.cmd.seq;
        ({ prev: () => go('prev'), next: () => go('next'), toggle })[x.cmd.type]?.();
      } else if (!cur.current && (x.queue.some(q => !q.played) || x.fallback.length)) go('next'); // 멈춰 있다가 곡이 생김
    }, 3000);
    return () => clearInterval(t);
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = s && { ...s, now: current };
  return (
    <>
      <Topbar title="사무실 플레이어" sub="신청곡 먼저, 없으면 기본 리스트를 순서대로 반복해요">
        {started && (
          <div className="right ctrl">
            <span className="chip">🔊 {s?.volume ?? 100}</span>
            <button className="btn line" onClick={() => go('prev')}>⏮ 이전곡</button>
            <button className="btn red" onClick={toggle}>⏯ 재생/일시정지</button>
            <button className="btn line" onClick={() => go('next')}>⏭ 다음곡</button>
          </div>
        )}
      </Topbar>
      <div className="wrap">
        <main>
          <div className="stage">
            <div ref={host} className="host" />
            {!started && <button className="btn red start" disabled={!ready} onClick={start}>▶ 플레이어 시작</button>}
          </div>
          <NowCard now={current} paused={paused} />
          <section className="card">
            <h2>기본 리스트 <small>신청곡이 없을 때 순서대로 반복</small></h2>
            <BaseList s={view} />
          </section>
        </main>
        <aside className="card"><RequestList s={view} /></aside>
      </div>
    </>
  );
}
