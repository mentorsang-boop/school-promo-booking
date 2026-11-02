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

// 차수를 차례로 비교해 각 단어가 언제 생겼는지 찾아 차수별 색으로 표시한다
function layeredChanges(texts, rounds) {
  let tokens = String(texts[0] || '').split(/(\s+)/).map((word) => ({ word, round: 0 }));
  for (let v = 1; v < texts.length; v++) {
    const b = String(texts[v] || '').split(/(\s+)/);
    const a = tokens;
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let k = b.length - 1; k >= 0; k--) t[i][k] = a[i].word === b[k] ? t[i + 1][k + 1] + 1 : Math.max(t[i + 1][k], t[i][k + 1]);
    let i = 0;
    tokens = b.map((word, k) => {
      while (i < a.length && a[i].word !== word && t[i + 1][k] >= t[i][k + 1]) i++;
      if (i < a.length && a[i].word === word) return { word, round: a[i++].round };
      return { word, round: rounds[v] };
    });
  }
  return tokens.map(({ word, round }) => (round && word.trim() ? `<mark class="chg chg-${round}">${esc(word)}</mark>` : esc(word))).join('');
}

// chain([{ round, doc }, ...])을 주면 미리보기용으로 수정 차수를 색으로 표시하고, 없으면 깨끗한 출력본을 만든다
window.resumeDocHTML = (d, photoUrl, chain) => {
  const t = (pick) => (chain ? layeredChanges(chain.map((c) => String(pick(c.doc) ?? '')), chain.map((c) => c.round)) : esc(pick(d)));
  const [y, m, day] = (d.writeDate || '').split('-');
  const contact = [['생년월일', 'birth'], ['휴대번호', 'mobile'], ['집 번호', 'homePhone'], ['E-mail', 'email'], ['주소', 'address']].filter((x) => String(d[x[1]] || '').trim());
  const rangeOf = (r) => (r ? tidy(r.from) + (r.to && r.to !== r.from ? ` ~ ${tidy(r.to)}` : '') : '');
  const spaced = (p) => tidy(p).replace('~', ' ~ ');
  const rows = (key, has, make) => d[key].map((r, i) => (has(r) ? make((x) => x[key]?.[i] || {}) : '')).filter(Boolean);
  const edu = [];
  if (d.eduSchool || d.eduPeriod) edu.push(item(t((x) => spaced(x.eduPeriod)), t((x) => x.eduSchool), t((x) => [x.major, x.gradStatus].filter(Boolean).join(' · '))));
  if (d.edu2School || d.edu2Period) edu.push(item(t((x) => spaced(x.edu2Period)), t((x) => x.edu2School), '원적교'));
  const intro = [['성장 과정', 'growth'], ['성격의 장·단점', 'personality'], ['학창시절 및 사회경험', 'school'], ['지원동기 및 입사 후 포부', 'motivation']];
  return `<section class="a4"><header class="hd"><div class="id"><div><div class="name">${t((x) => x.name)}</div>${d.applyField ? `<div class="field-to">지원분야 · ${t((x) => x.applyField)}</div>` : ''}</div>
    <ul class="contact">${contact.map((c) => `<li><b>${c[0]}</b><i>${t((x) => x[c[1]])}</i></li>`).join('')}</ul></div>
    <div class="ph" style="${photoUrl ? `background-image:url('${photoUrl}')` : ''}"></div></header>
  <div class="body">${sec('학력', edu)}
    ${sec('자격 및 면허', rows('licenses', (r) => r.date || r.name || r.org, (o) => item(t((x) => tidy(o(x).date)), t((x) => o(x).name), t((x) => o(x).org))))}
    ${sec('수상 및 활동 경력', rows('awards', (r) => r.from || r.to || r.text || r.org, (o) => item(t((x) => rangeOf(o(x))), t((x) => o(x).text), t((x) => o(x).org))))}
    ${sec('경력 사항', rows('careers', (r) => r.from || r.to || r.place || r.rank || r.desc, (o) => item(t((x) => rangeOf(o(x))), t((x) => o(x).place), t((x) => [o(x).rank, o(x).desc].filter(Boolean).join(' · ')))))}
    ${sec('동아리 및 봉사 활동', rows('clubs', (r) => r.from || r.to || r.name || r.desc, (o) => item(t((x) => rangeOf(o(x))), t((x) => o(x).name), t((x) => o(x).desc))))}</div>
  <footer class="foot"><p>위 사항은 사실과 틀림없음을 증명합니다.</p><p class="date">${esc(y || '')}년 ${m ? +m : ''}월 ${day ? +day : ''}일</p><p class="author">작성자 <b>${esc(d.name)}</b> (서명)</p><p class="to"><b>${t((x) => x.company)}</b> 귀하</p></footer></section>
<section class="a4 p2"><header class="hd"><div class="doc-title">자기소개서</div><div class="doc-sub">${esc(d.name)}${d.applyField ? ` · 지원분야 ${esc(d.applyField)}` : ''}</div></header>
  <div class="body">${intro.filter((x) => String(d.intro[x[1]] || '').trim()).map((c) => `<section class="sec"><h2>${c[0]}</h2><p>${t((x) => x.intro?.[c[1]])}</p></section>`).join('')}</div></section>`;
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
