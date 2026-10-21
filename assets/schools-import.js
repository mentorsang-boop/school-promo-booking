// 방문 홍보 배정 엑셀(“방문예정교 현황” 시트 + “○월 방문일정” 달력 시트)을 학교 목록으로 바꿉니다.
// 브라우저(관리 화면의 엑셀 올리기)와 Node(처음 자료 넣기) 양쪽에서 씁니다.
(function (root) {
  const str = (v) => (v == null ? "" : String(v).trim());
  const num = (v) => (v == null || v === "" || v === "-" || isNaN(Number(v)) ? null : Number(v));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  // 이름 줄이기: 부평여자고등학교 → 부평여고, 인천대건고등학교 → 인천대건고 (별칭: 대건고)
  function shortName(name) {
    return str(name).replace(/여자고등학교$/, "여고").replace(/고등학교$/, "고").replace(/중고등학교$/, "중고");
  }
  function aliases(name) {
    const s = shortName(name);
    const out = new Set([str(name), s]);
    if (s.startsWith("인천") && s.length > 3) out.add(s.slice(2));
    return [...out];
  }

  // "2026.10.28.(수)", "2026. 10. 30 (최우철 방문)", Date → { date, note }
  function parseVisit(v) {
    if (v instanceof Date && !isNaN(v)) return { date: ymd(v.getFullYear(), v.getMonth() + 1, v.getDate()), note: "" };
    const s = str(v);
    if (!s) return null;
    const m = s.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
    if (!m) return { date: null, note: s };
    const rest = s.slice(m.index + m[0].length).replace(/^[\s.]*(\([월화수목금토일]\))?/, "").replace(/^\s*\((.*)\)\s*$/, "$1").trim();
    return { date: ymd(+m[1], +m[2], +m[3]), note: rest };
  }

  // "이은경(032-627-0058)" 같은 칸 → [{ text, phones: [...] }] (줄마다)
  function parseContact(v) {
    return str(v).split(/\n+/).map((line) => line.trim()).filter(Boolean).map((text) => ({
      text,
      phones: (text.match(/(0\d{1,2}[-\s)]?)?\d{3,4}-\d{4}/g) || []).map((p) => p.replace(/[\s)]/g, "-").replace(/-+/g, "-")),
    }));
  }

  // 재학생 칸: "박예원(그래픽디자인과)" → { name, dept }
  function parseStudent(v) {
    const s = str(v);
    if (!s || s === "-") return null;
    const m = s.match(/^([^(]+)\(?([^)]*)\)?$/);
    return m ? { name: m[1].trim(), dept: m[2].trim() } : { name: s, dept: "" };
  }

  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i] || [];
      const c = r.findIndex((x) => str(x) === "학교명");
      if (c >= 0) return { row: i, cols: r.map(str) };
    }
    return null;
  }

  function parseStatus(rows) {
    const h = findHeader(rows);
    if (!h) throw new Error("'방문예정교 현황' 시트에서 '학교명' 머리글을 찾지 못했어요.");
    const col = (label) => h.cols.findIndex((x) => x.replace(/\s+/g, "").startsWith(label));
    const C = {
      no: col("연번"), kind: col("계열"), district: col("소재지"), found: col("설립"), gender: col("공학"), name: col("학교명"),
      classes: col("2학년학급수"), students: col("2학년학생수"), intake: col("년도별입교현황"),
      current: col("재학생"), promo: col("홍보담당교사"), consign: col("위탁담당교사"), grade2: col("2학년부장교사"),
      career: col("진로진학담당교사"), hope: col("위탁교육희망"), ourHope: col("본교위탁교육"), briefing: col("설명회희망"), visit: col("(방문)홍보"),
    };
    for (const [k, v] of Object.entries(C)) if (v < 0) throw new Error(`머리글 '${k}' 칸을 찾지 못했어요. 엑셀 양식이 바뀌었는지 확인해 주세요.`);
    const years = (rows[h.row + 1] || []).slice(C.intake, C.current).map(num);
    const schools = [];
    let cur = null;
    for (let i = h.row + 2; i < rows.length; i++) {
      const r = rows[i] || [];
      const no = num(r[C.no]);
      if (str(r[C.no]).includes("통계")) break;
      if (no != null && str(r[C.name])) {
        cur = {
          no, name: str(r[C.name]), short: shortName(r[C.name]),
          kind: "", district: "", found: "", gender: "",
          classes: num(r[C.classes]), students: num(r[C.students]),
          intake: years.map((y, k) => ({ year: y, count: num(r[C.intake + k]) })).filter((x) => x.year),
          current: [], promo_teacher: str(r[C.promo]),
          contacts: [
            { role: "위탁 담당", lines: parseContact(r[C.consign]) },
            { role: "2학년 부장", lines: parseContact(r[C.grade2]) },
            { role: "진로진학 담당", lines: parseContact(r[C.career]) },
          ].filter((c) => c.lines.length),
          consign_hope: str(r[C.hope]), our_hope: str(r[C.ourHope]), briefing: str(r[C.briefing]),
          visits: [],
        };
        const v = parseVisit(r[C.visit]);
        if (v) cur.visits.push({ ...v, source: "현황" });
        schools.push(cur);
      }
      if (!cur) continue;
      // 학교 칸이 여러 줄로 합쳐진 경우, 계열·소재지 등은 아무 줄에나 들어 있을 수 있음
      for (const k of ["kind", "district", "found", "gender"]) if (!cur[k] && str(r[C[k]])) cur[k] = str(r[C[k]]);
      const st = parseStudent(r[C.current]);
      if (st) cur.current.push(st);
    }
    return schools;
  }

  // 달력 시트: 날짜 숫자 줄 아래 칸에 "명신여고(김현희)\n부평고(김현희, 교내설명회)" 형태
  function parseCalendar(rows, title) {
    const head = rows.find((r) => (r || []).some((x) => x instanceof Date));
    const base = head ? head.find((x) => x instanceof Date) : null;
    let year = base ? base.getFullYear() : null, month = base ? base.getMonth() + 1 : null;
    if (!month) { const m = str(title).match(/(\d{1,2})월/); if (m) month = +m[1]; }
    if (!year) year = new Date().getFullYear();
    if (!month) return [];
    const out = [];
    let days = null; // 열 → 날짜
    for (const r of rows) {
      if (!r) continue;
      const nums = r.map((x) => { const m = str(x).match(/^(\d{1,2})(\s|$)/); return m && (typeof x === "number" || /^\d{1,2}\s/.test(str(x))) ? +m[1] : null; });
      if (nums.filter((n) => n != null).length >= 2) { days = nums; continue; }
      if (!days) continue;
      r.forEach((cell, c) => {
        const d = days[c];
        if (d == null || !str(cell)) return;
        for (const line of str(cell).split(/\n+/)) {
          const m = line.match(/^(.*?)\((.*)\)\s*$/);
          const names = (m ? m[1] : line).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
          const note = m ? m[2].trim() : "";
          for (const n of names) out.push({ key: n, date: ymd(year, month, d), note });
        }
      });
    }
    return out;
  }

  function parseWorkbook(wb, XLSX) {
    const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    const statusName = wb.SheetNames.find((n) => n.includes("방문예정교"));
    if (!statusName) throw new Error("'방문예정교 현황' 시트를 찾지 못했어요.");
    const schools = parseStatus(sheet(statusName));
    const byAlias = new Map();
    for (const s of schools) for (const a of aliases(s.name)) byAlias.set(a, s);
    const unmatched = [];
    for (const n of wb.SheetNames.filter((x) => /\d{1,2}월.*일정/.test(x))) {
      for (const e of parseCalendar(sheet(n), n)) {
        const s = byAlias.get(e.key);
        if (!s) { unmatched.push(`${e.date} ${e.key}`); continue; }
        const same = s.visits.find((v) => v.date === e.date);
        if (same) { if (e.note && !same.note.includes(e.note)) same.note = [same.note, e.note].filter(Boolean).join(" · "); }
        else s.visits.push({ date: e.date, note: e.note, source: "달력" });
      }
    }
    for (const s of schools) s.visits.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { schools, unmatched };
  }

  const api = { parseWorkbook, shortName, aliases };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SchoolImport = api;
})(typeof window !== "undefined" ? window : globalThis);
