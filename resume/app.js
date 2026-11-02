const SUPABASE_URL = 'https://prsldqlwyohsqmzzuiji.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rk7hTt2bKuzbFRm0J8ozJw_qx4xQdqf';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'resume-auth' } });

const VERSION = '1.8';
const INTRO_MAX = 600;
const INTRO = [['growth', '성장 과정'], ['personality', '성격의 장·단점'], ['school', '학창시절 및 사회경험'], ['motivation', '지원동기 및 입사 후 포부']];
const SECTIONS = ['전체', '기본 정보', '학력', '자격 및 면허', '수상 및 활동', '경력 사항', '동아리·봉사', ...INTRO.map((x) => x[1]), '제출 정보'];
const REQUIRED = [['applyField', '지원분야'], ['name', '성명'], ['birth', '생년월일'], ['mobile', '휴대번호'], ['address', '주소'], ['email', 'E-mail'], ['major', '전공분야']];

const $ = (s) => document.querySelector(s);
const state = {
  profile: null, view: 'auth', authTab: 'login', tab: 'edit',
  doc: null, resume: null, owner: null, feedbacks: [], photoUrl: '', saveState: '', timer: null, saving: false, dirty: false,
  students: [], resumes: [], filter: 'all', search: '', tg: null,
};
const isTeacher = () => state.profile?.role === 'teacher';
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

const syncAddress = (d) => { d.address = [d.addressBase, d.addressDetail].map((x) => String(x || '').trim()).filter(Boolean).join(' '); };

/* 진행률 */
function missing(d, hasPhoto) {
  const list = REQUIRED.filter(([k]) => !String(d[k] || '').trim()).map((x) => x[1]);
  if (d.address && !String(d.addressDetail || '').trim()) list.push('상세 주소');
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
      <div class="field"><label for="f-id">${teacher ? '아이디' : '학번'}</label><input id="f-id" name="login_id" autocomplete="username" autocapitalize="none" required></div>
      ${signup ? `<div class="field"><label for="f-name">이름</label><input id="f-name" name="name" autocomplete="name" required></div>
      ${teacher ? `<div class="field"><label for="f-code">교사 인증 코드</label><input id="f-code" name="teacher_code" autocomplete="off" required></div>` : `<div class="field"><label for="f-dept">학과</label><input id="f-dept" name="dept"></div>`}` : ''}
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
  <input id="i-${path}" data-path="${path}" value="${esc(opts.date ? toIso(getPath(path)) : getPath(path))}" type="${opts.date ? 'date' : opts.type || 'text'}" ${opts.date ? 'data-date="1"' : ''}></div>`;
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
const SCALARS = {
  '기본 정보': [['applyField', '지원분야'], ['name', '성명'], ['birth', '생년월일'], ['mobile', '휴대번호'], ['addressBase', '주소'], ['addressDetail', '상세주소'], ['homePhone', '집 번호'], ['email', 'E-mail']],
  학력: [['eduPeriod', '재학기간'], ['eduSchool', '학교명'], ['edu2Period', '원적교 재학기간'], ['edu2School', '원적교'], ['major', '전공분야'], ['gradStatus', '졸업여부']],
  '제출 정보': [['company', '회사명'], ['writeDate', '작성일']],
};
const LISTS = {
  '자격 및 면허': ['licenses', [['date', '취득일'], ['name', '자격 및 면허증 명'], ['org', '발급기관']]],
  '수상 및 활동': ['awards', [['from', '시작'], ['to', '종료'], ['text', '내용'], ['org', '기관']]],
  '경력 사항': ['careers', [['from', '시작'], ['to', '종료'], ['place', '근무처'], ['rank', '직급'], ['desc', '업무내용']]],
  '동아리·봉사': ['clubs', [['from', '시작'], ['to', '종료'], ['name', '활동명'], ['desc', '내용']]],
};
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
  const now = sectionValues(f.section, state.doc);
  const keys = Object.keys(now).filter((k) => String(f.snapshot[k] ?? '').trim() !== now[k].trim());
  if (!keys.length) return '<p class="hint">피드백 이후 바뀐 내용이 없습니다.</p>';
  return `<div class="changes"><b class="small">피드백 이후 수정된 곳 ${keys.length}개</b>${keys.map((k) => `<div class="change"><span class="small">${esc(k)}</span><del>${esc(f.snapshot[k] ?? '') || '(빈칸)'}</del><ins>${esc(now[k]) || '(빈칸)'}</ins></div>`).join('')}</div>`;
}
function fbList(section) {
  // 지금 없는 항목 이름으로 남은 피드백은 맨 위 '전체'에 모아 보여 준다
  const items = state.feedbacks.filter((f) => f.section === section || (section === '전체' && !SECTIONS.includes(f.section)));
  return items.map((f) => {
    const status = isTeacher()
      ? `<div class="row between">${f.done_at ? `<span class="badge ok">학생 수정 완료 ${when(f.done_at)}</span>` : '<span class="badge warn">학생 미확인</span>'}<button class="btn-link" data-act="delFb" data-v="${f.id}">삭제</button></div>`
      : (f.done_at ? `<div class="row"><span class="badge ok">수정 완료 ${when(f.done_at)}</span><button class="btn-link" data-act="fbDone" data-v="${f.id}">취소</button></div>` : `<div><button class="btn btn-primary btn-sm" data-act="fbDone" data-v="${f.id}">수정했어요</button></div>`);
    return `<article class="fb"><div class="row between"><b class="small">${f.round ? `${f.round}차 ` : ''}선생님 피드백</b><span class="hint">${when(f.created_at)}</span></div><p>${esc(f.body)}</p>${changesHTML(f)}${status}</article>`;
  }).join('');
}
function fbBlock(section) {
  const write = isTeacher() ? `<details class="fb-write"><summary>피드백 쓰기</summary><form class="fbForm" data-section="${esc(section)}"><div class="field"><textarea name="body" maxlength="2000" required aria-label="${esc(section)} 피드백"></textarea></div><button class="btn btn-primary btn-sm" type="submit">등록</button></form></details>` : '';
  return `<div class="fb-block"><div class="fb-list" data-fb="${esc(section)}">${fbList(section)}</div>${write}</div>`;
}
function refreshFb() {
  document.querySelectorAll('[data-fb]').forEach((el) => { el.innerHTML = fbList(el.dataset.fb); });
}

function editForm() {
  const d = state.doc;
  return `${isTeacher() || state.feedbacks.some((f) => f.section === '전체' || !SECTIONS.includes(f.section)) ? `<section class="card"><h2>이력서 전체</h2>${fbBlock('전체')}</section>` : ''}
  <section class="card"><h2>기본 정보</h2>
    <div class="photo-box"><div class="photo ${state.photoUrl ? 'has' : ''}" style="${state.photoUrl ? `background-image:url('${state.photoUrl}')` : ''}">${state.photoUrl ? '' : '3×4<br>증명사진'}</div>
      <div style="display:grid;gap:6px"><label class="btn btn-soft" for="photoInput">사진 ${state.photoUrl ? '바꾸기' : '올리기'}</label><input id="photoInput" type="file" accept="image/*" hidden><span class="hint">자동으로 3:4 비율에 맞춰 잘립니다.</span></div></div>
    <div class="form-grid">
      ${input('applyField', '지원분야', { req: 1 })}${input('name', '성명', { req: 1 })}
      ${input('birth', '생년월일', { req: 1, ...DATE })}${input('mobile', '휴대번호', { req: 1, type: 'tel' })}
      <div class="field full"><label for="i-addressBase">주소 <span class="req">*</span></label><div class="addr-row"><input id="i-addressBase" value="${esc(d.addressBase)}" readonly data-act="findAddr"><button class="btn btn-soft" type="button" data-act="findAddr">주소 검색</button></div></div>
      ${input('addressDetail', '상세주소', { req: 1, cls: 'full' })}
      ${input('homePhone', '집 번호', { type: 'tel' })}${input('email', 'E-mail', { req: 1, type: 'email' })}
    </div>${fbBlock('기본 정보')}</section>
  <section class="card"><h2>학력</h2><div class="form-grid">
    ${rangeInput('eduPeriod', '재학기간')}${input('eduSchool', '학교명', { cls: 'full' })}
    ${rangeInput('edu2Period', '원적교 재학기간')}${input('edu2School', '원적교', { cls: 'full' })}
    ${input('major', '전공분야(학과명)', { req: 1 })}${input('gradStatus', '졸업여부')}
  </div>${fbBlock('학력')}</section>
  <section class="card"><h2>자격 및 면허</h2><div class="rows">${d.licenses.map((_, i) => `<div class="entry-3">${input(`licenses.${i}.date`, '취득일', DATE)}${input(`licenses.${i}.name`, '자격 및 면허증 명')}${input(`licenses.${i}.org`, '발급기관')}</div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:0;width:100%">')}</div>${fbBlock('자격 및 면허')}</section>
  <section class="card"><h2>수상 및 활동 경력</h2><div class="rows">${d.awards.map((_, i) => periodRow('awards', i, 'text', '내용', 'org', '기관')).join('')}</div>${fbBlock('수상 및 활동')}</section>
  <section class="card"><h2>경력 사항</h2><div class="rows">${d.careers.map((_, i) => `<div class="entry-4 career">${input(`careers.${i}.from`, '시작', DATE)}${input(`careers.${i}.to`, '종료', DATE)}${input(`careers.${i}.place`, '근무처', { cls: 'wide' })}${input(`careers.${i}.rank`, '직급', { cls: 'wide' })}${input(`careers.${i}.desc`, '업무내용', { cls: 'full-row' })}</div>`).join('')}</div>${fbBlock('경력 사항')}</section>
  <section class="card"><h2>동아리 활동 및 봉사 활동</h2><div class="rows">${d.clubs.map((_, i) => periodRow('clubs', i, 'name', '활동명', 'desc', '내용')).join('')}</div>${fbBlock('동아리·봉사')}</section>
  <section class="card"><h2>자기소개서</h2>${INTRO.map(([k, label]) => `<div class="field"><label for="i-intro.${k}">${label} <span class="req">*</span></label>
    <textarea id="i-intro.${k}" data-path="intro.${k}" maxlength="${INTRO_MAX}">${esc(d.intro[k])}</textarea><span class="hint" data-count="intro.${k}">${d.intro[k].length} / ${INTRO_MAX}자</span>${fbBlock(label)}</div>`).join('')}</section>
  <section class="card"><h2>제출 정보</h2><div class="form-grid">${input('company', '회사명', { req: 1 })}${input('writeDate', '작성일', { type: 'date' })}</div>
    <p class="hint">지원하는 회사가 바뀌면 회사명만 고쳐서 다시 내려받으면 됩니다.</p>${fbBlock('제출 정보')}</section>
  ${isTeacher() ? '<section class="card"><h2>계정 관리</h2><div class="row"><button class="btn" data-act="resetPw">비밀번호 초기화</button><button class="btn btn-danger" data-act="delStudent">학생 계정 삭제</button></div></section>' : ''}`;
}
const periodRow = (key, i, a, aLabel, b, bLabel) => `<div class="entry-4">${input(`${key}.${i}.from`, '시작', DATE)}${input(`${key}.${i}.to`, '종료', DATE)}${input(`${key}.${i}.${a}`, aLabel, { cls: 'wide' })}${input(`${key}.${i}.${b}`, bLabel, { cls: 'wide' })}</div>`;

/* 편집 화면 (학생 본인, 교사의 학생 지도 공용) */
function viewEditor() {
  const { doc: d, resume: r, owner } = state;
  const missingList = missing(d, !!state.photoUrl);
  const pct = progress(d, !!state.photoUrl);
  const teacher = isTeacher();
  const round = r.round || 1;
  const badge = r.status === 'approved' ? '<span class="badge ok">완성 (승인됨)</span>' : r.status === 'submitted' ? `<span class="badge warn">${round}차 제출 · 첨삭 대기</span>` : `<span class="badge">${round}차 작성 중</span>`;
  const head = `<div class="head"><div>${teacher ? '<button class="btn-link" data-act="back">← 학생 목록</button>' : ''}<h1>${esc(owner.name)} 이력서</h1><p class="muted small">${esc(owner.login_id)}${owner.dept ? ' · ' + esc(owner.dept) : ''} · 진행률 ${pct}%</p></div>${badge}</div>
    <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
  const tabs = `<div class="tabs" role="tablist">${[['edit', '작성'], ['preview', '미리보기·출력']].map(([v, l]) => `<button role="tab" aria-selected="${state.tab === v}" data-act="tab" data-v="${v}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (state.tab === 'edit') {
    body = (!teacher && state.feedbacks.length ? `<div class="notice" id="fbNotice">${state.feedbacks.some((f) => !f.done_at) ? `아직 수정하지 않은 피드백이 <b>${state.feedbacks.filter((f) => !f.done_at).length}건</b> 있습니다. 해당 항목 바로 아래에서 확인하세요.` : '모든 피드백을 수정했습니다.'}</div>` : '') + editForm();
  } else {
    body = `<section class="card">${versionButtons()}${canOutput() ? '<div class="row"><button class="btn btn-primary" data-act="print">프린트</button><button class="btn" data-act="pdf">PDF 다운로드</button></div>' : `<div class="notice">${r.status === 'approved' ? '프린트와 다운로드는 완성본에서 할 수 있습니다.' : '지금은 미리보기만 가능합니다. 선생님이 승인하면 프린트와 다운로드를 할 수 있습니다.'}</div>`}
      ${missingList.length ? `<div class="notice warn">아직 비어 있는 항목: ${esc(missingList.join(', '))}</div>` : ''}
      ${canOutput() ? '<p class="hint">휴대폰에서 프린트가 어려우면 PDF로 내려받아 사용하세요.</p>' : ''}</section><div class="preview" id="preview"></div>`;
  }
  const submit = teacher ? reviewButtons(r)
    : r.status === 'approved' ? '<button class="btn btn-primary" data-act="tab" data-v="preview">프린트·다운로드</button>'
    : r.status === 'submitted' ? '<button class="btn" disabled>선생님 확인 중</button>'
    : `<button class="btn btn-primary" data-act="submit">${round}차 제출</button>`;
  const dock = `<div class="dock"><div class="wrap"><span class="save-state" id="saveState"></span>${submit}</div></div>`;
  return shell(head + tabs + body, dock);
}

/* 차수 보기와 승인 */
const canOutput = () => state.resume?.status === 'approved' && !state.versionView;
const shownDoc = () => {
  const v = state.versions?.find((x) => x.round === state.versionView);
  return v ? mergeDoc(v.data, state.owner) : state.doc;
};
function versionButtons() {
  const has = (n) => state.versions?.some((v) => v.round === n);
  const approved = state.resume.status === 'approved';
  const btn = (v, label, on) => `<button class="btn btn-sm ${state.versionView === v ? 'btn-primary' : ''}" data-act="version" data-v="${v ?? ''}" ${on ? '' : 'disabled'}>${label}</button>`;
  return `<div class="row">${[1, 2, 3].map((n) => btn(n, `${n}차`, has(n))).join('')}${btn(null, approved ? '완성본' : '현재 작성본', true)}</div>`;
}
function reviewButtons(r) {
  const round = r.round || 1;
  if (r.status === 'approved') return '<button class="btn" data-act="review" data-v="reopen">승인 취소</button>';
  const back = r.status === 'submitted' && round < 3 ? `<button class="btn" data-act="review" data-v="next">${round + 1}차 첨삭으로 돌려보내기</button>` : '';
  return `<div class="row">${back}<button class="btn btn-primary" data-act="review" data-v="approve">승인 (완성)</button></div>`;
}
// 학생은 제출 후 잠기고, 승인 후에는 회사명과 작성일만 고칠 수 있다
function applyLocks() {
  const status = state.resume.status;
  if (isTeacher() || status === 'draft') return;
  const free = status === 'approved' ? ['company', 'writeDate'] : [];
  document.querySelectorAll('[data-path],[data-range],[data-act=findAddr],#photoInput').forEach((el) => { if (!free.includes(el.dataset.path)) el.disabled = true; });
  document.querySelector('label[for=photoInput]')?.remove();
  $('#i-addressBase')?.removeAttribute('data-act');
  document.querySelector('.page .tabs').insertAdjacentHTML('afterend', `<div class="notice ${status === 'approved' ? 'ok' : 'warn'}">${status === 'approved' ? '선생님이 승인한 완성본입니다. 회사명과 작성일만 고칠 수 있습니다.' : '제출한 내용을 선생님이 확인하고 있습니다. 돌려받으면 다시 수정할 수 있습니다.'}</div>`);
}

/* 출력 */
function renderPaper() {
  const paper = $('#paper');
  paper.innerHTML = resumeDocHTML(shownDoc(), state.photoUrl);
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
  pdf.save(`이력서_${state.owner.login_id}_${state.doc.name || state.owner.name}.pdf`.replace(/[\\/:*?"<>|]/g, ''));
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
  state.versionView = null;
  const { data: versions } = await sb.from('resume_versions').select().eq('user_id', owner.id);
  state.versions = versions || [];
  await Promise.all([loadPhoto(), loadFeedbacks()]);
  state.view = 'editor';
  render();
  showSave(`마지막 저장 ${when(r.updated_at)}`);
}
async function loadPhoto() {
  if (!state.resume.photo_path) return;
  const { data } = await sb.storage.from('resume-photos').download(state.resume.photo_path);
  if (data) state.photoUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(data); });
}
async function loadFeedbacks() {
  const { data } = await sb.from('resume_feedbacks').select().eq('student_id', state.owner.id).order('created_at', { ascending: false });
  state.feedbacks = data || [];
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
  const [p, r, f] = await Promise.all([
    sb.from('resume_profiles').select().eq('role', 'student').order('login_id'),
    sb.from('resumes').select('user_id,data,photo_path,status,round,approved_at,submitted_at,updated_at'),
    sb.from('resume_feedbacks').select('student_id,done_at'),
  ]);
  state.students = p.data || [];
  state.resumes = r.data || [];
  state.fbRows = f.data || [];
  state.view = 'teacher';
  render();
  api({ action: 'telegram_status' }).then((t) => { state.tg = t; if (state.view === 'teacher') { const el = $('#tgState'); if (el) el.innerHTML = tgLabel(); } }).catch(() => {});
}
const tgLabel = () => (state.tg?.hasChat ? '<span class="badge ok">연결됨</span>' : state.tg?.hasToken ? '<span class="badge warn">채팅 연결 필요</span>' : '<span class="badge off">미연결</span>');

const STATUS = { pending: '가입 승인 대기', rejected: '가입 거절', none: '시작 전', writing: '작성 중', review: '첨삭 대기', done: '완성' };
const BADGE = { pending: 'warn', rejected: 'off', none: 'off', writing: '', review: 'warn', done: 'ok' };
const statusText = (x) => (x.key === 'writing' || x.key === 'review' ? `${x.round}차 ${STATUS[x.key]}` : STATUS[x.key]);
function studentRows() {
  return state.students.map((s) => {
    const r = state.resumes.find((x) => x.user_id === s.id);
    const doc = r ? mergeDoc(r.data, s) : null;
    const key = s.status !== 'approved' ? s.status : !r ? 'none' : r.status === 'approved' ? 'done' : r.status === 'submitted' ? 'review' : 'writing';
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
    학번: x.s.login_id, 이름: x.s.name, 학과: x.doc?.major || x.s.dept, 상태: statusText(x), '진행률(%)': x.pct,
    지원분야: x.doc?.applyField || '', 회사명: x.doc?.company || '', '미입력 항목': x.lack.join(', '), '피드백 수': x.fb, '학생 수정 완료': x.fbDone,
    '최근 저장': x.updated ? new Date(x.updated).toLocaleString('ko-KR') : '', 승인일: x.key === 'done' && x.approved ? new Date(x.approved).toLocaleString('ko-KR') : '',
  }));
  if (!rows.length) { toast('내려받을 학생이 없습니다.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [12, 10, 16, 10, 9, 14, 18, 40, 9, 12, 22, 22].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '학생 현황');
  XLSX.writeFile(wb, `이력서_학생현황_${new Date().toLocaleDateString('sv')}.xlsx`);
}
function viewTeacher() {
  const rows = studentRows();
  const count = (k) => rows.filter((x) => x.key === k).length;
  const q = state.search.trim().toLowerCase();
  const match = (x) => state.filter === 'all' || x.key === state.filter || (state.filter === 'writing' && x.key === 'none');
  const list = rows.filter((x) => match(x) && (!q || x.s.name.toLowerCase().includes(q) || x.s.login_id.includes(q)));
  const stat = (k, n, label) => `<button class="stat" style="text-align:left;cursor:pointer;${state.filter === k ? 'border-color:var(--brand)' : ''}" data-act="filter" data-v="${k}"><b>${n}</b><span>${label}</span></button>`;
  const item = (x) => `<tr><td>${esc(x.s.login_id)}</td><td class="strong">${esc(x.s.name)}</td><td>${esc(x.doc?.major || x.s.dept)}</td><td><span class="badge ${BADGE[x.key]}">${statusText(x)}</span></td>
    <td class="pct"><div class="progress"><i style="width:${x.pct}%"></i></div><span>${x.pct}%</span></td><td class="lack">${esc(x.lack.join(', ')) || (x.doc ? '없음' : '-')}</td><td class="num">${x.fb ? `<span class="badge ${x.fbDone === x.fb ? 'ok' : 'warn'}">${x.fbDone}/${x.fb} 완료</span>` : '-'}</td><td class="nowrap">${when(x.updated)}</td><td class="nowrap">${x.key === 'done' ? when(x.approved) : '-'}</td>
    <td class="nowrap">${x.s.status === 'approved' ? `<button class="btn btn-soft btn-sm" data-act="openStudent" data-v="${x.s.id}">열기</button>` : `<button class="btn btn-primary btn-sm" data-act="approve" data-v="${x.s.id}">승인</button>${x.key === 'pending' ? ` <button class="btn btn-sm" data-act="reject" data-v="${x.s.id}">거절</button>` : ''}`}</td></tr>`;
  return shell(`<div class="head"><div><h1>학생 이력서 관리</h1><p class="muted small">${esc(state.profile.name)} 선생님</p></div><div class="row"><button class="btn btn-sm" data-act="excel">엑셀 다운로드</button><button class="btn btn-sm" data-act="refresh">새로고침</button></div></div>
    <div class="stats">${stat('all', rows.length, '전체 학생')}${stat('pending', count('pending'), '가입 승인 대기')}${stat('writing', count('writing') + count('none'), '작성 중·시작 전')}${stat('review', count('review'), '첨삭 대기')}${stat('done', count('done'), '완성')}</div>
    <section class="card"><div class="field"><label for="search">이름 또는 학번 검색</label><input id="search" value="${esc(state.search)}"></div><div class="table-scroll"><table class="data"><thead><tr><th>학번</th><th>이름</th><th>학과</th><th>상태</th><th>진행률</th><th>미입력 항목</th><th>피드백</th><th>최근 저장</th><th>승인일</th><th>관리</th></tr></thead><tbody>${list.map(item).join('') || '<tr><td colspan="10" class="muted">해당하는 학생이 없습니다.</td></tr>'}</tbody></table></div></section>
    <section class="card"><div class="row between"><h2>텔레그램 완료 알림</h2><span id="tgState">${tgLabel()}</span></div>
      <ol class="small muted" style="margin:0;padding-left:20px"><li>텔레그램에서 @BotFather에게 /newbot을 보내 봇을 만들고 토큰을 복사합니다.</li><li>토큰을 아래에 넣어 저장합니다.</li><li>만든 봇에게 아무 메시지나 보낸 뒤 "알림 연결"을 누릅니다.</li></ol>
      <div class="field"><label for="tgToken">봇 토큰</label><input id="tgToken" autocomplete="off"></div>
      <div class="row"><button class="btn" data-act="tgSave">토큰 저장</button><button class="btn btn-primary" data-act="tgConnect">알림 연결</button></div></section>`);
}

function render() {
  const view = { auth: viewAuth, pending: viewPending, editor: viewEditor, teacher: viewTeacher }[state.view]();
  const y = window.scrollY;
  $('#app').innerHTML = view;
  $('#app').className = state.view === 'teacher' ? 'wide' : '';
  document.body.classList.toggle('no-print', !(state.view === 'editor' && canOutput()));
  if (state.view === 'editor') { showSave(state.saveState); if (state.tab === 'preview') renderPreview(); else applyLocks(); }
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
  print: async () => { if (!canOutput()) return; if (state.dirty) await save(); renderPaper(); await document.fonts.ready; window.print(); },
  pdf: async () => { if (!canOutput()) return; if (state.dirty) await save(); await downloadPdf(); },
  submit: async () => {
    const list = missing(state.doc, !!state.photoUrl);
    if (list.length) { toast(`먼저 입력해 주세요: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` 외 ${list.length - 3}개` : ''}`); return; }
    const round = state.resume.round || 1;
    if (!confirm(`${round}차로 제출할까요? 선생님이 돌려주기 전까지는 수정할 수 없습니다.`)) return;
    if (!(await save())) return;
    try {
      await api({ action: 'submit' });
      await openResume(state.owner);
      state.tab = 'preview'; render(); window.scrollTo(0, 0);
      toast(`${round}차 제출을 완료했습니다. 선생님께 알림을 보냈습니다.`);
    } catch (e) { toast(e.message); }
  },
  version: (v) => { state.versionView = v ? +v : null; render(); },
  review: async (kind) => {
    const r = state.resume;
    if (state.dirty && !(await save())) return;
    const round = state.resume.round || 1;
    const asks = { next: `${round + 1}차 첨삭으로 돌려보낼까요? 학생이 다시 수정할 수 있게 됩니다.`, approve: '이 이력서를 완성으로 승인할까요? 학생이 프린트와 다운로드를 할 수 있게 됩니다.', reopen: '승인을 취소할까요? 학생의 프린트와 다운로드가 다시 막힙니다.' };
    if (!confirm(asks[kind])) return;
    const patch = { next: { status: 'draft', round: round + 1 }, approve: { status: 'approved', approved_at: new Date().toISOString() }, reopen: { status: 'draft', approved_at: null } }[kind];
    const { data, error } = await sb.from('resumes').update(patch).eq('user_id', r.user_id).eq('version', state.resume.version).select().maybeSingle();
    if (error || !data) { toast('처리하지 못했습니다. 새로고침 후 다시 시도해 주세요.'); return; }
    state.resume = data; state.versionView = null; render();
    toast({ next: `${round + 1}차로 돌려보냈습니다.`, approve: '완성으로 승인했습니다.', reopen: '승인을 취소했습니다.' }[kind]);
  },
  back: async () => { if (state.dirty) await save(); state.search = ''; await loadTeacher(); },
  refresh: () => loadTeacher(),
  excel: () => downloadExcel(),
  filter: (v) => { state.filter = v; render(); },
  openStudent: (id) => openResume(state.students.find((s) => s.id === id)),
  approve: async (id) => { await sb.from('resume_profiles').update({ status: 'approved' }).eq('id', id); await loadTeacher(); toast('승인했습니다.'); },
  reject: async (id) => { if (!confirm('가입을 거절할까요?')) return; await sb.from('resume_profiles').update({ status: 'rejected' }).eq('id', id); await loadTeacher(); },
  fbDone: async (id) => {
    if (state.dirty) await save();
    const f = state.feedbacks.find((x) => String(x.id) === String(id));
    const { error } = await sb.from('resume_feedbacks').update({ done_at: f.done_at ? null : new Date().toISOString() }).eq('id', f.id);
    if (error) { toast('저장하지 못했습니다. 다시 시도해 주세요.'); return; }
    await loadFeedbacks(); refreshFb();
    const left = state.feedbacks.filter((x) => !x.done_at).length;
    const n = $('#fbNotice'); if (n) n.innerHTML = left ? `아직 수정하지 않은 피드백이 <b>${left}건</b> 있습니다. 해당 항목 바로 아래에서 확인하세요.` : '모든 피드백을 수정했습니다.';
  },
  delFb: async (id) => { await sb.from('resume_feedbacks').delete().eq('id', id); await loadFeedbacks(); refreshFb(); },
  resetPw: () => passwordModal(`${state.owner.name} 비밀번호 초기화`, async (pw) => { await api({ action: 'reset_password', user_id: state.owner.id, password: pw }); toast('비밀번호를 초기화했습니다. 학생에게 전달해 주세요.'); }),
  delStudent: async () => {
    if (!confirm(`${state.owner.name} 학생의 계정, 이력서, 사진을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
    try { await api({ action: 'delete_student', user_id: state.owner.id }); toast('삭제했습니다.'); await loadTeacher(); } catch (e) { toast(e.message); }
  },
  tgSave: async () => { try { await api({ action: 'telegram_save', token: $('#tgToken').value }); toast('토큰을 저장했습니다.'); await loadTeacher(); } catch (e) { toast(e.message); } },
  tgConnect: async () => { try { const r = await api({ action: 'telegram_connect' }); toast(r.ok ? '연결했습니다. 텔레그램을 확인해 주세요.' : '메시지를 보내지 못했습니다.'); await loadTeacher(); } catch (e) { toast(e.message); } },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el.dataset.v); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'search') { state.search = t.value; const pos = t.selectionStart; render(); const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos); return; }
  if (t.dataset.range) {
    const parts = String(getPath(t.dataset.range) || '').split('~');
    parts[+t.dataset.i] = fromIso(t.value);
    setPath(t.dataset.range, parts[0] || parts[1] ? `${parts[0] || ''}~${parts[1] || ''}` : '');
    queueSave();
    return;
  }
  if (!t.dataset.path) return;
  setPath(t.dataset.path, t.dataset.date ? fromIso(t.value) : t.value);
  if (t.dataset.path === 'addressDetail') syncAddress(state.doc);
  const c = document.querySelector(`[data-count="${t.dataset.path}"]`);
  if (c) c.textContent = `${t.value.length} / ${INTRO_MAX}자`;
  queueSave();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'photoInput' && t.files[0]) uploadPhoto(t.files[0]);
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'authForm') {
    const v = Object.fromEntries(new FormData(f));
    const err = $('#authErr'); err.hidden = true; state.authMsg = '';
    if (window.ADMIN_PAGE && state.authTab === 'signup' && !String(v.teacher_code || '').trim()) { err.textContent = '교사 인증 코드를 입력해 주세요.'; err.hidden = false; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const login = String(v.login_id || '').trim().toLowerCase();
    try {
      if (state.authTab === 'signup') await api({ action: 'signup', ...v, login_id: login });
      const { error } = await sb.auth.signInWithPassword({ email: `${login}@resume.example.com`, password: v.password });
      if (error) throw new Error('학번(아이디) 또는 비밀번호가 맞지 않습니다.');
      await boot();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  }
  if (f.id === 'pwForm') {
    try { await state.pwSubmit($('#pw1').value); $('#modal').innerHTML = ''; } catch (_e) { toast('비밀번호를 변경하지 못했습니다.'); }
  }
  if (f.classList.contains('fbForm')) {
    const body = new FormData(f).get('body').trim();
    if (!body) return;
    const { error } = await sb.from('resume_feedbacks').insert({ student_id: state.owner.id, teacher_id: state.profile.id, section: f.dataset.section, round: state.resume.round || 1, body, snapshot: sectionValues(f.dataset.section, state.doc) });
    if (error) { toast('피드백을 등록하지 못했습니다.'); return; }
    f.reset();
    await loadFeedbacks(); refreshFb(); toast('피드백을 등록했습니다.');
  }
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });
window.addEventListener('resize', () => { if (state.view === 'editor' && state.tab === 'preview') renderPreview(); });
window.addEventListener('focus', () => {
  if (state.view === 'teacher' && !$('#modal').innerHTML && document.activeElement?.id !== 'tgToken') loadTeacher();
  if (state.view === 'editor') loadFeedbacks().then(refreshFb);
});

async function boot() {
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
  if (profile.role === 'teacher') await loadTeacher();
  else await openResume(profile);
}
boot();
