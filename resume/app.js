const SUPABASE_URL = 'https://prsldqlwyohsqmzzuiji.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rk7hTt2bKuzbFRm0J8ozJw_qx4xQdqf';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'resume-auth' } });

const VERSION = '1.17';
const INTRO_MAX = 600;
const INTRO = [['growth', '성장 과정'], ['personality', '성격의 장·단점'], ['school', '학창시절 및 사회경험'], ['motivation', '지원동기 및 입사 후 포부']];
const SECTIONS = ['전체', '기본 정보', '학력', '자격 및 면허', '수상 경력', '활동 경력', '경력 사항', '동아리·봉사', ...INTRO.map((x) => x[1]), '제출 정보'];
const REQUIRED = [['applyField', '지원분야'], ['name', '성명'], ['birth', '생년월일'], ['mobile', '휴대번호'], ['address', '주소'], ['email', 'E-mail']];

const $ = (s) => document.querySelector(s);
const state = {
  profile: null, view: 'auth', authTab: 'login', tab: 'edit',
  doc: null, resume: null, owner: null, feedbacks: [], photoUrl: '', saveState: '', timer: null, saving: false, dirty: false,
  students: [], resumes: [], filter: 'all', search: '', tg: null,
};
const isTeacher = () => state.profile?.role === 'teacher';
const isOwner = () => isTeacher() && !!state.profile.is_owner;
const canEdit = () => isOwner() || (isTeacher() && !!state.profile.can_edit);
const canApprove = () => isOwner() || (isTeacher() && !!state.profile.can_approve);
const classLabel = (s) => (s?.grade ? `${s.grade}학년 ${s.class_no}반${s.number ? ` ${s.number}번` : ''}` : '반 미지정');
const numberOptions = (max, unit, value) => `<option value="">선택</option>${Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${+value === i + 1 ? 'selected' : ''}>${i + 1}${unit}</option>`).join('')}`;
const makeStudentId = (g, c, n) => [g, c, n].map((x) => String(x).padStart(2, '0')).join('');
const deptField = (value = '') => (state.depts?.length
  ? `<div class="field"><label for="f-dept">학과</label><select id="f-dept" name="dept" required><option value="">선택</option>${state.depts.map((d) => `<option ${d.name === value ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}${value && !state.depts.some((d) => d.name === value) ? `<option selected>${esc(value)}</option>` : ''}</select></div>`
  : `<div class="field"><label for="f-dept">학과</label><input id="f-dept" name="dept" value="${esc(value)}"></div>`);
const classFields = (s = {}) => `<div class="class-row"><div class="field"><label for="f-grade">학년</label><select id="f-grade" name="grade" required>${numberOptions(3, '학년', s.grade)}</select></div><div class="field"><label for="f-class">반</label><select id="f-class" name="class_no" required>${numberOptions(20, '반', s.class_no)}</select></div><div class="field"><label for="f-number">번호</label><select id="f-number" name="number" required>${numberOptions(40, '번', s.number)}</select></div></div>`;
const api = async (body) => {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/resume-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
};
let toastTimer;
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000); };
const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

const validMobile = (v) => /^010-\d{4}-\d{4}$/.test(v);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v);
const CHECKS = { mobile: [validMobile, '010-1234-5678 형식으로 입력해 주세요.'], email: [validEmail, '이메일 주소 형식이 아닙니다. 예: name@example.com'] };
function formatMobile(value) {
  let d = value.replace(/\D/g, '');
  if (d && !'010'.startsWith(d) && !d.startsWith('010')) d = `010${d.replace(/^0+/, '').replace(/^10/, '')}`;
  d = d.slice(0, 11);
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join('-');
}
const syncAddress = (d) => { d.address = [d.addressBase, d.addressDetail].map((x) => String(x || '').trim()).filter(Boolean).join(' '); };

/* 진행률 */
function missing(d, hasPhoto) {
  const list = REQUIRED.filter(([k]) => !String(d[k] || '').trim()).map((x) => x[1]);
  if (d.address && !String(d.addressDetail || '').trim()) list.push('상세 주소');
  if (d.mobile && !validMobile(d.mobile)) list.push('휴대번호 형식');
  if (d.email && !validEmail(d.email)) list.push('E-mail 형식');
  if (!hasPhoto) list.push('사진');
  if (!d.company?.trim()) list.push('회사명');
  INTRO.forEach(([k, label]) => { if (!d.intro?.[k]?.trim()) list.push(label); });
  return list;
}
const progress = (d, hasPhoto) => { const total = REQUIRED.length + 2 + INTRO.length; return Math.max(0, Math.round((1 - missing(d, hasPhoto).length / total) * 100)); };
const mergeDoc = (data, profile) => {
  const base = newResume(profile);
  const doc = { ...base, ...data, intro: { ...base.intro, ...(data?.intro || {}) } };
  // 검색 기능 이전에 직접 입력한 주소는 검색 주소 칸으로 옮긴다
  if (!doc.addressBase && String(doc.address || '').trim() !== '인천광역시') doc.addressBase = doc.address || '';
  syncAddress(doc);
  // 예전 '수상 및 활동' 줄은 기간이 있으면 활동으로, 날짜가 하나면 수상으로 옮긴다
  doc.awards = (doc.awards || []).flatMap((row) => {
    if (!('from' in row)) return [row];
    if (row.to && row.to !== row.from) { doc.activities.push(row); return []; }
    return [{ date: row.from, text: row.text, org: row.org }];
  });
  Object.keys(ROWS).forEach((key) => {
    doc[key] = (doc[key] || []).filter((row) => !rowEmpty(row));
    if (!doc[key].length) doc[key].push(blankRow(key));
  });
  // 인천산업정보학교 학력은 학생 입력이 아니라 학교 설정을 따른다
  doc.eduSchool = base.eduSchool;
  if (state.school) { doc.eduPeriod = state.school.edu_period; doc.gradStatus = state.school.grad_status; }
  return doc;
};

/* 공통 틀 */
function shell(body, dock = '') {
  const who = state.profile ? `<button class="btn btn-sm" data-act="password">비밀번호</button><button class="btn btn-sm" data-act="logout">로그아웃</button>` : '';
  return `<header class="topbar"><div class="wrap"><div class="brand"><img src="logo.svg" alt="인천산업정보학교"><span>이력서 작성</span></div><div class="top-actions">${who}</div></div></header>
  <main class="wrap page">${body}<p class="version">v${VERSION}</p></main>${dock}`;
}

/* 로그인·가입 */
function viewAuth() {
  const teacher = !!window.ADMIN_PAGE;
  const signup = state.authTab === 'signup';
  return shell(`<section class="card auth">
    <div><h1 style="font-size:1.375rem;font-weight:800">${teacher ? '교사 계정' : '학생 이력서 작성'}</h1><p class="muted small">PC와 휴대폰 어디서나 이어서 작성할 수 있습니다.</p></div>
    <div class="seg" role="tablist"><button role="tab" aria-selected="${!signup}" data-act="authTab" data-v="login">로그인</button><button role="tab" aria-selected="${signup}" data-act="authTab" data-v="signup">회원가입</button></div>
    <form id="authForm" style="display:grid;gap:12px" novalidate>
      ${!teacher && signup ? '' : `<div class="field"><label for="f-id">${teacher ? '아이디' : '학번'}</label><input id="f-id" name="login_id" autocomplete="username" autocapitalize="none" required></div>`}
      ${signup ? `<div class="field"><label for="f-name">이름</label><input id="f-name" name="name" autocomplete="name" required></div>
      ${teacher ? `<div class="field"><label for="f-code">교사 인증 코드</label><input id="f-code" name="teacher_code" autocomplete="off" required></div><div class="field"><label for="f-phone">학교 전화번호 <span class="req">*</span></label><input id="f-phone" name="school_phone" type="tel" autocomplete="off" required><span class="hint">피드백 옆에 표시되어 학생이 연락할 수 있습니다.</span></div>` : `${classFields()}<div class="notice" id="autoId">학년, 반, 번호를 고르면 학번이 만들어집니다.</div>${deptField()}`}` : ''}
      <div class="field"><label for="f-pw">비밀번호${signup ? ' (8자 이상)' : ''}</label><input id="f-pw" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required></div>
      ${signup ? `<label class="check"><input type="checkbox" name="consent"><span>이력서 작성·지도를 위해 사진, 연락처, 주소, 학력·경력 등 개인정보를 수집·이용하고 담당 교사가 열람하는 데 동의합니다. 보유 기간은 수료 후 계정을 삭제할 때까지입니다.</span></label>` : ''}
      <p class="error" id="authErr" ${state.authMsg ? '' : 'hidden'}>${esc(state.authMsg || '')}</p>
      <button class="btn btn-primary" type="submit">${signup ? '가입 신청' : '로그인'}</button>
    </form>
    ${signup || teacher ? '' : '<p class="hint">비밀번호를 잊었다면 담당 선생님께 초기화를 요청해 주세요.</p>'}
  </section>`);
}
function viewPending() {
  const rejected = state.profile.status === 'rejected';
  return shell(`<section class="card auth" style="text-align:center"><h1 style="font-size:1.25rem">${rejected ? '가입이 승인되지 않았습니다' : '선생님의 승인을 기다리고 있습니다'}</h1>
    <p class="muted">${esc(state.profile.name)} (${esc(state.profile.login_id)})<br>${rejected ? '담당 선생님께 문의해 주세요.' : '승인되면 바로 작성할 수 있습니다.'}</p>
    <button class="btn" data-act="reload">다시 확인</button></section>`);
}

/* 입력 칸 */
const getPath = (path) => path.split('.').reduce((o, k) => o?.[k], state.doc);
function setPath(path, value) {
  const keys = path.split('.'); const last = keys.pop();
  keys.reduce((o, k) => o[k], state.doc)[last] = value;
}
const input = (path, label, opts = {}) => `<div class="field ${opts.cls || ''}"><label for="i-${path}">${label}${opts.req ? ' <span class="req">*</span>' : ''}</label>
  <input id="i-${path}" data-path="${path}" value="${esc(opts.date ? toIso(getPath(path)) : getPath(path))}" type="${opts.date ? 'date' : opts.type || 'text'}" ${opts.date ? 'data-date="1"' : ''} ${path === 'mobile' ? 'data-phone="1" inputmode="numeric" maxlength="13"' : ''}>${CHECKS[path] ? `<span class="hint over" data-err="${path}" ${!getPath(path) || CHECKS[path][0](getPath(path)) ? 'hidden' : ''}>${CHECKS[path][1]}</span>` : ''}</div>`;
const DATE = { date: true };
const toIso = (s) => { const m = String(s || '').match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${(m[3] || '1').padStart(2, '0')}` : ''; };
const fromIso = (v) => (v ? v.replace(/-/g, '.') : '');
// 재학기간처럼 한 칸에 '시작~종료'로 저장하는 값을 달력 두 개로 나눠 입력한다
const rangeInput = (path, label) => {
  const [from, to] = String(getPath(path) || '').split('~');
  const one = (i, text, v) => `<div class="field"><label for="i-${path}-${i}">${label} ${text}</label><input id="i-${path}-${i}" type="date" data-range="${path}" data-i="${i}" value="${toIso(v)}"></div>`;
  return one(0, '시작', from) + one(1, '종료', to);
};

/* 항목 바로 아래에 붙는 피드백: 교사는 내용을 보면서 쓰고, 학생은 고칠 곳에서 바로 읽는다 */
const RESPONSE = { edited: '수정했어요', kept: '그대로 둘게요' };
const unanswered = () => state.feedbacks.filter((f) => f.sent_at && !f.response);
const fbNoticeHTML = () => (unanswered().length ? `아직 답하지 않은 피드백이 <b>${unanswered().length}건</b> 있습니다. 각 피드백에서 수정했는지, 그대로 둘지 골라 주세요.` : '모든 피드백에 답했습니다.');
const SCALARS = {
  '기본 정보': [['applyField', '지원분야'], ['name', '성명'], ['birth', '생년월일'], ['mobile', '휴대번호'], ['addressBase', '주소'], ['addressDetail', '상세주소'], ['homePhone', '집 번호'], ['email', 'E-mail']],
  학력: [['eduPeriod', '재학기간'], ['eduSchool', '학교명'], ['edu2Period', '원적교 재학기간'], ['edu2School', '원적교'], ['major', '전공분야'], ['gradStatus', '졸업여부']],
  '제출 정보': [['company', '회사명'], ['writeDate', '작성일']],
};
const LISTS = {
  '자격 및 면허': ['licenses', [['date', '취득일'], ['name', '자격 및 면허증 명'], ['org', '발급기관']]],
  '수상 경력': ['awards', [['date', '수상일'], ['text', '수상명'], ['org', '수여기관']]],
  '활동 경력': ['activities', [['from', '시작'], ['to', '종료'], ['text', '활동 내용'], ['org', '주관기관']]],
  '경력 사항': ['careers', [['from', '시작'], ['to', '종료'], ['place', '근무처'], ['rank', '직급'], ['desc', '업무내용']]],
  '동아리·봉사': ['clubs', [['from', '시작'], ['to', '종료'], ['name', '활동명'], ['desc', '내용']]],
};
// date: 정렬 기준 날짜, need: 비어 있으면 도우미가 알려 주는 칸
const ROWS = {
  licenses: { section: '자격 및 면허', date: 'date', need: ['date', 'name', 'org'] },
  awards: { section: '수상 경력', date: 'date', need: ['date', 'text', 'org'] },
  activities: { section: '활동 경력', date: 'from', need: ['from', 'text', 'org'] },
  careers: { section: '경력 사항', date: 'from', need: ['from', 'to', 'place', 'desc'] },
  clubs: { section: '동아리·봉사', date: 'from', need: ['from', 'name'] },
};
const MAX_ROWS = 8;
const rowEmpty = (row) => !Object.values(row).some((v) => String(v || '').trim());
const blankRow = (key) => Object.fromEntries(LISTS[ROWS[key].section][1].map(([k]) => [k, '']));
const GUIDE = {
  '기본 정보': '지원분야는 채용공고에 적힌 직무명 그대로 씁니다. 사진은 최근 3개월 안에 찍은 단정한 증명사진을 올립니다. E-mail은 자주 확인하는 주소를 씁니다.',
  '자격 및 면허': '가장 최근에 취득한 것부터 적습니다. 자격증에 적힌 정식 명칭과 발급기관을 그대로 씁니다.',
  '수상 경력': '가장 최근에 받은 상부터 적습니다. 상장에 적힌 상 이름과 수여기관을 그대로 씁니다.',
  '활동 경력': '가장 최근 활동부터 적습니다. 무슨 활동을 했는지와 주관기관을 씁니다.',
  '경력 사항': '가장 최근 것부터 적습니다. 아르바이트도 경력입니다. 근무처는 정식 상호로, 업무내용은 실제로 한 일을 구체적으로 씁니다. 직급이 없으면 비워 둡니다.',
  '동아리·봉사': '가장 최근 것부터 적습니다. 활동명과 맡은 역할, 한 일을 씁니다.',
  '제출 정보': '회사명은 정식 명칭으로 씁니다. 작성일은 제출하는 날짜로 맞춥니다.',
  '성장 과정': '가족 소개를 나열하지 말고, 지금의 나를 만든 경험 한두 가지를 중심으로 씁니다.',
  '성격의 장·단점': '장점은 실제 경험을 근거로 들고, 단점은 고치려고 노력한 내용까지 함께 씁니다.',
  '학창시절 및 사회경험': '무슨 일을 했는지보다 그 경험에서 배운 점과 결과가 드러나게 씁니다.',
  '지원동기 및 입사 후 포부': '왜 이 회사와 이 직무인지, 입사 후 무엇을 할지 구체적으로 씁니다. 회사가 바뀌면 이 항목을 꼭 고칩니다.',
};
const guide = (section) => (studentDone() ? '' : `<p class="guide"><b>작성 도우미</b> ${GUIDE[section]}</p>`);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const outOfOrder = (key) => {
  const dates = state.doc[key].map((r) => toIso(r[ROWS[key].date])).filter(Boolean);
  return dates.some((v, i) => i && v > dates[i - 1]);
};
// 달력에서 최신순을 어기는 날짜를 고를 수 없게 한다: 윗줄보다 늦은 날짜, 아랫줄보다 이른 날짜는 막힌다
function applyDateLimits() {
  const birth = document.getElementById('i-birth');
  if (birth) birth.max = today();
  Object.entries(ROWS).forEach(([key, { date }]) => {
    state.doc[key].forEach((row, i) => {
      const above = state.doc[key].slice(0, i).reverse().find((x) => x[date]);
      const below = state.doc[key].slice(i + 1).find((x) => x[date]);
      const main = document.getElementById(`i-${key}.${i}.${date}`);
      const end = document.getElementById(`i-${key}.${i}.to`);
      if (main) {
        main.max = [today(), above && toIso(above[date]), row.to && toIso(row.to)].filter(Boolean).sort()[0];
        main.min = below ? toIso(below[date]) : '';
      }
      if (end) end.min = row.from ? toIso(row.from) : '';
    });
  });
}
function guideIssues(d) {
  const list = [];
  Object.entries(ROWS).forEach(([key, { section, need }]) => {
    const labels = Object.fromEntries(LISTS[section][1]);
    d[key].forEach((row, i) => {
      if (rowEmpty(row)) return;
      const lack = need.filter((k) => !String(row[k] || '').trim()).map((k) => labels[k]);
      if (lack.length) list.push(`${section} ${i + 1}번째 줄: ${lack.join(', ')} 입력 필요`);
    });
  });
  return list;
}
function guideHTML() {
  const sorts = Object.keys(ROWS).filter(outOfOrder);
  const issues = guideIssues(state.doc);
  if (!sorts.length && !issues.length) return '<div class="notice ok">작성 도우미 점검: 날짜 순서와 빠진 칸 모두 문제없습니다.</div>';
  return `<div class="notice warn"><b>작성 도우미 점검</b>${issues.length ? `<ul class="guide-list">${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${sorts.map((key) => `<div class="row between guide-sort"><span>${ROWS[key].section}: 최신순이 아닙니다.</span><button class="btn btn-sm" type="button" data-act="rowSort" data-v="${key}">최신순으로 정렬</button></div>`).join('')}</div>`;
}
const refreshGuide = () => { const el = $('#guideCheck'); if (el) el.innerHTML = guideHTML(); };
const canWrite = () => (isTeacher() ? canEdit() : state.resume?.status === 'draft');
// 줄마다 삭제 버튼을, 목록 아래에 추가 버튼을 붙인다
function rowList(key, make) {
  const rows = state.doc[key];
  const full = rows.length >= MAX_ROWS;
  return `<div class="rows">${rows.map((row, i) => `<div class="row-entry">${make(i)}${rows.length > 1 || !rowEmpty(row) ? `<button class="btn-link row-del" type="button" data-act="rowDel" data-v="${key}|${i}">이 줄 삭제</button>` : ''}</div>`).join('')}</div>
    <div class="row add-row"><button class="btn btn-soft btn-sm" type="button" data-act="rowAdd" data-v="${key}|end" ${full ? 'disabled' : ''}>+ 더 이전 내용 추가</button><button class="btn btn-sm" type="button" data-act="rowAdd" data-v="${key}|top" ${full ? 'disabled' : ''}>+ 더 최근 내용 맨 위에 추가</button>${full ? `<span class="hint">최대 ${MAX_ROWS}줄까지 넣을 수 있습니다.</span>` : ''}</div>`;
}
const lockedField = (label, value) => `<div class="field"><label>${label}</label><input value="${esc(value)}" disabled></div>`;

// 피드백을 쓸 때의 항목 내용을 {이름: 값}으로 저장해 두고 지금 내용과 비교한다
function sectionValues(section, d) {
  if (section === '전체') return Object.assign({}, ...SECTIONS.filter((s) => s !== '전체').map((s) => sectionValues(s, d)));
  const out = {};
  (SCALARS[section] || []).forEach(([k, label]) => { out[label] = String(d[k] || ''); });
  if (LISTS[section]) {
    const [key, cols] = LISTS[section];
    d[key].forEach((row, i) => cols.forEach(([k, label]) => { out[`${i + 1}번 ${label}`] = String(row[k] || ''); }));
  }
  const intro = INTRO.find((x) => x[1] === section);
  if (intro) out[section] = String(d.intro[intro[0]] || '');
  return out;
}
function changesHTML(f) {
  if (!f.snapshot) return '<p class="hint">이 피드백은 수정 전 내용이 저장되어 있지 않아 비교할 수 없습니다.</p>';
  if (!SECTIONS.includes(f.section)) return '<p class="hint">항목이 바뀌기 전의 피드백이라 비교할 수 없습니다.</p>';
  const now = sectionValues(f.section, state.doc);
  const keys = [...new Set([...Object.keys(f.snapshot), ...Object.keys(now)])].filter((k) => String(f.snapshot[k] ?? '').trim() !== String(now[k] ?? '').trim());
  if (!keys.length) return '<p class="hint">피드백 이후 바뀐 내용이 없습니다.</p>';
  return `<div class="changes"><b class="small">피드백 이후 수정된 곳 ${keys.length}개</b>${keys.map((k) => `<div class="change"><span class="small">${esc(k)}</span><del>${esc(f.snapshot[k] ?? '') || '(빈칸)'}</del><ins>${esc(now[k] ?? '') || '(빈칸)'}</ins></div>`).join('')}</div>`;
}
function fbList(section) {
  // 지금 없는 항목 이름으로 남은 피드백은 맨 위 '전체'에 모아 보여 준다
  const items = state.feedbacks.filter((f) => f.section === section || (section === '전체' && !SECTIONS.includes(f.section)));
  return items.map((f) => {
    const status = isTeacher()
      ? `<div class="row between">${!f.sent_at ? '<span class="badge off">전송 전</span>' : f.response ? `<span class="badge ok">학생: ${RESPONSE[f.response]} ${when(f.done_at)}</span>` : '<span class="badge warn">학생 응답 전</span>'}<button class="btn-link" data-act="delFb" data-v="${f.id}">삭제</button></div>`
      : (f.response ? `<div class="row"><span class="badge ok">${RESPONSE[f.response]} ${when(f.done_at)}</span><button class="btn-link" data-act="fbChoice" data-v="${f.id}:">다시 선택</button></div>` : `<div class="row"><button class="btn btn-primary btn-sm" data-act="fbChoice" data-v="${f.id}:edited">수정했어요</button><button class="btn btn-sm" data-act="fbChoice" data-v="${f.id}:kept">그대로 둘게요</button></div>`);
    return `<article class="fb"><div class="row between"><div class="fb-who"><b class="small">${f.round ? `${f.round}차 ` : ''}${esc(f.teacher_name || '')} 선생님 피드백</b>${f.teacher_phone ? `<a class="small" href="tel:${esc(f.teacher_phone.replace(/[^0-9+]/g, ''))}">☎ ${esc(f.teacher_phone)}</a>` : ''}</div><span class="hint">${when(f.created_at)}</span></div><p>${esc(f.body)}</p>${changesHTML(f)}${status}</article>`;
  }).join('');
}
function fbBlock(section) {
  if (studentDone()) return '';
  const write = canFeedback() ? `<details class="fb-write"><summary>피드백 쓰기</summary><form class="fbForm" data-section="${esc(section)}"><div class="field"><textarea name="body" maxlength="2000" required aria-label="${esc(section)} 피드백"></textarea></div><button class="btn btn-primary btn-sm" type="submit">등록</button></form></details>` : '';
  return `<div class="fb-block"><div class="fb-list" data-fb="${esc(section)}">${fbList(section)}</div>${write}</div>`;
}
function refreshFb() {
  document.querySelectorAll('[data-fb]').forEach((el) => { el.innerHTML = fbList(el.dataset.fb); });
}

const editForm = () => basicForm() + introForm();
function basicForm() {
  const d = state.doc;
  return `${canWrite() ? `<div id="guideCheck">${guideHTML()}</div>` : ''}${canFeedback() || state.feedbacks.some((f) => f.section === '전체' || !SECTIONS.includes(f.section)) ? `<section class="card"><h2>이력서 전체</h2>${fbBlock('전체')}</section>` : ''}
  <section class="card" data-sec="기본 정보"><h2>기본 정보</h2>${guide('기본 정보')}
    <div class="photo-box"><div class="photo ${state.photoUrl ? 'has' : ''}" style="${state.photoUrl ? `background-image:url('${state.photoUrl}')` : ''}">${state.photoUrl ? '' : '3×4<br>증명사진'}</div>
      <div style="display:grid;gap:6px"><label class="btn btn-soft" for="photoInput">사진 ${state.photoUrl ? '바꾸기' : '올리기'}</label><input id="photoInput" type="file" accept="image/*" hidden><span class="hint">자동으로 3:4 비율에 맞춰 잘립니다.</span></div></div>
    <div class="form-grid">
      ${input('applyField', '지원분야', { req: 1 })}${input('name', '성명', { req: 1 })}
      ${input('birth', '생년월일', { req: 1, ...DATE })}${input('mobile', '휴대번호', { req: 1, type: 'tel' })}
      <div class="field full"><label for="i-addressBase">주소 <span class="req">*</span></label><div class="addr-row"><input id="i-addressBase" value="${esc(d.addressBase)}" readonly data-act="findAddr"><button class="btn btn-soft" type="button" data-act="findAddr">주소 검색</button></div></div>
      ${input('addressDetail', '상세주소', { req: 1, cls: 'full' })}
      ${input('homePhone', '집 번호', { type: 'tel' })}${input('email', 'E-mail', { req: 1, type: 'email' })}
    </div>${fbBlock('기본 정보')}</section>
  <section class="card" data-sec="학력"><h2>학력</h2><div class="form-grid">
    ${lockedField('학교명', d.eduSchool)}${lockedField('재학기간', spacedPeriod(d.eduPeriod))}
    ${lockedField('전공분야(학과명)', d.major)}${lockedField('졸업여부', d.gradStatus)}
    <p class="hint full">인천산업정보학교 학력은 선생님이 설정하는 항목이라 수정할 수 없습니다.</p>
    ${rangeInput('edu2Period', '원적교 재학기간')}${input('edu2School', '원적교', { cls: 'full' })}
  </div>${fbBlock('학력')}</section>
  <section class="card" data-sec="자격 및 면허"><h2>자격 및 면허</h2>${guide('자격 및 면허')}${rowList('licenses', (i) => `<div class="entry-3">${input(`licenses.${i}.date`, '취득일', DATE)}${input(`licenses.${i}.name`, '자격 및 면허증 명')}${input(`licenses.${i}.org`, '발급기관')}</div>`)}${fbBlock('자격 및 면허')}</section>
  <section class="card" data-sec="수상 경력"><h2>수상 경력</h2>${guide('수상 경력')}${rowList('awards', (i) => `<div class="entry-3">${input(`awards.${i}.date`, '수상일', DATE)}${input(`awards.${i}.text`, '수상명')}${input(`awards.${i}.org`, '수여기관')}</div>`)}${fbBlock('수상 경력')}</section>
  <section class="card" data-sec="활동 경력"><h2>활동 경력</h2>${guide('활동 경력')}${rowList('activities', (i) => periodRow('activities', i, 'text', '활동 내용', 'org', '주관기관'))}${fbBlock('활동 경력')}</section>
  <section class="card" data-sec="경력 사항"><h2>경력 사항</h2>${guide('경력 사항')}${rowList('careers', (i) => `<div class="entry-4 career">${input(`careers.${i}.from`, '시작', DATE)}${input(`careers.${i}.to`, '종료', DATE)}${input(`careers.${i}.place`, '근무처', { cls: 'wide' })}${input(`careers.${i}.rank`, '직급', { cls: 'wide' })}${input(`careers.${i}.desc`, '업무내용', { cls: 'full-row' })}</div>`)}${fbBlock('경력 사항')}</section>
  <section class="card" data-sec="동아리·봉사"><h2>동아리 활동 및 봉사 활동</h2>${guide('동아리·봉사')}${rowList('clubs', (i) => periodRow('clubs', i, 'name', '활동명', 'desc', '내용'))}${fbBlock('동아리·봉사')}</section>
  <section class="card" data-sec="제출 정보"><h2>제출 정보</h2>${guide('제출 정보')}<div class="form-grid">${input('company', '회사명', { req: 1 })}${input('writeDate', '작성일', { type: 'date' })}</div>
    <p class="hint">지원하는 회사가 바뀌면 회사명만 고쳐서 다시 내려받으면 됩니다.</p>${fbBlock('제출 정보')}</section>
  ${isTeacher() ? '<section class="card"><h2>계정 관리</h2><div class="row"><button class="btn" data-act="resetPw">비밀번호 초기화</button>' + (isOwner() ? '<button class="btn btn-danger" data-act="delStudent">학생 계정 삭제</button>' : '') + '</div></section>' : ''}`;
}
function introForm() {
  const d = state.doc;
  return `<section class="card"><h2>자기소개서</h2>${INTRO.map(([k, label]) => `<div class="field" data-sec="${label}"><label for="i-intro.${k}">${label} <span class="req">*</span></label>${guide(label)}
    <textarea id="i-intro.${k}" data-path="intro.${k}" maxlength="${INTRO_MAX}">${esc(d.intro[k])}</textarea><span class="hint" data-count="intro.${k}">${d.intro[k].length} / ${INTRO_MAX}자</span>${fbBlock(label)}</div>`).join('')}</section>`;
}
const spacedPeriod = (p) => String(p || '').replace('~', ' ~ ');
const periodRow = (key, i, a, aLabel, b, bLabel) => `<div class="entry-4">${input(`${key}.${i}.from`, '시작', DATE)}${input(`${key}.${i}.to`, '종료', DATE)}${input(`${key}.${i}.${a}`, aLabel, { cls: 'wide' })}${input(`${key}.${i}.${b}`, bLabel, { cls: 'wide' })}</div>`;

/* 편집 화면 (학생 본인, 교사의 학생 지도 공용) */
function viewEditor() {
  const { doc: d, resume: r, owner } = state;
  const missingList = missing(d, !!state.photoUrl);
  const pct = progress(d, !!state.photoUrl);
  const teacher = isTeacher();
  const round = r.round || 1;
  const badge = r.status === 'approved' ? '<span class="badge ok">완성 (승인됨)</span>' : r.status === 'submitted' ? `<span class="badge warn">${round}차 첨삭 요청됨</span>` : `<span class="badge">${round}차 작성 중</span>`;
  const head = `<div class="head"><div>${teacher ? '<button class="btn-link" data-act="back">← 학생 목록</button>' : ''}<h1>${esc(owner.name)} 이력서</h1><p class="muted small">${classLabel(owner)} · ${esc(owner.login_id)}${owner.dept ? ' · ' + esc(owner.dept) : ''} · 진행률 ${pct}%</p></div>${badge}</div>
    <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
  const tabs = `<div class="tabs" role="tablist">${[['edit', '기본정보'], ['intro', '자기소개서'], ...(studentDone() ? [] : [['review', `첨삭${state.feedbacks.length ? ` ${state.feedbacks.length}` : ''}`], ['preview', '미리보기']]), ...(r.status === 'approved' ? [['companies', `추가 자기소개서${state.companies?.length ? ` ${state.companies.length}` : ''}`], ['output', '출력']] : [])].map(([v, l]) => `<button role="tab" aria-selected="${state.tab === v}" data-act="tab" data-v="${v}">${l}</button>`).join('')}</div>`;
  if (studentDone() && (state.tab === 'review' || state.tab === 'preview')) state.tab = 'edit';
  let body = '';
  if (state.tab === 'review') body = viewReview();
  else if (state.tab === 'output') body = viewOutput();
  else if (state.tab === 'companies') body = viewCompanies();
  else if (state.tab === 'edit' || state.tab === 'intro') {
    body = (!teacher && !studentDone() && state.feedbacks.length ? `<div class="notice" id="fbNotice">${fbNoticeHTML()}</div>` : '')
      + (teacher && r.status === 'submitted' && round >= 3 ? '<div class="notice">3차는 마지막 첨삭입니다. 고칠 내용은 직접 수정한 뒤 최종 승인해 주세요.</div>' : '')
      + (teacher && r.status === 'draft' ? `<div class="notice">학생이 ${round}차를 작성 중입니다. 첨삭 요청이 오면 피드백을 쓸 수 있습니다.</div>` : '')
      + (state.tab === 'edit'
        ? `${basicForm()}<div class="tab-next"><button class="btn btn-soft" data-act="tab" data-v="intro">다음: 자기소개서 쓰기 →</button></div>`
        : `${introForm()}<div class="tab-next"><button class="btn" data-act="tab" data-v="edit">← 기본정보로</button></div>`);
  } else {
    body = `<section class="card">${versionButtons()}<div class="notice">${r.status === 'approved' ? '프린트와 다운로드는 출력 탭에서 할 수 있습니다.' : '지금은 미리보기만 가능합니다. 선생님이 최종 승인하면 출력 탭이 열립니다.'}</div>${changeLegend()}
      ${missingList.length ? `<div class="notice warn">아직 비어 있는 항목: ${esc(missingList.join(', '))}</div>` : ''}
</section><div class="preview" id="preview"></div>`;
  }
  const submit = teacher ? reviewButtons(r)
    : r.status === 'approved' ? '<button class="btn btn-primary" data-act="tab" data-v="output">프린트·다운로드</button>'
    : r.status === 'submitted' ? '<button class="btn" disabled>선생님 첨삭 중</button>'
    : `<button class="btn btn-primary" data-act="submit">${round}차 첨삭 요청</button>`;
  const dock = `<div class="dock"><div class="wrap"><span class="save-state" id="saveState"></span>${submit}</div></div>`;
  return shell(head + tabs + body, dock);
}

/* 차수 보기와 승인 */
// 완성된 학생에게는 첨삭과 미리보기를 보여 주지 않는다
const studentDone = () => !isTeacher() && state.resume?.status === 'approved';
const canOutput = () => state.resume?.status === 'approved' && state.tab === 'output';
// 미리보기에서는 보고 있는 차수까지의 변경 내역을 차수별 색으로 표시한다 (4는 승인 시점의 완성본)
const changeChain = () => {
  if (state.tab !== 'preview') return null;
  const view = currentView();
  const approved = state.resume.status === 'approved';
  const round = state.resume.round || 1;
  const chain = (state.versions || []).filter((v) => v.round <= (view ?? 3) && !(v.round === view && view === round && !approved)).sort((a, b) => a.round - b.round).map((v) => ({ round: v.round, doc: mergeDoc(v.data, state.owner) }));
  if (view === null) chain.push({ round: 4, doc: state.doc });
  else if (view === round && !approved) chain.push({ round, doc: state.doc });
  return chain.length > 1 ? chain : null;
};
const CHANGE_LABELS = { 2: '2차 수정', 3: '3차 수정', 4: '완성 전 최종 수정' };
const changeLegend = () => {
  const chain = changeChain();
  if (!chain) return '';
  return `<p class="small legend">${chain.slice(1).map((c) => `<mark class="chg chg-${c.round}">${CHANGE_LABELS[c.round]}</mark>`).join('')}<span class="muted">지운 글자와 사진 변경은 표시되지 않습니다.</span></p>`;
};
const COMPANY_STATUS = { draft: ['작성 중', ''], submitted: ['첨삭 요청', 'warn'], approved: ['승인', 'ok'] };
function viewCompanies() {
  const teacher = isTeacher();
  const add = teacher ? '' : `<section class="card"><h2>추가 자기소개서 만들기</h2><p class="small muted">승인된 자기소개서가 복사됩니다. 회사에 맞게 지원분야와 지원동기를 고친 뒤 첨삭을 요청하세요.</p><div class="phone-row"><div class="field"><label for="newCompany">회사명</label><input id="newCompany" maxlength="60"></div><button class="btn btn-primary" data-act="coAdd">추가</button></div></section>`;
  const list = state.companies.length ? `<section class="card"><h2>추가 자기소개서 목록</h2><div class="row">${state.companies.map((c) => `<button class="btn btn-sm ${c.id === state.companyId ? 'btn-primary' : ''}" data-act="coSelect" data-v="${c.id}">${esc(c.company)} · ${COMPANY_STATUS[c.status][0]}</button>`).join('')}</div></section>` : `<section class="card"><p class="muted">${teacher ? '이 학생이 만든 추가 자기소개서가 없습니다.' : '아직 만든 추가 자기소개서가 없습니다.'}</p></section>`;
  const c = state.companies.find((x) => x.id === state.companyId);
  return add + list + (c ? companyEditor(c) : '');
}
function companyEditor(c) {
  const teacher = isTeacher();
  const editable = teacher ? canEdit() : c.status === 'draft';
  const [label, badge] = COMPANY_STATUS[c.status];
  const fields = INTRO.map(([k, name]) => {
    const value = c.intro[k] || '';
    const changed = value.trim() !== String(state.doc.intro[k] || '').trim();
    return `<div class="field"><label for="co-${k}">${name}${changed ? ' <span class="badge">기본본과 다름</span>' : ''}</label><textarea id="co-${k}" data-co="${k}" maxlength="${INTRO_MAX}" ${editable ? '' : 'disabled'}>${esc(value)}</textarea>${changed ? `<div class="co-diff"><span class="small muted">기본본에서 바뀐 내용</span><p>${layeredChanges([state.doc.intro[k] || '', value], [0, 2])}</p></div>` : ''}</div>`;
  }).join('');
  const note = c.feedback ? `<article class="fb"><div class="fb-who"><b class="small">${esc(c.feedback_by || '')} 선생님 피드백</b>${c.feedback_phone ? `<a class="small" href="tel:${esc(c.feedback_phone.replace(/[^0-9+]/g, ''))}">☎ ${esc(c.feedback_phone)}</a>` : ''}</div><p>${esc(c.feedback)}</p></article>` : '';
  const buttons = teacher
    ? `${c.status === 'submitted' && !c.feedback ? `<div class="field"><label for="coNote">피드백</label><textarea id="coNote" maxlength="2000"></textarea></div><div><button class="btn" data-act="coFeedback">피드백 전송</button></div>` : ''}<div class="row">${c.status !== 'approved' && canApprove() ? '<button class="btn btn-primary" data-act="coReview" data-v="approved">승인</button>' : ''}${c.status === 'approved' && canApprove() ? '<button class="btn" data-act="coReview" data-v="draft">승인 취소</button>' : ''}</div>`
    : `<div class="row">${c.status === 'draft' ? '<button class="btn btn-primary" data-act="coRequest">첨삭 요청</button>' : ''}${c.status !== 'approved' ? '<button class="btn btn-danger" data-act="coDelete">삭제</button>' : ''}</div>`;
  return `<section class="card"><div class="row between"><h2>${esc(c.company)}</h2><span class="badge ${badge}">${label}</span></div>${note}
    <div class="form-grid"><div class="field"><label for="co-company">회사명</label><input id="co-company" data-co-company maxlength="60" value="${esc(c.company)}" ${editable ? '' : 'disabled'}></div><div class="field"><label for="co-applyField">지원분야</label><input id="co-applyField" data-co="applyField" maxlength="60" value="${esc(c.intro.applyField ?? state.doc.applyField)}" ${editable ? '' : 'disabled'}></div></div>${fields}${buttons}
    ${c.status === 'approved' ? '<p class="hint">출력 탭에서 이 회사를 골라 프린트하거나 내려받을 수 있습니다.</p>' : ''}</section>`;
}
function queueCompanySave() {
  showSave('저장 중…');
  clearTimeout(state.coTimer);
  state.coTimer = setTimeout(saveCompany, 800);
}
async function saveCompany() {
  const c = state.companies.find((x) => x.id === state.companyId);
  if (!c) return;
  const { error } = await sb.from('resume_companies').update({ company: c.company, intro: c.intro }).eq('id', c.id);
  showSave(error ? '저장 실패 · 다시 시도해 주세요.' : '저장됨', !!error);
}
async function setCompany(id, patch, message) {
  const { error } = await sb.from('resume_companies').update(patch).eq('id', id);
  if (error) { toast('처리하지 못했습니다.'); return; }
  await loadCompanies(); render(); toast(message);
}
function viewOutput() {
  const approved = (state.companies || []).filter((c) => c.status === 'approved');
  return `<section class="card">${approved.length ? `<div class="field"><label for="outChoice">출력할 자기소개서</label><select id="outChoice"><option value="">기본 (${esc(state.doc.company || '회사명 없음')})</option>${approved.map((c) => `<option value="${c.id}" ${state.outputCompany === c.id ? 'selected' : ''}>${esc(c.company)}</option>`).join('')}</select></div>` : ''}<div class="row"><button class="btn btn-primary" data-act="print">프린트</button><button class="btn" data-act="pdf">PDF 다운로드</button></div>
    <p class="hint">휴대폰에서 프린트가 어려우면 PDF로 내려받아 사용하세요. 회사가 바뀌면 기본정보 탭에서 회사명을 고친 뒤 다시 출력하세요.</p></section><div class="preview" id="preview"></div>`;
}
function viewReview() {
  const form = document.createElement('template');
  form.innerHTML = editForm();
  const cards = [...form.content.querySelectorAll('[data-sec]')];
  const blocks = SECTIONS.map((section) => {
    const hasFb = state.feedbacks.some((f) => f.section === section || (section === '전체' && !SECTIONS.includes(f.section)));
    if (!hasFb && !canFeedback()) return '';
    if (section === '전체') return `<section class="card"><h2>이력서 전체</h2>${fbBlock(section)}</section>`;
    const card = cards.find((c) => c.dataset.sec === section);
    return card.tagName === 'SECTION' ? card.outerHTML : `<section class="card"><h2>자기소개서</h2>${card.outerHTML}</section>`;
  }).join('');
  const notice = !isTeacher() && state.feedbacks.length ? `<div class="notice" id="fbNotice">${fbNoticeHTML()}</div>` : '';
  return notice + (blocks || '<section class="card"><p class="muted">아직 첨삭 내용이 없습니다.</p></section>');
}
const shownDoc = () => {
  const c = state.tab === 'output' && state.companies?.find((x) => x.id === state.outputCompany);
  if (c) return { ...state.doc, company: c.company, applyField: c.intro.applyField ?? state.doc.applyField, intro: { ...state.doc.intro, ...c.intro } };
  const v = state.tab === 'preview' && state.versions?.find((x) => x.round === state.versionView);
  return v ? mergeDoc(v.data, state.owner) : state.doc;
};
const currentView = () => state.versionView ?? (state.resume.status === 'approved' ? null : state.resume.round || 1);
function versionButtons() {
  const approved = state.resume.status === 'approved';
  const round = state.resume.round || 1;
  const has = (n) => state.versions?.some((v) => v.round === n) || (!approved && n === round);
  const btn = (v, label, on) => `<button class="btn btn-sm ${currentView() === v ? 'btn-primary' : ''}" data-act="version" data-v="${v ?? ''}" ${on ? '' : 'disabled'}>${label}</button>`;
  return `<div class="row">${[1, 2, 3].map((n) => btn(n, `${n}차`, has(n))).join('')}${approved ? btn(null, '완성본', true) : ''}</div>`;
}
function reviewButtons(r) {
  const round = r.round || 1;
  if (r.status === 'approved') return canApprove() ? '<button class="btn" data-act="review" data-v="reopen">최종 승인 취소</button>' : '';
  const send = canFeedback() ? `<button class="btn" data-act="review" data-v="next">피드백 전송 (${round + 1}차로)</button>` : '';
  return `<div class="row">${send}${canApprove() ? '<button class="btn btn-primary" data-act="review" data-v="approve">최종 승인</button>' : ''}</div>`;
}
const canFeedback = () => isTeacher() && state.resume?.status === 'submitted' && (state.resume.round || 1) < 3;
// 학생은 제출 후 잠기고, 승인 후에는 회사명과 작성일만 고칠 수 있다
function applyLocks() {
  ['i-name'].forEach((id) => { const el = document.getElementById(id); if (el) el.disabled = true; });
  const status = state.resume.status;
  if (isTeacher()) {
    if (canEdit()) return;
    document.querySelectorAll('[data-path],[data-range],[data-act=findAddr],[data-act=rowAdd],[data-act=rowDel],#photoInput').forEach((el) => { el.disabled = true; });
    document.querySelector('label[for=photoInput]')?.remove();
    $('#i-addressBase')?.removeAttribute('data-act');
    return;
  }
  if (status === 'draft') return;
  const free = status === 'approved' ? ['company', 'writeDate'] : [];
  document.querySelectorAll('[data-path],[data-range],[data-act=findAddr],[data-act=rowAdd],[data-act=rowDel],#photoInput').forEach((el) => { if (!free.includes(el.dataset.path)) el.disabled = true; });
  document.querySelector('label[for=photoInput]')?.remove();
  $('#i-addressBase')?.removeAttribute('data-act');
  document.querySelector('.page .tabs').insertAdjacentHTML('afterend', `<div class="notice ${status === 'approved' ? 'ok' : 'warn'}">${status === 'approved' ? '선생님이 승인한 완성본입니다. 회사명과 작성일만 고칠 수 있습니다.' : '선생님이 첨삭하고 있습니다. 피드백이 오면 다시 수정할 수 있습니다.'}</div>`);
}

/* 출력 */
function renderPaper() {
  const paper = $('#paper');
  paper.innerHTML = resumeDocHTML(shownDoc(), state.photoUrl, changeChain());
  fitPages(paper);
}
function renderPreview() {
  const box = $('#preview'); if (!box) return;
  renderPaper();
  const width = Math.min(box.clientWidth, 794);
  const scale = width / 794;
  box.innerHTML = '';
  $('#paper').querySelectorAll('.a4').forEach((p) => {
    const frame = document.createElement('div');
    frame.className = 'sheet-frame';
    frame.style.cssText = `width:${794 * scale}px;height:${1123 * scale}px`;
    const copy = p.cloneNode(true);
    copy.style.transform = `scale(${scale})`;
    frame.append(copy);
    if (!canOutput()) frame.insertAdjacentHTML('beforeend', '<div class="watermark">미리보기</div>');
    box.append(frame);
  });
}
async function downloadPdf() {
  toast('PDF를 만들고 있습니다…');
  renderPaper();
  await document.fonts.ready;
  const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const pages = [...$('#paper').querySelectorAll('.a4')];
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#fff', useCORS: true, windowWidth: 794 });
    if (i) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  }
  const company = state.companies?.find((x) => x.id === state.outputCompany)?.company;
  pdf.save(`이력서_${state.owner.login_id}_${state.doc.name || state.owner.name}${company ? `_${company}` : ''}.pdf`.replace(/[\\/:*?"<>|]/g, ''));
}

/* 저장 */
function showSave(text, bad) { state.saveState = text; const el = $('#saveState'); if (el) { el.textContent = text; el.classList.toggle('bad', !!bad); } }
function queueSave() {
  state.dirty = true;
  showSave('저장 중…');
  clearTimeout(state.timer);
  state.timer = setTimeout(save, 800);
}
async function save(extra = {}) {
  clearTimeout(state.timer);
  if (state.saving) { state.timer = setTimeout(() => save(extra), 300); return false; }
  state.saving = true; state.dirty = false;
  const patch = { data: state.doc, ...extra };
  const { data, error } = await sb.from('resumes').update(patch).eq('user_id', state.resume.user_id).eq('version', state.resume.version).select().maybeSingle();
  state.saving = false;
  if (error) {
    state.dirty = true;
    showSave('저장 실패 · 연결을 확인해 주세요. 다시 시도합니다.', true);
    state.timer = setTimeout(save, 5000);
    return false;
  }
  if (!data) return conflict();
  const statusChanged = data.status !== state.resume.status;
  state.resume = data;
  showSave(`저장됨 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
  refreshFb();
  if (statusChanged) render();
  return true;
}
async function conflict() {
  const { data } = await sb.from('resumes').select().eq('user_id', state.resume.user_id).single();
  if (confirm('다른 기기나 선생님이 이 이력서를 먼저 수정했습니다.\n\n[확인] 지금 화면의 내용으로 저장\n[취소] 최신 내용 불러오기')) {
    state.resume = data;
    return save();
  }
  state.resume = data;
  state.doc = mergeDoc(data.data, state.owner);
  render();
  showSave('최신 내용을 불러왔습니다.');
  return false;
}

/* 데이터 불러오기 */
async function openResume(owner) {
  state.owner = owner; state.tab = 'edit'; state.photoUrl = '';
  let { data: r } = await sb.from('resumes').select().eq('user_id', owner.id).maybeSingle();
  if (!r) {
    const res = await sb.from('resumes').insert({ user_id: owner.id, data: newResume(owner) }).select().single();
    if (res.error) { toast('이력서를 열지 못했습니다.'); return; }
    r = res.data;
  }
  state.resume = r;
  state.doc = mergeDoc(r.data, owner);
  state.doc.name = owner.name;
  if (owner.dept) state.doc.major = owner.dept;
  state.versionView = null;
  const { data: versions } = await sb.from('resume_versions').select().eq('user_id', owner.id);
  state.versions = versions || [];
  state.companyId = null; state.outputCompany = '';
  await loadCompanies();
  await Promise.all([loadPhoto(), loadFeedbacks()]);
  state.view = 'editor';
  if (isTeacher() && r.status === 'submitted') state.tab = 'review';
  const asked = isTeacher() && r.status === 'approved' && state.companies.find((c) => c.status === 'submitted');
  if (asked) { state.tab = 'companies'; state.companyId = asked.id; }
  render();
  showSave(`마지막 저장 ${when(r.updated_at)}`);
}
async function loadCompanies() {
  const { data } = await sb.from('resume_companies').select().eq('user_id', state.owner.id).order('created_at');
  state.companies = data || [];
}
async function loadPhoto() {
  if (!state.resume.photo_path) return;
  const { data } = await sb.storage.from('resume-photos').download(state.resume.photo_path);
  if (data) state.photoUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(data); });
}
async function loadFeedbacks() {
  const { data } = await sb.from('resume_feedbacks').select().eq('student_id', state.owner.id).order('created_at', { ascending: false });
  // 학생에게는 지난 차수에서 답을 마친 피드백을 다음 첨삭부터 보여 주지 않는다
  const round = state.resume?.round || 1;
  state.feedbacks = (data || []).filter((f) => isTeacher() || !f.response || (f.round || 0) >= round - 1);
}
async function uploadPhoto(file) {
  toast('사진을 올리고 있습니다…');
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = 3 / 4; let sw = bitmap.width; let sh = bitmap.height;
    if (sw / sh > ratio) sw = sh * ratio; else sh = sw / ratio;
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, Math.max(0, (bitmap.height - sh) / 4), sw, sh, 0, 0, 600, 800);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    const path = `${state.owner.id}/photo.jpg`;
    const { error } = await sb.storage.from('resume-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    state.photoUrl = canvas.toDataURL('image/jpeg', 0.88);
    await save({ photo_path: path });
    render();
    toast('사진을 저장했습니다.');
  } catch (_e) {
    toast('사진을 올리지 못했습니다. JPG나 PNG 파일로 다시 시도해 주세요.');
  }
}
async function loadTeacher() {
  const [p, r, f, co] = await Promise.all([
    sb.from('resume_profiles').select().eq('role', 'student').order('grade').order('class_no').order('number').order('login_id'),
    sb.from('resumes').select('user_id,data,photo_path,status,round,approved_at,submitted_at,updated_at'),
    sb.from('resume_feedbacks').select('student_id,done_at').not('sent_at', 'is', null),
    sb.from('resume_companies').select('id,user_id,company,status,applyField:intro->>applyField').order('created_at'),
  ]);
  state.students = p.data || [];
  state.resumes = r.data || [];
  state.fbRows = f.data || [];
  state.coRows = co.data || [];
  if (isOwner()) {
    const [t, c] = await Promise.all([sb.from('resume_profiles').select().eq('role', 'teacher').order('created_at'), sb.from('resume_teacher_classes').select()]);
    state.teachers = t.data || []; state.assign = c.data || [];
  }
  state.view = 'teacher';
  render();
  if (state.tg) paintTg();
  api({ action: 'telegram_status' }).then((t) => { state.tg = t; if (state.view === 'teacher') paintTg(); }).catch(() => {});
}
function tgBoxHTML() {
  const tg = state.tg || {};
  const link = `https://t.me/${esc(tg.username || '')}?start=${String(state.profile?.id || '').replace(/-/g, '')}`;
  const setup = `<ol class="tg-steps">
    <li><b>알림 봇 만들기</b><span>아래 버튼을 눌러 텔레그램의 BotFather를 열고 <b>시작</b>을 누른 뒤 <code>/newbot</code>을 보냅니다. 이름을 물으면 <code>이력서 알림</code>, 아이디를 물으면 <code>incheon_resume_2026_bot</code>처럼 <code>bot</code>으로 끝나게 보냅니다.</span><div><a class="btn" href="https://t.me/BotFather" target="_blank" rel="noopener">BotFather 열기</a></div></li>
    <li><b>토큰 붙여 넣기</b><span>답장에 있는 <code>123456789:ABC...</code> 형태의 긴 글자를 복사해 붙여 넣고 저장합니다.</span><div class="field"><label for="tgToken">봇 토큰</label><input id="tgToken" autocomplete="off"></div><div><button class="btn btn-primary" data-act="tgSave">토큰 저장</button></div></li>
  </ol>`;
  if (tg.hasChat) return `<div class="notice ok">연결되었습니다. 가입 신청과 첨삭 요청이 텔레그램으로 옵니다.</div>${isOwner() ? `<details class="fb-write"><summary>봇 바꾸기</summary>${setup}</details>` : ''}`;
  if (!tg.hasToken) return isOwner() ? `<p class="small muted">학생이 가입하거나 첨삭을 요청하면 텔레그램으로 알림을 받습니다. 먼저 휴대폰에 텔레그램을 설치해 주세요. 봇은 최고 관리자가 한 번만 만들면 선생님들이 함께 씁니다.</p>${setup}` : '<p class="small muted">최고 관리자가 알림 봇을 등록하면 이곳에 연결 방법이 나타납니다.</p>';
  return `<div class="notice">토큰 저장 완료. 마지막 단계만 남았습니다.</div>
    <ol class="tg-steps"><li><b>내 봇 열고 시작 누르기</b><span>휴대폰으로 QR을 찍거나 아래 버튼을 눌러 봇을 연 뒤 <b>시작</b>을 누르세요. 이 화면이 자동으로 연결을 확인합니다.</span>
      ${tg.username ? `<div class="tg-open"><div id="tgQr"></div><a class="btn btn-primary" href="${link}" target="_blank" rel="noopener">@${esc(tg.username)} 열기</a></div>` : '<span>봇 주소를 불러오지 못했습니다. 새로고침해 주세요.</span>'}
      <p class="small muted" id="tgWait">시작을 누르기를 기다리는 중입니다…</p><div><button class="btn btn-sm" data-act="tgConnect">직접 연결 확인</button></div></li></ol>
    ${isOwner() ? `<details class="fb-write"><summary>토큰 다시 넣기</summary>${setup}</details>` : ''}`;
}
function paintTg() {
  const box = $('#tgBox'); if (!box) return;
  box.innerHTML = tgBoxHTML();
  const label = $('#tgState'); if (label) label.innerHTML = tgLabel();
  const qr = $('#tgQr');
  if (qr && state.tg?.username && window.QRCode) new QRCode(qr, { text: `https://t.me/${state.tg.username}?start=${state.profile.id.replace(/-/g, '')}`, width: 140, height: 140 });
  watchTg();
}
// 토큰 저장 후 학생 알림을 받을 대화가 생기면 자동으로 연결한다
function watchTg() {
  clearInterval(state.tgTimer);
  if (!state.tg?.hasToken || state.tg.hasChat) return;
  let tries = 0;
  state.tgTimer = setInterval(async () => {
    if (state.view !== 'teacher' || ++tries > 100) { clearInterval(state.tgTimer); return; }
    try {
      const r = await api({ action: 'telegram_connect' });
      if (r.ok) { clearInterval(state.tgTimer); state.tg = { ...state.tg, hasChat: true }; paintTg(); toast('텔레그램 연결이 끝났습니다. 확인 메시지를 보냈습니다.'); }
    } catch (_e) { /* 아직 시작을 누르지 않음 */ }
  }, 3000);
}
const tgLabel = () => (state.tg?.hasChat ? '<span class="badge ok">연결됨</span>' : state.tg?.hasToken ? '<span class="badge warn">채팅 연결 필요</span>' : '<span class="badge off">미연결</span>');

const companyCell = (id) => {
  const rows = (state.coRows || []).filter((c) => c.user_id === id);
  if (!rows.length) return '-';
  const asked = rows.filter((c) => c.status === 'submitted').length;
  return `<button class="btn-link" data-act="coList" data-v="${id}">${rows.length}개 보기</button>${asked ? ` <span class="badge warn">요청 ${asked}</span>` : ''}`;
};
const STATUS = { pending: '가입 승인 대기', rejected: '가입 거절', none: '시작 전', writing: '작성 중', review: '첨삭 요청', done: '완성', coReview: '추가 자기소개서 첨삭 요청', coWriting: '추가 자기소개서 작성 중' };
const BADGE = { pending: 'warn', rejected: 'off', none: 'off', writing: '', review: 'warn', done: 'ok', coReview: 'warn', coWriting: '' };
const statusText = (x) => (x.key === 'writing' || x.key === 'review' ? `${x.round}차 ${STATUS[x.key]}` : STATUS[x.key]);
function studentRows() {
  return state.students.map((s) => {
    const r = state.resumes.find((x) => x.user_id === s.id);
    const doc = r ? mergeDoc(r.data, s) : null;
    const co = (state.coRows || []).filter((c) => c.user_id === s.id);
    const key = s.status !== 'approved' ? s.status : !r ? 'none' : r.status !== 'approved' ? (r.status === 'submitted' ? 'review' : 'writing')
      : co.some((c) => c.status === 'submitted') ? 'coReview' : co.some((c) => c.status === 'draft') ? 'coWriting' : 'done';
    return {
      s, key, doc,
      pct: doc ? progress(doc, !!r.photo_path) : 0,
      lack: doc ? missing(doc, !!r.photo_path) : [],
      fb: (state.fbRows || []).filter((f) => f.student_id === s.id).length,
      fbDone: (state.fbRows || []).filter((f) => f.student_id === s.id && f.done_at).length,
      round: r?.round || 1, updated: r?.updated_at, approved: r?.approved_at,
    };
  });
}
function downloadExcel() {
  const rows = studentRows().map((x) => ({
    학년: x.s.grade || '', 반: x.s.class_no || '', 번호: x.s.number || '', 학번: x.s.login_id, 이름: x.s.name, 학과: x.doc?.major || x.s.dept, 상태: statusText(x), '진행률(%)': x.pct,
    지원분야: x.doc?.applyField || '', 회사명: x.doc?.company || '', '미입력 항목': x.lack.join(', '), '피드백 수': x.fb, '학생 응답': x.fbDone,
    '최근 저장': x.updated ? new Date(x.updated).toLocaleString('ko-KR') : '', 승인일: x.approved ? new Date(x.approved).toLocaleString('ko-KR') : '',
  }));
  if (!rows.length) { toast('내려받을 학생이 없습니다.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [6, 6, 6, 12, 10, 16, 10, 9, 14, 18, 40, 9, 12, 22, 22].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '학생 현황');
  XLSX.writeFile(wb, `이력서_학생현황_${new Date().toLocaleDateString('sv')}.xlsx`);
}
const studentUrl = () => new URL('./', location.href).href;
function drawShareQr() {
  const box = $('#shareQr');
  if (box && window.QRCode) new QRCode(box, { text: studentUrl(), width: 132, height: 132 });
}
function viewDepts() {
  const rows = (state.depts || []).map((d) => `<div class="dept-row"><input data-dept="${d.id}" value="${esc(d.name)}" maxlength="40" aria-label="학과 이름"><button class="btn btn-sm btn-danger" data-act="delDept" data-v="${d.id}">삭제</button></div>`).join('');
  return shell(`<div class="head"><div><button class="btn-link" data-act="back">← 학생 목록</button><h1>학과 관리</h1><p class="muted small">여기에 입력한 학과가 학생 회원가입 화면에 선택 목록으로 나옵니다.</p></div></div>
    <section class="card"><h2>학과 추가</h2><form id="deptForm" class="phone-row"><div class="field"><label for="newDept">학과 이름</label><input id="newDept" maxlength="40" required></div><button class="btn btn-primary" type="submit">추가</button></form></section>
    <section class="card"><h2>학과 목록</h2><div class="rows">${rows || '<p class="muted">아직 등록한 학과가 없습니다. 학과를 추가하기 전까지 학생은 학과를 직접 입력합니다.</p>'}</div><p class="hint">이름을 고치면 자동 저장됩니다. 학과를 삭제하거나 이름을 바꿔도 이미 가입한 학생의 학과는 그대로입니다.</p></section>`);
}
const GRAD_OPTIONS = ['수료예정', '수료', '졸업예정', '졸업'];
function schoolCard() {
  const base = state.school || { edu_period: newResume().eduPeriod, grad_status: newResume().gradStatus };
  const [from, to] = base.edu_period.split('~');
  return `<section class="card"><h2>인천산업정보학교 학력 설정</h2><p class="small muted">모든 학생의 이력서에 똑같이 적용됩니다. 학생은 보기만 하고 바꿀 수 없습니다.</p>
    <div class="form-grid"><div class="field"><label for="schoolFrom">재학 시작일</label><input id="schoolFrom" type="date" value="${toIso(from)}"></div><div class="field"><label for="schoolTo">재학 종료일</label><input id="schoolTo" type="date" value="${toIso(to)}"></div>
    <div class="field"><label for="schoolGrad">졸업여부</label><select id="schoolGrad">${[...new Set([...GRAD_OPTIONS, base.grad_status])].map((x) => `<option ${x === base.grad_status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div>
    <div><button class="btn btn-primary" data-act="saveSchool">저장</button></div></section>`;
}
function myInfoCard() {
  const phone = state.profile.school_phone || '';
  return `<section class="card"><h2>내 학교 전화번호</h2>${phone ? '' : '<div class="notice warn">번호를 입력하면 피드백 옆에 표시되어 학생이 연락할 수 있습니다.</div>'}<div class="phone-row"><div class="field"><label for="myPhone">학교 전화번호</label><input id="myPhone" type="tel" value="${esc(phone)}"></div><button class="btn" data-act="savePhone">저장</button></div></section>`;
}
function ownerCard() {
  const rows = (state.teachers || []).map((t) => {
    if (t.is_owner) return `<tr><td class="strong">${esc(t.name)}</td><td>${esc(t.login_id)}</td><td colspan="4" class="muted">최고 관리자 (모든 권한)</td></tr>`;
    const chips = (state.assign || []).filter((c) => c.teacher_id === t.id).map((c) => `<span class="chip">${c.grade}학년 ${c.class_no}반<button data-act="delClass" data-v="${t.id}|${c.grade}|${c.class_no}" aria-label="${c.grade}학년 ${c.class_no}반 빼기">×</button></span>`).join('');
    const perm = (k, label) => `<label class="check"><input type="checkbox" data-perm="${k}" data-teacher="${t.id}" ${t[k] ? 'checked' : ''}><span>${label}</span></label>`;
    return `<tr><td class="strong">${esc(t.name)}</td><td>${esc(t.login_id)}</td><td><div class="chips">${chips || '<span class="muted small">담당 반 없음</span>'}</div>
      <div class="class-add"><select id="g-${t.id}" aria-label="학년">${numberOptions(3, '학년')}</select><select id="c-${t.id}" aria-label="반">${numberOptions(20, '반')}</select><button class="btn btn-sm" data-act="addClass" data-v="${t.id}">추가</button></div></td>
      <td>${perm('can_view_all', '전체 반 보기')}</td><td>${perm('can_edit', '내용 수정')}</td><td>${perm('can_approve', '최종 승인')}</td></tr>`;
  }).join('');
  return `<section class="card"><h2>담임·권한 관리</h2><p class="small muted">최고 관리자만 보입니다. 담임은 담당 반 학생의 이력서만 볼 수 있습니다. 학생 가입 승인은 모든 선생님이 할 수 있습니다. 새 선생님은 교사 인증 코드로 가입한 뒤 여기에 나타납니다.</p>
    <div class="table-scroll"><table class="data"><thead><tr><th>이름</th><th>아이디</th><th>담당 반</th><th colspan="3">권한</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function viewTeacher() {
  const rows = studentRows();
  const count = (k) => rows.filter((x) => x.key === k).length;
  const q = state.search.trim().toLowerCase();
  const classKey = (s) => (s.grade ? `${s.grade}-${s.class_no}` : 'none');
  const classes = [...new Map(rows.map((x) => [classKey(x.s), x.s.grade ? `${x.s.grade}학년 ${x.s.class_no}반` : '반 미지정'])).entries()];
  const inClass = (x) => !state.classFilter || classKey(x.s) === state.classFilter;
  const match = (x) => inClass(x) && (state.filter === 'all' || x.key === state.filter || (state.filter === 'writing' && ['none', 'coWriting'].includes(x.key)) || (state.filter === 'review' && x.key === 'coReview'));
  const list = rows.filter((x) => match(x) && (!q || x.s.name.toLowerCase().includes(q) || x.s.login_id.includes(q)));
  const stat = (k, n, label) => `<button class="stat" style="text-align:left;cursor:pointer;${state.filter === k ? 'border-color:var(--brand)' : ''}" data-act="filter" data-v="${k}"><b>${n}</b><span>${label}</span></button>`;
  const item = (x) => `<tr><td class="nowrap">${isOwner() ? `<button class="btn-link" data-act="editClass" data-v="${x.s.id}">${classLabel(x.s)}</button>` : classLabel(x.s)}</td><td>${esc(x.s.login_id)}</td><td class="strong">${esc(x.s.name)}</td><td>${esc(x.doc?.major || x.s.dept)}</td><td><span class="badge ${BADGE[x.key]}">${statusText(x)}</span></td>
    <td class="pct"><div class="progress"><i style="width:${x.pct}%"></i></div><span>${x.pct}%</span></td><td class="num">${x.doc ? `${x.lack.length}개` : '-'}</td><td class="num">${x.fb ? `<span class="badge ${x.fbDone === x.fb ? 'ok' : 'warn'}">${x.fbDone}/${x.fb} 응답</span>` : '-'}</td><td class="nowrap">${companyCell(x.s.id)}</td><td class="nowrap">${when(x.updated)}</td><td class="nowrap">${x.approved ? when(x.approved) : '-'}</td>
    <td class="nowrap">${x.s.status === 'approved' ? `${x.approved ? `<a class="btn btn-primary btn-sm" href="admin.html?resume=${x.s.id}" target="_blank" rel="noopener">완성본 보기</a> ` : ''}<button class="btn btn-soft btn-sm" data-act="openStudent" data-v="${x.s.id}">열기</button>` : `<button class="btn btn-primary btn-sm" data-act="approve" data-v="${x.s.id}">승인</button>${x.key === 'pending' ? ` <button class="btn btn-sm" data-act="reject" data-v="${x.s.id}">거절</button>` : ''}`}${isOwner() ? ` <button class="btn btn-sm btn-danger" data-act="delRow" data-v="${x.s.id}">삭제</button>` : ''}</td></tr>`;
  return shell(`<div class="head"><div><h1>학생 이력서 관리</h1><p class="muted small">${esc(state.profile.name)} 선생님${isOwner() ? ' · 최고 관리자' : ''}</p></div><div class="row">${isOwner() ? '<button class="btn btn-sm" data-act="openDepts">학과 관리</button>' : ''}<button class="btn btn-sm" data-act="excel">엑셀 다운로드</button><button class="btn btn-sm" data-act="refresh">새로고침</button></div></div>
    <div class="stats">${stat('all', rows.length, '전체 학생')}${stat('pending', count('pending'), '가입 승인 대기')}${stat('writing', count('writing') + count('none') + count('coWriting'), '작성 중·시작 전')}${stat('review', count('review') + count('coReview'), '첨삭 요청')}${stat('done', count('done'), '완성')}</div>
    <section class="card"><h2>학생에게 주소 공유</h2><div class="share"><div id="shareQr"></div><div class="share-info"><p class="small muted">학생에게 이 주소를 보내거나 QR 코드를 보여 주세요. 학생용 로그인 화면이 열립니다.</p><input id="shareUrl" readonly value="${esc(studentUrl())}" aria-label="학생용 주소"><div class="row"><button class="btn btn-primary btn-sm" data-act="copyUrl">주소 복사</button><button class="btn btn-sm" data-act="saveQr">QR 이미지 저장</button></div></div></div></section>
    <section class="card"><div class="form-grid"><div class="field"><label for="search">이름 또는 학번 검색</label><input id="search" value="${esc(state.search)}"></div><div class="field"><label for="classFilter">반</label><select id="classFilter"><option value="">전체</option>${classes.map(([k, l]) => `<option value="${k}" ${state.classFilter === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div><div class="table-scroll"><table class="data"><thead><tr><th>반·번호</th><th>학번</th><th>이름</th><th>학과</th><th>상태</th><th>진행률</th><th>미입력</th><th>피드백</th><th>추가 자기소개서</th><th>최근 저장</th><th>승인일</th><th>관리</th></tr></thead><tbody>${list.map(item).join('') || '<tr><td colspan="12" class="muted">해당하는 학생이 없습니다.</td></tr>'}</tbody></table></div></section>
    ${isOwner() ? schoolCard() : ''}${myInfoCard()}${isOwner() ? ownerCard() : ''}<section class="card"><div class="row between"><h2>텔레그램 알림</h2><span id="tgState">${tgLabel()}</span></div>
      <div id="tgBox">${tgBoxHTML()}</div></section>`);
}

function render() {
  const view = { auth: viewAuth, pending: viewPending, editor: viewEditor, teacher: viewTeacher, depts: viewDepts }[state.view]();
  const y = window.scrollY;
  $('#app').innerHTML = view;
  $('#app').className = state.view === 'teacher' ? 'wide' : '';
  if (state.view === 'teacher') drawShareQr();
  document.body.classList.toggle('no-print', !(state.view === 'editor' && canOutput()));
  if (state.view === 'editor') { showSave(state.saveState); if (state.tab === 'preview' || state.tab === 'output') renderPreview(); else { applyDateLimits(); applyLocks(); } }
  window.scrollTo(0, y);
}

function passwordModal(title, onSubmit) {
  $('#modal').innerHTML = `<div class="modal-back"><form class="modal-box" id="pwForm"><h2 style="font-size:1.125rem">${esc(title)}</h2>
    <div class="field"><label for="pw1">새 비밀번호 (8자 이상)</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-act="closeModal">취소</button><button class="btn btn-primary" type="submit">변경</button></div></form></div>`;
  state.pwSubmit = onSubmit;
  $('#pw1').focus();
}

const ACT = {
  authTab: (v) => { state.authTab = v; render(); },
  tab: async (v) => { if (state.dirty) await save(); state.tab = v; render(); window.scrollTo(0, 0); },
  logout: async () => { if (state.dirty) await save(); await sb.auth.signOut(); state.profile = null; state.view = 'auth'; state.authTab = 'login'; render(); },
  reload: () => boot(),
  password: () => passwordModal('비밀번호 변경', async (pw) => { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; toast('비밀번호를 변경했습니다.'); }),
  findAddr: () => {
    if (!isTeacher() && state.resume.status !== 'draft') return;
    if (!window.daum?.Postcode) { toast('주소 검색을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
    $('#modal').innerHTML = '<div class="modal-back"><div class="modal-box"><div class="row between"><h2 style="font-size:1.125rem">주소 검색</h2><button class="btn btn-sm" data-act="closeModal">닫기</button></div><div id="postcode"></div></div></div>';
    new daum.Postcode({
      width: '100%', height: '100%',
      oncomplete: (r) => {
        state.doc.addressBase = r.roadAddress || r.jibunAddress || r.address;
        syncAddress(state.doc);
        $('#modal').innerHTML = '';
        $('#i-addressBase').value = state.doc.addressBase;
        $('#i-addressDetail').focus();
        queueSave();
      },
    }).embed($('#postcode'));
  },
  closeModal: () => { $('#modal').innerHTML = ''; },
  rowAdd: (v) => {
    const [key, where] = v.split('|');
    const rows = state.doc[key];
    if (rows.length >= MAX_ROWS) return;
    if (where === 'top') rows.unshift(blankRow(key)); else rows.push(blankRow(key));
    render(); refreshGuide(); queueSave();
    document.getElementById(`i-${key}.${where === 'top' ? 0 : rows.length - 1}.${ROWS[key].date}`)?.focus();
  },
  rowDel: (v) => {
    const [key, i] = v.split('|');
    const rows = state.doc[key];
    if (!rowEmpty(rows[+i]) && !confirm('이 줄의 내용을 삭제할까요?')) return;
    rows.splice(+i, 1);
    if (!rows.length) rows.push(blankRow(key));
    render(); queueSave();
  },
  rowSort: (key) => {
    const { date } = ROWS[key];
    state.doc[key].sort((x, y) => toIso(y[date]).localeCompare(toIso(x[date])));
    render(); queueSave();
  },
  saveSchool: async () => {
    const from = $('#schoolFrom').value; const to = $('#schoolTo').value;
    if (!from || !to || from > to) { toast('재학 시작일과 종료일을 확인해 주세요.'); return; }
    const row = { id: true, edu_period: `${fromIso(from)}~${fromIso(to)}`, grad_status: $('#schoolGrad').value, updated_at: new Date().toISOString() };
    const { error } = await sb.from('resume_school_info').upsert(row);
    if (error) { toast('저장하지 못했습니다.'); return; }
    state.school = row; toast('학교 학력 설정을 저장했습니다.');
  },
  print: async () => { if (!canOutput()) return; if (state.dirty) await save(); renderPaper(); await document.fonts.ready; window.print(); },
  pdf: async () => { if (!canOutput()) return; if (state.dirty) await save(); await downloadPdf(); },
  submit: async () => {
    const list = missing(state.doc, !!state.photoUrl);
    if (list.length) { toast(`먼저 입력해 주세요: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` 외 ${list.length - 3}개` : ''}`); return; }
    const round = state.resume.round || 1;
    if (round >= 2 && unanswered().length) { state.tab = 'review'; render(); window.scrollTo(0, 0); toast(`피드백 ${unanswered().length}건에 먼저 답해 주세요. 수정했어요 또는 그대로 둘게요를 고르세요.`); return; }
    if (!confirm(`${round}차 첨삭을 요청할까요? 선생님이 피드백을 보내기 전까지는 수정할 수 없습니다.`)) return;
    if (!(await save())) return;
    try {
      await api({ action: 'submit' });
      await openResume(state.owner);
      state.tab = 'preview'; render(); window.scrollTo(0, 0);
      toast(`${round}차 첨삭을 요청했습니다. 선생님께 알림을 보냈습니다.`);
    } catch (e) { toast(e.message); }
  },
  version: (v) => { state.versionView = v && !(state.resume.status !== 'approved' && +v === (state.resume.round || 1)) ? +v : null; render(); window.scrollTo(0, 0); },
  review: async (kind) => {
    const r = state.resume;
    if (state.dirty && !(await save())) return;
    const round = state.resume.round || 1;
    const unsent = state.feedbacks.filter((f) => !f.sent_at);
    const asks = {
      next: unsent.length ? `피드백 ${unsent.length}건을 학생에게 전송하고 ${round + 1}차 수정으로 넘길까요?` : `작성한 피드백이 없습니다. 피드백 없이 ${round + 1}차 수정으로 넘길까요?`,
      approve: `최종 승인할까요? 학생이 프린트와 다운로드를 할 수 있게 됩니다.${unsent.length ? `\n전송하지 않은 피드백 ${unsent.length}건은 학생에게 보이지 않습니다.` : ''}`,
      reopen: '최종 승인을 취소할까요? 학생의 프린트와 다운로드가 다시 막힙니다.',
    };
    if (!confirm(asks[kind])) return;
    if (kind === 'next' && unsent.length) {
      const sent = await sb.from('resume_feedbacks').update({ sent_at: new Date().toISOString() }).eq('student_id', r.user_id).is('sent_at', null);
      if (sent.error) { toast('피드백을 전송하지 못했습니다. 다시 시도해 주세요.'); return; }
      await loadFeedbacks();
    }
    const patch = { next: { status: 'draft', round: round + 1 }, approve: { status: 'approved', approved_at: new Date().toISOString() }, reopen: { status: 'draft', approved_at: null } }[kind];
    const { data, error } = await sb.from('resumes').update(patch).eq('user_id', r.user_id).eq('version', state.resume.version).select().maybeSingle();
    if (error || !data) { toast('처리하지 못했습니다. 새로고침 후 다시 시도해 주세요.'); return; }
    state.resume = data; state.versionView = null; if (state.tab === 'output') state.tab = 'edit'; render();
    toast({ next: '피드백을 전송했습니다.', approve: '최종 승인했습니다.', reopen: '최종 승인을 취소했습니다.' }[kind]);
  },
  back: async () => { if (state.dirty) await save(); state.search = ''; await loadTeacher(); },
  refresh: () => loadTeacher(),
  excel: () => downloadExcel(),
  openDepts: async () => { await loadDepts(); state.view = 'depts'; render(); window.scrollTo(0, 0); },
  delDept: async (id) => {
    const d = state.depts.find((x) => String(x.id) === String(id));
    if (!confirm(`${d.name} 학과를 목록에서 삭제할까요? 이미 가입한 학생의 학과는 그대로입니다.`)) return;
    const { error } = await sb.from('resume_departments').delete().eq('id', id);
    if (error) { toast('삭제하지 못했습니다.'); return; }
    await loadDepts(); render();
  },
  coList: (id) => {
    const rows = (state.coRows || []).filter((c) => c.user_id === id);
    const s = state.students.find((x) => x.id === id);
    $('#modal').innerHTML = `<div class="modal-back"><div class="modal-box"><div class="row between"><h2 style="font-size:1.125rem">${esc(s.name)} 추가 자기소개서</h2><button class="btn btn-sm" data-act="closeModal">닫기</button></div>
      <div class="co-list">${rows.map((c) => `<button class="co-item" data-act="coOpen" data-v="${id}|${c.id}"><b>${esc(c.company)}</b><span class="small muted">${esc(c.applyField || '지원분야 기본')}</span><span class="badge ${COMPANY_STATUS[c.status][1]}">${COMPANY_STATUS[c.status][0]}</span></button>`).join('')}</div></div></div>`;
  },
  coOpen: async (v) => {
    const [id, company] = v.split('|');
    $('#modal').innerHTML = '';
    await openResume(state.students.find((x) => x.id === id));
    state.tab = 'companies'; state.companyId = company; render(); window.scrollTo(0, 0);
  },
  coAdd: async () => {
    const company = $('#newCompany').value.trim();
    if (!company) { toast('회사명을 입력해 주세요.'); return; }
    const { data, error } = await sb.from('resume_companies').insert({ user_id: state.owner.id, company, intro: { ...state.doc.intro, applyField: state.doc.applyField } }).select().single();
    if (error) { toast('추가하지 못했습니다.'); return; }
    state.companyId = data.id; await loadCompanies(); render(); toast('추가 자기소개서를 만들었습니다.');
  },
  coSelect: (id) => { state.companyId = state.companyId === id ? null : id; render(); },
  coRequest: async () => {
    clearTimeout(state.coTimer); await saveCompany();
    if (!confirm('첨삭을 요청할까요? 선생님이 돌려주기 전까지는 수정할 수 없습니다.')) return;
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/resume-company`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id: state.companyId }) });
    if (!r.ok) { toast('첨삭을 요청하지 못했습니다.'); return; }
    await loadCompanies(); render(); toast('첨삭을 요청했습니다.');
  },
  coDelete: async () => {
    const c = state.companies.find((x) => x.id === state.companyId);
    if (!confirm(`${c.company} 자기소개서를 삭제할까요?`)) return;
    await sb.from('resume_companies').delete().eq('id', c.id);
    state.companyId = null; await loadCompanies(); render();
  },
  coFeedback: () => {
    const feedback = $('#coNote').value.trim();
    if (!feedback) { toast('피드백을 입력해 주세요.'); return; }
    setCompany(state.companyId, { feedback, status: 'draft' }, '피드백을 전송했습니다.');
  },
  coReview: async (status) => {
    if (!confirm(status === 'approved' ? '이 추가 자기소개서를 승인할까요?' : '승인을 취소할까요?')) return;
    clearTimeout(state.coTimer); await saveCompany();
    setCompany(state.companyId, { status, approved_at: status === 'approved' ? new Date().toISOString() : null }, status === 'approved' ? '승인했습니다.' : '승인을 취소했습니다.');
  },
  savePhone: async () => {
    const phone = $('#myPhone').value.trim();
    const { error } = await sb.rpc('resume_set_my_phone', { phone });
    if (error) { toast('번호를 확인해 주세요.'); return; }
    state.profile.school_phone = phone; render(); paintTg(); toast('학교 전화번호를 저장했습니다.');
  },
  addClass: async (id) => {
    const grade = +$(`#g-${id}`).value; const classNo = +$(`#c-${id}`).value;
    if (!grade || !classNo) { toast('학년과 반을 선택해 주세요.'); return; }
    const { error } = await sb.from('resume_teacher_classes').insert({ teacher_id: id, grade, class_no: classNo });
    if (error) { toast('이미 지정된 반이거나 저장하지 못했습니다.'); return; }
    await loadTeacher();
  },
  delClass: async (v) => {
    const [id, grade, classNo] = v.split('|');
    await sb.from('resume_teacher_classes').delete().eq('teacher_id', id).eq('grade', grade).eq('class_no', classNo);
    await loadTeacher();
  },
  editClass: (id) => {
    const s = state.students.find((x) => x.id === id);
    $('#modal').innerHTML = `<div class="modal-back"><form class="modal-box" id="classForm" data-id="${id}"><h2 style="font-size:1.125rem">학생 정보 변경</h2><div class="field"><label for="f-name">이름</label><input id="f-name" name="name" value="${esc(s.name)}" maxlength="30" required></div>${deptField(s.dept)}${classFields(s)}<div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-act="closeModal">취소</button><button class="btn btn-primary" type="submit">저장</button></div></form></div>`;
  },
  copyUrl: async () => {
    const input = $('#shareUrl');
    try { await navigator.clipboard.writeText(input.value); } catch (_e) { input.select(); document.execCommand('copy'); }
    toast('학생용 주소를 복사했습니다.');
  },
  saveQr: () => {
    const canvas = $('#shareQr canvas');
    if (!canvas) { toast('QR 코드를 불러오지 못했습니다.'); return; }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = '이력서_학생용_QR.png';
    link.click();
  },
  filter: (v) => { state.filter = v; render(); },
  openStudent: (id) => openResume(state.students.find((s) => s.id === id)),
  approve: async (id) => { const { error } = await sb.rpc('resume_decide_student', { student: id, decision: 'approved' }); await loadTeacher(); toast(error ? '승인하지 못했습니다.' : '승인했습니다.'); },
  reject: async (id) => { if (!confirm('가입을 거절할까요?')) return; const { error } = await sb.rpc('resume_decide_student', { student: id, decision: 'rejected' }); if (error) toast('처리하지 못했습니다.'); await loadTeacher(); },
  fbChoice: async (v) => {
    if (state.dirty) await save();
    const [id, response] = v.split(':');
    const { error } = await sb.from('resume_feedbacks').update({ response: response || null, done_at: response ? new Date().toISOString() : null }).eq('id', id);
    if (error) { toast('저장하지 못했습니다. 다시 시도해 주세요.'); return; }
    await loadFeedbacks(); refreshFb();
    const n = $('#fbNotice'); if (n) n.innerHTML = fbNoticeHTML();
  },
  delFb: async (id) => { await sb.from('resume_feedbacks').delete().eq('id', id); await loadFeedbacks(); refreshFb(); },
  resetPw: () => passwordModal(`${state.owner.name} 비밀번호 초기화`, async (pw) => { await api({ action: 'reset_password', user_id: state.owner.id, password: pw }); toast('비밀번호를 초기화했습니다. 학생에게 전달해 주세요.'); }),
  delRow: async (id) => {
    const s = state.students.find((x) => x.id === id);
    if (!confirm(`${classLabel(s)} ${s.name} 학생의 계정, 이력서, 사진을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
    try { await api({ action: 'delete_student', user_id: id }); toast('삭제했습니다.'); await loadTeacher(); } catch (e) { toast(e.message); }
  },
  delStudent: async () => {
    if (!confirm(`${state.owner.name} 학생의 계정, 이력서, 사진을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
    try { await api({ action: 'delete_student', user_id: state.owner.id }); toast('삭제했습니다.'); await loadTeacher(); } catch (e) { toast(e.message); }
  },
  tgSave: async () => { try { const r = await api({ action: 'telegram_save', token: $('#tgToken').value }); state.tg = { hasToken: true, hasChat: false, username: r.username }; paintTg(); toast('토큰을 저장했습니다.'); } catch (e) { toast(e.message); } },
  tgConnect: async () => { try { const r = await api({ action: 'telegram_connect' }); toast(r.ok ? '연결했습니다. 텔레그램을 확인해 주세요.' : '메시지를 보내지 못했습니다.'); if (r.ok) { state.tg = { ...state.tg, hasChat: true }; paintTg(); } } catch (e) { toast(e.message); } },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el.dataset.v); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'search') { state.search = t.value; const pos = t.selectionStart; render(); const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos); return; }
  if (t.dataset.co || t.dataset.coCompany !== undefined) {
    const c = state.companies.find((x) => x.id === state.companyId);
    if (t.dataset.co) c.intro = { ...c.intro, [t.dataset.co]: t.value }; else c.company = t.value;
    queueCompanySave();
    return;
  }
  if (t.dataset.range) {
    const parts = String(getPath(t.dataset.range) || '').split('~');
    parts[+t.dataset.i] = fromIso(t.value);
    setPath(t.dataset.range, parts[0] || parts[1] ? `${parts[0] || ''}~${parts[1] || ''}` : '');
    queueSave();
    return;
  }
  if (!t.dataset.path) return;
  if (t.dataset.phone) t.value = formatMobile(t.value);
  if (CHECKS[t.dataset.path]?.[0](t.value)) document.querySelector(`[data-err="${t.dataset.path}"]`).hidden = true;
  setPath(t.dataset.path, t.dataset.date ? fromIso(t.value) : t.value);
  if (t.dataset.path === 'addressDetail') syncAddress(state.doc);
  if (t.dataset.date) applyDateLimits();
  refreshGuide();
  const c = document.querySelector(`[data-count="${t.dataset.path}"]`);
  if (c) c.textContent = `${t.value.length} / ${INTRO_MAX}자`;
  queueSave();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'photoInput' && t.files[0]) uploadPhoto(t.files[0]);
  if (['f-grade', 'f-class', 'f-number'].includes(t.id) && $('#autoId')) {
    const g = $('#f-grade').value; const c = $('#f-class').value; const n = $('#f-number').value;
    $('#autoId').innerHTML = g && c && n ? `내 학번은 <b>${makeStudentId(g, c, n)}</b>입니다. 로그인할 때 이 번호를 사용하세요.` : '학년, 반, 번호를 고르면 학번이 만들어집니다.';
  }
  if (t.dataset.dept) {
    sb.from('resume_departments').update({ name: t.value.trim() }).eq('id', t.dataset.dept).then(({ error }) => { toast(error ? '저장하지 못했습니다. 같은 이름이 있는지 확인해 주세요.' : '저장했습니다.'); return loadDepts(); });
    return;
  }
  if (t.id === 'outChoice') { state.outputCompany = t.value; render(); return; }
  if (t.id === 'classFilter') { state.classFilter = t.value; render(); return; }
  if (t.dataset.perm) {
    sb.from('resume_profiles').update({ [t.dataset.perm]: t.checked }).eq('id', t.dataset.teacher).then(({ error }) => { toast(error ? '권한을 저장하지 못했습니다.' : '권한을 저장했습니다.'); return loadTeacher(); });
    return;
  }
  const check = CHECKS[t.dataset.path];
  if (check) document.querySelector(`[data-err="${t.dataset.path}"]`).hidden = !t.value || check[0](t.value);
});
document.addEventListener('focusin', (e) => {
  if (e.target.dataset.phone && !e.target.value && !e.target.disabled) e.target.value = '010-';
});
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t.dataset.phone && t.value === '010-') t.value = '';
  // 달력을 쓰지 않고 직접 입력한 날짜도 최신순을 어기면 지운다
  if (t.dataset.date && t.value && ((t.max && t.value > t.max) || (t.min && t.value < t.min))) {
    const late = t.max && t.value > t.max;
    toast(late ? `${fromIso(t.max)} 이후 날짜는 입력할 수 없습니다. 최신 내용이 위로 오도록 적어 주세요.` : `${fromIso(t.min)} 이전 날짜는 입력할 수 없습니다. 최신 내용이 위로 오도록 적어 주세요.`);
    t.value = '';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'authForm') {
    const v = Object.fromEntries(new FormData(f));
    const err = $('#authErr'); err.hidden = true; state.authMsg = '';
    if (!window.ADMIN_PAGE && state.authTab === 'signup' && state.depts?.length && !v.dept) { err.textContent = '학과를 선택해 주세요.'; err.hidden = false; return; }
    if (!window.ADMIN_PAGE && state.authTab === 'signup' && !(v.grade && v.class_no && v.number)) { err.textContent = '학년, 반, 번호를 모두 선택해 주세요.'; err.hidden = false; return; }
    if (window.ADMIN_PAGE && state.authTab === 'signup' && !String(v.teacher_code || '').trim()) { err.textContent = '교사 인증 코드를 입력해 주세요.'; err.hidden = false; return; }
    if (window.ADMIN_PAGE && state.authTab === 'signup' && String(v.school_phone || '').trim().length < 7) { err.textContent = '학교 전화번호를 입력해 주세요.'; err.hidden = false; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const autoStudent = !window.ADMIN_PAGE && state.authTab === 'signup';
    const login = autoStudent ? makeStudentId(v.grade, v.class_no, v.number) : String(v.login_id || '').trim().toLowerCase();
    try {
      if (state.authTab === 'signup') await api({ action: 'signup', ...v, login_id: login });
      const { error } = await sb.auth.signInWithPassword({ email: `${login}@resume.example.com`, password: v.password });
      if (error) throw new Error('학번(아이디) 또는 비밀번호가 맞지 않습니다.');
      if (v.school_phone) await sb.rpc('resume_set_my_phone', { phone: v.school_phone });
      await boot();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  }
  if (f.id === 'deptForm') {
    const name = $('#newDept').value.trim();
    if (!name) return;
    const { error } = await sb.from('resume_departments').insert({ name, sort_order: (state.depts?.length || 0) + 1 });
    if (error) { toast('추가하지 못했습니다. 같은 이름이 있는지 확인해 주세요.'); return; }
    await loadDepts(); render();
  }
  if (f.id === 'classForm') {
    const v = Object.fromEntries(new FormData(f));
    if (!v.name.trim() || !(v.grade && v.class_no && v.number)) { toast('이름, 학년, 반, 번호를 모두 입력해 주세요.'); return; }
    const { error } = await sb.from('resume_profiles').update({ name: v.name.trim(), dept: v.dept || '', grade: +v.grade, class_no: +v.class_no, number: +v.number }).eq('id', f.dataset.id);
    if (error) { toast('저장하지 못했습니다.'); return; }
    $('#modal').innerHTML = ''; await loadTeacher();
  }
  if (f.id === 'pwForm') {
    try { await state.pwSubmit($('#pw1').value); $('#modal').innerHTML = ''; } catch (_e) { toast('비밀번호를 변경하지 못했습니다.'); }
  }
  if (f.classList.contains('fbForm')) {
    const body = new FormData(f).get('body').trim();
    if (!body) return;
    const { error } = await sb.from('resume_feedbacks').insert({ student_id: state.owner.id, teacher_id: state.profile.id, section: f.dataset.section, round: state.resume.round || 1, sent_at: null, body, snapshot: sectionValues(f.dataset.section, state.doc) });
    if (error) { toast('피드백을 등록하지 못했습니다.'); return; }
    f.reset();
    await loadFeedbacks(); refreshFb(); toast('등록했습니다. 피드백 전송을 누르면 학생에게 보입니다.');
  }
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });
window.addEventListener('resize', () => { if (state.view === 'editor' && state.tab === 'preview') renderPreview(); });
window.addEventListener('focus', () => {
  if (state.view === 'teacher' && !$('#modal').innerHTML && document.activeElement?.id !== 'tgToken') loadTeacher();
  if (state.view === 'editor') loadFeedbacks().then(refreshFb);
});

async function loadDepts() {
  const { data } = await sb.from('resume_departments').select().order('sort_order').order('name');
  state.depts = data || [];
}
async function loadSchool() {
  const { data } = await sb.from('resume_school_info').select().maybeSingle();
  state.school = data || null;
}
async function boot() {
  await loadDepts();
  await loadSchool();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { state.view = 'auth'; render(); return; }
  const { data: profile } = await sb.from('resume_profiles').select().eq('id', session.user.id).maybeSingle();
  if (!profile) { await sb.auth.signOut(); state.view = 'auth'; render(); return; }
  // 학생 계정은 교사 페이지에 머물 수 없고, 교사 계정은 교사 페이지로 보낸다
  if (window.ADMIN_PAGE && profile.role !== 'teacher') {
    await sb.auth.signOut();
    state.authMsg = '교사 계정만 들어올 수 있습니다.'; state.authTab = 'login'; state.view = 'auth'; render(); return;
  }
  if (!window.ADMIN_PAGE && profile.role === 'teacher') { location.replace('admin.html'); return; }
  state.profile = profile;
  if (profile.status !== 'approved') { state.view = 'pending'; render(); return; }
  const direct = profile.role === 'teacher' && new URLSearchParams(location.search).get('resume');
  if (direct) {
    const { data: owner } = await sb.from('resume_profiles').select().eq('id', direct).maybeSingle();
    if (owner) {
      await openResume(owner);
      if (state.resume?.status === 'approved') { state.tab = 'output'; render(); }
      return;
    }
  }
  if (profile.role === 'teacher') await loadTeacher();
  else await openResume(profile);
}
boot();
