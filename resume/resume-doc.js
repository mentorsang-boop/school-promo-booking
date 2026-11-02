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
const period = (p) => esc(tidy(p).replace('~', ' ~ '));
const range = (r) => esc(tidy(r.from)) + (r.to && r.to !== r.from ? ` ~ ${esc(tidy(r.to))}` : '');
const item = (when, main, sub) => `<div class="item"><div class="when">${when}</div><div><b>${esc(main)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div></div>`;
const sec = (title, rows) => (rows.length ? `<section class="sec"><h2>${title}</h2><div>${rows.join('')}</div></section>` : '');

window.resumeDocHTML = (d, photoUrl) => {
  const [y, m, day] = (d.writeDate || '').split('-');
  const contact = [['생년월일', d.birth], ['휴대번호', d.mobile], ['집 번호', d.homePhone], ['E-mail', d.email], ['주소', d.address]].filter((x) => String(x[1] || '').trim());
  const edu = [];
  if (d.eduSchool || d.eduPeriod) edu.push(item(period(d.eduPeriod), d.eduSchool, [d.major, d.gradStatus].filter(Boolean).join(' · ')));
  if (d.edu2School || d.edu2Period) edu.push(item(period(d.edu2Period), d.edu2School, '원적교'));
  const intro = [['성장 과정', d.intro.growth], ['성격의 장·단점', d.intro.personality], ['학창시절 및 사회경험', d.intro.school], ['지원동기 및 입사 후 포부', d.intro.motivation]];
  return `<section class="a4"><header class="hd"><div class="id"><div><div class="name">${esc(d.name)}</div>${d.applyField ? `<div class="field-to">지원분야 · ${esc(d.applyField)}</div>` : ''}</div>
    <ul class="contact">${contact.map((x) => `<li><b>${x[0]}</b><i>${esc(x[1])}</i></li>`).join('')}</ul></div>
    <div class="ph" style="${photoUrl ? `background-image:url('${photoUrl}')` : ''}"></div></header>
  <div class="body">${sec('학력', edu)}
    ${sec('자격 및 면허', d.licenses.filter((r) => r.date || r.name || r.org).map((r) => item(esc(tidy(r.date)), r.name, r.org)))}
    ${sec('수상 및 활동 경력', d.awards.filter((r) => r.from || r.to || r.text || r.org).map((r) => item(range(r), r.text, r.org)))}
    ${sec('경력 사항', d.careers.filter((r) => r.from || r.to || r.place || r.rank || r.desc).map((r) => item(range(r), r.place, [r.rank, r.desc].filter(Boolean).join(' · '))))}
    ${sec('동아리 및 봉사 활동', d.clubs.filter((r) => r.from || r.to || r.name || r.desc).map((r) => item(range(r), r.name, r.desc)))}</div>
  <footer class="foot"><p>위 사항은 사실과 틀림없음을 증명합니다.</p><p>${esc(y || '')}년 ${m ? +m : ''}월 ${day ? +day : ''}일 &nbsp; 작성자 ${esc(d.name)} (서명)</p><p class="to">${esc(d.company)} 귀하</p></footer></section>
<section class="a4 p2"><header class="hd"><div class="doc-title">자기소개서</div><div class="doc-sub">${esc(d.name)}${d.applyField ? ` · 지원분야 ${esc(d.applyField)}` : ''}</div></header>
  <div class="body">${intro.filter((x) => String(x[1] || '').trim()).map((x) => `<section class="sec"><h2>${x[0]}</h2><p>${esc(x[1])}</p></section>`).join('')}</div></section>`;
};

// 내용이 많아 A4를 넘치면 글자 크기를 줄여 한 쪽 안에 맞춘다
window.fitPages = (root) => {
  root.querySelectorAll('.a4').forEach((page) => {
    const body = page.querySelector('.body');
    for (let size = 14.5; size >= 8.5; size -= 0.5) {
      page.style.fontSize = size + 'px';
      if (body.scrollHeight <= body.clientHeight && page.scrollHeight <= page.clientHeight) break;
    }
  });
};
