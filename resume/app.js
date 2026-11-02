const SUPABASE_URL = 'https://prsldqlwyohsqmzzuiji.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rk7hTt2bKuzbFRm0J8ozJw_qx4xQdqf';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'resume-auth' } });

const INTRO_MAX = 600;
const INTRO = [['growth', '성장 과정'], ['personality', '성격의 장·단점'], ['school', '학창시절 및 사회경험'], ['motivation', '지원동기 및 입사 후 포부']];
const SECTIONS = ['전체', '기본 정보', '학력', '자격 및 면허', '수상 및 활동', '경력 사항', '동아리·봉사', ...INTRO.map((x) => x[1])];
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

/* 진행률 */
function missing(d, hasPhoto) {
  const list = REQUIRED.filter(([k]) => !String(d[k] || '').trim()).map((x) => x[1]);
  if (String(d.address || '').trim() === '인천광역시') list.push('상세 주소');
  if (!hasPhoto) list.push('사진');
  if (!d.company?.trim()) list.push('회사명');
  INTRO.forEach(([k, label]) => { if (!d.intro?.[k]?.trim()) list.push(label); });
  return list;
}
const progress = (d, hasPhoto) => { const total = REQUIRED.length + 2 + INTRO.length; return Math.max(0, Math.round((1 - missing(d, hasPhoto).length / total) * 100)); };
const mergeDoc = (data, profile) => {
  const base = newResume(profile);
  return { ...base, ...data, intro: { ...base.intro, ...(data?.intro || {}) } };
};

/* 공통 틀 */
function shell(body, dock = '') {
  const who = state.profile ? `<button class="btn btn-sm" data-act="password">비밀번호</button><button class="btn btn-sm" data-act="logout">로그아웃</button>` : '';
  return `<header class="topbar"><div class="wrap"><div class="brand"><img src="logo.svg" alt="인천산업정보학교"><span>이력서 작성</span></div><div class="top-actions">${who}</div></div></header>
  <main class="wrap page">${body}</main>${dock}`;
}

/* 로그인·가입 */
function viewAuth() {
  const teacher = location.hash === '#teacher';
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
      <p class="error" id="authErr" hidden></p>
      <button class="btn btn-primary" type="submit">${signup ? '가입 신청' : '로그인'}</button>
    </form>
    ${signup || teacher ? '' : '<p class="hint">비밀번호를 잊었다면 담당 선생님께 초기화를 요청해 주세요.</p>'}
    ${teacher ? '<a class="small muted" href="#">학생 로그인으로 돌아가기</a>' : '<a class="small muted" href="#teacher">교사 로그인</a>'}
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
  <input id="i-${path}" data-path="${path}" value="${esc(getPath(path))}" placeholder="${esc(opts.ph || '')}" type="${opts.type || 'text'}" ${opts.date ? 'data-date="1" inputmode="numeric"' : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''}></div>`;
const DATE = { date: true, ph: '2026.03.06' };

function editForm() {
  const d = state.doc;
  return `
  <section class="card"><h2>기본 정보</h2>
    <div class="photo-box"><div class="photo ${state.photoUrl ? 'has' : ''}" style="${state.photoUrl ? `background-image:url('${state.photoUrl}')` : ''}">${state.photoUrl ? '' : '3×4<br>증명사진'}</div>
      <div style="display:grid;gap:6px"><label class="btn btn-soft" for="photoInput">사진 ${state.photoUrl ? '바꾸기' : '올리기'}</label><input id="photoInput" type="file" accept="image/*" hidden><span class="hint">자동으로 3:4 비율에 맞춰 잘립니다.</span></div></div>
    <div class="form-grid">
      ${input('applyField', '지원분야', { req: 1, ph: '예: 제과제빵' })}${input('name', '성명', { req: 1 })}
      ${input('birth', '생년월일', { req: 1, ...DATE, ph: '2008.03.15' })}${input('mobile', '휴대번호', { req: 1, type: 'tel', ph: '010-0000-0000' })}
      ${input('address', '주소', { req: 1, cls: 'full' })}
      ${input('homePhone', '집 번호', { type: 'tel' })}${input('email', 'E-mail', { req: 1, type: 'email' })}
    </div></section>
  <section class="card"><h2>학력</h2><div class="form-grid">
    ${input('eduPeriod', '재학기간')}${input('eduSchool', '학교명')}
    ${input('edu2Period', '원적교 재학기간', { ph: '2023.03.02.~2026.02.10.' })}${input('edu2School', '원적교')}
    ${input('major', '전공분야(학과명)', { req: 1 })}${input('gradStatus', '졸업여부')}
  </div></section>
  <section class="card"><h2>자격 및 면허</h2><div class="rows">${d.licenses.map((_, i) => `<div class="entry-3">${input(`licenses.${i}.date`, '취득일', DATE)}${input(`licenses.${i}.name`, '자격 및 면허증 명')}${input(`licenses.${i}.org`, '발급기관')}</div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:0;width:100%">')}</div></section>
  <section class="card"><h2>수상 및 활동 경력</h2><div class="rows">${d.awards.map((_, i) => periodRow('awards', i, 'text', '내용', 'org', '기관')).join('')}</div></section>
  <section class="card"><h2>경력 사항</h2><div class="rows">${d.careers.map((_, i) => periodRow('careers', i, 'place', '근무처', 'desc', '직위 및 근무내용')).join('')}</div></section>
  <section class="card"><h2>동아리 활동 및 봉사 활동</h2><div class="rows">${d.clubs.map((_, i) => periodRow('clubs', i, 'name', '활동명', 'desc', '내용')).join('')}</div></section>
  <section class="card"><h2>자기소개서</h2>${INTRO.map(([k, label]) => `<div class="field"><label for="i-intro.${k}">${label} <span class="req">*</span></label>
    <textarea id="i-intro.${k}" data-path="intro.${k}" maxlength="${INTRO_MAX}">${esc(d.intro[k])}</textarea><span class="hint" data-count="intro.${k}">${d.intro[k].length} / ${INTRO_MAX}자</span></div>`).join('')}</section>
  <section class="card"><h2>제출 정보</h2><div class="form-grid">${input('company', '회사명', { req: 1, ph: '지원할 회사 이름' })}${input('writeDate', '작성일', { type: 'date' })}</div>
    <p class="hint">지원하는 회사가 바뀌면 회사명만 고쳐서 다시 내려받으면 됩니다.</p></section>`;
}
const periodRow = (key, i, a, aLabel, b, bLabel) => `<div class="entry-4">${input(`${key}.${i}.from`, '시작', DATE)}${input(`${key}.${i}.to`, '종료', DATE)}${input(`${key}.${i}.${a}`, aLabel, { cls: 'wide' })}${input(`${key}.${i}.${b}`, bLabel, { cls: 'wide' })}</div>`;

/* 편집 화면 (학생 본인, 교사의 학생 지도 공용) */
function viewEditor() {
  const { doc: d, resume: r, owner } = state;
  const missingList = missing(d, !!state.photoUrl);
  const pct = progress(d, !!state.photoUrl);
  const teacher = isTeacher();
  const badge = r.status === 'submitted' ? '<span class="badge ok">작성 완료</span>' : '<span class="badge off">작성 중</span>';
  const head = `<div class="head"><div>${teacher ? '<button class="btn-link" data-act="back">← 학생 목록</button>' : ''}<h1>${esc(owner.name)} 이력서</h1><p class="muted small">${esc(owner.login_id)}${owner.dept ? ' · ' + esc(owner.dept) : ''} · 진행률 ${pct}%</p></div>${badge}</div>
    <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
  const newest = state.feedbacks[0];
  const tabs = `<div class="tabs" role="tablist">${[['edit', '작성'], ['preview', '미리보기·출력'], ['feedback', `피드백${state.feedbacks.length ? ` ${state.feedbacks.length}` : ''}`]].map(([v, l]) => `<button role="tab" aria-selected="${state.tab === v}" data-act="tab" data-v="${v}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (state.tab === 'edit') {
    body = (!teacher && newest ? `<div class="notice"><b>선생님 피드백</b> (${esc(newest.section)}) ${esc(newest.body.slice(0, 80))}${newest.body.length > 80 ? '…' : ''} <button class="btn-link" data-act="tab" data-v="feedback">전체 보기</button></div>` : '') + editForm();
  } else if (state.tab === 'preview') {
    body = `<section class="card"><div class="row"><button class="btn btn-primary" data-act="print">프린트</button><button class="btn" data-act="pdf">PDF 다운로드</button></div>
      ${missingList.length ? `<div class="notice warn">아직 비어 있는 항목: ${esc(missingList.join(', '))}</div>` : ''}
      <p class="hint">휴대폰에서 프린트가 어려우면 PDF로 내려받아 사용하세요.</p></section><div class="preview" id="preview"></div>`;
  } else {
    body = viewFeedback();
  }
  const submit = !teacher ? `<button class="btn btn-primary" data-act="submit">${r.status === 'submitted' ? '완료됨 · 출력' : '작성 완료'}</button>` : '';
  const dock = `<div class="dock"><div class="wrap"><span class="save-state" id="saveState"></span>${submit}</div></div>`;
  return shell(head + tabs + body, dock);
}
function viewFeedback() {
  const teacher = isTeacher();
  const list = state.feedbacks.length ? state.feedbacks.map((f) => `<article class="fb"><div class="row between"><span class="badge">${esc(f.section)}</span><span class="hint">${when(f.created_at)}</span></div><p>${esc(f.body)}</p>${teacher ? `<div><button class="btn-link" data-act="delFb" data-v="${f.id}">삭제</button></div>` : ''}</article>`).join('') : '<p class="muted">아직 등록된 피드백이 없습니다.</p>';
  const form = teacher ? `<form id="fbForm" style="display:grid;gap:10px"><div class="field"><label for="fb-section">항목</label><select id="fb-section" name="section">${SECTIONS.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
    <div class="field"><label for="fb-body">피드백 내용</label><textarea id="fb-body" name="body" maxlength="2000" required style="min-height:110px"></textarea></div><button class="btn btn-primary" type="submit">피드백 등록</button></form>` : '';
  const manage = teacher ? `<section class="card"><h2>계정 관리</h2><div class="row"><button class="btn" data-act="resetPw">비밀번호 초기화</button><button class="btn btn-danger" data-act="delStudent">학생 계정 삭제</button></div></section>` : '';
  return `<section class="card"><h2>피드백</h2>${form}<div style="display:grid;gap:10px">${list}</div></section>${manage}`;
}

/* 출력 */
function renderPaper() {
  const paper = $('#paper');
  paper.innerHTML = resumeDocHTML(state.doc, state.photoUrl);
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
  // 학생이 완료 후 내용을 고치면 다시 완료를 누르도록 상태를 되돌린다
  if (!isTeacher() && state.resume.status === 'submitted') patch.status = 'draft';
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
  const [p, r] = await Promise.all([
    sb.from('resume_profiles').select().eq('role', 'student').order('login_id'),
    sb.from('resumes').select('user_id,data,photo_path,status,submitted_at,updated_at'),
  ]);
  state.students = p.data || [];
  state.resumes = r.data || [];
  state.view = 'teacher';
  render();
  api({ action: 'telegram_status' }).then((t) => { state.tg = t; if (state.view === 'teacher') { const el = $('#tgState'); if (el) el.innerHTML = tgLabel(); } }).catch(() => {});
}
const tgLabel = () => (state.tg?.hasChat ? '<span class="badge ok">연결됨</span>' : state.tg?.hasToken ? '<span class="badge warn">채팅 연결 필요</span>' : '<span class="badge off">미연결</span>');

function viewTeacher() {
  const rows = state.students.map((s) => {
    const r = state.resumes.find((x) => x.user_id === s.id);
    const pct = r ? progress(mergeDoc(r.data, s), !!r.photo_path) : 0;
    const key = s.status === 'pending' ? 'pending' : r?.status === 'submitted' ? 'done' : 'writing';
    return { s, r, pct, key };
  });
  const count = (k) => rows.filter((x) => x.key === k).length;
  const q = state.search.trim().toLowerCase();
  const list = rows.filter((x) => (state.filter === 'all' || x.key === state.filter) && (!q || x.s.name.toLowerCase().includes(q) || x.s.login_id.includes(q)));
  const stat = (k, n, label) => `<button class="stat" style="text-align:left;cursor:pointer;${state.filter === k ? 'border-color:var(--brand)' : ''}" data-act="filter" data-v="${k}"><b>${n}</b><span>${label}</span></button>`;
  const item = ({ s, r, pct, key }) => `<div class="student"><div><strong>${esc(s.name)}</strong><span class="small muted">${esc(s.login_id)}${s.dept ? ' · ' + esc(s.dept) : ''}</span></div>
    <div class="prog">${key === 'pending' ? '<span class="badge warn">승인 대기</span>' : `<div class="row between small"><span>${key === 'done' ? '<span class="badge ok">작성 완료</span>' : '<span class="badge off">작성 중</span>'}</span><span class="muted">${pct}% · ${when(r?.updated_at)}</span></div><div class="progress" style="margin-top:4px"><i style="width:${pct}%"></i></div>`}</div>
    <div class="row">${key === 'pending' ? `<button class="btn btn-primary btn-sm" data-act="approve" data-v="${s.id}">승인</button><button class="btn btn-sm" data-act="reject" data-v="${s.id}">거절</button>` : `<button class="btn btn-soft btn-sm" data-act="openStudent" data-v="${s.id}">열기</button>`}</div></div>`;
  return shell(`<div class="head"><div><h1>학생 이력서 관리</h1><p class="muted small">${esc(state.profile.name)} 선생님</p></div><button class="btn btn-sm" data-act="refresh">새로고침</button></div>
    <div class="stats">${stat('all', rows.length, '전체 학생')}${stat('pending', count('pending'), '승인 대기')}${stat('writing', count('writing'), '작성 중')}${stat('done', count('done'), '작성 완료')}</div>
    <section class="card"><div class="field"><label for="search">이름 또는 학번 검색</label><input id="search" value="${esc(state.search)}"></div><div>${list.map(item).join('') || '<p class="muted">해당하는 학생이 없습니다.</p>'}</div></section>
    <section class="card"><div class="row between"><h2>텔레그램 완료 알림</h2><span id="tgState">${tgLabel()}</span></div>
      <ol class="small muted" style="margin:0;padding-left:20px"><li>텔레그램에서 @BotFather에게 /newbot을 보내 봇을 만들고 토큰을 복사합니다.</li><li>토큰을 아래에 넣어 저장합니다.</li><li>만든 봇에게 아무 메시지나 보낸 뒤 "알림 연결"을 누릅니다.</li></ol>
      <div class="field"><label for="tgToken">봇 토큰</label><input id="tgToken" autocomplete="off"></div>
      <div class="row"><button class="btn" data-act="tgSave">토큰 저장</button><button class="btn btn-primary" data-act="tgConnect">알림 연결</button></div></section>`);
}

function render() {
  const view = { auth: viewAuth, pending: viewPending, editor: viewEditor, teacher: viewTeacher }[state.view]();
  const y = window.scrollY;
  $('#app').innerHTML = view;
  if (state.view === 'editor') { showSave(state.saveState); if (state.tab === 'preview') renderPreview(); }
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
  closeModal: () => { $('#modal').innerHTML = ''; },
  print: async () => { if (state.dirty) await save(); renderPaper(); await document.fonts.ready; window.print(); },
  pdf: async () => { if (state.dirty) await save(); await downloadPdf(); },
  submit: async () => {
    if (state.resume.status === 'submitted') { ACT.tab('preview'); return; }
    const list = missing(state.doc, !!state.photoUrl);
    if (list.length) { toast(`먼저 입력해 주세요: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` 외 ${list.length - 3}개` : ''}`); return; }
    if (!(await save())) return;
    try {
      await api({ action: 'submit' });
      const { data } = await sb.from('resumes').select().eq('user_id', state.owner.id).single();
      state.resume = data; state.tab = 'preview'; render(); window.scrollTo(0, 0);
      toast('작성을 완료했습니다. 선생님께 알림을 보냈습니다.');
    } catch (e) { toast(e.message); }
  },
  back: async () => { if (state.dirty) await save(); state.search = ''; await loadTeacher(); },
  refresh: () => loadTeacher(),
  filter: (v) => { state.filter = v; render(); },
  openStudent: (id) => openResume(state.students.find((s) => s.id === id)),
  approve: async (id) => { await sb.from('resume_profiles').update({ status: 'approved' }).eq('id', id); await loadTeacher(); toast('승인했습니다.'); },
  reject: async (id) => { if (!confirm('가입을 거절할까요?')) return; await sb.from('resume_profiles').update({ status: 'rejected' }).eq('id', id); await loadTeacher(); },
  delFb: async (id) => { await sb.from('resume_feedbacks').delete().eq('id', id); await loadFeedbacks(); render(); },
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
  if (!t.dataset.path) return;
  setPath(t.dataset.path, t.value);
  const c = document.querySelector(`[data-count="${t.dataset.path}"]`);
  if (c) c.textContent = `${t.value.length} / ${INTRO_MAX}자`;
  queueSave();
});
// 숫자만 입력해도 2026.03.06 형태로 정리한다
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'photoInput' && t.files[0]) { uploadPhoto(t.files[0]); return; }
  if (t.dataset.date) {
    const n = t.value.replace(/\D/g, '');
    if (n.length === 8 || n.length === 6) {
      t.value = n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : `${n.slice(0, 4)}.${n.slice(4)}`;
      setPath(t.dataset.path, t.value); queueSave();
    }
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'authForm') {
    const v = Object.fromEntries(new FormData(f));
    const err = $('#authErr'); err.hidden = true;
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
  if (f.id === 'fbForm') {
    const v = new FormData(f);
    const { error } = await sb.from('resume_feedbacks').insert({ student_id: state.owner.id, teacher_id: state.profile.id, section: v.get('section'), body: v.get('body').trim() });
    if (error) { toast('피드백을 등록하지 못했습니다.'); return; }
    await loadFeedbacks(); render(); toast('피드백을 등록했습니다.');
  }
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });
window.addEventListener('hashchange', () => { if (state.view === 'auth') render(); });
window.addEventListener('resize', () => { if (state.view === 'editor' && state.tab === 'preview') renderPreview(); });
window.addEventListener('focus', () => { if (state.view === 'teacher' && !$('#modal').innerHTML && document.activeElement?.id !== 'tgToken') loadTeacher(); });

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { state.view = 'auth'; render(); return; }
  const { data: profile } = await sb.from('resume_profiles').select().eq('id', session.user.id).maybeSingle();
  if (!profile) { await sb.auth.signOut(); state.view = 'auth'; render(); return; }
  state.profile = profile;
  if (profile.status !== 'approved') { state.view = 'pending'; render(); return; }
  if (profile.role === 'teacher') await loadTeacher();
  else await openResume(profile);
}
boot();
