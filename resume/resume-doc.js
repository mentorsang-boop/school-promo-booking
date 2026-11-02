// 학교 양식(이력서_학번_성명.hwp)을 화면·인쇄·PDF용 A4 HTML로 옮긴 파일
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.newResume = (profile) => ({
  applyField: '', name: profile?.name || '', birth: '', mobile: '', address: '인천광역시 ', homePhone: '', email: '',
  eduPeriod: '2026.03.06.~2026.12.30.', eduSchool: '인천산업정보학교', major: profile?.dept || '', gradStatus: '수료예정', edu2Period: '', edu2School: '',
  licenses: Array.from({ length: 4 }, () => ({ date: '', name: '', org: '' })),
  awards: ['(출결) 출결사항_', '(수상)', '(활동)', '(교육이수)', ''].map((text) => ({ from: '', to: '', text, org: '' })),
  careers: Array.from({ length: 4 }, () => ({ from: '', to: '', place: '', desc: '' })),
  clubs: ['(동아리)', '(봉사)', '', ''].map((name) => ({ from: '', to: '', name, desc: '' })),
  writeDate: '', company: '',
  intro: { growth: '', personality: '', school: '', motivation: '' },
});

const range = (r) => `${esc(r.from)}${r.from || r.to ? ' ~ ' : '~'}${esc(r.to)}`;

window.resumeDocHTML = (d, photoUrl) => {
  const [y, m, day] = (d.writeDate || '').split('-');
  return `<section class="a4 page1"><table>
  <colgroup><col style="width:6.6%"><col style="width:14.7%"><col style="width:12.1%"><col style="width:33%"><col style="width:5.7%"><col style="width:4.6%"><col style="width:23.3%"></colgroup>
  <tr style="height:52px"><td class="photo-cell" colspan="2" rowspan="5"><div style="${photoUrl ? `background-image:url('${photoUrl}')` : ''}"></div></td>
    <td class="title" colspan="2"><span>이 력 서</span></td><th colspan="2">지원분야</th><td>${esc(d.applyField)}</td></tr>
  <tr><th rowspan="2">성명</th><td rowspan="2" style="font-size:16px">${esc(d.name)}</td><th colspan="2">생년월일</th><td>${esc(d.birth)}</td></tr>
  <tr><th colspan="2">휴대번호</th><td>${esc(d.mobile)}</td></tr>
  <tr><th rowspan="2">주소</th><td class="l" rowspan="2">${esc(d.address)}</td><th colspan="2">집 번호</th><td>${esc(d.homePhone)}</td></tr>
  <tr><th colspan="2">E-mail</th><td style="font-size:12px">${esc(d.email)}</td></tr>
  <tr><th class="vert" rowspan="3">학력</th><th colspan="2">재학기간</th><th>학 교 명</th><th colspan="2">전공분야</th><td>${esc(d.major)}</td></tr>
  <tr><td colspan="2" style="font-size:12.5px">${esc(d.eduPeriod)}</td><td>${esc(d.eduSchool)}</td><th colspan="2" rowspan="2">졸업여부</th><td rowspan="2">${esc(d.gradStatus)}</td></tr>
  <tr><td colspan="2" style="font-size:12.5px">${esc(d.edu2Period)}</td><td>${esc(d.edu2School)}</td></tr>
  <tr><th class="vert" rowspan="5">자격<br>및<br>면허</th><th colspan="2">취득일</th><th colspan="3">자격 및 면허증 명</th><th>발급기관</th></tr>
  ${d.licenses.map((r) => `<tr><td colspan="2">${esc(r.date)}</td><td class="l" colspan="3">${esc(r.name)}</td><td>${esc(r.org)}</td></tr>`).join('')}
  <tr><th class="vert" rowspan="6">수상<br>및<br>활동<br>경력</th><th colspan="2">일 자</th><th colspan="3">수 상 내 용</th><th>기관</th></tr>
  ${d.awards.map((r) => `<tr><td colspan="2">${range(r)}</td><td class="l" colspan="3">${esc(r.text)}</td><td>${esc(r.org)}</td></tr>`).join('')}
  <tr><th class="vert" rowspan="5">경력<br>사항</th><th colspan="2">기 간</th><th colspan="2">근 무 처</th><th colspan="2">직위 및 근무내용</th></tr>
  ${d.careers.map((r) => `<tr><td colspan="2">${range(r)}</td><td colspan="2">${esc(r.place)}</td><td colspan="2">${esc(r.desc)}</td></tr>`).join('')}
  <tr><th class="vert" rowspan="5">동아리<br>활동 및<br>봉사<br>활동</th><th colspan="2">기 간</th><th colspan="2">활 동 명</th><th colspan="2">내 용</th></tr>
  ${d.clubs.map((r) => `<tr><td colspan="2">${range(r)}</td><td class="l" colspan="2">${esc(r.name)}</td><td colspan="2">${esc(r.desc)}</td></tr>`).join('')}
</table>
<div class="sign"><p>위 사항은 사실과 틀림없음을 증명함.</p><p>${esc(y || '2026')}년 &nbsp; ${esc(m || '')}월 &nbsp; ${esc(day || '')}일</p></div>
<div class="author">작성자 <u>${esc(d.name)}</u> (서명)</div>
<div class="to"><b>${esc(d.company) || '&nbsp;'}</b> 귀하</div>
</section>
<section class="a4 page2"><p class="intro-title">[자 기 소 개 서]</p><table class="intro">
  <tr><th>성장<br>과정</th><td>${esc(d.intro.growth)}</td></tr>
  <tr><th>성격의<br>장·단점</th><td>${esc(d.intro.personality)}</td></tr>
  <tr><th>학창시절<br>및<br>사회경험</th><td>${esc(d.intro.school)}</td></tr>
  <tr><th>지원동기<br>및<br>입사 후<br>포부</th><td>${esc(d.intro.motivation)}</td></tr>
</table></section>`;
};

// 내용이 많아 A4를 넘치면 글자 크기를 줄여 한 쪽 안에 맞춘다
window.fitPages = (root) => {
  root.querySelectorAll('.a4').forEach((page) => {
    for (let size = 13.5; size >= 9; size -= 0.5) {
      page.style.fontSize = size + 'px';
      if (page.scrollHeight <= page.clientHeight) break;
      if (page.classList.contains('page2')) page.querySelectorAll('.intro td').forEach((c) => { c.style.height = 'auto'; });
    }
  });
};
