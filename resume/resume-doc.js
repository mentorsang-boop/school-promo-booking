// 화면·인쇄·PDF에 함께 쓰는 이력서 A4 문서 (스탠다드 디자인). 입력한 줄과 항목만 출력한다.
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.newResume = (profile) => ({
  applyField: '', name: profile?.name || '', birth: '', mobile: '', address: '', addressBase: '', addressDetail: '', homePhone: '', email: '',
  eduPeriod: '2026.03.06~2026.12.30', eduSchool: '인천산업정보학교', major: profile?.dept || '', gradStatus: '수료예정', edu2Period: '', edu2School: '',
  licenses: Array.from({ length: 4 }, () => ({ date: '', name: '', org: '' })),
  awards: Array.from({ length: 5 }, () => ({ from: '', to: '', text: '', org: '' })),
  careers: Array.from({ length: 4 }, () => ({ from: '', to: '', place: '', rank: '', desc: '' })),
  clubs: Array.from({ length: 4 }, () => ({ from: '', to: '', name: '', desc: '' })),
  writeDate: '', company: '',
  intro: { growth: '', personality: '', school: '', motivation: '' },
});

const tidy = (s) => String(s || '').replace(/\.(?=~|$)/g, '');
const item = (when, main, sub) => `<div class="item"><div class="when">${when}</div><div><b>${main}</b>${sub ? `<span>${sub}</span>` : ''}</div></div>`;
const sec = (title, rows) => (rows.length ? `<section class="sec"><h2>${title}</h2><div>${rows.join('')}</div></section>` : '');

// 단어 단위로 비교해 기준본에 없던 부분만 표시한다
function markChanges(before, after) {
  const a = String(before || '').split(/(\s+)/);
  const b = String(after || '').split(/(\s+)/);
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let k = b.length - 1; k >= 0; k--) t[i][k] = a[i] === b[k] ? t[i + 1][k + 1] + 1 : Math.max(t[i + 1][k], t[i][k + 1]);
  let i = 0; let out = '';
  for (let k = 0; k < b.length; k++) {
    while (i < a.length && a[i] !== b[k] && t[i + 1][k] >= t[i][k + 1]) i++;
    if (i < a.length && a[i] === b[k]) { out += esc(b[k]); i++; } else out += /^\s+$/.test(b[k]) ? b[k] : `<mark class="chg">${esc(b[k])}</mark>`;
  }
  return out;
}

// base를 주면 미리보기용으로 달라진 곳을 표시하고, 없으면 깨끗한 출력본을 만든다
window.resumeDocHTML = (d, photoUrl, base) => {
  const t = (cur, old) => (base ? markChanges(old, cur) : esc(cur));
  const oldRow = (key, i) => base?.[key]?.[i] || {};
  const [y, m, day] = (d.writeDate || '').split('-');
  const contact = [['생년월일', 'birth'], ['휴대번호', 'mobile'], ['집 번호', 'homePhone'], ['E-mail', 'email'], ['주소', 'address']].filter((x) => String(d[x[1]] || '').trim());
  const rangeOf = (r) => tidy(r.from) + (r.to && r.to !== r.from ? ` ~ ${tidy(r.to)}` : '');
  const rows = (key, has, make) => d[key].map((r, i) => (has(r) ? make(r, oldRow(key, i)) : '')).filter(Boolean);
  const edu = [];
  const line = (x) => [x.major, x.gradStatus].filter(Boolean).join(' · ');
  if (d.eduSchool || d.eduPeriod) edu.push(item(t(tidy(d.eduPeriod).replace('~', ' ~ '), tidy(base?.eduPeriod).replace('~', ' ~ ')), t(d.eduSchool, base?.eduSchool), t(line(d), base && line(base))));
  if (d.edu2School || d.edu2Period) edu.push(item(t(tidy(d.edu2Period).replace('~', ' ~ '), tidy(base?.edu2Period).replace('~', ' ~ ')), t(d.edu2School, base?.edu2School), '원적교'));
  const intro = [['성장 과정', 'growth'], ['성격의 장·단점', 'personality'], ['학창시절 및 사회경험', 'school'], ['지원동기 및 입사 후 포부', 'motivation']];
  return `<section class="a4"><header class="hd"><div class="id"><div><div class="name">${t(d.name, base?.name)}</div>${d.applyField ? `<div class="field-to">지원분야 · ${t(d.applyField, base?.applyField)}</div>` : ''}</div>
    <ul class="contact">${contact.map((x) => `<li><b>${x[0]}</b><i>${t(d[x[1]], base?.[x[1]])}</i></li>`).join('')}</ul></div>
    <div class="ph" style="${photoUrl ? `background-image:url('${photoUrl}')` : ''}"></div></header>
  <div class="body">${sec('학력', edu)}
    ${sec('자격 및 면허', rows('licenses', (r) => r.date || r.name || r.org, (r, o) => item(t(tidy(r.date), tidy(o.date)), t(r.name, o.name), t(r.org, o.org))))}
    ${sec('수상 및 활동 경력', rows('awards', (r) => r.from || r.to || r.text || r.org, (r, o) => item(t(rangeOf(r), base && rangeOf(o)), t(r.text, o.text), t(r.org, o.org))))}
    ${sec('경력 사항', rows('careers', (r) => r.from || r.to || r.place || r.rank || r.desc, (r, o) => item(t(rangeOf(r), base && rangeOf(o)), t(r.place, o.place), t([r.rank, r.desc].filter(Boolean).join(' · '), [o.rank, o.desc].filter(Boolean).join(' · ')))))}
    ${sec('동아리 및 봉사 활동', rows('clubs', (r) => r.from || r.to || r.name || r.desc, (r, o) => item(t(rangeOf(r), base && rangeOf(o)), t(r.name, o.name), t(r.desc, o.desc))))}</div>
  <footer class="foot"><p>위 사항은 사실과 틀림없음을 증명합니다.</p><p class="date">${esc(y || '')}년 ${m ? +m : ''}월 ${day ? +day : ''}일</p><p class="author">작성자 <b>${esc(d.name)}</b> (서명)</p><p class="to"><b>${t(d.company, base?.company)}</b> 귀하</p></footer></section>
<section class="a4 p2"><header class="hd"><div class="doc-title">자기소개서</div><div class="doc-sub">${esc(d.name)}${d.applyField ? ` · 지원분야 ${esc(d.applyField)}` : ''}</div></header>
  <div class="body">${intro.filter((x) => String(d.intro[x[1]] || '').trim()).map((x) => `<section class="sec"><h2>${x[0]}</h2><p>${t(d.intro[x[1]], base?.intro?.[x[1]])}</p></section>`).join('')}</div></section>`;
};

// 내용 양에 맞춰 글자 크기와 항목 간격을 조절해 한 쪽을 알맞게 채운다
window.fitPages = (root) => {
  root.querySelectorAll('.a4').forEach((page) => {
    const body = page.querySelector('.body');
    let size = 17;
    body.style.gap = '';
    for (; size >= 8.5; size -= 0.5) {
      page.style.fontSize = size + 'px';
      if (body.scrollHeight <= body.clientHeight && page.scrollHeight <= page.clientHeight) break;
    }
    const last = page.lastElementChild.getBoundingClientRect();
    const spare = page.getBoundingClientRect().bottom - 52 - last.bottom;
    const count = body.children.length;
    if (spare > 0 && count) body.style.gap = `calc(1.5em + ${Math.min(spare / count, size * 2.5)}px)`;
  });
};
