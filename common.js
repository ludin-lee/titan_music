// 예약 페이지·플레이어가 같이 쓰는 렌더링
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const thumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const row = (v, sub, chip, cls = '', extra = '') => `<li class="row ${cls}">
  <img src="${thumb(v.id)}" alt="" loading="lazy">
  <div class="t"><b>${esc(v.title)}</b>${sub ? `<small>${sub}</small>` : ''}</div>
  ${chip}${extra}</li>`;

function nowHtml(now, paused) {
  if (!now) return '<div class="now empty">재생 중인 곡이 없어요. 노래를 신청하거나 관리자가 기본 리스트를 등록해주세요.</div>';
  return `<div class="now"><img src="${thumb(now.id)}" alt="">
    <div><div class="k">${paused ? '⏸ 일시정지' : '<b>●</b> 지금 재생 중'}</div>
    <div class="v">${esc(now.title)}</div>
    <div class="s">${now.by ? `${esc(now.by)} 님 신청` : '기본 리스트'}</div></div></div>`;
}

// 받은 신청곡 전체: 접수 순서대로, 재생 중 / 재생됨 / 대기
function requestList(s, extra = () => '') {
  const q = s.queue || [];
  const playingIdx = s.now?.by ? q.findLastIndex(x => x.played && x.id === s.now.id) : -1;
  return q.map((x, i) => i === playingIdx ? row(x, `${esc(x.by)} 님`, '<span class="chip red">재생 중</span>', 'playing', extra(x))
    : row(x, `${esc(x.by)} 님`, x.played ? '<span class="chip">재생됨</span>' : '<span class="chip">대기</span>', x.played ? 'done' : '', extra(x))
  ).join('') || '<li class="empty-msg">아직 신청곡이 없어요<br>신청하면 다음 곡으로 나와요</li>';
}
const requestCount = s => `총 ${(s.queue || []).length}곡 · 대기 ${(s.queue || []).filter(x => !x.played).length}곡`;

function baseList(s) {
  return (s.fallback || []).map((v, i) => {
    const playing = !s.now?.by && s.now?.id === v.id;
    return row(v, '', playing ? '<span class="chip red">재생 중</span>' : i === s.fallbackPos ? '<span class="chip">다음</span>' : '', playing ? 'playing' : '');
  }).join('') || '<li class="empty-msg">비어 있어요</li>';
}
