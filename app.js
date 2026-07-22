/* =========================================================================
   Lịch Làm Việc — quản lý lịch làm việc theo tuần
   Không dùng cơ sở dữ liệu: toàn bộ dữ liệu lưu trong localStorage.
   ========================================================================= */

const STORAGE_KEY = 'lich-lam-viec:data:v2';
const NOON = 12 * 60;
const DAY_START = 5 * 60;   // 05:00
const DAY_END = 22 * 60;    // 22:00
const MAX_PERIOD_A = 3;     // 05:00–12:00 (khi bật ràng buộc 3 NV)
const MAX_PERIOD_B = 2;     // sau 12:00
const MIN_STAFF = 2;        // tối thiểu 2 nhân viên cho mọi ca

const DAYS = [
  { key: 'T2', label: 'Thứ 2' },
  { key: 'T3', label: 'Thứ 3' },
  { key: 'T4', label: 'Thứ 4' },
  { key: 'T5', label: 'Thứ 5' },
  { key: 'T6', label: 'Thứ 6' },
  { key: 'T7', label: 'Thứ 7' },
  { key: 'CN', label: 'CN' },
];

const PRESETS = [
  [5 * 60, 8 * 60], [5 * 60, 12 * 60], [5 * 60 + 30, 11 * 60], [5 * 60 + 30, 12 * 60],
  [8 * 60, 15 * 60], [8 * 60, 17 * 60], [12 * 60, 17 * 60], [15 * 60, 22 * 60], [17 * 60, 22 * 60],
];

/* ---------------------------- Utilities ---------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad2 = n => String(n).padStart(2, '0');
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function minutesToLabel(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h${pad2(mm)}`;
}
function minutesToInputTime(m) {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${pad2(h)}:${pad2(mm)}`;
}
function inputTimeToMinutes(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
function shiftLabel(sh) { return `${minutesToLabel(sh.s)}-${minutesToLabel(sh.e)}`; }
function overlaps(a, b) { return a.s < b.e && b.s < a.e; }

function escapeCsv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1]?.[0] || '?').toUpperCase();
}

/* ---------------------------- Data model ---------------------------- */
function emptySchedule() {
  const sched = {};
  DAYS.forEach(d => sched[d.key] = {});
  return sched;
}

function makeLocation(name, employeeNames) {
  const loc = { id: uid(), name, nextEmpNum: 1, employees: [], schedule: emptySchedule(), require3Before9: true };
  (employeeNames || []).forEach(n => addEmployeeToLocation(loc, n, false));
  return loc;
}

// Chuyển đổi tên tiếng Việt thành mã không dấu viết liền để tránh trùng lắp
function nameToCode(name) {
  var str = name.trim().toUpperCase();
  str = str.replace(/A|Á|À|Ả|Ã|Ạ|Ă|Ắ|Ằ|Ẳ|Ẵ|Ặ|Â|Ấ|Ầ|Ẩ|Ẫ|Ậ/g, "A");
  str = str.replace(/D|Đ/g, "D");
  str = str.replace(/E|É|È|Ẻ|Ẽ|Ẹ|Ê|Ế|Ề|Ể|Ễ|Ệ/g, "E");
  str = str.replace(/I|Í|Ì|Ỉ|Ĩ|Ị/g, "I");
  str = str.replace(/O|Ó|Ò|Ỏ|Õ|Ọ|Ô|Ố|Ồ|Ổ|Ỗ|Ộ|Ơ|Ớ|Ờ|Ở|Ỡ|Ợ/g, "O");
  str = str.replace(/U|Ú|Ù|Ủ|Ũ|Ụ|Ư|Ứ|Ừ|Ử|Ữ|Ự/g, "U");
  str = str.replace(/Y|Ý|Ỳ|Ỷ|Ỹ|Y/g, "Y");
  str = str.replace(/[^A-Z0-9]/g, "");
  return str;
}

function addEmployeeToLocation(loc, name, ensureShape = true, email = '') {
  const code = nameToCode(name);
  const emp = { id: uid(), code, name: name.trim(), email: (email || '').trim() };
  loc.employees.push(emp);
  if (ensureShape) ensureScheduleShape(loc);
  return emp;
}

function ensureScheduleShape(loc) {
  DAYS.forEach(d => {
    if (!loc.schedule[d.key]) loc.schedule[d.key] = {};
    loc.employees.forEach(emp => {
      if (!loc.schedule[d.key][emp.id]) loc.schedule[d.key][emp.id] = [];
    });
  });
}

function createDefaultData() {
  const quan5 = makeLocation('QUÁN 5', ['Tánh', 'Ái Vy', 'Hà Vy', 'Muội', 'Lan Anh', 'Thuý Anh', 'Ngọc Thảo', 'Hương', 'Dì My']);
  const quan2 = makeLocation('QUÁN 2', ['Hoa', 'Chi', 'Hà Vy', 'Muội', 'Hiền', 'Ngọc Thảo', 'Gia Phát', 'Dì My', 'Hương']);
  return { locations: [quan5, quan2], activeLocationId: quan5.id };
}

function loadData() {
  // Lấy cache local tạm thời để render ngay lập tức
  let initialData = createDefaultData();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.locations && parsed.locations.length) {
        parsed.locations.forEach(loc => {
          ensureScheduleShape(loc);
          if (loc.require3Before9 === undefined) loc.require3Before9 = true;
        });
        initialData = parsed;
      }
    }
  } catch (e) {}

  // Luôn nạp dữ liệu mới nhất từ server (đồng bộ tất cả thiết bị)
  fetch('/data/admin_schedule.json')
    .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(data => {
      if (data && data.locations && data.locations.length) {
        data.locations.forEach(loc => {
          ensureScheduleShape(loc);
          if (loc.require3Before9 === undefined) loc.require3Before9 = true;
        });
        state.data = data;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); // cập nhật cache
        if (typeof renderAll === 'function') renderAll();
      }
    })
    .catch(() => {
      // Fallback: nếu không có server, dùng cache localStorage
      console.warn('Server không hoạt động, dùng dữ liệu cục bộ.');
    });

  return initialData;
}

function saveData() {
  // Lưu vào localStorage cache trước (tức thì)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  // Lưu vào file server (đồng bộ tất cả thiết bị)
  fetch('/data/admin_schedule.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.data)
  }).catch(e => console.warn('Không lưu được vào server:', e));
}

const state = {
  data: loadData(),
  drawer: null, // { locId, dayKey, empId, draft: [{s,e}] }
};

function getActiveLocation() {
  return state.data.locations.find(l => l.id === state.data.activeLocationId) || state.data.locations[0];
}

/* ---------------------------- Validation core ---------------------------- */
function splitAtNoon(sh) {
  if (sh.e <= NOON || sh.s >= NOON) return [sh];
  return [{ s: sh.s, e: NOON }, { s: NOON, e: sh.e }];
}

function formatRanges(hours, isSpecialA3 = false) {
  if (!hours || hours.length === 0) return '';
  const sorted = Array.from(new Set(hours)).sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
    } else {
      const sStr = (isSpecialA3 && start === 5) ? '5h30' : `${start}h`;
      const eStr = `${prev + 1}h`;
      if (start === prev) {
        ranges.push((isSpecialA3 && start === 5) ? '5h30 đến 6h' : `${start}h đến ${prev + 1}h`);
      } else {
        ranges.push(`${sStr} đến ${eStr}`);
      }
      start = current;
      prev = current;
    }
  }
  return ranges.join(', ');
}

/**
 * Analyzes shifts hour by hour from 5h to 21h.
 * Each hour h is checked at h:30 (midpoint of h:00–(h+1):00).
 * Returns { maxA, maxB, warnHoursA3_1, warnHoursA3_2, warnHoursA_0, warnHoursA_1, warnHoursB_0, warnHoursB_1 }.
 */
function analyzeShifts(shifts, require3Before9 = true) {
  let maxA = 0, maxB = 0;

  const hasShifts = shifts.length > 0;

  const warnHoursA3_1 = []; // missing 1 (has 2)
  const warnHoursA3_2 = []; // missing 2 (has 1 or 0)
  const warnHoursA_0 = [];  // morning 0 staff
  const warnHoursA_1 = [];  // morning 1 staff
  const warnHoursB_0 = [];  // afternoon 0 staff
  const warnHoursB_1 = [];  // afternoon 1 staff

  for (let h = 5; h <= 21; h++) {
    const mid = h * 60 + 30; // check at :30 of each hour
    const count = shifts.filter(sh => sh.s <= mid && sh.e > mid).length;

    if (h < 12) {
      maxA = Math.max(maxA, count);
      
      // 3-person rule (5h30-9h => hours 5, 6, 7, 8) if require3Before9 is enabled
      const is3PersonSlot = h < 9 && require3Before9;

      if (is3PersonSlot) {
        if (hasShifts) {
          if (count === 2) {
            warnHoursA3_1.push(h);
          } else if (count === 1) {
            warnHoursA3_2.push(h);
          } else if (count === 0) {
            warnHoursA_0.push(h);
          }
        }
      } else {
        // General morning rule (2-person rule) for h >= 9 (9h-12h)
        if (hasShifts && count < 2) {
          if (count === 0) {
            warnHoursA_0.push(h);
          } else {
            warnHoursA_1.push(h);
          }
        }
      }
    } else {
      maxB = Math.max(maxB, count);
      // General afternoon rule (2-person rule)
      if (hasShifts && count < MIN_STAFF) {
        if (count === 0) {
          warnHoursB_0.push(h);
        } else {
          warnHoursB_1.push(h);
        }
      }
    }
  }

  return {
    maxA,
    maxB,
    warnHoursA3_1,
    warnHoursA3_2,
    warnHoursA_0,
    warnHoursA_1,
    warnHoursB_0,
    warnHoursB_1
  };
}

function countAtMinute(loc, dayKey, minute) {
  const daySched = loc.schedule[dayKey] || {};
  let count = 0;
  loc.employees.forEach(emp => {
    const shifts = daySched[emp.id] || [];
    if (shifts.some(sh => sh.s <= minute && sh.e > minute)) count++;
  });
  return count;
}

/* ---------------------------- Rendering ---------------------------- */
function renderAll() {
  renderLocTabs();
  renderTable();
}

function renderLocTabs() {
  const nav = $('#loc-tabs');
  nav.innerHTML = '';
  state.data.locations.forEach(loc => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'loc-tab' + (loc.id === state.data.activeLocationId ? ' active' : '');
    btn.innerHTML = `<span>${escapeHtml(loc.name)}</span><span class="count">${loc.employees.length} NV</span>`;
    if (state.data.locations.length > 1) {
      const del = document.createElement('span');
      del.className = 'loc-tab-del';
      del.title = 'Xoá quán này';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirm({
          title: `Xoá "${loc.name}"?`,
          message: `Toàn bộ nhân viên và lịch làm việc của "${loc.name}" sẽ bị xoá vĩnh viễn. Hành động này không thể hoàn tác.`,
          onConfirm: () => {
            state.data.locations = state.data.locations.filter(l => l.id !== loc.id);
            if (state.data.activeLocationId === loc.id) state.data.activeLocationId = state.data.locations[0].id;
            saveData(); renderAll();
            showToast('Đã xoá quán.');
          }
        });
      });
      btn.appendChild(del);
    }
    btn.addEventListener('click', () => { state.data.activeLocationId = loc.id; saveData(); renderAll(); });
    nav.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'loc-tab-add';
  addBtn.textContent = '+ Thêm quán';
  addBtn.addEventListener('click', () => startInlineAddLocation(nav, addBtn));
  nav.appendChild(addBtn);

  // Render the 3-staff toggle for the active location
  renderStaffToggle();
}

function renderStaffToggle() {
  const loc = getActiveLocation();
  if (!loc) return;
  let container = $('#staff-toggle-container');
  if (!container) return;
  const on = loc.require3Before9;
  container.innerHTML = `
    <button
      id="btn-staff-toggle"
      type="button"
      class="staff-toggle-btn${on ? ' active' : ''}"
      title="${on ? 'Đang yêu cầu 3 NV trong ca 5-9h. Nhấn để tắt.' : 'Ràng buộc 3 NV ca 5-9h đang tắt. Nhấn để bật.'}"
      aria-pressed="${on}"
    >
      <span class="toggle-track"><span class="toggle-thumb"></span></span>
      <span class="toggle-label">Ca 5h30-9h: bắt buộc 3 NV</span>
    </button>`;
  $('#btn-staff-toggle').addEventListener('click', () => {
    loc.require3Before9 = !loc.require3Before9;
    saveData();
    renderStaffToggle();
    renderTable();
    showToast(loc.require3Before9 ? 'Đã bật: ca 5-9h yêu cầu 3 nhân viên.' : 'Đã tắt: ca 5-9h không bắt buộc 3 nhân viên.');
  });
}

function startInlineAddLocation(nav, addBtn) {
  const wrap = document.createElement('div');
  wrap.className = 'inline-add-loc';
  wrap.innerHTML = `<input type="text" placeholder="Tên quán mới…" maxlength="40"><button type="button" aria-label="Thêm">+</button>`;
  nav.replaceChild(wrap, addBtn);
  const input = $('input', wrap);
  input.focus();
  const commit = () => {
    const name = input.value.trim();
    if (name) {
      const loc = makeLocation(name.toUpperCase());
      state.data.locations.push(loc);
      state.data.activeLocationId = loc.id;
      saveData();
      renderAll();
      showToast(`Đã thêm quán "${loc.name}".`);
    } else {
      renderAll();
    }
  };
  $('button', wrap).addEventListener('click', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') renderAll();
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.body.contains(wrap)) renderAll(); }, 150));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Per-employee color palette — bright hues for chip backgrounds (teal/indigo = dark)
const EMP_COLORS = [
  '#FFE066', // yellow
  '#FF9A3C', // orange
  '#FF6B9D', // pink
  '#A8FFD8', // mint
  '#7FE0FF', // sky
  '#D4A3FF', // lavender
  '#FF8A8A', // coral
  '#B8F573', // lime
  '#FFC3A0', // peach
  '#85E0FF', // light blue
  '#FFD1F5', // blush
  '#AAFFC3', // green
];

// Darker variants for use on light backgrounds (drawer list)
const EMP_COLORS_DARK = [
  '#B08A00', // yellow → dark gold
  '#C45A00', // orange → burnt
  '#A3004F', // pink → magenta
  '#007A50', // mint → forest
  '#006A99', // sky → ocean
  '#5A00AA', // lavender → purple
  '#A01010', // coral → crimson
  '#3A7A00', // lime → olive
  '#9C4A10', // peach → sienna
  '#00618A', // light blue → teal
  '#8A0060', // blush → rose
  '#006A3A', // green → emerald
];

function getEmpColor(empId, loc, dark = false) {
  const idx = loc.employees.findIndex(e => e.id === empId);
  const palette = dark ? EMP_COLORS_DARK : EMP_COLORS;
  return palette[(idx < 0 ? 0 : idx) % palette.length];
}

function renderTable() {
  const loc = getActiveLocation();
  const table = $('#schedule-table');
  const emptyState = $('#empty-state');
  if (!loc || loc.employees.length === 0) {
    table.hidden = true;
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  table.hidden = false;

  // Header rows
  const headRow = $('.row-head', table);
  headRow.innerHTML = '';
  const stripRow = $('.row-strip', table);
  stripRow.innerHTML = '';

  const require3 = loc.require3Before9;
  DAYS.forEach(d => {
    const th = document.createElement('th');
    th.textContent = d.label;
    headRow.appendChild(th);

    const stripTh = document.createElement('th');
    const strip = document.createElement('div');
    strip.className = 'coverage-strip';
    for (let h = 5; h <= 21; h++) {
      const minute = h * 60 + 30;
      const count = countAtMinute(loc, d.key, minute);
      const period = minute < NOON ? 'a' : 'b';
      const max = period === 'a' ? MAX_PERIOD_A : MAX_PERIOD_B;
      const level = Math.min(count, max);
      const span = document.createElement('span');
      let warnHint = '';
      if (period === 'a') {
        if (h < 9 && require3 && count > 0 && count < 3) warnHint = ' ⚠ (cần 3 NV)';
        else if (h >= 9 && count > 0 && count < 2) warnHint = ' ⚠ (cần 2 NV)';
      } else {
        if (count > 0 && count < 2) warnHint = ' ⚠ (cần 2 NV)';
      }
      span.className = `lvl-${period}-${level}`;
      span.title = `${d.label} · ${h}:00–${h + 1}:00 · ${count} người${warnHint}`;
      strip.appendChild(span);
    }
    stripTh.appendChild(strip);
    stripRow.appendChild(stripTh);
  });

  // Body
  const body = $('#schedule-body');
  body.innerHTML = '';

  const tr = document.createElement('tr');
  DAYS.forEach(d => {
    const td = document.createElement('td');
    td.className = 'day-cell';

    // Gather all shifts for this day and sort by start time
    const dayShifts = [];
    loc.employees.forEach(emp => {
      const shifts = (loc.schedule[d.key][emp.id] || []);
      shifts.forEach(sh => {
        dayShifts.push({ ...sh, empId: emp.id, empName: emp.name });
      });
    });
    dayShifts.sort((a, b) => a.s - b.s);

    if (dayShifts.length === 0) {
      td.innerHTML = '<span class="cell-empty-hint">+ thêm ca</span>';
    } else {
      td.innerHTML = dayShifts.map(sh => {
        const periodClass = sh.s < NOON ? 'period-a' : 'period-b';
        return `<div class="shift-chip-block ${periodClass}">
          <span class="shift-chip-emp" style="text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(sh.empName)}</span>
          <span class="shift-chip-time">${shiftLabel(sh)}</span>
        </div>`;
      }).join('');
    }
    td.addEventListener('click', () => openShiftDrawer(loc.id, d.key));
    tr.appendChild(td);
  });
  body.appendChild(tr);
}

/* ---------------------------- Shift drawer ---------------------------- */
function openShiftDrawer(locId, dayKey) {
  const loc = state.data.locations.find(l => l.id === locId);
  const dayLabel = DAYS.find(d => d.key === dayKey).label;

  // Gather all shifts for this day
  const existing = [];
  loc.employees.forEach(emp => {
    const shifts = (loc.schedule[dayKey][emp.id] || []);
    shifts.forEach(sh => {
      existing.push({ ...sh, empId: emp.id });
    });
  });

  state.drawer = { locId, dayKey, draft: existing };

  $('#drawer-eyebrow').textContent = loc.name;
  $('#drawer-title').textContent = dayLabel;
  $('#shift-error').hidden = true;
  $('#input-start').value = '05:00';
  $('#input-end').value = '08:00';

  // Fill employee selection dropdown in drawer
  const empSelect = $('#input-shift-emp');
  empSelect.innerHTML = '';
  loc.employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.name;
    empSelect.appendChild(opt);
  });

  renderPresetRow();
  renderShiftList();
  refreshDrawerWarning();
  renderSuggestedList(loc, dayKey);

  $('#overlay').hidden = false;
  $('#shift-drawer').hidden = false;
}

function closeShiftDrawer() {
  $('#overlay').hidden = true;
  $('#shift-drawer').hidden = true;
  state.drawer = null;
}

/* ---- Suggested employee list from registration data ---- */
function renderSuggestedList(loc, dayKey) {
  const listEl = $('#drawer-suggested-list');
  const emptyEl = $('#drawer-suggested-empty');
  if (!listEl) return;

  // Map empCode -> empName from this location
  const codeToName = {};
  const nameToEmpId = {};
  loc.employees.forEach(emp => {
    codeToName[emp.code] = emp.name;
    // normalize for lookup: strip accents, upper, nospace
    const normalized = nameToCode(emp.name);
    nameToEmpId[normalized] = emp.id;
    // also map by code directly
    nameToEmpId[emp.code] = emp.id;
  });

  // Load registration data
  let regs = [];
  try { regs = JSON.parse(localStorage.getItem('cfhm-schedule-v1') || '[]'); } catch(e) {}

  // Map day key: the reg data may use T2/T3... same as this system
  const dayRegs = regs.filter(r => r.day === dayKey);

  listEl.innerHTML = '';
  if (!dayRegs.length) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  // Sort by earliest start time
  dayRegs.sort((a, b) => {
    const getStart = r => (r.timeRanges && r.timeRanges.length) ? r.timeRanges[0].start : '23:59';
    return getStart(a).localeCompare(getStart(b));
  });

  dayRegs.forEach(reg => {
    const empCode = reg.empCode || '';
    // Resolve name: first try nameMap from location, fall back to stored name or code
    const empName = codeToName[empCode] || reg.empName || empCode;
    // Resolve empId for auto-fill
    const empId = nameToEmpId[empCode] || nameToEmpId[nameToCode(empName)] || null;

    // Build color from EMP_COLORS_DARK
    let empColor = '#555';
    if (empId) {
      const idx = loc.employees.findIndex(e => e.id === empId);
      if (idx >= 0) empColor = EMP_COLORS_DARK[idx % EMP_COLORS_DARK.length];
    }

    const times = (reg.timeRanges || []);
    const card = document.createElement('div');
    card.className = 'suggest-card';
    card.style.cursor = 'default';

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = `font-weight:700;font-size:13px;color:${empColor};cursor:pointer;user-select:none;`;
    nameSpan.textContent = empName;
    nameSpan.addEventListener('click', () => {
      const empSelect = $('#input-shift-emp');
      if (empId && empSelect) {
        empSelect.value = empId;
      }
    });
    card.appendChild(nameSpan);

    const timesContainer = document.createElement('span');
    timesContainer.className = 'suggest-times';

    times.forEach(t => {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'suggest-time-badge';
      badge.style.cursor = 'pointer';
      badge.textContent = `${t.start}–${t.end}`;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const empSelect = $('#input-shift-emp');
        if (empId && empSelect) {
          empSelect.value = empId;
        }
        $('#input-start').value = t.start;
        $('#input-end').value = t.end;
        
        // Highlight the clicked badge
        $$('.suggest-time-badge').forEach(b => {
          b.style.boxShadow = '';
          b.style.borderColor = 'var(--line)';
          b.style.background = 'var(--surface-sunken)';
          b.style.color = 'var(--ink-soft)';
        });
        badge.style.setProperty('background', 'var(--primary-tint)', 'important');
        badge.style.setProperty('color', 'var(--primary)', 'important');
        badge.style.setProperty('border-color', 'var(--primary)', 'important');
        badge.style.boxShadow = '0 0 0 2px var(--primary-tint)';
      });
      timesContainer.appendChild(badge);
    });

    card.appendChild(timesContainer);
    listEl.appendChild(card);
  });
}

function renderPresetRow() {
  const row = $('#preset-row');
  row.innerHTML = '';
  PRESETS.forEach(([s, e]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.textContent = `${minutesToLabel(s)}-${minutesToLabel(e)}`;
    btn.addEventListener('click', () => {
      $('#input-start').value = minutesToInputTime(s);
      $('#input-end').value = minutesToInputTime(e);
    });
    row.appendChild(btn);
  });
}

function renderShiftList() {
  const list = $('#shift-list');
  const emptyHint = $('#shift-list-empty');
  const draft = state.drawer.draft;
  list.innerHTML = '';
  emptyHint.hidden = draft.length !== 0;

  const loc = state.data.locations.find(l => l.id === state.drawer.locId);

  draft.slice().sort((a, b) => a.s - b.s).forEach(sh => {
    const emp = loc.employees.find(e => e.id === sh.empId);
    const empName = emp ? emp.name : 'Chưa rõ';
    const empColor = getEmpColor(sh.empId, loc, true); // dark variant for light bg
    const li = document.createElement('li');
    const periodClass = sh.s < NOON ? 'period-a' : 'period-b';
    li.innerHTML = `<span class="shift-label"><span class="badge ${periodClass}"></span><strong style="color:${empColor};text-transform:uppercase;letter-spacing:.03em;font-size:13px;">${escapeHtml(empName)}</strong>: ${shiftLabel(sh)}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'shift-remove';
    removeBtn.type = 'button';
    removeBtn.title = 'Xoá ca này';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      state.drawer.draft = state.drawer.draft.filter(x => x !== sh);
      renderShiftList();
      refreshDrawerWarning();
    });
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function refreshDrawerWarning() {
  const warnEl = $('#shift-warning');
  const { locId, draft } = state.drawer;
  const loc = state.data.locations.find(l => l.id === locId);
  const require3 = loc ? loc.require3Before9 : true;
  const { warnHoursA3_1, warnHoursA3_2, warnHoursA_0, warnHoursA_1, warnHoursB_0, warnHoursB_1 } = analyzeShifts(draft, require3);
  const messages = [];

  // Group 0 employee (unstaffed) warnings for morning and afternoon
  const unstaffedHours = [...warnHoursA_0, ...warnHoursB_0];
  
  // Group 1 employee (missing 1) warnings for morning and afternoon (outside the 5h30-9h rule)
  const missing1Hours = [...warnHoursA_1, ...warnHoursB_1];

  // 1. 5h30-9h Rule specific warnings
  if (warnHoursA3_1.length > 0) {
    messages.push(`⚠️ Thiếu 1 nhân viên khung giờ: <strong>${formatRanges(warnHoursA3_1, true)}</strong>`);
  }
  if (warnHoursA3_2.length > 0) {
    messages.push(`⚠️ Thiếu 2 nhân viên khung giờ: <strong>${formatRanges(warnHoursA3_2, true)}</strong>`);
  }

  // 2. Missing 1 employee (under 2-person rule)
  if (missing1Hours.length > 0) {
    messages.push(`⚠️ Thiếu 1 nhân viên cho khung giờ: <strong>${formatRanges(missing1Hours)}</strong>`);
  }

  // 3. Unstaffed (0 employees)
  if (unstaffedHours.length > 0) {
    messages.push(`⚠️ Chưa có nhân viên cho khung giờ: <strong>${formatRanges(unstaffedHours)}</strong>`);
  }

  if (messages.length > 0) {
    // Render horizontal flex layout
    warnEl.innerHTML = messages.map(msg => `<div class="warning-item">${msg}</div>`).join('');
    warnEl.hidden = false;
  } else {
    warnEl.hidden = true;
  }
}

function handleAddShift() {
  const errEl = $('#shift-error');
  errEl.hidden = true;
  const empId = $('#input-shift-emp').value;
  const s = inputTimeToMinutes($('#input-start').value);
  const e = inputTimeToMinutes($('#input-end').value);
  if (!empId) { errEl.hidden = false; errEl.textContent = 'Vui lòng chọn nhân viên.'; return; }
  if (s === null || e === null) { errEl.hidden = false; errEl.textContent = 'Vui lòng chọn giờ bắt đầu và kết thúc.'; return; }
  if (s >= e) { errEl.hidden = false; errEl.textContent = 'Giờ kết thúc phải sau giờ bắt đầu.'; return; }

  const { locId, dayKey, draft } = state.drawer;
  const newShift = { empId, s, e };

  if (draft.some(sh => sh.empId === empId && overlaps(sh, newShift))) {
    errEl.hidden = false;
    errEl.textContent = 'Nhân viên này có ca làm việc bị trùng.';
    return;
  }

  const loc2 = state.data.locations.find(l => l.id === locId);
  const require3 = loc2 ? loc2.require3Before9 : true;
  const trial = [...draft, newShift];
  const { maxA, maxB } = analyzeShifts(trial, require3);

  if (maxA > MAX_PERIOD_A) {
    errEl.hidden = false;
    errEl.textContent = `Khung 5h–12h đã đủ tối đa ${MAX_PERIOD_A} nhân viên trong giờ này, không thể thêm.`;
    return;
  }
  if (maxB > MAX_PERIOD_B) {
    errEl.hidden = false;
    errEl.textContent = `Sau 12h chỉ cho phép tối đa ${MAX_PERIOD_B} nhân viên trong giờ này, không thể thêm.`;
    return;
  }

  state.drawer.draft.push(newShift);
  renderShiftList();
  refreshDrawerWarning();
}

function handleSaveDrawer() {
  const { locId, dayKey, draft } = state.drawer;
  const loc = state.data.locations.find(l => l.id === locId);
  const dayLabel = DAYS.find(d => d.key === dayKey).label;

  const summaryParts = [];
  loc.employees.forEach(emp => {
    const empShifts = draft.filter(sh => sh.empId === emp.id).sort((a, b) => a.s - b.s);
    if (empShifts.length > 0) {
      summaryParts.push(`${emp.name}: ${empShifts.map(shiftLabel).join(', ')}`);
    }
  });
  const summary = summaryParts.length > 0 ? summaryParts.join('; ') : '(không có ca nào — sẽ xoá hết ca của ngày này)';

  showConfirm({
    title: 'Xác nhận lưu lịch',
    message: `Lưu ca làm việc cho ${dayLabel}: ${summary}?`,
    warningText: null,
    onConfirm: () => {
      loc.employees.forEach(emp => {
        loc.schedule[dayKey][emp.id] = [];
      });
      draft.forEach(sh => {
        if (!loc.schedule[dayKey][sh.empId]) loc.schedule[dayKey][sh.empId] = [];
        loc.schedule[dayKey][sh.empId].push({ s: sh.s, e: sh.e });
      });
      saveData();
      closeShiftDrawer();
      renderTable();
      showToast('Đã lưu lịch làm việc.');
    }
  });
}

/* ---------------------------- Employee drawer ---------------------------- */
function openEmployeeDrawer() {
  const loc = getActiveLocation();
  $('#emp-drawer-eyebrow').textContent = loc.name;
  renderEmployeeList();
  $('#overlay').hidden = false;
  $('#employee-drawer').hidden = false;
  $('#input-new-emp').value = '';
}

function closeEmployeeDrawer() {
  $('#overlay').hidden = true;
  $('#employee-drawer').hidden = true;
}

function renderEmployeeList() {
  const loc = getActiveLocation();
  const list = $('#employee-list');
  list.innerHTML = '';
  if (loc.employees.length === 0) {
    const li = document.createElement('li');
    li.style.background = 'transparent';
    li.style.border = 'none';
    li.style.padding = '12px 0';
    li.innerHTML = '<span class="field-hint">Chưa có nhân viên nào. Thêm nhân viên bên phải ➜</span>';
    list.appendChild(li);
  }
  loc.employees.forEach(emp => {
    const li = document.createElement('li');
    const displayEmail = emp.email ? escapeHtml(emp.email) : '<span style="color:#94a3b8; font-style:italic;">(Chưa có email)</span>';
    li.innerHTML = `
      <div class="emp-info">
        <span class="emp-avatar">${initials(emp.name)}</span>
        <div class="emp-name-wrap" style="display: flex; flex-direction: column;">
          <span class="emp-name" style="font-weight: 700;">${escapeHtml(emp.name)}</span>
          <span class="emp-code" style="font-size: 11px; color: #64748b;">Mã: ${emp.code}</span>
          <span class="emp-email" style="font-size: 11.5px; color: #0e7c66; margin-top: 2px;">${displayEmail}</span>
        </div>
      </div>
      <div class="emp-actions">
        <button class="emp-btn" data-action="rename" title="Sửa thông tin"><i class="fa-solid fa-pen" style="font-size: 13px; color: #64748b;"></i></button>
        <button class="emp-btn danger" data-action="delete" title="Xoá nhân viên"><i class="fa-solid fa-trash" style="font-size: 13px;"></i></button>
      </div>`;
    $('[data-action="rename"]', li).addEventListener('click', () => startRenameEmployee(li, loc, emp));
    $('[data-action="delete"]', li).addEventListener('click', () => {
      showConfirm({
        title: `Xoá ${emp.name}?`,
        message: `Toàn bộ ca làm việc đã xếp cho ${emp.name} (${emp.code}) trong tuần sẽ bị xoá theo. Hành động này không thể hoàn tác.`,
        onConfirm: () => {
          loc.employees = loc.employees.filter(e => e.id !== emp.id);
          DAYS.forEach(d => { delete loc.schedule[d.key][emp.id]; });
          saveData();
          renderEmployeeList();
          renderTable();
          renderLocTabs();
          showToast(`Đã xoá ${emp.name}.`);
        }
      });
    });
    list.appendChild(li);
  });
}


function startRenameEmployee(li, loc, emp) {
  const wrap = $('.emp-name-wrap', li);
  const originalName = emp.name;
  const originalEmail = emp.email || '';
  
  wrap.innerHTML = `
    <input type="text" class="emp-name-input" placeholder="Tên" value="${escapeHtml(originalName)}" maxlength="40" style="margin-bottom:4px; font-weight:700;">
    <input type="email" class="emp-email-input" placeholder="Email (Tùy chọn)" value="${escapeHtml(originalEmail)}" maxlength="60" style="font-size:12px; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius:4px;">
    <span class="emp-code" style="font-size:11px; color:#64748b; margin-top:4px;">Mã: ${emp.code}</span>
  `;
  
  const nameInput = $('.emp-name-input', wrap);
  const emailInput = $('.emp-email-input', wrap);
  nameInput.focus();
  
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    
    if (name && (name !== originalName || email !== originalEmail)) {
      showConfirm({
        title: 'Xác nhận thay đổi',
        message: `Cập nhật thông tin nhân viên?`,
        onConfirm: () => { 
          emp.name = name; 
          emp.email = email;
          emp.code = nameToCode(name);
          saveData(); 
          renderEmployeeList(); 
          renderTable(); 
        },
        onCancel: () => renderEmployeeList()
      });
    } else {
      renderEmployeeList();
    }
  };

  // Click outside or Blur logic needs to wait for either input
  let blurTimeout;
  const setupBlur = (el) => {
    el.addEventListener('blur', () => {
      clearTimeout(blurTimeout);
      blurTimeout = setTimeout(() => {
        // Chỉ commit khi không có input nào đang focus
        if (document.activeElement !== nameInput && document.activeElement !== emailInput) {
          commit();
        }
      }, 200);
    });
  };

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { settled = true; renderEmployeeList(); }
  });
  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { settled = true; renderEmployeeList(); }
  });

  setupBlur(nameInput);
  setupBlur(emailInput);
}

function handleAddEmployee() {
  const input = $('#input-new-emp');
  const inputEmail = $('#input-new-emp-email');
  const name = input.value.trim();
  const email = inputEmail.value.trim();
  if (!name) return;
  const loc = getActiveLocation();
  const emp = addEmployeeToLocation(loc, name, true, email);
  saveData();
  input.value = '';
  inputEmail.value = '';
  renderEmployeeList();
  renderTable();
  renderLocTabs();
  showToast(`Đã thêm ${emp.name} (${emp.code}).`);
  input.focus();
}

/* ---------------------------- Confirm modal ---------------------------- */
let pendingConfirm = null;
function showConfirm({ title, message, warningText, onConfirm, onCancel }) {
  $('#confirm-title').textContent = title || 'Xác nhận';
  $('#confirm-message').textContent = message || 'Bạn có chắc chắn không?';
  const warnEl = $('#confirm-warning');
  if (warningText) { warnEl.hidden = false; warnEl.textContent = warningText; }
  else warnEl.hidden = true;
  pendingConfirm = { onConfirm, onCancel };
  $('#confirm-overlay').hidden = false;
}
function closeConfirm(didConfirm) {
  $('#confirm-overlay').hidden = true;
  const cb = pendingConfirm;
  pendingConfirm = null;
  if (!cb) return;
  if (didConfirm && cb.onConfirm) cb.onConfirm();
  if (!didConfirm && cb.onCancel) cb.onCancel();
}

/* ---------------------------- Toast ---------------------------- */
let toastTimer = null;
function showToast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------------------------- Copy & Download ---------------------------- */
function buildMatrix(loc) {
  const header = ['Tên NV', ...DAYS.map(d => d.label)];
  const rows = loc.employees.map(emp => {
    const cells = DAYS.map(d => (loc.schedule[d.key][emp.id] || []).slice().sort((a, b) => a.s - b.s).map(shiftLabel).join(', '));
    return [`${emp.name} (${emp.code})`, ...cells];
  });
  return [header, ...rows];
}

function copyTable() {
  const loc = getActiveLocation();
  if (!loc || !loc.employees.length) {
    showToast('Chưa có dữ liệu để lưu.', 'warn');
    return;
  }
  
  // === Lưu snapshot toàn bộ lịch các quán vào localStorage để nhân viên xem ===
  const snapshot = {
    publishedAt: new Date().toISOString(),
    locations: state.data.locations.map(l => {
      const locSched = {};
      DAYS.forEach(d => {
        locSched[d.key] = {};
        l.employees.forEach(emp => {
          const shifts = (l.schedule[d.key] && l.schedule[d.key][emp.id]) || [];
          if (shifts.length > 0) {
            locSched[d.key][emp.id] = shifts.map(sh => ({ s: sh.s, e: sh.e }));
          }
        });
      });
      return {
        id: l.id,
        name: l.name,
        require3Before9: l.require3Before9,
        employees: l.employees.map(e => ({ id: e.id, name: e.name, code: e.code })),
        schedule: locSched
      };
    })
  };
  // Lưu cache cục bộ
  localStorage.setItem('cfhm-published-schedule', JSON.stringify(snapshot));
  // Lưu vào file server (đồng bộ tất cả thiết bị)
  fetch('/data/published_schedule.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot)
  }).catch(e => console.warn('Không lưu được published schedule:', e));
  
  const originalTable = document.querySelector('table.schedule');
  if (!originalTable) {
    showToast('Không tìm thấy bảng lịch làm việc.', 'warn');
    return;
  }

  showToast('✅ Đã lưu lịch vào hệ thống! Đang tạo ảnh...');

  // Create temporary wrapper
  const tempContainer = document.createElement('div');
  tempContainer.style.cssText = 'position: absolute; left: -9999px; top: -9999px; background: #ffffff; padding: 24px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); width: ' + (originalTable.offsetWidth + 48) + 'px; font-family: "Be Vietnam Pro", Inter, sans-serif;';
  
  // Header with store name
  const header = document.createElement('div');
  header.style.cssText = 'text-align: center; margin-bottom: 20px; border-bottom: 2px solid #0e7c66; padding-bottom: 14px;';
  header.innerHTML = '<h2 style="margin: 0; font-size: 22px; font-weight: 800; color: #0e7c66; letter-spacing: 0.05em; text-transform: uppercase;">LỊCH LÀM VIỆC — ' + loc.name.toUpperCase() + '</h2>';
  tempContainer.appendChild(header);

  // Clone table
  const clonedTable = originalTable.cloneNode(true);
  clonedTable.style.width = '100%';
  clonedTable.style.minWidth = '920px';
  clonedTable.style.setProperty('position', 'relative', 'important');
  
  // Force all sticky headers and cells to static to fix html2canvas position:sticky rendering bug
  const stickyEls = clonedTable.querySelectorAll('th, td, thead, tbody, tr');
  stickyEls.forEach(el => {
    el.style.setProperty('position', 'static', 'important');
  });

  // Remove empty hints so the image is clean
  const emptyHints = clonedTable.querySelectorAll('.cell-empty-hint');
  emptyHints.forEach(hint => hint.innerHTML = '&nbsp;');

  tempContainer.appendChild(clonedTable);
  
  // Append inside panel-schedule to inherit all css variables properly
  const parentContainer = document.getElementById('panel-schedule') || document.body;
  parentContainer.appendChild(tempContainer);

  html2canvas(tempContainer, {
    scale: 2.5,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff'
  }).then(canvas => {
    canvas.toBlob(blob => {
      tempContainer.remove();
      if (!blob) {
        showToast('Không thể tạo hình ảnh.', 'danger');
        return;
      }
      
      try {
        const item = new ClipboardItem({ 'image/png': blob });
        navigator.clipboard.write([item]).then(() => {
          showToast('✅ Đã sao chép ảnh lịch ' + loc.name + ' vào clipboard!');
        }).catch(err => {
          console.error(err);
          downloadBlobImage(blob, loc.name);
        });
      } catch (e) {
        console.error(e);
        downloadBlobImage(blob, loc.name);
      }
    }, 'image/png');
  }).catch(err => {
    console.error(err);
    showToast('Lỗi khi chuyển đổi bảng sang hình ảnh.', 'danger');
    tempContainer.remove();
  });
}

function downloadBlobImage(blob, locName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lich-lam-viec-' + locName.toLowerCase().replace(/\s+/g, '-') + '.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Do cài đặt bảo mật trình duyệt, ảnh đã được tải về máy!', 'info');
}


function downloadCSV() {
  const loc = getActiveLocation();
  if (!loc.employees.length) { showToast('Chưa có dữ liệu để tải xuống.', 'warn'); return; }
  const matrix = buildMatrix(loc);
  const csv = '\uFEFF' + matrix.map(row => row.map(escapeCsv).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lich-lam-viec-${loc.name.toLowerCase().replace(/\s+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Đã tải xuống file CSV — mở được bằng Excel.');
}

/* ---------------------------- Wire up events ---------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  renderAll();

  $('#btn-employees').addEventListener('click', openEmployeeDrawer);
  $('#btn-empty-add').addEventListener('click', openEmployeeDrawer);
  $('#emp-drawer-close').addEventListener('click', closeEmployeeDrawer);
  $('#btn-add-emp').addEventListener('click', handleAddEmployee);
  $('#input-new-emp').addEventListener('keydown', e => { if (e.key === 'Enter') handleAddEmployee(); });

  $('#drawer-close').addEventListener('click', closeShiftDrawer);
  $('#btn-cancel-drawer').addEventListener('click', closeShiftDrawer);
  $('#btn-add-shift').addEventListener('click', handleAddShift);
  $('#btn-save-drawer').addEventListener('click', handleSaveDrawer);

  $('#overlay').addEventListener('click', () => { closeShiftDrawer(); closeEmployeeDrawer(); });

  $('#confirm-cancel').addEventListener('click', () => closeConfirm(false));
  $('#confirm-ok').addEventListener('click', () => closeConfirm(true));
  $('#confirm-overlay').addEventListener('click', e => { if (e.target.id === 'confirm-overlay') closeConfirm(false); });

  $('#btn-copy').addEventListener('click', copyTable);
  $('#btn-download').addEventListener('click', downloadCSV);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#confirm-overlay').hidden) closeConfirm(false);
      else { closeShiftDrawer(); closeEmployeeDrawer(); }
    }
  });
});
