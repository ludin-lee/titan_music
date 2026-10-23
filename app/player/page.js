'use client';
import { useEffect, useRef, useState } from 'react';
import { NowCard, RequestList, Topbar, getState, post } from '../ui';

export default function Player() {
  const [s, setS] = useState(null);
  const [current, setCurrent] = useState(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [kicked, setKicked] = useState(false); // 다른 곳에서 플레이어를 켜서 밀려남
  const host = useRef(null);
  const yt = useRef(null);
  const cur = useRef(null);
  const cmdSeq = useRef(null);
  const vol = useRef(100);
  const pid = useRef(null); // 이 플레이어의 id (시작할 때마다 새로)
  const kickedRef = useRef(false);

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
        onStateChange: e => { // 0 = 끝남, 1 = 재생, 2 = 일시정지
          if (e.data === 0) go('next');
          if (e.data === 1 || e.data === 2) report();
          setPaused(e.data === 2);
        },
        onError: () => setTimeout(() => go('next'), 1000), // 임베드 금지/삭제된 영상은 건너뜀
      },
    });
  }

  // 다른 곳에서 플레이어가 켜지면 여기는 멈춘다
  function kick() {
    kickedRef.current = true;
    setKicked(true);
    yt.current?.pauseVideo?.();
  }

  async function go(dir) {
    if (kickedRef.current) return;
    try {
      const { now } = await post(`/api/${dir}`, { pid: pid.current });
      setCur(now);
      if (now) play(now.id);
    } catch (err) { if (/다른 곳/.test(err.message)) kick(); }
  }

  // 관리자 화면 진행률용: 지금 재생 위치를 서버에 알림
  function report() {
    const p = yt.current;
    if (!p?.getCurrentTime || !cur.current) return;
    if (kickedRef.current) return;
    post('/api/progress', { pid: pid.current, id: cur.current.id, t: p.getCurrentTime(), d: p.getDuration(), playing: p.getPlayerState() === 1 }).catch(() => {});
  }
  const seek = t => { yt.current?.seekTo?.(t, true); setTimeout(report, 800); };

  const toggle = () => { const p = yt.current; if (p) p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(); };

  // 브라우저 자동재생 정책 때문에 한 번은 클릭 필요. "여기서 다시 틀기"도 이걸 다시 부른다
  async function start() {
    pid.current = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36); // http(IP 접속)에선 randomUUID 없음
    const x = await post('/api/claim', { pid: pid.current }); // 이제 여기가 플레이어
    kickedRef.current = false;
    setKicked(false);
    setStarted(true);
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
      if (kickedRef.current) return;
      if (x.playerId && x.playerId !== pid.current) return kick();
      if ((x.volume ?? 100) !== vol.current) { vol.current = x.volume ?? 100; yt.current?.setVolume?.(vol.current); } // 관리자 음량
      if (x.cmd.seq !== cmdSeq.current) { // 관리자 원격 조작
        cmdSeq.current = x.cmd.seq;
        ({ prev: () => go('prev'), next: () => go('next'), toggle, seek: () => seek(x.cmd.t) })[x.cmd.type]?.();
      } else if (!cur.current && x.queue.length) go('next'); // 멈춰 있다가 곡이 생김
    }, 3000);
    // ponytail: 위치는 15초마다만 보내고 그 사이는 관리자 화면이 시간을 이어 계산 (Redis 사용량 절약)
    const r = setInterval(report, 15000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = s && { ...s, now: current };
  return (
    <>
      <Topbar title="사무실 플레이어" sub="신청곡을 순서대로, 새 신청곡이 없으면 처음부터 다시 재생해요">
        {started && !kicked && (
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
          {kicked && (
            <div className="note err kicked">
              다른 곳에서 플레이어가 켜져서 여기는 멈췄어요. 플레이어는 한 곳에서만 틀 수 있어요.
              <button className="btn red sm" onClick={start}>여기서 다시 틀기</button>
            </div>
          )}
          <NowCard now={current} paused={paused} />
        </main>
        <aside className="card"><RequestList s={view} /></aside>
      </div>
    </>
  );
}
