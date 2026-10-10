"use strict";

/* ==================== CONFIGURARE ==================== */
// Cheile de stocare rămân identice, ca datele existente să fie păstrate.
const KEYS = {
    subjects: "pro_catalog_db_v4",
    settings: "pro_settings_db_v4",
    calendar: "pro_calendar_db_v4",
    alerts: "pro_alerts_db_v4", // nu se mai scrie: alertele se regenerează la fiecare calcul
    activity: "pro_activity_db_v4",
    achievements: "pro_achievements_db_v4",
    firstRun: "pro_has_run_v4",
    history: "pro_history_db_v4",
    alertMeta: "pro_alert_meta_db_v4",
    simulator: "pro_simulator_db_v4", // note ipotetice + scenarii; separat de notele reale
    backupUndo: "pro_backup_undo_v4", // copia datelor de dinainte de ultimul import (pentru „Anulează importul”)
    lastExport: "pro_last_export_v4", // momentul ultimului backup exportat
    timetable: "pro_timetable_db_v4", // orarul săptămânal: { 1: ["Matematică", ...], ... }
    purtare: "pro_purtare_db_v4",     // purtarea pe module: { grades: { "2026-2": { val, reason } }, ... }
    brand: "pro_brand_v4",            // a trecut o dată prin schimbarea mărcii (Zece → urNotes)
    plan: "pro_plan_db_v4"            // planul de studiu: preferințe de timp + sesiuni (vezi PLANUL MEU)
};


/* ==================== PURTARE ==================== */
/*
 * Purtarea e preinstalată în catalog și nu se poate șterge.
 * Pornește de la 10 la începutul fiecărui modul; se salvează doar modulele în care a fost modificată:
 *   state.purtare.grades["2026-2"] = { val: 9, reason: "..." }
 * Cheia = anul în care începe Modulul 1 + numărul modulului, deci schimbarea vacanței mobile nu pierde nimic.
 * În media generală intră media modulelor începute (ca o materie; în modul ponderat, cu 1 oră).
 */
const PURTARE_KEY = "__purtare__";
const PURTARE_WEIGHT = 1;
const PURTARE_KEY_RE = /^\d{4}-[1-5]$/;

/** Structura anului școlar 2026–2027 (OM nr. 3194/2026). Modulele 3–4 depind de vacanța mobilă a județului. */
const MODULE_PRESETS = {
    "2026-feb15": { label: "2026–2027 · vacanța mobilă 15–21 februarie", m3End: "2027-02-12", m4Start: "2027-02-22" },
    "2026-feb22": { label: "2026–2027 · vacanța mobilă 22–28 februarie", m3End: "2027-02-19", m4Start: "2027-03-01" },
    "2026-mar01": { label: "2026–2027 · vacanța mobilă 1–7 martie", m3End: "2027-02-26", m4Start: "2027-03-08" }
};
const DEFAULT_MODULE_PRESET = "2026-feb22";

function presetModules(id = DEFAULT_MODULE_PRESET) {
    const p = MODULE_PRESETS[id] || MODULE_PRESETS[DEFAULT_MODULE_PRESET];
    return [
        { start: "2026-09-07", end: "2026-10-23" },
        { start: "2026-11-02", end: "2026-12-22" },
        { start: "2027-01-11", end: p.m3End },
        { start: p.m4Start, end: "2027-04-23" },
        { start: "2027-05-05", end: "2027-06-18" }
    ];
}

const DEFAULT_SETTINGS = {
    goals: { primary: "gpa", targetGPA: 10, minGPA: 9 },
    calc: { method: "weighted", rounding: "2", riskThreshold: 8, riskDrop: 0.5 },
    targets: { tens: 20, evals: 30 },
    appearance: { theme: "system", accent: "violet", density: "normal", cursor: "off", island: "on" },
    // Modulele anului școlar (pentru purtare): [{ start, end }] × 5
    modules: presetModules(),
    // Raportul pentru printare: datele de pe antet, perioada și secțiunile alese ultima dată
    report: { name: "", cls: "", period: "year", sections: {} },
    // Personalizare: cum îl cheamă pe elev și cum și-a botezat mascota (post-it-ul de pe pagina Azi)
    profile: { name: "", buddy: "Tiți" },
    // Programa elevului (aleasă în configurare): de ea depind materiile care se pot adăuga
    school: { profile: "", cls: 0, variant: "", lm2: "Limba franceză" }
};

const REPORT_SECTIONS = [
    { key: "grades", label: "Toate notele, pe fiecare materie", on: true },
    { key: "need", label: "Ce notă îți trebuie la următoarea evaluare", on: true },
    { key: "chart", label: "Graficul mediei generale", on: true },
    { key: "modules", label: "Mediile pe module și purtarea", on: true },
    { key: "upcoming", label: "Evaluările din următoarele 30 de zile", on: true },
    { key: "tips", label: "Recomandări", on: true },
    { key: "plan", label: "Planul de studiu pentru următoarele 7 zile", on: false },
    { key: "sign", label: "Loc pentru semnătura părintelui", on: false }
];

const ACHIEVEMENTS = [
    { key: "first_grade", icon: "trophy", label: "Prima notă", toast: "🏆 Prima notă înregistrată!", test: m => m.totalGrades >= 1 },
    { key: "five_tens", icon: "flame", label: "5 note de 10", toast: "🔥 Ai acumulat 5 note de 10!", test: m => m.tensCount >= 5 },
    { key: "high_avg", icon: "trend-up", label: "Media peste 9", toast: "📈 Media generală a depășit 9.00!", test: m => m.globalAvg >= 9 },
    { key: "perfect_10", icon: "target", label: "Media 10", toast: "🎯 Performanță maximă: media 10.00!", test: m => m.globalAvg >= 10 },
    { key: "ten_evals", icon: "notebook", label: "10 evaluări", toast: "📚 10 evaluări înregistrate!", test: m => m.totalGrades >= 10 }
];

// Culoarea cernelii: o nuanță pentru caiet (luminos) și una mai deschisă, ca de cretă, pentru tablă (întunecat).
const ACCENTS = {
    violet: { light: "#5B3CC4", dark: "#C3A6FF" },
    blue: { light: "#2347C5", dark: "#8DB4FF" },
    pink: { light: "#B8336A", dark: "#FF9EC0" },
    green: { light: "#18794E", dark: "#8FDCAF" },
    orange: { light: "#C2410C", dark: "#FFB27A" }
};
const MONTHS = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const GRADE_TYPES = ["Test", "Ascultare", "Temă", "Proiect", "Teză", "Altele"];
const EVENT_TYPES = ["Test", "Examen", "Temă", "Proiect", "Prezentare", "Personal"];
const EXAM_TYPES = new Set(["Test", "Examen"]);

/* ==================== STATE ==================== */
// `state` conține doar date salvate. Tot ce se calculează stă în `metrics`.
const state = {
    subjects: {},
    calendar: {},
    timetable: {},
    purtare: defaultPurtare(),
    activity: [],
    history: [],
    alertMeta: { dismissed: {}, read: {} },
    achievements: Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, false])),
    settings: clone(DEFAULT_SETTINGS),
    plan: defaultPlan()
};

let metrics = emptyMetrics();
let alerts = [];

const ui = {
    activeTab: "tab-dashboard",
    cal: { view: "week", date: getLocalDateKey() }, // ziua în jurul căreia se afișează săptămâna/luna
    ttDraft: null,
    // Catalog: materia deschisă, căutare, sortare, filtru; showDetail = pe telefon, detaliile acoperă lista
    catalog: { selected: "", query: "", sort: "group", filter: "all", showDetail: false, autoPicked: true, collapsed: {} },
    charts: {},
    home: { day: null },     // Azi: null = automat (după-amiaza arată ziua următoare), "today" | "next"
    statsSort: "attention",
    statsPeriod: "year",   // perioada pentru Materii / Note / Timp
    statsAnimate: false,   // animațiile rulează la deschiderea tabului, nu la fiecare recalculare
    modalReturnFocus: null
};

/* ==================== UTILITARE ==================== */
/** Iconiță din setul din index.html (linie simplă, în culoarea textului). */
function icon(name, cls = "") {
    return `<svg class="ico${cls ? ` ${cls}` : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function $(id) {
    return document.getElementById(id);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, incoming) {
    const output = clone(base);
    if (!isPlainObject(incoming)) return output;

    for (const [key, value] of Object.entries(incoming)) {
        if (key === "__proto__") continue; // date importate: nu lăsăm un fișier să modifice prototipul
        output[key] = isPlainObject(value) && isPlainObject(output[key])
            ? deepMerge(output[key], value)
            : value;
    }
    return output;
}

function safeParseJSON(raw, fallback) {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch (err) {
        console.warn("Date locale invalide; se folosește valoarea implicită.", err);
        return fallback;
    }
}

function clampNumber(value, min, max, fallback) {
    const parsed = parseFloat(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clampInteger(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/** Întoarce un întreg în [min, max] sau null dacă valoarea nu e validă (fără „corectare” tăcută). */
function parseStrictInteger(value, min, max) {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return n >= min && n <= max ? n : null;
}

function roundValue(value, decimals = 2) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function getLocalDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey) {
    const [y, m, d] = String(dateKey).split("-").map(Number);
    return new Date(y, m - 1, d);
}

function getDateLabel(dateKey) {
    return parseDateKey(dateKey).toLocaleDateString("ro-RO");
}

function getShortDateLabel(dateKey) {
    return parseDateKey(dateKey).toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" });
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[ch]));
}

function uid() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}




/* ==================== CALENDAR: MODEL ==================== */
/*
 * Un eveniment e salvat o singură dată, la data lui de început (state.calendar[data] = [...]).
 * Câmpuri opționale:
 *   repeat:    { every: 1|2 (săptămâni), until: "YYYY-MM-DD" | "" }
 *   doneDates: { "YYYY-MM-DD": true }    — apariții marcate ca făcute
 *   skipDates: ["YYYY-MM-DD", ...]       — apariții șterse/mutate dintr-o serie
 * O notă adăugată dintr-un test păstrează legătura: grade.eventId + grade.eventDate.
 * „Făcut” = bifat SAU are notă legată. Nota rămâne sursa de adevăr: dacă o ștergi, testul redevine nefinalizat.
 */
const DAY_MS = 86400000;
const WEEKDAY_SHORT = ["Du", "Lu", "Ma", "Mi", "Jo", "Vi", "Sâ"];
const WEEKDAY_LONG = ["Duminică", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă"];
const MONTH_SHORT = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];
const TIMETABLE_DAYS = [1, 2, 3, 4, 5];
const TIMETABLE_MAX = 10;
const GRADE_TYPE_FOR_EVENT = { Test: "Test", Examen: "Teză", Temă: "Temă", Proiect: "Proiect", Prezentare: "Altele" };
const NEEDS_GRADE = new Set(["Test", "Examen", "Proiect", "Prezentare"]);
const EVENT_TYPE_CLASS = { Test: "test", Examen: "examen", Temă: "tema", Proiect: "proiect", Prezentare: "prezentare", Personal: "personal" };
const EVENT_TYPE_ICON = { Test: "note", Examen: "graduation", Temă: "book", Proiect: "shapes", Prezentare: "mic", Personal: "pin" };

function addDays(dateKey, n) {
    const d = parseDateKey(dateKey);
    d.setDate(d.getDate() + n);
    return getLocalDateKey(d);
}

function daysBetween(a, b) {
    return Math.round((parseDateKey(b) - parseDateKey(a)) / DAY_MS);
}

/** Lunea săptămânii care conține data. */
function weekStart(dateKey) {
    return addDays(dateKey, -((parseDateKey(dateKey).getDay() + 6) % 7));
}

function shortDayLabel(dateKey) {
    const d = parseDateKey(dateKey);
    return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

function weekdayLabel(dateKey) {
    const d = parseDateKey(dateKey);
    return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** „azi”, „mâine”, „ieri”, „în 3 zile”, „acum 5 zile”. */
function relativeDayLabel(dateKey) {
    const n = daysBetween(getLocalDateKey(), dateKey);
    if (n === 0) return "azi";
    if (n === 1) return "mâine";
    if (n === -1) return "ieri";
    return n > 0 ? `în ${plural(n, "zi", "zile")}` : `acum ${plural(-n, "zi", "zile")}`;
}

/** Cheia unei apariții: id-ul simplu pentru evenimente unice (compatibil cu datele vechi). */
function occurrenceKey(ev, date) {
    return ev.repeat ? `${ev.id}@${date}` : ev.id;
}

/** Datele la care apare un eveniment în intervalul [from, to]. */
function seriesDates(ev, start, from, to) {
    if (!ev.repeat) return start >= from && start <= to ? [start] : [];

    const step = 7 * ev.repeat.every;
    const end = ev.repeat.until && ev.repeat.until < to ? ev.repeat.until : to;
    const skip = new Set(ev.skipDates || []);
    const out = [];
    const firstIndex = Math.max(0, Math.ceil(daysBetween(start, from) / step));
    for (let date = addDays(start, firstIndex * step); date <= end && out.length < 500; date = addDays(date, step)) {
        if (!skip.has(date)) out.push(date);
    }
    return out;
}

/** Toate aparițiile din interval, sortate după dată și oră. */
function occurrencesBetween(from, to) {
    const out = [];
    for (const [start, events] of Object.entries(state.calendar)) {
        if (start > to) continue;
        events.forEach(ev => seriesDates(ev, start, from, to).forEach(date => {
            out.push({ ev, date, start, key: occurrenceKey(ev, date) });
        }));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.ev.time || "").localeCompare(b.ev.time || ""));
}

function findEvent(id) {
    for (const [start, events] of Object.entries(state.calendar)) {
        const ev = events.find(e => e.id === id);
        if (ev) return { ev, start };
    }
    return null;
}

/** Notele legate de evenimente, indexate după „idEveniment|dată”. */
function gradeLinks() {
    const map = new Map();
    for (const [mat, sub] of Object.entries(state.subjects)) {
        sub.grades.forEach((grade, idx) => {
            if (grade.eventId) map.set(`${grade.eventId}|${grade.eventDate || grade.date || ""}`, { mat, idx, grade });
        });
    }
    return map;
}

function linkedGrade(links, ev, date) {
    return links.get(`${ev.id}|${date}`) || null;
}

function isOccurrenceDone(ev, date, links) {
    return Boolean(ev.doneDates?.[date]) || Boolean(linkedGrade(links, ev, date));
}

/** Se poate adăuga nota direct din eveniment: are materie, e evaluabil, a avut loc, nu are deja notă. */
function canGradeOccurrence(ev, date, links) {
    return Boolean(state.subjects[ev.subject]) && Boolean(GRADE_TYPE_FOR_EVENT[ev.type])
        && date <= getLocalDateKey() && !linkedGrade(links, ev, date);
}

/** Prima zi (după `after`) în care materia apare în orar. */
function nextLessonDate(mat, after = getLocalDateKey()) {
    for (let i = 1; i <= 14; i++) {
        const date = addDays(after, i);
        if ((state.timetable[parseDateKey(date).getDay()] || []).includes(mat)) return date;
    }
    return null;
}

function autoEventTitle(type, subject) {
    return subject ? `${type} ${subject}` : type;
}

function pruneTimetable() {
    for (const day of Object.keys(state.timetable)) {
        state.timetable[day] = state.timetable[day].filter(m => state.subjects[m]);
        if (state.timetable[day].length === 0) delete state.timetable[day];
    }
}

/* ==================== PURTARE (logică) ==================== */
function matchingModulePreset(list) {
    return Object.keys(MODULE_PRESETS).find(id => JSON.stringify(presetModules(id)) === JSON.stringify(list)) || "custom";
}

/** Întoarce un mesaj de eroare sau null dacă lista de module e validă. */
function validateModules(list) {
    if (!Array.isArray(list) || list.length !== 5) return "Sunt necesare exact 5 module.";
    for (let i = 0; i < 5; i++) {
        const m = list[i];
        const ok = d => typeof d === "string" && DATE_KEY_RE.test(d) && !Number.isNaN(parseDateKey(d).getTime());
        if (!isPlainObject(m) || !ok(m.start) || !ok(m.end)) return `Modulul ${i + 1}: completează ambele date.`;
        if (m.end < m.start) return `Modulul ${i + 1}: se termină înainte să înceapă.`;
        if (i > 0 && m.start <= list[i - 1].end) return `Modulul ${i + 1} trebuie să înceapă după sfârșitul Modulului ${i}.`;
    }
    if (daysBetween(list[0].start, list[4].end) > 400) return "Modulele trebuie să fie în același an școlar.";
    return null;
}

function sanitizeModules(raw) {
    const list = Array.isArray(raw) ? raw.map(m => (isPlainObject(m) ? { start: String(m.start || ""), end: String(m.end || "") } : null)) : null;
    return validateModules(list) ? presetModules() : list;
}

function defaultPurtare() {
    return { grades: {}, excludeFromGPA: false, lastModule: "" };
}

function sanitizePurtare(raw) {
    const p = defaultPurtare();
    if (!isPlainObject(raw)) return p;
    if (isPlainObject(raw.grades)) {
        for (const [key, g] of Object.entries(raw.grades)) {
            if (!PURTARE_KEY_RE.test(key) || !isPlainObject(g)) continue;
            const val = parseStrictInteger(g.val, 1, 10);
            if (val === null) continue;
            const reason = typeof g.reason === "string" ? g.reason.trim().slice(0, 120) : "";
            if (val !== 10 || reason) p.grades[key] = reason ? { val, reason } : { val };
        }
    }
    p.excludeFromGPA = raw.excludeFromGPA === true;
    p.lastModule = typeof raw.lastModule === "string" && PURTARE_KEY_RE.test(raw.lastModule) ? raw.lastModule : "";
    return p;
}

/** Situația purtării la o dată: modulele, modulul curent și media lor. */
function purtareInfo(today = getLocalDateKey()) {
    const list = state.settings.modules;
    const year = list[0].start.slice(0, 4);
    const modules = list.map((m, i) => {
        const key = `${year}-${i + 1}`;
        const saved = state.purtare.grades[key];
        const status = today < m.start ? "upcoming" : today > m.end ? "done" : "current";
        return {
            n: i + 1,
            key,
            start: m.start,
            end: m.end,
            status,
            val: status === "upcoming" ? null : (saved?.val ?? 10),
            reason: saved?.reason || "",
            changed: Boolean(saved)
        };
    });

    const started = modules.filter(m => m.status !== "upcoming");
    const current = modules.find(m => m.status === "current") || null;
    const lastDone = [...modules].reverse().find(m => m.status === "done") || null;
    const next = modules.find(m => m.status === "upcoming") || null;
    // Înainte de primul modul nota e 10 (se reînnoiește); după ultimul rămâne media anului.
    const avg = started.length ? started.reduce((s, m) => s + m.val, 0) / started.length : 10;
    const shown = current || lastDone;

    return {
        modules,
        current,
        lastDone,
        next,
        started: started.length,
        avg,
        value: shown ? shown.val : 10,
        shown,
        yearOver: !current && !next
    };
}

function purtareTone(val) {
    return val >= 10 ? "ok" : val >= 6 ? "warn" : "danger";
}

/** La purtare, orice notă sub 10 e o scădere: o colorăm ca atare (nu cu scala notelor obișnuite). */
function purtareGradeClass(val) {
    return { ok: "tone-hi", warn: "tone-low", danger: "tone-fail" }[purtareTone(val)];
}

function moduleRange(m) {
    return `${shortDayLabel(m.start)} – ${shortDayLabel(m.end)}`;
}

/** O materie veche numită „Purtare”, adăugată manual înainte de această versiune. */
function isLegacyPurtareName(name) {
    return foldText(String(name).trim()) === "purtare";
}

/** La începutul unui modul nou: jurnal + mesaj. Prima rulare doar memorează modulul. */
function checkModuleRollover() {
    const cur = metrics.purtare?.current;
    if (!cur || state.purtare.lastModule === cur.key) return;
    const firstRun = !state.purtare.lastModule;
    state.purtare.lastModule = cur.key;
    if (firstRun) return;
    addActivity(`A început Modulul ${cur.n}. Purtarea pornește din nou de la 10.`);
    showToast(`🎖️ A început Modulul ${cur.n} — purtarea pornește din nou de la 10.`);
}

/* ---------- catalog ---------- */
function purtareRowHTML() {
    const p = metrics.purtare;
    const selected = ui.catalog.selected === PURTARE_KEY;
    const where = p.current ? `Modulul ${p.current.n}` : p.yearOver ? "an încheiat" : p.next ? `de la ${shortDayLabel(p.next.start)}` : "";
    return `
        <button type="button" class="cat-row is-purtare ${selected ? "selected" : ""}" data-action="cat-select" data-mat="${PURTARE_KEY}"
            ${selected ? 'aria-current="true"' : ""}>
            <span class="cat-purtare-icon" aria-hidden="true">${icon("medal")}</span>
            <span class="cat-row-main">
                <span class="cat-row-name">Purtare</span>
                <span class="cat-row-meta" title="Pornește de la 10 la începutul fiecărui modul">${escapeHTML([where, "se reînnoiește"].filter(Boolean).join(" · "))}</span>
            </span>
            <span class="cat-row-avg">
                <b class="tone-text-${purtareTone(p.value)}">${p.value}</b>
                <small>${p.started > 1 ? `media ${p.avg.toFixed(2)}` : "din 10"}</small>
            </span>
        </button>`;
}

function purtareVisibleInList() {
    const q = foldText(ui.catalog.query.trim());
    return ui.catalog.filter === "all" && (!q || "purtare".includes(q));
}

function renderPurtareDetail() {
    const p = metrics.purtare;
    const today = getLocalDateKey();
    const inGPA = !state.purtare.excludeFromGPA;
    const editable = p.shown;
    const badge = p.value >= 10 ? ["badge-ok", "Maximă"] : p.value >= 6 ? ["badge-warn", "Scăzută"] : ["badge-danger", "Sub 6"];

    const stat = (title, value, caption, tone = "") => `
        <div class="cat-stat ${tone}">
            <span class="kpi-title">${title}</span>
            <b>${value}</b>
            <small>${caption}</small>
        </div>`;

    let nowTile;
    let daysTile;
    if (p.current) {
        const left = daysBetween(today, p.current.end);
        nowTile = stat(`Modulul ${p.current.n}`, `<span class="cat-grade-val ${purtareGradeClass(p.current.val)}">${p.current.val}</span>`, escapeHTML(moduleRange(p.current)));
        daysTile = stat("Până la final", left === 0 ? "azi" : plural(left, "zi", "zile"), `modulul se încheie pe ${escapeHTML(shortDayLabel(p.current.end))}`);
    } else if (p.next) {
        nowTile = stat(p.lastDone ? `Modulul ${p.lastDone.n}` : "Purtare", `<span class="cat-grade-val ${purtareGradeClass(p.value)}">${p.value}</span>`,
            p.lastDone ? "încheiat · acum e vacanță" : "pornește de la 10");
        daysTile = stat(`Modulul ${p.next.n}`, escapeHTML(shortDayLabel(p.next.start)), `începe ${escapeHTML(relativeDayLabel(p.next.start))}, de la 10`);
    } else {
        nowTile = stat("Ultimul modul", `<span class="cat-grade-val ${purtareGradeClass(p.value)}">${p.value}</span>`, "anul școlar s-a încheiat");
        daysTile = stat("An școlar", "încheiat", "actualizează modulele în Setări");
    }

    $("cat-detail").innerHTML = `
        <div class="glass-card cat-detail-card purtare-card">
            <button type="button" class="btn btn-text cat-back" data-action="cat-back">← Toate materiile</button>

            <header class="cat-detail-head">
                <div class="cat-detail-title-wrap">
                    <div class="cat-title-row">
                        <h3 class="cat-title" id="cat-detail-title" tabindex="-1">${icon("medal")} Purtare</h3>
                        <span class="badge ${badge[0]}">${badge[1]}</span>
                        ${inGPA ? "" : `<span class="badge cat-badge-muted">${icon("ban")} Exclusă din medie</span>`}
                    </div>
                    <p class="subtitle">Preinstalată · pornește de la 10 la începutul fiecărui modul</p>
                </div>
                ${editable ? `
                    <div class="cat-head-actions">
                        <button type="button" class="btn btn-primary" data-action="purtare-edit" data-key="${editable.key}">${icon("pen")} Modifică nota${p.current ? "" : ` (M${editable.n})`}</button>
                    </div>` : ""}
            </header>

            <div class="cat-stats">
                ${nowTile}
                ${stat("Media anuală", p.started ? p.avg.toFixed(2) : "10", p.started ? `din ${plural(p.started, "modul", "module")}` : "încă niciun modul", p.avg < 10 ? "is-warn" : "is-ok")}
                ${stat("Module", `${p.modules.filter(m => m.status === "done").length}<span class="sim-round">/5</span>`, "încheiate")}
                ${daysTile}
            </div>

            <section class="cat-block" aria-labelledby="purtare-mod-title">
                <div class="cat-block-head">
                    <h4 id="purtare-mod-title">${icon("calendar")} Pe module</h4>
                    <button type="button" class="btn btn-text cat-inline-btn" data-action="purtare-settings">Datele modulelor →</button>
                </div>
                <ol class="purtare-modules">
                    ${p.modules.map(m => purtareModuleHTML(m, today)).join("")}
                </ol>
            </section>

            <p class="muted-small purtare-note">
                ${inGPA
                    ? `Intră în media generală ca o materie${state.settings.calc.method === "weighted" ? ` (cu ${PURTARE_WEIGHT} oră în media ponderată)` : ""}, cu media modulelor de până acum.`
                    : "Nu intră în media generală."}
            </p>

            <footer class="cat-detail-foot">
                <button type="button" class="btn btn-text" data-action="purtare-toggle-gpa">
                    ${inGPA ? `${icon("ban")} Exclude din media generală` : `${icon("undo")} Include în media generală`}
                </button>
            </footer>
        </div>`;
}

function purtareModuleHTML(m, today) {
    const statusLabel = { done: "Încheiat", current: "În curs", upcoming: "Urmează" }[m.status];
    const progress = m.status === "current"
        ? Math.round((daysBetween(m.start, today) + 1) / (daysBetween(m.start, m.end) + 1) * 100)
        : 0;
    return `
        <li class="purtare-mod is-${m.status}">
            <div class="purtare-mod-head">
                <b>Modulul ${m.n}</b>
                <span class="purtare-mod-status">${statusLabel}</span>
            </div>
            <small class="purtare-mod-dates">${escapeHTML(moduleRange(m))}</small>
            <div class="purtare-mod-body">
                ${m.val === null
                    ? `<span class="purtare-mod-future">pornește de la 10</span>`
                    : `<span class="cat-grade-val ${purtareGradeClass(m.val)}">${m.val}</span>
                       <button type="button" class="btn btn-glass icon-btn" data-action="purtare-edit" data-key="${m.key}"
                           title="Modifică nota" aria-label="Modifică purtarea pe Modulul ${m.n}">${icon("pen")}</button>`}
            </div>
            ${m.reason ? `<small class="purtare-mod-reason">${escapeHTML(m.reason)}</small>` : ""}
            ${m.status === "current" ? `<span class="purtare-mod-bar" aria-hidden="true"><span style="width:${progress}%"></span></span>` : ""}
        </li>`;
}

function openPurtareModal(key) {
    const m = metrics.purtare.modules.find(x => x.key === key);
    if (!m || m.val === null) return;

    openModal({
        layout: "panel",
        title: `Purtare · Modulul ${m.n}`,
        confirmText: "Salvează",
        body: `
            <p class="modal-hint">${escapeHTML(moduleRange(m))}. Fiecare modul pornește de la 10; modifică nota doar dacă a fost scăzută.</p>
            <div class="form-group">
                <label for="purtare-val">Nota la purtare (1-10)</label>
                <input type="number" id="purtare-val" class="glass-input" min="1" max="10" step="1" value="${m.val}" inputmode="numeric">
            </div>
            <div class="form-group">
                <label for="purtare-reason">Motiv <span class="label-hint">(opțional)</span></label>
                <input type="text" id="purtare-reason" class="glass-input" maxlength="120" autocomplete="off"
                    value="${escapeHTML(m.reason)}" placeholder="ex: absențe nemotivate">
            </div>
            ${m.changed ? `<button type="button" class="btn btn-text" data-action="purtare-reset" data-key="${m.key}">↺ Revino la 10</button>` : ""}`,
        onConfirm: () => {
            const val = parseStrictInteger(field("purtare-val"), 1, 10);
            if (val === null) {
                showToast("⚠️ Nota trebuie să fie un număr întreg între 1 și 10.");
                $("purtare-val")?.focus();
                return;
            }
            setPurtare(m, val, field("purtare-reason").trim().slice(0, 120));
        }
    });
    $("purtare-val")?.select();
}

function setPurtare(m, val, reason) {
    const before = m.val;
    if (val === 10 && !reason) delete state.purtare.grades[m.key];
    else state.purtare.grades[m.key] = reason ? { val, reason } : { val };

    if (before !== val) addActivity(`Purtare, Modulul ${m.n}: ${before} → ${val}${reason ? ` (${reason})` : ""}.`);
    closeActionModal();
    refresh();
    showToast(before === val ? "Purtare actualizată." : `Purtarea pe Modulul ${m.n}: ${val}.`);
}

/* ---------- setări: modulele ---------- */
function renderModulesSettings(list = state.settings.modules) {
    const box = $("set-modules");
    if (!box) return;
    box.innerHTML = list.map((m, i) => `
        <div class="module-row">
            <b>Modulul ${i + 1}</b>
            <input type="date" id="set-mod-${i}-start" class="glass-input" value="${escapeHTML(m.start)}" aria-label="Modulul ${i + 1}: început">
            <span aria-hidden="true">–</span>
            <input type="date" id="set-mod-${i}-end" class="glass-input" value="${escapeHTML(m.end)}" aria-label="Modulul ${i + 1}: sfârșit">
        </div>`).join("");
    syncModulePresetSelect();
}

function readModulesFromSettings() {
    return Array.from({ length: 5 }, (_, i) => ({ start: field(`set-mod-${i}-start`), end: field(`set-mod-${i}-end`) }));
}

function syncModulePresetSelect() {
    const select = $("set-module-preset");
    if (!select) return;
    const id = matchingModulePreset(readModulesFromSettings());
    select.value = id;
    select.querySelector('option[value="custom"]').hidden = id !== "custom";
}

function bindPurtareEvents() {
    $("set-module-preset")?.addEventListener("change", event => {
        if (MODULE_PRESETS[event.target.value]) renderModulesSettings(presetModules(event.target.value));
    });
    $("set-modules")?.addEventListener("change", syncModulePresetSelect);
}

/* ==================== STOCARE ==================== */
const lastWritten = {};
let storageErrorShown = false;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function loadState() {
    applyLoadedData(readStoredData(name => safeParseJSON(localStorage.getItem(KEYS[name]), null)));

    // urNotes: cine avea culoarea implicită de dinainte (albastru) trece o singură dată pe violetul noii mărci.
    try {
        if (!localStorage.getItem(KEYS.brand)) {
            if (state.settings.appearance.accent === "blue") state.settings.appearance.accent = "violet";
            localStorage.setItem(KEYS.brand, "urnotes");
        }
    } catch (_) { /* fără stocare: rămâne culoarea din setări */ }

    // Cheia veche de alerte nu mai e folosită.
    try {
        localStorage.removeItem(KEYS.alerts);
    } catch (_) { /* ignorăm */ }
}

/**
 * Citește și validează toate datele printr-o funcție `read(nume)`.
 * Aceeași funcție servește la pornire (din localStorage) și la importul unui backup,
 * deci un fișier importat trece prin exact aceleași verificări ca datele salvate.
 * Nu modifică starea aplicației: întoarce un obiect nou.
 */
function readStoredData(read) {
    const data = {
        settings: read("settings"),
        subjects: read("subjects"),
        calendar: read("calendar"),
        timetable: read("timetable"),
        purtare: read("purtare"),
        activity: read("activity"),
        history: read("history"),
        alertMeta: read("alertMeta"),
        achievements: read("achievements"),
        plan: read("plan")
    };
    normalizeState(data);
    return { data, sim: parseSimulator(read("simulator")) };
}

function applyLoadedData({ data, sim: loadedSim }) {
    Object.assign(state, data);
    sim = loadedSim;
}

const cleanName = (value, max) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Setări complete și valide, indiferent ce conține sursa. */
function sanitizeSettings(raw) {
    const s = deepMerge(DEFAULT_SETTINGS, raw);
    for (const group of Object.keys(DEFAULT_SETTINGS)) {
        if (group !== "modules" && !isPlainObject(s[group])) s[group] = clone(DEFAULT_SETTINGS[group]);
    }
    const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

    return {
        goals: {
            primary: pick(s.goals.primary, ["gpa", "tens", "evals"], "gpa"),
            targetGPA: clampNumber(s.goals.targetGPA, 5, 10, 10),
            minGPA: clampNumber(s.goals.minGPA, 5, 10, 9)
        },
        calc: {
            method: pick(s.calc.method, ["weighted", "arithmetic"], "weighted"),
            rounding: pick(String(s.calc.rounding), ["2", "0"], "2"),
            riskThreshold: clampNumber(s.calc.riskThreshold, 1, 10, 8),
            riskDrop: clampNumber(s.calc.riskDrop, 0.1, 5, 0.5)
        },
        targets: {
            tens: clampInteger(s.targets.tens, 1, 1000, 20),
            evals: clampInteger(s.targets.evals, 1, 10000, 30)
        },
        appearance: {
            theme: pick(s.appearance.theme, ["system", "light", "dark"], "system"),
            accent: pick(s.appearance.accent, Object.keys(ACCENTS), "violet"),
            density: pick(s.appearance.density, ["normal", "compact", "spacious"], "normal"),
            cursor: pick(s.appearance.cursor, CURSOR_MODES, "off"),
            island: pick(s.appearance.island, ["on", "off"], "on")
        },
        school: {
            profile: typeof s.school?.profile === "string" && SETUP_PROFILES[s.school.profile] ? s.school.profile : "",
            cls: Number.isInteger(s.school?.cls) ? s.school.cls : 0,
            variant: typeof s.school?.variant === "string" ? s.school.variant.slice(0, 30) : "",
            lm2: LM2_CHOICES.includes(s.school?.lm2) ? s.school.lm2 : LM2_CHOICES[0]
        },
        modules: sanitizeModules(s.modules),
        report: {
            name: typeof s.report.name === "string" ? s.report.name.trim().slice(0, 60) : "",
            cls: typeof s.report.cls === "string" ? s.report.cls.trim().slice(0, 30) : "",
            period: typeof s.report.period === "string" && /^(year|30d|m[1-5])$/.test(s.report.period) ? s.report.period : "year",
            sections: Object.fromEntries(REPORT_SECTIONS.map(x => [x.key,
                isPlainObject(s.report.sections) && typeof s.report.sections[x.key] === "boolean" ? s.report.sections[x.key] : x.on]))
        },
        profile: {
            name: cleanName(s.profile.name, 40),
            buddy: cleanName(s.profile.buddy, 20) || DEFAULT_SETTINGS.profile.buddy
        }
    };
}

function normalizeGrade(g) {
    if (!isPlainObject(g)) return null;
    const val = Number(g.val);
    if (!Number.isFinite(val) || val < 1 || val > 10) return null;
    // Ponderea notelor a fost eliminată: fiecare notă contează o singură dată.
    const grade = { val, type: GRADE_TYPES.includes(g.type) ? g.type : "Altele" };
    if (typeof g.date === "string" && DATE_KEY_RE.test(g.date)) grade.date = g.date;
    // Legătura cu testul din calendar din care a fost adăugată nota.
    if (g.eventId && typeof g.eventDate === "string" && DATE_KEY_RE.test(g.eventDate)) {
        grade.eventId = String(g.eventId).slice(0, 100);
        grade.eventDate = g.eventDate;
    }
    return grade;
}

function normalizeEvent(ev, dateKey) {
    const out = {
        id: ev.id ? String(ev.id) : uid(),
        title: String(ev.title ?? "").trim().slice(0, 100) || "Eveniment",
        time: typeof ev.time === "string" && TIME_RE.test(ev.time) ? ev.time : "",
        type: EVENT_TYPES.includes(ev.type) ? ev.type : "Personal",
        subject: typeof ev.subject === "string" ? ev.subject : "",
        description: typeof ev.description === "string" ? ev.description.slice(0, 500) : ""
    };

    if (isPlainObject(ev.repeat)) {
        const until = typeof ev.repeat.until === "string" && DATE_KEY_RE.test(ev.repeat.until) && ev.repeat.until >= dateKey ? ev.repeat.until : "";
        out.repeat = { every: Number(ev.repeat.every) === 2 ? 2 : 1, until };
    }

    const done = {};
    if (isPlainObject(ev.doneDates)) {
        Object.keys(ev.doneDates).forEach(d => { if (DATE_KEY_RE.test(d) && ev.doneDates[d] === true) done[d] = true; });
    }
    if (ev.done === true) done[dateKey] = true;
    if (Object.keys(done).length) out.doneDates = done;

    if (out.repeat && Array.isArray(ev.skipDates)) {
        const skip = [...new Set(ev.skipDates.filter(d => typeof d === "string" && DATE_KEY_RE.test(d)))];
        if (skip.length) out.skipDates = skip;
    }
    return out;
}

/** Repară și migrează datele vechi fără să piardă nimic valid. Lucrează pe obiectul primit. */
function normalizeState(s) {
    s.settings = sanitizeSettings(s.settings);
    s.purtare = sanitizePurtare(s.purtare);
    s.plan = sanitizePlan(s.plan);

    const meta = isPlainObject(s.alertMeta) ? s.alertMeta : {};
    s.alertMeta = {
        dismissed: isPlainObject(meta.dismissed) ? meta.dismissed : {},
        read: isPlainObject(meta.read) ? meta.read : {}
    };

    s.achievements = Object.fromEntries(
        ACHIEVEMENTS.map(a => [a.key, isPlainObject(s.achievements) && s.achievements[a.key] === true])
    );

    // Materii: păstrăm doar câmpurile salvate (versiunile vechi salvau și valorile calculate).
    const subjects = {};
    for (const [mat, sub] of Object.entries(isPlainObject(s.subjects) ? s.subjects : {})) {
        if (!isPlainObject(sub) || !mat.trim() || mat === "__proto__" || mat === PURTARE_KEY) continue;
        subjects[mat] = {
            ore: clampNumber(sub.ore, 0.5, 100, 2),
            target: clampNumber(sub.target, 1, 10, 10),
            grades: (Array.isArray(sub.grades) ? sub.grades : []).map(normalizeGrade).filter(Boolean),
            priority: Boolean(sub.priority),
            excludeFromGPA: Boolean(sub.excludeFromGPA)
        };
    }
    s.subjects = subjects;

    // Calendar: fiecare eveniment primește un id stabil; alertele vechi sunt migrate pe noul id.
    const calendar = {};
    for (const [dateKey, events] of Object.entries(isPlainObject(s.calendar) ? s.calendar : {})) {
        if (!DATE_KEY_RE.test(dateKey) || !Array.isArray(events)) continue;
        const list = events.filter(isPlainObject).map(raw => {
            const ev = normalizeEvent(raw, dateKey);
            const legacyId = `exam-${dateKey}-${normalizeLegacyId(raw.title)}`;
            ["dismissed", "read"].forEach(bucket => {
                if (s.alertMeta[bucket][legacyId]) s.alertMeta[bucket][examAlertId(ev)] = true;
            });
            return ev;
        });
        if (list.length) calendar[dateKey] = list;
    }
    s.calendar = calendar;

    // Orar: doar zilele Luni–Vineri și doar materii existente.
    const tt = isPlainObject(s.timetable) ? s.timetable : {};
    s.timetable = {};
    TIMETABLE_DAYS.forEach(day => {
        const list = (Array.isArray(tt[day]) ? tt[day] : []).filter(m => typeof m === "string" && subjects[m]).slice(0, TIMETABLE_MAX);
        if (list.length) s.timetable[day] = list;
    });

    ["dismissed", "read"].forEach(bucket => {
        Object.keys(s.alertMeta[bucket])
            .filter(id => id.startsWith("exam-") && !id.startsWith("exam:"))
            .forEach(id => delete s.alertMeta[bucket][id]);
    });

    s.history = (Array.isArray(s.history) ? s.history : [])
        .filter(item => isPlainObject(item) && DATE_KEY_RE.test(String(item.date)))
        .slice(-90);
    s.activity = (Array.isArray(s.activity) ? s.activity : []).filter(isPlainObject).slice(0, 100);
}

function normalizeLegacyId(value = "") {
    return String(value).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

function examAlertId(ev) {
    return `exam:${ev.id}`;
}

/** Scrie doar cheile care s-au schimbat de la ultima salvare. */
function saveState() {
    if (guest.on) return; // ca vizitator nu se salvează nimic (nici caietul de exemplu)
    saveCounter++;
    const payload = {
        [KEYS.settings]: state.settings,
        [KEYS.subjects]: state.subjects,
        [KEYS.calendar]: state.calendar,
        [KEYS.timetable]: state.timetable,
        [KEYS.purtare]: state.purtare,
        [KEYS.activity]: state.activity,
        [KEYS.achievements]: state.achievements,
        [KEYS.history]: state.history,
        [KEYS.alertMeta]: state.alertMeta,
        [KEYS.simulator]: sim,
        [KEYS.plan]: state.plan
    };

    let changed = false;
    for (const [key, value] of Object.entries(payload)) {
        const json = JSON.stringify(value);
        if (lastWritten[key] === json) continue;
        changed = true;
        try {
            localStorage.setItem(key, json);
            lastWritten[key] = json;
        } catch (err) {
            console.error("Salvarea a eșuat.", err);
            if (!storageErrorShown) {
                storageErrorShown = true;
                showToast("⚠️ Datele nu au putut fi salvate. Verifică spațiul de stocare al browserului.");
            }
            return;
        }
    }
    if (changed) onLocalDataChange();
}

/* ==================== MOTOR DE CALCUL ==================== */
function emptyMetrics() {
    return {
        subjects: {},
        globalAvg: 0,
        rawGlobalAvg: 0,
        riskCount: 0,
        totalGrades: 0,
        tensCount: 0,
        maxGrade: null,
        minGrade: null,
        purtare: null
    };
}

/**
 * Calculează mediile pentru un set de materii.
 * Implicit cele reale; Simulatorul trimite o copie cu notele ipotetice adăugate.
 */
function calculateMetrics(subjects = state.subjects) {
    const calc = state.settings.calc;
    const decimals = Number(calc.rounding);
    const m = emptyMetrics();

    let weightedSum = 0;
    let weightTotal = 0;
    let arithmeticSum = 0;
    let arithmeticCount = 0;

    for (const [mat, sub] of Object.entries(subjects)) {
        let sum = 0;
        const count = sub.grades.length;

        sub.grades.forEach(g => {
            const value = clampNumber(g.val, 1, 10, 1);
            sum += value;

            m.totalGrades++;
            if (value === 10) m.tensCount++;
            m.maxGrade = m.maxGrade === null ? value : Math.max(m.maxGrade, value);
            m.minGrade = m.minGrade === null ? value : Math.min(m.minGrade, value);
        });

        const rawAvg = count > 0 ? sum / count : 0;
        const exactAvg = count > 0 ? roundValue(rawAvg, decimals) : 0;
        const d = {
            rawAvg,
            exactAvg,
            roundedAvg: exactAvg > 0 ? Math.round(exactAvg) : 0,
            requiredNotes: Math.max(0, Math.ceil(sub.ore) + 3 - sub.grades.length)
        };

        if (sub.grades.length === 0) {
            d.status = "Fără note";
            d.statusClass = "badge-warn";
        } else if (exactAvg < calc.riskThreshold) {
            d.status = "Risc";
            d.statusClass = "badge-danger";
            m.riskCount++;
        } else {
            d.status = "Sigur";
            d.statusClass = "badge-ok";
        }

        if (!sub.excludeFromGPA && rawAvg > 0) {
            weightedSum += rawAvg * sub.ore;
            weightTotal += sub.ore;
            arithmeticSum += rawAvg;
            arithmeticCount++;
        }

        m.subjects[mat] = d;
    }

    // Purtarea intră ca o materie, dar doar dacă există și alte medii (altfel media generală ar fi doar purtarea).
    m.purtare = purtareInfo();
    if (!state.purtare.excludeFromGPA && arithmeticCount > 0) {
        weightedSum += m.purtare.avg * PURTARE_WEIGHT;
        weightTotal += PURTARE_WEIGHT;
        arithmeticSum += m.purtare.avg;
        arithmeticCount++;
    }

    m.rawGlobalAvg = calc.method === "weighted"
        ? (weightTotal > 0 ? weightedSum / weightTotal : 0)
        : (arithmeticCount > 0 ? arithmeticSum / arithmeticCount : 0);
    m.globalAvg = roundValue(m.rawGlobalAvg, decimals);

    return m;
}

function updateHistoryPoint() {
    const today = getLocalDateKey();
    const existing = state.history.find(item => item.date === today);

    if (existing) {
        existing.average = metrics.globalAvg || 0;
        existing.totalGrades = metrics.totalGrades;
    } else if (metrics.totalGrades > 0) {
        state.history.push({ date: today, average: metrics.globalAvg || 0, totalGrades: metrics.totalGrades });
    }

    if (state.history.length > 90) {
        state.history = state.history.slice(-90);
    }
}

function checkAchievements() {
    if (metrics.totalGrades === 0) return;

    ACHIEVEMENTS.forEach(a => {
        if (!state.achievements[a.key] && a.test(metrics)) {
            state.achievements[a.key] = true;
            showToast(a.toast);
        }
    });
}

const NONOTE_GROUP_ID = "nonote:group";
const NONOTE_GROUP_MIN = 3;

function generateAlerts() {
    const list = [];
    const { dismissed, read } = state.alertMeta;
    const push = alert => {
        if (!dismissed[alert.id]) list.push({ ...alert, unread: read[alert.id] !== true });
    };

    // Materiile fără note: câte o alertă dacă sunt 1–2; altfel una singură (ex. imediat după configurare).
    const empty = Object.keys(state.subjects).filter(mat => state.subjects[mat].grades.length === 0);
    if (empty.length >= NONOTE_GROUP_MIN) {
        const shown = empty.slice(0, 3).join(", ");
        push({
            id: NONOTE_GROUP_ID,
            text: `Nu ai încă note la ${plural(empty.length, "materie", "materii")}: ${shown}${empty.length > 3 ? ` și încă ${empty.length - 3}` : ""}.`,
            type: "warning", icon: "note", filter: "empty"
        });
    } else {
        // Dacă elevul a ascuns alerta grupată, materiile rămase nu revin una câte una; apoi alerta grupată e „uitată”,
        // ca să poată apărea din nou într-o situație nouă (ex. după ce adaugă alte materii).
        ["dismissed", "read"].forEach(bucket => {
            if (!state.alertMeta[bucket][NONOTE_GROUP_ID]) return;
            empty.forEach(mat => { state.alertMeta[bucket][`nonote-${mat}`] = true; });
            delete state.alertMeta[bucket][NONOTE_GROUP_ID];
        });
        empty.forEach(mat => push({ id: `nonote-${mat}`, text: `Nu ai nicio notă înregistrată la ${mat}.`, type: "warning", icon: "note", mat }));
    }

    for (const [mat] of Object.entries(state.subjects)) {
        const d = metrics.subjects[mat];

        if (d.exactAvg > 0 && d.exactAvg < state.settings.calc.riskThreshold) {
            push({ id: `risk-${mat}`, text: `Media la ${mat} e sub pragul de risc: ${d.exactAvg.toFixed(2)}.`, type: "critical", icon: "alert", mat });
        }
    }

    const today = getLocalDateKey();
    const links = gradeLinks();
    occurrencesBetween(today, addDays(today, 60)).forEach(({ ev, date, key }) => {
        if (!EXAM_TYPES.has(ev.type) || isOccurrenceDone(ev, date, links)) return;
        push({
            id: `exam:${key}`,
            text: `${ev.type} „${ev.title}”${ev.subject ? ` la ${ev.subject}` : ""}, ${relativeDayLabel(date)} (${getDateLabel(date)}).`,
            type: "warning", icon: "calendar-check", date
        });
    });

    // Planul de azi: câte sesiuni mai sunt
    const planToday = state.plan.prefs.setup ? state.plan.items.filter(it => it.date === today && !it.done) : [];
    if (planToday.length) {
        push({
            id: `plan:${today}`,
            text: `Azi ai ${plural(planToday.length, "sesiune", "sesiuni")} în plan (${planToday.reduce((n, it) => n + it.min, 0)} min): ${planToday.map(it => it.mat).join(", ")}.`,
            type: "success", icon: "calendar-check", tab: "tab-plan"
        });
    }

    // Teste trecute fără notă: legătura dintre calendar și catalog.
    occurrencesBetween(addDays(today, -30), addDays(today, -1)).forEach(({ ev, date, key }) => {
        if (!NEEDS_GRADE.has(ev.type) || !state.subjects[ev.subject] || isOccurrenceDone(ev, date, links)) return;
        push({
            id: `ungraded:${key}`,
            text: `Ai avut „${ev.title}” la ${ev.subject} pe ${getDateLabel(date)}. Adaugă nota din Calendar.`,
            type: "warning", icon: "pen", date
        });
    });

    return list;
}

/** Șterge metadatele de alertă care nu mai corespund niciunei materii existente. */
function pruneSubjectAlertMeta() {
    const valid = new Set([NONOTE_GROUP_ID]);
    Object.keys(state.subjects).forEach(mat => {
        valid.add(`nonote-${mat}`);
        valid.add(`risk-${mat}`);
    });

    ["dismissed", "read"].forEach(bucket => {
        Object.keys(state.alertMeta[bucket])
            .filter(id => !isEventAlertId(id) && !valid.has(id))
            .forEach(id => delete state.alertMeta[bucket][id]);
    });
}

function isEventAlertId(id) {
    return id.startsWith("exam:") || id.startsWith("ungraded:") || id.startsWith("plan:");
}

/** Șterge starea alertelor (citit/eliminat) pentru toate aparițiile unui eveniment. */
function clearEventAlertMeta(ev) {
    const ids = [`exam:${ev.id}`, `ungraded:${ev.id}`];
    ["dismissed", "read"].forEach(bucket => {
        Object.keys(state.alertMeta[bucket])
            .filter(id => ids.some(base => id === base || id.startsWith(`${base}@`)))
            .forEach(id => delete state.alertMeta[bucket][id]);
    });
}

function clearAllEventAlertMeta() {
    ["dismissed", "read"].forEach(bucket => {
        Object.keys(state.alertMeta[bucket]).filter(isEventAlertId).forEach(id => delete state.alertMeta[bucket][id]);
    });
}

function addActivity(text) {
    const now = new Date();
    state.activity.unshift({
        id: uid(),
        ts: now.toISOString(),
        time: now.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }),
        text
    });
    if (state.activity.length > 100) {
        state.activity.length = 100;
    }
}

/**
 * Punctul central: recalculează, salvează, apoi redesenează doar tabul vizibil.
 * Salvarea are loc înainte de randare, așa că o eroare de afișare nu poate pierde date.
 */
function refresh() {
    guestGuard(); // vizitatorii nu pot schimba nimic: o modificare ajunsă în date se anulează aici
    metrics = calculateMetrics();
    checkModuleRollover();
    updateHistoryPoint();
    if (!guest.on) checkAchievements(); // vizitatorii (și caietul de exemplu) nu primesc realizări
    updatePlan();
    alerts = generateAlerts();
    pruneTimetable();
    pruneSimulator();
    saveState();

    renderNotificationBadge();
    if (!$("notif-panel")?.hidden) renderAlerts();
    renderActiveTab({ keepSettingsForm: true });
    islandAfterRefresh();
}

/* ==================== RANDARE ==================== */
const TAB_RENDERERS = {
    "tab-dashboard": renderDashboard,
    "tab-plan": renderPlan,
    "tab-catalog": renderCatalog,
    "tab-calendar": renderCalendar,
    "tab-simulator": renderSimulator,
    "tab-statistici": renderStatistics,
    "tab-setari": loadSettingsIntoUI
};

function renderActiveTab({ keepSettingsForm = false } = {}) {
    // Formularul de setări nu e redesenat la fiecare calcul, ca să nu pierdem ce scrie utilizatorul.
    if (keepSettingsForm && ui.activeTab === "tab-setari") return;

    const render = TAB_RENDERERS[ui.activeTab];
    if (!render) return;

    try {
        render();
    } catch (err) {
        console.error(`Eroare la afișarea ${ui.activeTab}.`, err);
    }
}

function emptyNote(text) {
    return `<p class="empty-note">${escapeHTML(text)}</p>`;
}

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}

function renderNotificationBadge() {
    const badge = $("notif-badge");
    if (!badge) return;
    const unread = alerts.filter(a => a.unread).length;
    badge.textContent = unread;
    badge.hidden = unread === 0;
    $("notif-btn")?.setAttribute("aria-label", unread > 0 ? `Notificări (${unread} necitite)` : "Notificări");
}

/* ---------- DASHBOARD ---------- */
/* ==================== AZI (pagina de start) ==================== */
/*
 * Răspunde la „ce am azi?”: orele din orar (cu testele zilei marcate), ce e de făcut,
 * media pe scurt, ultimele note și materiile de urmărit.
 * După-amiaza (de la 15:00) arată automat ziua de școală următoare — ca să-ți faci ghiozdanul.
 */
const HOME_EVENING_HOUR = 15;

/** Modulul care conține data (cu numărul lui) sau null în vacanță. */
function moduleAt(dateKey) {
    const list = state.settings.modules;
    const i = list.findIndex(m => dateKey >= m.start && dateKey <= m.end);
    return i >= 0 ? { n: i + 1, ...list[i] } : null;
}

function isSchoolDay(dateKey) {
    const wd = parseDateKey(dateKey).getDay();
    return wd >= 1 && wd <= 5 && Boolean(moduleAt(dateKey));
}

function nextSchoolDay(after) {
    for (let i = 1; i <= 200; i++) {
        const date = addDays(after, i);
        if (isSchoolDay(date)) return date;
    }
    return null;
}

function lessonsOn(dateKey) {
    return isSchoolDay(dateKey) ? (state.timetable[parseDateKey(dateKey).getDay()] || []) : [];
}

/** Ziua din cardul cu ore: azi sau următoarea zi de școală. */
function homeDays(now = new Date()) {
    const today = getLocalDateKey(now);
    const next = nextSchoolDay(today);
    const todayBusy = isSchoolDay(today) || occurrencesBetween(today, today).length > 0;
    let pick = ui.home.day || (todayBusy && now.getHours() < HOME_EVENING_HOUR ? "today" : "next");
    if (pick === "next" && !next) pick = "today";
    return { today, next, pick, date: pick === "next" ? next : today };
}

/** „azi”, „mâine”, „vineri”, „luni, 2 nov”. */
function dayWord(date, today = getLocalDateKey()) {
    const n = daysBetween(today, date);
    if (n === 0) return "azi";
    if (n === 1) return "mâine";
    if (n === -1) return "ieri";
    const wd = WEEKDAY_LONG[parseDateKey(date).getDay()].toLowerCase();
    return n > 0 && n < 7 ? wd : `${wd}, ${shortDayLabel(date)}`;
}

const capitalize = text => text ? text[0].toLocaleUpperCase("ro") + text.slice(1) : text;

function longDateLabel(date) {
    const d = parseDateKey(date);
    return `${WEEKDAY_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`;
}

function greeting(hour) {
    if (hour >= 5 && hour < 11) return "Bună dimineața";
    if (hour >= 11 && hour < 18) return "Bună ziua";
    return "Bună seara";
}

/* ==================== PERSONALIZARE: ELEVUL ȘI MASCOTA ==================== */
/*
 * Mascota e un post-it cu fața desenată; elevul îi alege numele (Setări sau configurarea).
 * Starea ei vine din note și din calendar: bucuroasă după un 10 sau când media e sus,
 * concentrată înaintea unui test, îngrijorată când o materie e sub pragul de risc.
 */
const firstName = () => state.settings.profile.name.split(" ")[0] || "";
const buddyName = () => state.settings.profile.buddy || DEFAULT_SETTINGS.profile.buddy;
const formatAvg = v => Number(v).toFixed(2);

/*
 * Fața mascotei, pe stări. Ochii „normali” au pupilele într-un grup separat (.buddy-pupils),
 * ca să poată urmări cursorul; celelalte stări (râde, „au!”) își desenează singure ochii.
 */
const INK = "#2A1B5C";
const EYES_OPEN = (r = 4.5) => `<g class="b-eyes-pop"><g class="buddy-eyes">
    <circle cx="44" cy="55" r="9.5" fill="#FFFFFF"/><circle cx="76" cy="55" r="9.5" fill="#FFFFFF"/>
    <g class="buddy-pupils"><circle cx="45" cy="56" r="${r}" fill="${INK}"/><circle cx="77" cy="56" r="${r}" fill="${INK}"/></g>
</g></g>`;
const bLine = (d, w = 3.6, cls = "") => `<path class="${cls}" d="${d}" stroke="${INK}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const STAR = (x, y, s = 1, fill = "#FFFFFF") => `<g transform="translate(${x} ${y}) scale(${s})"><path class="b-spark" d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" fill="${fill}" stroke="${INK}" stroke-width="0.8"/></g>`;
const HEART = (x, y) => `<g transform="translate(${x} ${y})"><path class="b-heart" d="M0 4 C-7 -1 -4 -7 0 -3 C4 -7 7 -1 0 4 Z" fill="#FF5C8A"/></g>`;
// Efecte în jurul mascotei (steluțe, abur, stropi…), animate din CSS după starea ei.
const BUDDY_FX = {
    giggle: STAR(18, 26, 0.9, "#FFE58A") + STAR(102, 20, 0.7, "#FFE58A") + STAR(106, 44, 0.5, "#FFFFFF"),
    surprised: `<g class="b-shock">${bLine("M10 42 L2 37M9 52 L0 52M10 62 L2 67M110 42 L118 37M111 52 L120 52M110 62 L118 67", 2.6)}</g>`,
    ouch: `<g class="b-orbit">${STAR(38, 6, 1, "#FFE58A")}${STAR(82, 6, 1, "#FFE58A")}${STAR(60, -2, 0.8, "#FFFFFF")}</g>`,
    dizzy: `<g class="b-orbit is-slow">${STAR(38, 6, 0.95, "#FFE58A")}${STAR(82, 6, 0.95, "#FFE58A")}${STAR(60, -2, 0.75, "#FF9EC0")}</g>`,
    angry: `<circle class="b-steam" cx="22" cy="8" r="5" fill="#FFFFFF" stroke="${INK}" stroke-width="0.8"/><circle class="b-steam is-late" cx="98" cy="6" r="5" fill="#FFFFFF" stroke="${INK}" stroke-width="0.8"/>`,
    worried: `<path class="b-sweat" d="M95 30 Q90 38 95 41 Q100 38 95 30 Z" fill="#8FD3FF" stroke="${INK}" stroke-width="0.8"/>`,
    love: HEART(20, 30) + `<g class="is-late">${HEART(100, 24)}</g>` + HEART(104, 52)
};
const SPIRAL = (cx, cy) => `<g transform="translate(${cx} ${cy})"><path class="b-spiral" d="M0 0 m0 -1.5 a1.5 1.5 0 1 1 -1.5 1.5 a3.5 3.5 0 1 1 3.5 3.5 a5.5 5.5 0 1 1 -5.5 -5.5 a7.5 7.5 0 1 1 7.5 7.5" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`;
const BUDDY_FACES = {
    happy: { eyes: EYES_OPEN(), mouth: bLine("M50 72 Q60 84 70 72", 3.6, "b-mouth") },
    focused: { eyes: EYES_OPEN(), mouth: bLine("M52 76 H68", 3.6, "b-mouth") },
    worried: { eyes: EYES_OPEN(), brows: bLine("M36 41 L50 44M84 41 L70 44", 3, "b-brows"), mouth: bLine("M50 81 Q60 70 70 81", 3.6, "b-mouth") },
    giggle: { eyes: bLine("M36 57 Q44 48 52 57M68 57 Q76 48 84 57", 3.4, "b-squint"), mouth: `<g class="b-mouth"><path d="M47 69 Q60 90 73 69 Z" fill="${INK}"/><path d="M53 79 Q60 85 67 79" fill="#FF7AA8"/></g>` },
    surprised: { eyes: EYES_OPEN(3), brows: bLine("M36 39 Q44 34 51 38M69 38 Q76 34 84 39", 3, "b-brows"), mouth: `<ellipse class="b-mouth" cx="60" cy="78" rx="5.5" ry="7" fill="${INK}"/>` },
    ouch: { eyes: bLine("M38 50 L50 61M50 50 L38 61", 3.4, "b-x") + bLine("M70 50 L82 61M82 50 L70 61", 3.4, "b-x"), mouth: bLine("M47 79 q4.3 -5 8.6 0 t8.6 0 t8.6 0", 3.2, "b-mouth") },
    dizzy: { eyes: SPIRAL(44, 55) + SPIRAL(76, 55), mouth: bLine("M48 80 Q54 74 60 80 T72 80", 3.2, "b-mouth") },
    angry: { eyes: EYES_OPEN(4), brows: bLine("M35 42 L51 48M85 42 L69 48", 3.6, "b-brows"), mouth: bLine("M50 80 Q60 73 70 80", 3.6, "b-mouth"), hot: true },
    love: { eyes: HEART(44, 55).replace('class="b-heart"', 'class="b-heart-eye"').replace("translate(44 55)", "translate(44 55) scale(1.7)") + HEART(76, 55).replace('class="b-heart"', 'class="b-heart-eye"').replace("translate(76 55)", "translate(76 55) scale(1.7)"),
        mouth: bLine("M48 71 Q60 86 72 71", 3.6, "b-mouth"), hot: true }
};

function buddySVG(mood = "happy", cls = "") {
    const f = BUDDY_FACES[mood] || BUDDY_FACES.happy;
    const cheek = f.hot ? "#FF5C7A" : "#FF7AA8";
    return `<svg class="buddy ${cls}" viewBox="0 0 120 120" aria-hidden="true" data-mood="${mood}">
        <g class="buddy-body"><g class="buddy-anim">
            <g transform="rotate(-6 60 62)">
                <path d="M14 18H106V86L88 104H14Z" fill="#FFC93C"/>
                <path d="M88 104V86H106Z" fill="#E0A21C"/>
                <rect x="44" y="10" width="32" height="13" fill="#FF9EC0"/>
                ${f.eyes}${f.brows || ""}
                <g class="b-cheeks"><ellipse cx="31" cy="70" rx="6.5" ry="3.8" fill="${cheek}" opacity="0.75"/><ellipse cx="89" cy="70" rx="6.5" ry="3.8" fill="${cheek}" opacity="0.75"/></g>
                ${f.mouth}
                ${BUDDY_FX[mood] || ""}
            </g>
        </g></g>
    </svg>`;
}

/*
 * Mascota urmărește cursorul: pupilele se uită spre el și corpul se apleacă puțin.
 * O singură ascultare de „pointermove” + requestAnimationFrame, pentru toate mascotele de pe ecran.
 */
const buddyLook = { x: -1, y: -1, frame: 0 };
function initBuddyLook() {
    const calm = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const update = () => {
        buddyLook.frame = 0;
        document.querySelectorAll(".buddy").forEach(svg => {
            const r = svg.getBoundingClientRect();
            if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
            const dx = buddyLook.x - (r.left + r.width / 2);
            const dy = buddyLook.y - (r.top + r.height * 0.45);
            const dist = Math.hypot(dx, dy) || 1;
            const reach = Math.min(1, dist / 60) * 3.6; // aproape de el, privirea se adună spre centru
            const pupils = svg.querySelector(".buddy-pupils");
            if (pupils) pupils.style.transform = `translate(${(dx / dist * reach).toFixed(2)}px, ${(dy / dist * reach).toFixed(2)}px)`;
            const body = svg.querySelector(".buddy-body");
            if (body && !calm) body.style.transform = `rotate(${Math.max(-7, Math.min(7, dx / 70)).toFixed(2)}deg)`;
        });
    };
    const track = event => {
        buddyLook.x = event.clientX;
        buddyLook.y = event.clientY;
        if (!buddyLook.frame) buddyLook.frame = requestAnimationFrame(update);
    };
    document.addEventListener("pointermove", track, { passive: true });
    document.addEventListener("pointerdown", track, { passive: true });
}

/*
 * Clic pe mascotă: fără text, doar fața și corpul reacționează. La clicuri repetate:
 * râde, se miră, „au!”, se supără (cu abur), amețește, apoi face pace (cu inimioare).
 */
const BUDDY_POKES = ["giggle", "giggle", "surprised", "ouch", "angry", "angry", "dizzy", "love"];
const buddyPoke = { n: 0, last: 0, timer: 0, rest: null };

function pokeBuddy(btn, event) {
    const box = btn.closest(".azi-buddy");
    if (!box) return;
    const now = Date.now();
    buddyPoke.n = now - buddyPoke.last < 4000 ? (buddyPoke.n % BUDDY_POKES.length) + 1 : 1;
    buddyPoke.last = now;
    btn.innerHTML = buddySVG(BUDDY_POKES[buddyPoke.n - 1]);

    // Apăsat ca un buton: se turtește pe loc, apoi revine (nu fuge în nicio direcție).
    btn.classList.remove("is-hit", "is-calm");
    void btn.offsetWidth; // repornește animația
    btn.classList.add("is-hit");

    // După câteva secunde de liniște, revine la fața de zi cu zi (mesajul rămâne neatins).
    clearTimeout(buddyPoke.timer);
    buddyPoke.timer = setTimeout(() => {
        buddyPoke.n = 0;
        if (buddyPoke.rest && document.contains(btn)) {
            btn.classList.remove("is-hit");
            btn.classList.add("is-calm"); // revine fără să „apară” din nou
            btn.innerHTML = buddySVG(buddyPoke.rest.mood);
        }
    }, 5000);
}

/** Ce simte și ce îi spune mascota elevului azi. */
function buddyState({ today }, { tests }) {
    const name = firstName();
    const hey = name ? `, ${name}` : "";
    const mats = Object.keys(state.subjects);
    if (!mats.length) return { mood: "happy", text: `Eu sunt ${buddyName()}, colegul tău de bancă. Adaugă-ți materiile și te ajut să ții evidența notelor.` };

    // Cel mai recent 10 (ultimele 7 zile)
    let ten = null;
    for (const mat of mats) {
        for (const g of state.subjects[mat].grades) {
            if (g.val === 10 && g.date && daysBetween(g.date, today) <= 7 && (!ten || g.date > ten.date)) ten = { mat, date: g.date };
        }
    }
    const risk = mats
        .filter(mat => metrics.subjects[mat]?.statusClass === "badge-danger")
        .sort((a, b) => metrics.subjects[a].exactAvg - metrics.subjects[b].exactAvg)[0];
    const soon = tests.find(o => daysBetween(today, o.date) <= 1);

    if (ten && daysBetween(ten.date, today) <= 2) return { mood: "happy", text: `Un 10 la ${ten.mat}! Bravo${hey}, ți-am lipit o steluță.` };
    const planToday = state.plan.prefs.setup ? state.plan.items.filter(it => it.date === today) : [];
    if (planToday.length && planToday.every(it => it.done)) return { mood: "love", text: `Gata planul de azi! Bravo${hey}, mă bucur tare.` };
    if (risk) return { mood: "worried", text: `${risk} e la ${formatAvg(metrics.subjects[risk].exactAvg)}, sub pragul tău de ${formatAvg(state.settings.calc.riskThreshold)}. ${state.plan.prefs.setup ? "Am pus sesiuni pentru ea în planul tău." : "Facem un plan împreună? Îl găsești la „Plan”."}` };
    const todo = planToday.filter(it => !it.done);
    if (todo.length && new Date().getHours() >= 15) return { mood: "focused", text: `Mai ai ${plural(todo.length, "sesiune", "sesiuni")} în planul de azi. Începem cu ${todo[0].mat}?` };
    if (soon) {
        const what = `${soon.ev.type.toLocaleLowerCase("ro")}${soon.ev.subject ? ` la ${soon.ev.subject}` : ""}`;
        return { mood: "focused", text: `${capitalize(dayWord(soon.date, today))} ai ${what}. Recapitulăm puțin${hey}?` };
    }
    if (ten) return { mood: "happy", text: `Săptămâna asta ai luat 10 la ${ten.mat}. Continuă tot așa${hey}!` };
    if (metrics.globalAvg >= 9) return { mood: "happy", text: `Media ta e ${formatAvg(metrics.globalAvg)}. Ești pe drumul cel bun${hey}!` };
    if (metrics.totalGrades === 0) return { mood: "happy", text: `Când primești prima notă, scrie-o aici și îți calculez media${hey}.` };
    return { mood: "happy", text: `Sunt aici${hey}. Pas cu pas, spre ținta de ${formatAvg(state.settings.goals.targetGPA)}.` };
}

function renderBuddy(days, todo) {
    const box = $("azi-buddy");
    if (!box) return;
    buddyPoke.rest = buddyState(days, todo);
    clearTimeout(buddyPoke.timer);
    buddyPoke.n = 0;
    paintBuddy(box, buddyPoke.rest);
}

function paintBuddy(box, { mood, text }) {
    box.innerHTML = `
        <button type="button" class="buddy-poke" data-action="buddy-poke" aria-label="${escapeHTML(`Gâdilă-l pe ${buddyName()}`)}">${buddySVG(mood)}</button>
        <p class="buddy-bubble" aria-live="polite"><b class="buddy-name">${escapeHTML(buddyName())}</b><span>${escapeHTML(text)}</span></p>`;
}

/** Evenimente trecute nefinalizate (ultimele 45 de zile); dintr-o serie, doar ultima apariție (+ câte mai vechi). */
function missedOccurrences(links = gradeLinks(), today = getLocalDateKey()) {
    const out = [];
    const bySeries = new Map();
    occurrencesBetween(addDays(today, -45), addDays(today, -1))
        .filter(o => o.ev.type !== "Personal" && !isOccurrenceDone(o.ev, o.date, links))
        .reverse()
        .forEach(o => {
            const seen = bySeries.get(o.ev.id);
            if (seen) seen.older++;
            else {
                const item = { ...o, older: 0 };
                bySeries.set(o.ev.id, item);
                out.push(item);
            }
        });
    return out;
}

function homeTodo(links, today) {
    return {
        missed: missedOccurrences(links, today),
        homework: occurrencesBetween(today, addDays(today, 6))
            .filter(o => o.ev.type === "Temă" && !isOccurrenceDone(o.ev, o.date, links)),
        tests: occurrencesBetween(today, addDays(today, 13))
            .filter(o => NEEDS_GRADE.has(o.ev.type) && !isOccurrenceDone(o.ev, o.date, links))
    };
}

function renderDashboard() {
    if (!$("azi-day")) return;
    const now = new Date();
    const links = gradeLinks();
    const days = homeDays(now);
    const todo = homeTodo(links, days.today);

    const mod = moduleAt(days.today);
    setText("azi-date", [
        longDateLabel(days.today),
        mod ? `Modulul ${mod.n}, săptămâna ${Math.floor(daysBetween(weekStart(mod.start), days.today) / 7) + 1}` : "Vacanță"
    ].join(" · "));
    const first = firstName();
    setText("h-dashboard", `${greeting(now.getHours())}${first ? `, ${first}` : ""}!`);
    setText("azi-summary", homeSummary(days, todo));
    renderBuddy(days, todo);

    $("azi-day").innerHTML = homeDayHTML(days, links);
    $("azi-todo").innerHTML = homeTodoHTML(todo, links, days.today);
    if ($("azi-plan")) $("azi-plan").innerHTML = homePlanHTML(days.today);
    if ($("azi-start")) { const st = homeStartHTML(); $("azi-start").innerHTML = st; $("azi-start").hidden = !st; }
    $("azi-avg").innerHTML = homeAverageHTML();
    const watch = homeWatchHTML();
    $("azi-watch").innerHTML = watch;
    $("azi-watch").hidden = !watch;
    $("azi-recent").innerHTML = homeRecentHTML();
    $("azi-more").innerHTML = homeMoreHTML();
}

/** Una-două propoziții cu ce contează: orele zilei afișate, următoarea evaluare, ce așteaptă nota. */
function homeSummary({ today, date }, { missed, tests }) {
    const out = [];
    if (!Object.keys(state.subjects).length) return "Adaugă-ți materiile și orarul, iar pagina asta îți va arăta în fiecare zi ce ai de făcut.";

    if (!moduleAt(today)) {
        const next = nextSchoolDay(today);
        out.push(next ? `Ești în vacanță; școala reîncepe ${dayWord(next, today)}.` : "Anul școlar s-a încheiat.");
    }
    if (date && (moduleAt(today) || daysBetween(today, date) <= 1)) {
        const lessons = lessonsOn(date);
        const exams = occurrencesBetween(date, date).filter(o => NEEDS_GRADE.has(o.ev.type));
        const word = capitalize(dayWord(date, today));
        const examText = exams.length === 1
            ? `${exams[0].ev.type.toLocaleLowerCase("ro")}${exams[0].ev.subject ? ` la ${exams[0].ev.subject}` : ""}`
            : `${exams.length} evaluări`;
        if (lessons.length) out.push(`${word} ai ${plural(lessons.length, "oră", "ore")}${exams.length ? ` și ${examText}` : ""}.`);
        else if (exams.length) out.push(`${word} ai ${examText}.`);
    }
    // „Urmează”: o evaluare după azi (testele de azi sunt deja în propoziția zilei sau au trecut).
    const later = tests.find(o => o.date > today && o.date !== date);
    if (later) out.push(`Urmează „${later.ev.title}”, ${dayWord(later.date, today)}.`);
    const ungraded = missed.filter(o => NEEDS_GRADE.has(o.ev.type)).length;
    if (ungraded) out.push(ungraded === 1 ? "Un test așteaptă nota." : `${ungraded} teste așteaptă nota.`);
    return out.length ? out.join(" ") : "Nimic urgent. Ești la zi.";
}

/* ---------- „?”: explicații pe înțelesul tuturor ---------- */
const HELP = {
    gpa: { title: "Media generală", text: "Media tuturor materiilor tale, calculată ca în catalog: fiecare materie are media ei (rotunjită la final), iar media generală e media lor. Dirigenția din liceu și materiile marcate „exclusă” nu intră." },
    target: { title: "Ținta", text: "Media pe care ți-o dorești. O alegi pentru media generală (în Setări) și pentru fiecare materie (din „Editează”). Aplicația îți spune ce note îți trebuie ca s-o atingi." },
    risk: { title: "„La risc”", text: "O materie e la risc când media ei e sub pragul ales de tine (implicit 8). Le vezi primele în Catalog, iar planul îți pune sesiuni în plus pentru ele." },
    need: { title: "Ce îți trebuie", text: "Ce notă îți trebuie la următoarea evaluare ca să ajungi (sau să rămâi) la țintă. Dacă nu se poate dintr-o singură notă, îți spun câte note de un anumit fel îți trebuie." },
    sim: { title: "Simulatorul", text: "Aici încerci note „ce-ar fi dacă”: adaugi note imaginare și vezi cum s-ar schimba mediile. Notele tale reale nu se schimbă." },
    plan: { title: "Planul", text: "Îți împart timpul de învățat pe 7 zile: înainte de teste, pentru teme și pentru materiile care au nevoie. Apeși „Începe”, înveți cât arată cronometrul, iar sesiunea se bifează singură." },
    programme: { title: "Programa", text: "Materiile tale vin din planul-cadru al profilului și clasei tale, plus dirigenția și maximum un opțional (căruia îi scrii tu tema). Alte materii nu se pot adăuga, ca să nu se strice mediile." }
};
const helpDot = key => `<button type="button" class="help-dot" data-action="help" data-key="${key}" aria-label="${escapeHTML(`Ce înseamnă: ${HELP[key].title}?`)}" title="Ce înseamnă?">?</button>`;
function openHelp(key) {
    const h = HELP[key];
    if (!h) return;
    openModal({ title: h.title, body: `<p class="help-text">${escapeHTML(h.text)}</p>`, confirmText: "", cancelText: "Am înțeles", guestOk: true });
}

/* ---------- „Primii pași”: ce face aplicația utilă, bifat singur pe măsură ce elevul le face ---------- */
const START_HIDE_KEY = "pro_start_hidden_v4";
function startSteps() {
    const hasGrade = Object.values(state.subjects).some(sub => sub.grades.length);
    const hasEvent = Object.keys(state.calendar).length > 0;
    const hasTimetable = Object.values(state.timetable).some(list => list.length);
    return [
        { done: Boolean(myProgramme()), label: "Alege-ți programa", hint: "materiile se completează singure", action: "programme-change" },
        { done: hasTimetable, label: "Completează orarul", hint: "ca să vezi orele fiecărei zile", action: "timetable" },
        { done: hasGrade, label: "Adaugă prima notă", hint: "media se calculează singură", action: "add-grade" },
        { done: hasEvent, label: "Pune un test în calendar", hint: "îți spun ce notă îți trebuie", action: "quick-test" },
        { done: state.plan.prefs.setup, label: "Fă-ți planul de învățat", hint: "2 întrebări, restul e automat", action: "nav", tab: "tab-plan" }
    ];
}
function homeStartHTML() {
    let hidden = false;
    try { hidden = localStorage.getItem(START_HIDE_KEY) === "1"; } catch (_) { /* fără stocare */ }
    const steps = startSteps();
    const done = steps.filter(st => st.done).length;
    if (hidden || done === steps.length || (typeof guest !== "undefined" && guest.on)) return "";
    const next = steps.find(st => !st.done);
    return `
        ${homeCardHead("azi-start-title", "rocket", "Primii pași", `<span class="cat-count">${done} din ${steps.length}</span>`)}
        <p class="azi-more-line">Cinci lucruri scurte și aplicația lucrează pentru tine. Apasă pe un pas ca să-l faci acum.</p>
        <ol class="start-steps">
            ${steps.map(st => `
                <li class="${st.done ? "is-done" : ""} ${st === next ? "is-next" : ""}">
                    <button type="button" class="start-step" data-action="${st.done ? "none" : st.action}" ${st.tab ? `data-tab="${st.tab}"` : ""} ${st.done ? 'aria-disabled="true" tabindex="-1"' : ""}>
                        <span class="start-dot" aria-hidden="true">${st.done ? icon("check") : ""}</span>
                        <span class="start-text"><b>${st.label}</b><small>${st.hint}</small></span>
                        ${st.done ? `<span class="sr-only">(făcut)</span>` : icon("chevron", "start-arrow")}
                    </button>
                </li>`).join("")}
        </ol>
        <button type="button" class="btn btn-text btn-sm" data-action="start-hide">Ascunde, mă descurc</button>`;
}

function homeCardHead(id, iconName, title, extra = "") {
    return `<div class="azi-card-head"><h3 id="${id}">${icon(iconName)} ${title}</h3>${extra}</div>`;
}

/** Eticheta unui eveniment lângă materie: tipul (sau titlul, dacă e unul propriu) + ora. */
function evTagHTML(ev, done) {
    const custom = ev.title && ev.title !== autoEventTitle(ev.type, ev.subject);
    const text = custom ? ev.title : ev.type;
    return `<span class="azi-tag ev-${EVENT_TYPE_CLASS[ev.type] || "personal"} ${done ? "is-done" : ""}" title="${escapeHTML(`${ev.type}: ${ev.title}${done ? " (făcut)" : ""}`)}">${icon(done ? "check" : EVENT_TYPE_ICON[ev.type] || "pin")} ${escapeHTML(text)}${ev.time ? ` · ${escapeHTML(ev.time)}` : ""}</span>`;
}

/* ---------- orele zilei ---------- */
function homeDayHTML({ today, next, pick, date }, links) {
    const hasSubjects = Object.keys(state.subjects).length > 0;
    const word = dayWord(date, today);
    const seg = next ? `
        <div class="azi-seg" role="group" aria-label="Ce zi arăt">
            <button type="button" data-action="home-day" data-day="today" aria-pressed="${pick === "today"}">Azi</button>
            <button type="button" data-action="home-day" data-day="next" aria-pressed="${pick === "next"}">${escapeHTML(capitalize(dayWord(next, today).split(",")[0]))}</button>
        </div>` : "";
    const head = `
        <div class="azi-card-head">
            <div>
                <h3 id="azi-day-title">${icon("clock")} Orele de ${escapeHTML(word.split(",")[0])}</h3>
                <span class="subtitle">${escapeHTML(longDateLabel(date))}</span>
            </div>
            ${seg}
        </div>`;

    if (!hasSubjects) {
        return `${head}
            <div class="azi-empty-box">
                <p>Începe cu materiile tale. Apoi completează orarul și aici vei vedea în fiecare zi orele, testele și temele.</p>
                <div class="azi-empty-actions">
                    <button type="button" class="btn btn-primary" data-action="setup-open">${icon("sparkles")} Alege profilul</button>
                    <button type="button" class="btn btn-glass" data-action="add-subject">${icon("plus")} O singură materie</button>
                </div>
            </div>`;
    }

    const occ = occurrencesBetween(date, date);
    const lessons = lessonsOn(date);
    const ttEmpty = Object.keys(state.timetable).length === 0;
    const links7 = occurrencesBetween(addDays(date, 1), addDays(date, 7))
        .filter(o => EXAM_TYPES.has(o.ev.type) && !isOccurrenceDone(o.ev, o.date, links));

    let body;
    if (lessons.length) {
        const used = new Set();
        const rows = lessons.map((mat, i) => {
            const mine = used.has(mat) ? [] : occ.filter(o => o.ev.subject === mat);
            used.add(mat);
            const d = metrics.subjects[mat];
            const sub = state.subjects[mat];
            const exam = mine.some(o => NEEDS_GRADE.has(o.ev.type));
            const soon = links7.find(o => o.ev.subject === mat);
            const bits = [
                ...mine.map(o => evTagHTML(o.ev, isOccurrenceDone(o.ev, o.date, links))),
                soon && !exam ? `<span class="azi-hint">${icon("calendar-check")} ${escapeHTML(soon.ev.type.toLocaleLowerCase("ro"))} ${escapeHTML(dayWord(soon.date, today))}</span>` : "",
                d?.statusClass === "badge-danger" ? `<span class="azi-hint is-risk">${icon("alert")} la risc</span>` : "",
                sub?.priority ? `<span class="azi-hint">${icon("star")} prioritară</span>` : ""
            ].filter(Boolean);
            const avg = d && sub.grades.length ? d.exactAvg.toFixed(2) : "–";
            return `
                <li class="azi-lesson ${exam ? "has-exam" : ""}">
                    <span class="azi-lesson-n" aria-hidden="true">${i + 1}</span>
                    <button type="button" class="azi-lesson-main" data-action="open-subject" data-mat="${escapeHTML(mat)}"
                        aria-label="${escapeHTML(`Ora ${i + 1}: ${mat}${exam ? ", are evaluare" : ""}. Deschide în Catalog`)}">
                        <span class="azi-lesson-name">${escapeHTML(mat)}</span>
                        ${bits.length ? `<span class="azi-lesson-meta">${bits.join("")}</span>` : ""}
                    </button>
                    <span class="azi-lesson-avg ${sub.grades.length ? `tone-${gradeTone(d.exactAvg)}` : "is-none"}" title="Media la ${escapeHTML(mat)}">${avg}</span>
                    <button type="button" class="azi-icon-btn" data-action="add-grade" data-mat="${escapeHTML(mat)}"
                        title="Adaugă o notă la ${escapeHTML(mat)}" aria-label="Adaugă o notă la ${escapeHTML(mat)}">${icon("plus")}</button>
                </li>`;
        });
        body = `<ol class="azi-lessons">${rows.join("")}</ol>`;
    } else if (ttEmpty) {
        body = `
            <div class="azi-empty-box">
                <p>Completează orarul ca să vezi aici orele fiecărei zile, cu testele și temele lângă materia lor.</p>
                <div class="azi-empty-actions"><button type="button" class="btn btn-primary" data-action="timetable">${icon("calendar-days")} Completează orarul</button></div>
            </div>`;
    } else {
        const wd = parseDateKey(date).getDay();
        const why = !moduleAt(date) ? "Vacanță — nu ai ore." : wd === 0 || wd === 6 ? "Weekend — nu ai ore." : `Nu ai ore în orar ${WEEKDAY_LONG[wd].toLocaleLowerCase("ro")}.`;
        body = `<p class="azi-empty">${icon("sun")} ${why}</p>`;
    }

    const lessonSet = new Set(lessons);
    const others = occ.filter(o => !lessonSet.has(o.ev.subject));
    const othersHTML = others.length ? `
        <h4 class="azi-group">${lessons.length ? "Tot în ziua asta" : "În ziua asta"}</h4>
        <ul class="azi-list">${others.map(o => `
            <li class="azi-item">
                <i class="ev-dot ev-${EVENT_TYPE_CLASS[o.ev.type] || "personal"}" aria-hidden="true"></i>
                <button type="button" class="azi-item-main" data-action="cal-goto" data-date="${o.date}">
                    <b>${escapeHTML(o.ev.title)}</b>
                    <small>${escapeHTML([o.ev.type, o.ev.subject, o.ev.time].filter(Boolean).join(" · "))}</small>
                </button>
            </li>`).join("")}</ul>` : "";

    return `${head}${body}${othersHTML}
        <div class="azi-card-foot">
            ${ttEmpty ? "" : `<button type="button" class="btn btn-text" data-action="timetable">${icon("pen")} Modifică orarul</button>`}
            <button type="button" class="btn btn-text" data-action="cal-goto" data-date="${date}">${icon("calendar")} Vezi în calendar</button>
        </div>`;
}

/* ---------- de făcut ---------- */
function homeTodoHTML({ missed, homework, tests }, links, today) {
    const total = missed.length + homework.length + tests.length;
    const head = homeCardHead("azi-todo-title", "check-circle", "De făcut", total ? `<span class="cat-count">${total}</span>` : "");
    if (!total) {
        return `${head}<p class="azi-empty">${icon("sparkles")} Nimic de făcut acum: nicio temă în următoarele 7 zile, niciun test în următoarele două săptămâni.</p>`;
    }

    const groups = [];
    if (missed.length) {
        groups.push(`
            <h4 class="azi-group">Au trecut — completează</h4>
            <ul class="azi-list">${missed.slice(0, 5).map(({ ev, date, older }) => {
                const grade = NEEDS_GRADE.has(ev.type);
                return `
                <li class="azi-item is-missed">
                    <i class="ev-dot ev-${EVENT_TYPE_CLASS[ev.type] || "personal"}" aria-hidden="true"></i>
                    <button type="button" class="azi-item-main" data-action="cal-goto" data-date="${date}">
                        <b>${escapeHTML(ev.title)}</b>
                        <small>${escapeHTML([ev.subject, dayWord(date, today), older && `+${older} mai ${older === 1 ? "veche" : "vechi"}`].filter(Boolean).join(" · "))}</small>
                    </button>
                    <span class="azi-item-actions">
                        ${grade && canGradeOccurrence(ev, date, links) ? `<button type="button" class="btn btn-primary btn-sm" data-action="event-grade" data-id="${escapeHTML(ev.id)}" data-date="${date}">${icon("plus")} Notă</button>` : ""}
                        <button type="button" class="btn btn-glass btn-sm" data-action="event-done" data-id="${escapeHTML(ev.id)}" data-date="${date}"
                            title="${grade ? "Marchează ca încheiat fără notă" : "Marchează ca făcut"}">${icon("check")} ${grade ? "Fără notă" : "Făcut"}</button>
                    </span>
                </li>`;
            }).join("")}</ul>
            ${missed.length > 5 ? `<p class="azi-more-line">și încă ${missed.length - 5} în Calendar</p>` : ""}`);
    }
    if (homework.length) {
        groups.push(`
            <h4 class="azi-group">Teme de predat</h4>
            <ul class="azi-list">${homework.map(({ ev, date }) => `
                <li class="azi-item">
                    <button type="button" class="azi-check" data-action="event-done" data-id="${escapeHTML(ev.id)}" data-date="${date}"
                        aria-pressed="false" title="Bifează ca făcută" aria-label="${escapeHTML(`Făcută: ${ev.title}`)}"></button>
                    <button type="button" class="azi-item-main" data-action="cal-goto" data-date="${date}">
                        <b>${escapeHTML(ev.title)}</b>
                        <small>${escapeHTML([ev.subject, ev.time].filter(Boolean).join(" · ") || "Temă")}</small>
                    </button>
                    <span class="azi-when ${date === today ? "is-today" : ""}">${escapeHTML(dayWord(date, today).split(",")[0])}</span>
                </li>`).join("")}</ul>`);
    }
    if (tests.length) {
        groups.push(`
            <h4 class="azi-group">Teste și evaluări</h4>
            <ul class="azi-list">${tests.map(({ ev, date }) => {
                const n = daysBetween(today, date);
                return `
                <li class="azi-item">
                    <span class="azi-count ${n <= 2 ? "is-near" : ""}" aria-hidden="true"><b>${n === 0 ? "azi" : n}</b>${n === 0 ? "" : `<small>${n === 1 ? "zi" : "zile"}</small>`}</span>
                    <button type="button" class="azi-item-main" data-action="cal-goto" data-date="${date}">
                        <b>${escapeHTML(ev.title)}</b>
                        <small>${escapeHTML([ev.type, ev.subject, `${dayWord(date, today)}${ev.time ? `, ${ev.time}` : ""}`].filter(Boolean).join(" · "))}</small>
                    </button>
                    ${state.subjects[ev.subject] ? `<button type="button" class="btn btn-text btn-sm" data-action="open-in-sim" data-mat="${escapeHTML(ev.subject)}" title="Ce notă îți trebuie? (Simulator)" aria-label="${escapeHTML(`Ce notă îmi trebuie la ${ev.subject}`)}">${icon("target")} <span class="azi-btn-label">Ce-mi trebuie</span></button>` : ""}
                </li>`;
            }).join("")}</ul>`);
    }
    return head + groups.join("");
}

/* ---------- media ---------- */
function homeSparkSVG(timeline) {
    if (timeline.length < 2) return "";
    const W = 132, H = 44, P = 4;
    const vals = timeline.map(p => p.avg);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; }
    const x = i => P + (i * (W - 2 * P)) / (vals.length - 1);
    const y = v => P + ((hi - v) * (H - 2 * P)) / (hi - lo);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const last = pts.at(-1).split(",");
    return `
        <svg class="azi-spark" viewBox="0 0 ${W} ${H}" role="img"
            aria-label="${escapeHTML(`Media generală de la ${vals[0].toFixed(2)} la ${vals.at(-1).toFixed(2)}, din ${shortDayLabel(timeline[0].date)}`)}">
            <polyline points="${pts.join(" ")}"/>
            <circle cx="${last[0]}" cy="${last[1]}" r="3"/>
        </svg>`;
}

function homeAverageHTML() {
    const gpa = metrics.globalAvg;
    const timeline = averageTimeline();
    const change = generalChange(timeline);
    const goal = getGoalProgress();
    const pct = Math.min(100, Math.max(0, goal.percent));
    const p = metrics.purtare || purtareInfo();
    let delta = `<span class="azi-delta">${gpa > 0 ? "Tendința apare de la notele din zile diferite." : "Încă nu ai note."}</span>`;
    if (change) {
        const dir = change.delta >= TREND_STABLE ? "up" : change.delta <= -TREND_STABLE ? "down" : "flat";
        const text = dir === "flat" ? "stabilă" : `${change.delta > 0 ? "+" : "−"}${Math.abs(change.delta).toFixed(2)}`;
        delta = `<span class="azi-delta is-${dir}">${icon(dir === "down" ? "trend-down" : "trend-up")} ${text} <small>${escapeHTML(change.label)}</small></span>`;
    }

    return `
        <div class="azi-avg-top">
            <div class="azi-avg-main">
                <span class="azi-label">Media generală ${helpDot("gpa")}</span>
                <b class="azi-avg-val">${gpa > 0 ? gpa.toFixed(2) : "–"}</b>
                ${delta}
            </div>
            ${homeSparkSVG(timeline)}
        </div>
        <div class="azi-goal">
            <div class="azi-goal-row"><span>${escapeHTML(goal.label)}</span><b>${escapeHTML(goal.value)}</b></div>
            <div class="azi-meter" role="progressbar" aria-label="${escapeHTML(goal.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}"><i style="width:${pct.toFixed(1)}%"></i></div>
        </div>
        <ul class="azi-facts">
            <li><button type="button" data-action="home-risk" ${metrics.riskCount ? "" : "disabled"}><b class="${metrics.riskCount ? "is-risk" : ""}">${metrics.riskCount}</b><span>${metrics.riskCount === 1 ? "materie la risc" : "materii la risc"}</span></button></li>
            <li><button type="button" data-action="nav" data-tab="tab-statistici"><b>${metrics.tensCount}</b><span>${metrics.tensCount === 1 ? "notă de 10" : "note de 10"}</span></button></li>
            <li><button type="button" data-action="open-subject" data-mat="${escapeHTML(PURTARE_KEY)}"><b>${p.value}</b><span>purtare</span></button></li>
        </ul>`;
}

function getGoalProgress() {
    const { goals, targets } = state.settings;
    if (goals.primary === "tens") {
        return { label: "Note de 10", value: `${metrics.tensCount} din ${targets.tens}`, percent: targets.tens > 0 ? (metrics.tensCount / targets.tens) * 100 : 0 };
    }
    if (goals.primary === "evals") {
        return { label: "Evaluări", value: `${metrics.totalGrades} din ${targets.evals}`, percent: targets.evals > 0 ? (metrics.totalGrades / targets.evals) * 100 : 0 };
    }
    const gpa = metrics.globalAvg;
    const percent = gpa > 0 ? (gpa / goals.targetGPA) * 100 : 0;
    return { label: `Spre ținta ${goals.targetGPA.toFixed(2)}`, value: `${Math.min(100, percent).toFixed(0)}%`, percent };
}

/* ---------- de urmărit ---------- */
function homeWatchHTML() {
    const risk = state.settings.calc.riskThreshold;
    const rows = [];
    statsEntries().forEach(e => {
        if (e.standing.key === "risk") {
            rows.push({ e, rank: 0, plan: planForCondition(e.mat, d => d.exactAvg >= risk), goal: `ieși din risc (${risk.toFixed(2)})` });
        } else if (e.standing.key === "below" && e.sub.priority) {
            rows.push({ e, rank: 1, plan: planForCondition(e.mat, d => reachesTarget(d, e.sub.target)), goal: `ajungi la ${fmtTarget(e.sub.target)}` });
        }
    });
    const empty = Object.entries(state.subjects).filter(([, sub]) => !sub.grades.length).map(([mat]) => mat);
    if (!rows.length && !empty.length) return "";
    rows.sort((a, b) => a.rank - b.rank || a.e.d.rawAvg - b.e.d.rawAvg);

    return `
        ${homeCardHead("azi-watch-title", "alert", "De urmărit")}
        ${rows.length ? `<ul class="azi-watch-list">${rows.slice(0, 4).map(({ e, plan, goal }) => {
            const pill = planPill(plan);
            return `
            <li><button type="button" class="azi-watch-row" data-action="open-subject" data-mat="${escapeHTML(e.mat)}">
                <span class="azi-watch-main">
                    <b>${escapeHTML(e.mat)}</b>
                    <small>Ca să ${escapeHTML(goal)}: ${plan.next > 1
                        ? `<span class="azi-need is-${pill.tone}">${escapeHTML(pill.text)}</span> la următoarea notă`
                        : plan.next === 1 ? `<span class="azi-need is-ok">orice notă</span> e suficientă`
                        : `ai nevoie de <span class="azi-need is-${pill.tone}">${escapeHTML(pill.text)}</span>`}</small>
                </span>
                <span class="azi-lesson-avg tone-${gradeTone(e.d.exactAvg)}">${e.d.exactAvg.toFixed(2)}</span>
            </button></li>`;
        }).join("")}</ul>` : ""}
        ${empty.length ? `<p class="azi-more-line">${icon("note")} Fără note încă: ${empty.slice(0, 4).map(m => `<button type="button" class="azi-inline-link" data-action="add-grade" data-mat="${escapeHTML(m)}">${escapeHTML(m)}</button>`).join(", ")}${empty.length > 4 ? ` și încă ${empty.length - 4}` : ""}</p>` : ""}`;
}

/* ---------- ultimele note ---------- */
function homeRecentHTML() {
    const all = [];
    for (const [mat, sub] of Object.entries(state.subjects)) {
        sub.grades.forEach((g, idx) => all.push({ mat, idx, g }));
    }
    const head = homeCardHead("azi-recent-title", "note", "Ultimele note");
    if (!all.length) {
        return `${head}
            <p class="azi-empty">Aici apar notele pe măsură ce le adaugi.</p>
            <button type="button" class="btn btn-primary btn-sm" data-action="add-grade">${icon("plus")} Adaugă prima notă</button>`;
    }
    all.sort((a, b) => (b.g.date || "").localeCompare(a.g.date || "") || b.idx - a.idx);
    return `${head}
        <ul class="azi-grades">${all.slice(0, 5).map(({ mat, idx, g }) => `
            <li><button type="button" class="azi-grade-row" data-action="edit-grade" data-mat="${escapeHTML(mat)}" data-index="${idx}" title="Modifică nota">
                <span class="cat-grade-val tone-${gradeTone(Number(g.val))}">${escapeHTML(g.val)}</span>
                <span class="azi-grade-info"><b>${escapeHTML(mat)}</b><small>${escapeHTML([g.type || "Altele", g.date ? relativeDayLabel(g.date) : ""].filter(Boolean).join(" · "))}</small></span>
            </button></li>`).join("")}</ul>
        <div class="azi-card-foot"><button type="button" class="btn btn-text" data-action="nav" data-tab="tab-catalog">${icon("notebook")} Toate notele în Catalog</button></div>`;
}

/* ---------- realizări + jurnal ---------- */
function homeMoreHTML() {
    const unlocked = ACHIEVEMENTS.filter(a => state.achievements[a.key]).length;
    return `
        ${homeCardHead("azi-more-title", "trophy", "Realizări", `<span class="cat-count">${unlocked} din ${ACHIEVEMENTS.length}</span>`)}
        <div class="badges-container">${ACHIEVEMENTS.map(a => {
            const on = state.achievements[a.key];
            return `<span class="badge-pill ${on ? "unlocked" : ""}" title="${on ? "Obținută" : "Încă blocată"}">${icon(on ? a.icon : "lock")} ${escapeHTML(a.label)}</span>`;
        }).join("")}</div>
        <details class="azi-log">
            <summary>${icon("clock")} Ce s-a schimbat recent</summary>
            ${state.activity.length
                ? `<ul class="activity-list">${state.activity.slice(0, 8).map(act => `
                    <li class="activity-item"><span>${escapeHTML(act.text)}</span><span>${escapeHTML(formatActivityTime(act))}</span></li>`).join("")}</ul>`
                : emptyNote("Nicio activitate recentă.")}
        </details>`;
}

function formatActivityTime(act) {
    if (!act.ts) return act.time || "";
    const date = new Date(act.ts);
    if (Number.isNaN(date.getTime())) return act.time || "";
    return getLocalDateKey(date) === getLocalDateKey()
        ? act.time
        : `${date.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" })} ${act.time}`;
}



/* ---------- MATERII (CATALOG) ---------- */
/*
 * Listă + panou de detalii. Pe ecrane mari se văd amândouă; pe telefon,
 * lista ocupă ecranul, iar alegerea unei materii deschide detaliile (cu „← Înapoi”).
 */
const CATALOG_FILTERS = {
    all: { label: "Toate", test: () => true },
    risk: { label: `${icon("alert")} Risc`, test: e => e.d.statusClass === "badge-danger" },
    empty: { label: "Fără note", test: e => e.sub.grades.length === 0 },
    priority: { label: `${icon("star")} Prioritare`, test: e => e.sub.priority }
};

const byName = (a, b) => a.mat.localeCompare(b.mat, "ro");
const avgOf = e => (e.sub.grades.length ? e.d.rawAvg : null);
function byAvg(dir) {
    return (a, b) => {
        const x = avgOf(a), y = avgOf(b);
        if (x === null && y === null) return byName(a, b);
        if (x === null) return 1;   // materiile fără note rămân la final
        if (y === null) return -1;
        return (x - y) * dir || byName(a, b);
    };
}
const STATUS_RANK = { "badge-danger": 0, "badge-warn": 1, "badge-ok": 2 };

const CATALOG_SORTS = {
    group: byName, // în interiorul fiecărui grup (vezi CATALOG_GROUPS)
    name: byName,
    "avg-desc": byAvg(-1),
    "avg-asc": byAvg(1),
    risk: (a, b) => STATUS_RANK[a.d.statusClass] - STATUS_RANK[b.d.statusClass] || byAvg(1)(a, b),
    missing: (a, b) => b.d.requiredNotes - a.d.requiredNotes || byName(a, b)
};

/* Lista „pe stare”: grupuri care se pot strânge, cele care cer atenție primele. */
const CATALOG_GROUPS = [
    { key: "risk", label: "La risc", tone: "danger" },
    { key: "below", label: "Sub țintă", tone: "warn" },
    { key: "ok", label: "La țintă", tone: "ok" },
    { key: "none", label: "Fără note", tone: "none" }
];

/** Materiile vizibile, în ordinea în care apar pe ecran, împărțite pe grupuri (sau un singur grup, la altă sortare). */
function catalogGroups() {
    const visible = visibleCatalogEntries();
    if (ui.catalog.sort !== "group") return [{ key: "all", label: "", entries: visible }];
    return CATALOG_GROUPS
        .map(g => ({ ...g, entries: visible.filter(e => subjectStanding(e.sub, e.d).key === g.key) }))
        .filter(g => g.entries.length);
}

/** Ordinea pentru „materia anterioară / următoare”: purtarea (dacă e în listă), apoi materiile, ca pe ecran. */
function catalogOrder() {
    return [...(purtareVisibleInList() ? [PURTARE_KEY] : []), ...catalogGroups().flatMap(g => g.entries.map(e => e.mat))];
}

function stepCatalog(dir) {
    const order = catalogOrder();
    if (order.length < 2) return;
    const i = order.indexOf(ui.catalog.selected);
    const next = order[(i < 0 ? 0 : i + dir + order.length) % order.length];
    selectCatalogSubject(next);
    $("cat-nav")?.querySelector(`[data-action="cat-step"][data-dir="${dir}"]`)?.focus({ preventScroll: true });
}

/** Bara de deasupra detaliilor: ‹ › între materii, poziția, iar pe telefon o bandă cu toate materiile. */
function renderCatalogNav() {
    const nav = $("cat-nav");
    if (!nav) return;
    const order = catalogOrder();
    const i = order.indexOf(ui.catalog.selected);
    if (order.length < 2 || i < 0) {
        nav.innerHTML = "";
        nav.hidden = true;
        return;
    }
    nav.hidden = false;
    const name = mat => mat === PURTARE_KEY ? "Purtare" : mat;
    const prev = order[(i - 1 + order.length) % order.length];
    const next = order[(i + 1) % order.length];
    nav.innerHTML = `
        <div class="cat-nav-bar">
            <button type="button" class="btn btn-glass cat-step" data-action="cat-step" data-dir="-1" aria-label="${escapeHTML(`Materia anterioară: ${name(prev)}`)}" title="${escapeHTML(name(prev))} (←)">${icon("chevron", "is-flip")}<span class="cat-step-name">${escapeHTML(name(prev))}</span></button>
            <span class="cat-nav-pos" aria-live="polite">${i + 1} din ${order.length}</span>
            <button type="button" class="btn btn-glass cat-step is-next" data-action="cat-step" data-dir="1" aria-label="${escapeHTML(`Materia următoare: ${name(next)}`)}" title="${escapeHTML(name(next))} (→)"><span class="cat-step-name">${escapeHTML(name(next))}</span>${icon("chevron")}</button>
        </div>
        <div class="cat-strip" role="tablist" aria-label="Alege materia">
            ${order.map(mat => {
                const d = mat === PURTARE_KEY ? null : metrics.subjects[mat];
                const tone = mat === PURTARE_KEY ? "ok" : statusTone(d);
                const on = mat === ui.catalog.selected;
                return `<button type="button" role="tab" class="cat-strip-chip ${on ? "is-on" : ""}" aria-selected="${on}" data-action="cat-select" data-mat="${escapeHTML(mat)}"><i class="cat-dot ${tone}" aria-hidden="true"></i>${escapeHTML(name(mat))}</button>`;
            }).join("")}
        </div>`;
    // materia aleasă, la mijlocul benzii (fără să miște pagina)
    const strip = nav.querySelector(".cat-strip");
    const chip = strip?.querySelector(".is-on");
    if (strip && chip && strip.clientWidth) strip.scrollLeft = chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
}

/** Text fără diacritice, pentru căutare: „matematica” găsește „Matematică”. */
function foldText(value) {
    return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("ro");
}

function catalogEntries() {
    return Object.entries(state.subjects).map(([mat, sub]) => ({ mat, sub, d: metrics.subjects[mat] }));
}

function visibleCatalogEntries() {
    const { filter, query, sort } = ui.catalog;
    const q = foldText(query.trim());
    return catalogEntries()
        .filter(e => (CATALOG_FILTERS[filter] || CATALOG_FILTERS.all).test(e))
        .filter(e => !q || foldText(e.mat).includes(q))
        .sort(CATALOG_SORTS[sort] || byName);
}

function gradeTone(value) {
    return value >= 9 ? "hi" : value >= 7 ? "mid" : value >= 5 ? "low" : "fail";
}

function statusTone(d) {
    return d.statusClass === "badge-danger" ? "danger" : d.statusClass === "badge-warn" ? "warn" : "ok";
}

function fmtTarget(target) {
    return Number.isInteger(target) ? String(target) : target.toFixed(2);
}

function fmtNumber(value) {
    return Number.isInteger(value) ? String(value) : String(roundValue(value, 2));
}

/** Notele în ordine cronologică (cele fără dată primele), cu indexul lor real. */
function gradesChrono(sub) {
    return sub.grades
        .map((g, i) => ({ g, i }))
        .sort((a, b) => (a.g.date || "").localeCompare(b.g.date || "") || a.i - b.i);
}

/** Ținta e media finală dorită: un număr întreg se compară cu media rotunjită. */
function reachesTarget(d, target) {
    if (!d || d.exactAvg <= 0) return false;
    return Number.isInteger(target) ? d.roundedAvg >= target : d.exactAvg >= target;
}

function metricsWithExtraGrades(mat, extra) {
    const sub = state.subjects[mat];
    return calculateMetrics({ ...state.subjects, [mat]: { ...sub, grades: [...sub.grades, ...extra] } });
}

/**
 * Ce îți trebuie ca o condiție să fie îndeplinită la materia dată:
 * cea mai mică notă următoare, sau câte note de 10 la rând, sau „imposibil” (peste 20).
 */
function planForCondition(mat, ok) {
    const now = ok(metrics.subjects[mat]);
    for (let g = 1; g <= 10; g++) {
        if (ok(metricsWithExtraGrades(mat, [{ val: g }]).subjects[mat])) return { now, next: g };
    }
    for (let k = 2; k <= 20; k++) {
        if (ok(metricsWithExtraGrades(mat, Array.from({ length: k }, () => ({ val: 10 }))).subjects[mat])) return { now, tens: k };
    }
    return { now, impossible: true };
}

function planPill(plan) {
    if (plan.impossible) return { text: "peste 20 de note de 10", tone: "danger" };
    if (plan.tens) return { text: `${plan.tens} note de 10 la rând`, tone: "danger" };
    if (plan.next === 1) return { text: "orice notă", tone: "ok" };
    return { text: `minim ${plan.next}`, tone: plan.next >= 9 ? "warn" : "neutral" };
}

function daysUntil(dateKey) {
    return Math.round((parseDateKey(dateKey) - parseDateKey(getLocalDateKey())) / 86400000);
}

function relativeDay(dateKey) {
    const n = daysUntil(dateKey);
    return n === 0 ? "azi" : n === 1 ? "mâine" : `în ${plural(n, "zi", "zile")}`;
}

function upcomingForSubject(mat, limit = 4) {
    const today = getLocalDateKey();
    const links = gradeLinks();
    return occurrencesBetween(today, addDays(today, 365))
        .filter(o => o.ev.subject === mat && !isOccurrenceDone(o.ev, o.date, links))
        .slice(0, limit)
        .map(o => ({ ...o.ev, date: o.date }));
}

/* ---------- randare ---------- */
function renderCatalog() {
    const layout = $("catalog-layout");
    if (!layout) return;

    const entries = catalogEntries();

    // Selecția rămâne validă: dacă materia a dispărut, alegem prima din listă (sau purtarea, care există mereu).
    if (ui.catalog.selected !== PURTARE_KEY && !state.subjects[ui.catalog.selected]) {
        ui.catalog.selected = (catalogGroups()[0]?.entries[0] || entries[0])?.mat || PURTARE_KEY;
        ui.catalog.showDetail = false;
        ui.catalog.autoPicked = true; // aleasă automat: pe telefon nu o evidențiem în listă
    }

    // Câmpurile statice păstrează valorile (ex. după un import sau o resetare).
    if ($("cat-search").value !== ui.catalog.query) $("cat-search").value = ui.catalog.query;
    $("cat-sort").value = ui.catalog.sort;

    renderCatalogSummary(entries);
    renderCatalogFilters(entries);
    renderCatalogList();
    renderCatalogDetail();
    layout.classList.toggle("show-detail", ui.catalog.showDetail);
    layout.classList.toggle("auto-pick", ui.catalog.autoPicked);
    $("tab-catalog").classList.toggle("cat-detail-open", ui.catalog.showDetail);
    renderCatalogNav();
}

function renderCatalogSummary(entries) {
    const priority = entries.filter(e => e.sub.priority).length;
    const excluded = entries.filter(e => e.sub.excludeFromGPA).length;
    const missing = entries.reduce((n, e) => n + e.d.requiredNotes, 0);
    const method = (state.settings.calc.method === "weighted" ? "ponderată după ore" : "media aritmetică")
        + (state.purtare.excludeFromGPA ? "" : " · cu purtarea");
    const tile = (title, value, caption, extra = "") => `
        <div class="glass-card cat-sum ${extra}">
            <span class="kpi-title">${title}</span>
            <b class="cat-sum-value">${value}</b>
            <small>${caption}</small>
        </div>`;

    $("cat-summary").innerHTML = [
        tile("Media generală", metrics.globalAvg > 0 ? metrics.globalAvg.toFixed(2) : "-", escapeHTML(method), "is-accent"),
        tile("Materii", entries.length, escapeHTML([priority && `${priority} prioritare`, excluded && `${excluded} excluse`].filter(Boolean).join(" · ") || "toate în medie")),
        tile("Note", metrics.totalGrades, missing > 0 ? `încă ${plural(missing, "notă necesară", "note necesare")}` : "✓ minimul atins peste tot"),
        tile("În risc", metrics.riskCount, `sub ${state.settings.calc.riskThreshold.toFixed(2)}`, metrics.riskCount > 0 ? "is-danger" : "")
    ].join("");
}

function renderCatalogFilters(entries) {
    $("cat-filters").innerHTML = Object.entries(CATALOG_FILTERS).map(([key, f]) => {
        const count = entries.filter(f.test).length;
        const active = ui.catalog.filter === key;
        return `
            <button type="button" class="cat-chip ${active ? "active" : ""}" data-action="cat-filter" data-filter="${key}" aria-pressed="${active}">
                ${f.label} <span class="cat-chip-count">${count}</span>
            </button>`;
    }).join("");
}

function renderCatalogList() {
    const list = $("cat-list");
    const visible = visibleCatalogEntries();
    const pinned = purtareVisibleInList() ? purtareRowHTML() : "";

    if (visible.length === 0) {
        list.innerHTML = pinned + (Object.keys(state.subjects).length === 0
            ? `
            <div class="cat-list-empty">
                <p>Nu ai încă nicio materie.</p>
                <button type="button" class="btn btn-primary" data-action="add-subject">+ Adaugă materie</button>
            </div>`
            : `
            <div class="cat-list-empty">
                <p>Nicio materie nu se potrivește.</p>
                <button type="button" class="btn btn-glass" data-action="cat-clear-filters">Arată toate materiile</button>
            </div>`);
        return;
    }

    const rowHTML = ({ mat, sub, d }) => {
        const selected = mat === ui.catalog.selected;
        const hasGrades = sub.grades.length > 0;
        const meta = [
            plural(sub.grades.length, "notă", "note"),
            `${fmtNumber(sub.ore)} ${sub.ore === 1 ? "oră" : "ore"}`,
            `ținta ${fmtTarget(sub.target)}`
        ].join(" · ");
        return `
            <button type="button" class="cat-row ${selected ? "selected" : ""}" data-action="cat-select" data-mat="${escapeHTML(mat)}"
                ${selected ? 'aria-current="true"' : ""}>
                <span class="cat-dot ${statusTone(d)}" aria-hidden="true"></span>
                <span class="cat-row-main">
                    <span class="cat-row-name">${sub.priority ? '<span class="cat-star" aria-label="prioritară">★</span>' : ""}${escapeHTML(mat)}</span>
                    <span class="cat-row-meta">${escapeHTML(meta)}${sub.excludeFromGPA ? ' · <span class="cat-tag">exclusă</span>' : ""}${inProgramme(mat) ? "" : ' · <span class="cat-tag is-warn">în afara programei</span>'}</span>
                </span>
                <span class="cat-row-avg">
                    <b>${hasGrades ? d.exactAvg.toFixed(2) : "–"}</b>
                    <small>${hasGrades ? `→ ${d.roundedAvg}` : escapeHTML(d.status)}</small>
                </span>
            </button>`;
    };
    const searching = Boolean(ui.catalog.query.trim());
    list.innerHTML = pinned + catalogGroups().map(g => {
        if (!g.label) return g.entries.map(rowHTML).join("");
        const open = searching || !ui.catalog.collapsed[g.key] || g.entries.some(e => e.mat === ui.catalog.selected && !ui.catalog.autoPicked);
        return `
            <div class="cat-group tone-${g.tone} ${open ? "" : "is-closed"}">
                <button type="button" class="cat-group-head" data-action="cat-group" data-group="${g.key}" aria-expanded="${open}">
                    ${icon("chevron", "cat-group-chev")}<span>${g.label}</span><span class="cat-group-count">${g.entries.length}</span>
                    ${open ? "" : `<span class="cat-group-peek">${escapeHTML(g.entries.slice(0, 3).map(e => e.mat).join(", "))}${g.entries.length > 3 ? "…" : ""}</span>`}
                </button>
                ${open ? g.entries.map(rowHTML).join("") : ""}
            </div>`;
    }).join("");
}

function renderCatalogDetail() {
    if (ui.catalog.selected === PURTARE_KEY) {
        renderPurtareDetail();
        return;
    }
    const pane = $("cat-detail");
    const mat = ui.catalog.selected;
    const sub = state.subjects[mat];
    if (!sub) {
        pane.innerHTML = "";
        return;
    }

    const d = metrics.subjects[mat];
    const safeMat = escapeHTML(mat);
    const chrono = gradesChrono(sub);
    const last = chrono[chrono.length - 1];
    const minTotal = sub.grades.length + d.requiredNotes;
    const reached = reachesTarget(d, sub.target);
    const gap = (Number.isInteger(sub.target) ? sub.target - 0.5 : sub.target) - d.exactAvg;

    const stat = (title, value, caption, tone = "") => `
        <div class="cat-stat ${tone}">
            <span class="kpi-title">${title}</span>
            <b>${value}</b>
            <small>${caption}</small>
        </div>`;

    pane.innerHTML = `
        <div class="glass-card cat-detail-card">
            <button type="button" class="btn btn-text cat-back" data-action="cat-back">← Toate materiile</button>

            <header class="cat-detail-head">
                <div class="cat-detail-title-wrap">
                    <div class="cat-title-row">
                        <h3 class="cat-title" id="cat-detail-title" tabindex="-1">${safeMat}</h3>
                        <span class="badge ${d.statusClass}">${escapeHTML(d.status)}</span>${d.statusClass === "badge-danger" ? helpDot("risk") : ""}
                        ${sub.excludeFromGPA ? `<span class="badge cat-badge-muted">${icon("ban")} Exclusă din medie</span>` : ""}
                        ${inProgramme(mat) ? "" : `<span class="badge badge-warn" title="Nu e în programa ta (${escapeHTML(programmeLabel())}). Din „Editează” o poți înlocui cu o materie din programă, păstrând notele.">În afara programei</span>`}
                    </div>
                    <p class="subtitle">${fmtNumber(sub.ore)} ${sub.ore === 1 ? "oră" : "ore"} pe săptămână · ținta ${fmtTarget(sub.target)}</p>
                </div>
                <div class="cat-head-actions">
                    <button type="button" class="btn-star ${sub.priority ? "active" : ""}" data-action="toggle-priority" data-mat="${safeMat}"
                        aria-pressed="${sub.priority}" title="${sub.priority ? "Scoate din prioritare" : "Marchează ca prioritară"}" aria-label="Materie prioritară">★</button>
                    <button type="button" class="btn btn-glass" data-action="edit-subject" data-mat="${safeMat}">${icon("pen")} Editează</button>
                    <button type="button" class="btn btn-primary" data-action="add-grade" data-mat="${safeMat}">+ Notă</button>
                </div>
            </header>

            ${isLegacyPurtareName(mat) ? `
                <div class="alert-card warning">
                    <span>${icon("medal")} Purtarea are acum o secție proprie, preinstalată, care se reînnoiește la fiecare modul. Această materie ar fi numărată de două ori în media generală.</span>
                    <button type="button" class="btn btn-glass" data-action="delete-subject" data-mat="${safeMat}">Șterge materia veche</button>
                </div>` : ""}

            <div class="cat-stats">
                ${stat("Media", sub.grades.length ? `${d.exactAvg.toFixed(2)} <span class="sim-round">→ ${d.roundedAvg}</span>` : "–",
                    sub.grades.length ? "exactă → finală" : "încă fără note")}
                ${stat("Ținta", fmtTarget(sub.target),
                    !sub.grades.length ? "media finală dorită" : reached ? "✓ atinsă" : `lipsesc ${Math.max(0.01, roundValue(gap, 2)).toFixed(2)} puncte`,
                    sub.grades.length ? (reached ? "is-ok" : "is-warn") : "")}
                ${stat("Note", sub.grades.length,
                    d.requiredNotes > 0 ? `încă ${d.requiredNotes} până la minim ${minTotal}` : `✓ minim ${minTotal} atins`,
                    d.requiredNotes > 0 ? "is-warn" : "is-ok")}
                ${stat("Ultima notă", last ? `<span class="cat-grade-val tone-${gradeTone(Number(last.g.val))}">${escapeHTML(last.g.val)}</span>` : "–",
                    last ? escapeHTML(`${last.g.type || "Altele"}${last.g.date ? ` · ${getShortDateLabel(last.g.date)}` : ""}`) : "nimic încă")}
            </div>

            <div class="cat-detail-grid">
                ${targetHelperHTML(mat, sub)}
                <section class="cat-block" aria-labelledby="cat-trend-title">
                    <h4 id="cat-trend-title">${icon("trend-up")} Evoluție</h4>
                    ${trendSVG(sub, chrono)}
                </section>
            </div>

            <section class="cat-block" aria-labelledby="cat-grades-title">
                <div class="cat-block-head">
                    <h4 id="cat-grades-title">${icon("note")} Note <span class="cat-count">${sub.grades.length}</span></h4>
                    ${sub.grades.length ? '<span class="subtitle">cele mai noi primele</span>' : ""}
                </div>
                ${gradesListHTML(mat, chrono)}
            </section>

            <section class="cat-block" aria-labelledby="cat-upcoming-title">
                <h4 id="cat-upcoming-title">${icon("calendar")} Următoarele evaluări</h4>
                ${upcomingHTML(mat)}
            </section>

            <footer class="cat-detail-foot">
                <button type="button" class="btn btn-text" data-action="toggle-exclude" data-mat="${safeMat}">
                    ${sub.excludeFromGPA ? `${icon("undo")} Include în media generală` : `${icon("ban")} Exclude din media generală`}
                </button>
                <button type="button" class="btn btn-text text-danger" data-action="delete-subject" data-mat="${safeMat}">${icon("trash")} Șterge materia</button>
            </footer>
        </div>`;
}

function targetHelperHTML(mat, sub) {
    const risk = state.settings.calc.riskThreshold;
    const targetPlan = planForCondition(mat, d => reachesTarget(d, sub.target));
    const riskPlan = planForCondition(mat, d => d.exactAvg >= risk);

    const row = (label, hint, plan) => {
        const pill = planPill(plan);
        return `
            <div class="sim-safety-row cat-plan-row">
                <span><b>${label}</b><small>${hint}</small></span>
                <span class="sim-result ${pill.tone}">${escapeHTML(pill.text)}</span>
            </div>`;
    };

    return `
        <section class="cat-block" aria-labelledby="cat-target-title">
            <h4 id="cat-target-title">${icon("target")} Ce îți trebuie ${helpDot("need")}</h4>
            <p class="muted-small">La următoarea evaluare la ${escapeHTML(mat)}:</p>
            <div class="sim-safety-list">
                ${row(targetPlan.now ? `Păstrezi ținta ${fmtTarget(sub.target)}` : `Ajungi la ținta ${fmtTarget(sub.target)}`,
                    targetPlan.now ? "✓ deja atinsă" : "media finală dorită", targetPlan)}
                ${row(riskPlan.now ? `Rămâi peste ${risk.toFixed(2)}` : `Ieși din risc (${risk.toFixed(2)})`,
                    riskPlan.now ? "pragul de risc din Setări" : "acum ești sub prag", riskPlan)}
            </div>
            <button type="button" class="btn btn-text cat-sim-link" data-action="open-in-sim" data-mat="${escapeHTML(mat)}">${icon("target")} Încearcă scenarii în Simulator →</button>
        </section>`;
}

/** Grafic mic, fără bibliotecă: notele (puncte) + media pe parcurs (linie) + țintă și prag. */
function trendSVG(sub, chrono) {
    if (chrono.length < 2) {
        return `<p class="muted-small cat-trend-empty">Graficul apare de la a doua notă.</p>`;
    }

    const W = 320, H = 120, L = 22, R = 10, T = 10, B = 10;
    const n = chrono.length;
    const risk = state.settings.calc.riskThreshold;
    const target = Math.min(10, sub.target);
    const values = chrono.map(({ g }) => Number(g.val));

    // Axa se adaptează notelor (ex. 5–10), ca diferențele mici să se vadă; include ținta și pragul.
    const lo = Math.max(1, Math.floor(Math.min(...values, risk, target)) - 1);
    const hi = 10;
    const step = hi - lo <= 4 ? 1 : hi - lo <= 8 ? 2 : 3;
    const ticks = [];
    for (let v = hi; v >= lo; v -= step) ticks.push(v);

    const x = i => L + (i * (W - L - R)) / (n - 1);
    const y = v => T + ((hi - v) * (H - T - B)) / (hi - lo);

    let sum = 0;
    const running = chrono.map(({ g }, i) => {
        sum += Number(g.val);
        return [x(i), y(sum / (i + 1))];
    });
    const path = running.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    const hline = (v, cls) => `<line class="${cls}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;

    return `
        <svg class="cat-trend" viewBox="0 0 ${W} ${H}" role="img"
            aria-label="Evoluția mediei la această materie: de la ${Number(chrono[0].g.val)} la ${(sum / n).toFixed(2)}">
            ${ticks.map(v => `<line class="trend-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
                <text class="trend-axis" x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`).join("")}
            ${hline(target, "trend-target")}
            ${hline(risk, "trend-risk")}
            <path class="trend-avg" d="${path}"/>
            ${chrono.map(({ g }, i) => `<circle class="trend-dot tone-${gradeTone(Number(g.val))}" cx="${x(i).toFixed(1)}" cy="${y(Number(g.val)).toFixed(1)}" r="4.5" data-tip-title="${escapeHTML(`${g.type || "Altele"}${g.date ? ` · ${getShortDateLabel(g.date)}` : ""}`)}" data-tip-value="${escapeHTML(g.val)}"/>`).join("")}
        </svg>
        <div class="cat-trend-legend" aria-hidden="true">
            <span><i class="lg-dot"></i>note</span>
            <span><i class="lg-avg"></i>media pe parcurs</span>
            <span><i class="lg-target"></i>ținta</span>
            <span><i class="lg-risk"></i>prag risc</span>
        </div>`;
}

function gradesListHTML(mat, chrono) {
    if (chrono.length === 0) {
        return `
            <div class="cat-grades-empty">
                <p class="muted-small">Nu există note la ${escapeHTML(mat)}.</p>
                <button type="button" class="btn btn-primary" data-action="add-grade" data-mat="${escapeHTML(mat)}">+ Adaugă prima notă</button>
            </div>`;
    }

    const safeMat = escapeHTML(mat);
    return `
        <ul class="cat-grades">
            ${[...chrono].reverse().map(({ g, i }) => `
                <li class="cat-grade">
                    <span class="cat-grade-val tone-${gradeTone(Number(g.val))}">${escapeHTML(g.val)}</span>
                    <span class="cat-grade-info">
                        <b>${escapeHTML(g.type || "Altele")}</b>
                        <small>${g.date ? escapeHTML(getDateLabel(g.date)) : "fără dată"}</small>
                    </span>
                    <span class="cat-grade-actions">
                        <button type="button" class="btn btn-glass icon-btn" data-action="edit-grade" data-mat="${safeMat}" data-index="${i}"
                            title="Editează nota" aria-label="Editează nota ${escapeHTML(g.val)} (${escapeHTML(g.type || "Altele")})">${icon("pen")}</button>
                        <button type="button" class="btn btn-glass icon-btn cat-del" data-action="delete-grade" data-mat="${safeMat}" data-index="${i}"
                            title="Șterge nota" aria-label="Șterge nota ${escapeHTML(g.val)} (${escapeHTML(g.type || "Altele")})">${icon("trash")}</button>
                    </span>
                </li>`).join("")}
        </ul>`;
}

function upcomingHTML(mat) {
    const events = upcomingForSubject(mat);
    if (events.length === 0) {
        return `<p class="muted-small">Nimic programat la ${escapeHTML(mat)}.
            <button type="button" class="btn btn-text cat-inline-btn" data-action="add-event" data-mat="${escapeHTML(mat)}">+ Adaugă în calendar</button></p>`;
    }
    return `
        <ul class="cat-upcoming">
            ${events.map(ev => `
                <li>
                    <button type="button" class="cat-upcoming-item" data-action="show-date" data-date="${escapeHTML(ev.date)}">
                        <span class="cat-upcoming-when ${daysUntil(ev.date) <= 2 ? "soon" : ""}">${escapeHTML(relativeDay(ev.date))}</span>
                        <span class="cat-upcoming-main">
                            <b>${escapeHTML(ev.title)}</b>
                            <small>${escapeHTML(`${ev.type} · ${getDateLabel(ev.date)}${ev.time ? `, ${ev.time}` : ""}`)}</small>
                        </span>
                        <span aria-hidden="true">→</span>
                    </button>
                </li>`).join("")}
        </ul>`;
}

/* ---------- interacțiuni ---------- */
function selectCatalogSubject(mat, { showDetail = true } = {}) {
    if (mat !== PURTARE_KEY && !state.subjects[mat]) return;
    const listHadFocus = $("cat-list")?.contains(document.activeElement);
    const changed = mat !== ui.catalog.selected;
    ui.catalog.selected = mat;
    ui.catalog.showDetail = showDetail;
    ui.catalog.autoPicked = false;
    renderCatalog();

    // O materie nouă se vede de la început: detaliile pornesc de sus, iar pagina nu rămâne derulată sub ele.
    if (changed) {
        const pane = $("cat-detail-pane");
        if (pane) pane.scrollTop = 0;
        const top = $("catalog-layout")?.getBoundingClientRect().top ?? 0;
        const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--appbar-h")) || 0;
        if (top < bar) window.scrollBy({ top: top - bar - 12 });
        // în listă, materia aleasă rămâne la vedere (ex. după ‹ ›)
        $("cat-list")?.querySelector(".cat-row.selected")?.scrollIntoView({ block: "nearest" });
    }
    // Pe telefon lista dispare: ducem focusul și pagina la detalii.
    const listVisible = $("cat-list")?.offsetParent !== null;
    if (showDetail && !listVisible) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        $("cat-detail-title")?.focus({ preventScroll: true });
    } else if (listHadFocus) {
        document.querySelector("#cat-list .cat-row.selected")?.focus();
    }
}

function openSubjectInCatalog(mat) {
    if (mat !== PURTARE_KEY && !state.subjects[mat]) return;
    ui.catalog.selected = mat;
    ui.catalog.showDetail = true;
    ui.catalog.autoPicked = false;
    // Dacă filtrele ar ascunde materia, le resetăm ca să fie vizibilă în listă.
    const hidden = mat === PURTARE_KEY ? !purtareVisibleInList() : !visibleCatalogEntries().some(e => e.mat === mat);
    if (hidden) {
        ui.catalog.filter = "all";
        ui.catalog.query = "";
    }
    switchTab("tab-catalog");
    const card = document.querySelector("#cat-detail .cat-detail-card");
    if (card) {
        card.classList.add("flash");
        setTimeout(() => card.classList.remove("flash"), 1600);
    }
}

function openSubjectInSimulator(mat) {
    if (!state.subjects[mat]) return;
    sim.selected = mat;
    saveState();
    switchTab("tab-simulator");
}

function bindCatalogEvents() {
    const search = $("cat-search");
    const runSearch = debounce(() => {
        ui.catalog.query = search.value;
        renderCatalogList();
        renderCatalogNav();
    }, 100);
    search.addEventListener("input", runSearch);
    search.addEventListener("keydown", event => {
        if (event.key === "Escape" && search.value) {
            event.stopPropagation();
            search.value = "";
            ui.catalog.query = "";
            renderCatalogList();
            renderCatalogNav();
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            $("cat-list").querySelector(".cat-row")?.focus();
        }
    });

    $("cat-sort").addEventListener("change", event => {
        ui.catalog.sort = CATALOG_SORTS[event.target.value] ? event.target.value : "name";
        renderCatalogList();
    });

    // Săgețile sus/jos navighează prin listă.
    $("cat-list").addEventListener("keydown", event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const rows = [...$("cat-list").querySelectorAll(".cat-row")];
        const i = rows.indexOf(document.activeElement);
        if (i < 0) return;
        event.preventDefault();
        const next = rows[event.key === "ArrowDown" ? i + 1 : i - 1];
        if (next) next.focus();
        else if (event.key === "ArrowUp") search.focus();
    });
}

/* ---------- meniul unei materii (dublu-clic, clic dreapta, apăsare lungă sau Shift+F10 pe rând) ---------- */
const catMenu = { mat: "", returnFocus: null, openedAt: 0, last: { mat: "", t: 0, x: 0, y: 0 } };

function openCatMenu(mat, x, y, returnFocus = null) {
    if (!state.subjects[mat]) return;
    const menu = $("cat-menu");
    if (!menu.hidden && catMenu.mat === mat) return;
    catMenu.openedAt = performance.now();
    catMenu.mat = mat;
    catMenu.returnFocus = returnFocus;
    $("cat-menu-title").textContent = mat;
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const vw = document.documentElement.clientWidth || innerWidth;
    menu.style.left = `${Math.max(8, Math.min(vw - w - 8, x))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, y))}px`;
    menu.querySelector("[role='menuitem']")?.focus({ preventScroll: true });
}

function closeCatMenu({ restoreFocus = true } = {}) {
    const menu = $("cat-menu");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    const back = catMenu.returnFocus;
    catMenu.returnFocus = null;
    if (restoreFocus && back && document.contains(back)) back.focus({ preventScroll: true });
}

/** „Pe scurt”: media, ținta, ce-ți trebuie, notele și următorul test — fără restul detaliilor. */
function openSubjectGlance(mat) {
    const sub = state.subjects[mat];
    if (!sub) return;
    const d = metrics.subjects[mat];
    const has = sub.grades.length > 0;
    const reached = reachesTarget(d, sub.target);
    const plan = has && !reached ? planForCondition(mat, x => reachesTarget(x, sub.target)) : null;
    const pill = plan ? planPill(plan) : null;
    const next = upcomingForSubject(mat, 6).find(ev => NEEDS_GRADE.has(ev.type));
    const today = getLocalDateKey();
    openModal({
        title: `${mat} · pe scurt`,
        guestOk: true,
        confirmText: "Adaugă o notă",
        cancelText: "Închide",
        body: `
            <div class="glance">
                <div class="glance-top">
                    <div class="glance-avg tone-${has ? gradeTone(d.exactAvg) : "none"}">
                        <b>${has ? d.exactAvg.toFixed(2) : "–"}</b>
                        <small>${has ? `media · finală ${d.roundedAvg}` : "încă fără note"}</small>
                    </div>
                    <div class="glance-facts">
                        <span><b>Ținta</b> ${fmtTarget(sub.target)}${has ? (reached ? ` · <span class="azi-need is-ok">atinsă</span>` : "") : ""}</span>
                        <span><b>Stare</b> <span class="badge ${d.statusClass}">${escapeHTML(d.status)}</span></span>
                        <span><b>Ore</b> ${fmtNumber(sub.ore)} pe săptămână</span>
                    </div>
                </div>
                ${plan ? `<p class="glance-need">${icon("target")} Ca să ajungi la ${fmtTarget(sub.target)}: ${plan.next
                    ? `<span class="azi-need is-${pill.tone}">${escapeHTML(pill.text)}</span> la următoarea notă`
                    : `ai nevoie de <span class="azi-need is-${pill.tone}">${escapeHTML(pill.text)}</span>`}.</p>` : ""}
                ${next ? `<p class="glance-next">${icon("calendar-check")} ${escapeHTML(capitalize(eventPhrase(next.type, next.date, today)))}.</p>` : ""}
                <div class="glance-grades" aria-label="Note"><span class="glance-label">${has ? plural(sub.grades.length, "notă", "note") : "Note"}</span>
                    ${has ? gradesChrono(sub).map(({ g }) => `<span class="cat-grade-val tone-${gradeTone(Number(g.val))}" title="${escapeHTML(`${g.type || "Altele"}${g.date ? ` · ${getShortDateLabel(g.date)}` : ""}`)}">${escapeHTML(g.val)}</span>`).join("")
                        : `<span class="subtitle">Nicio notă încă.</span>`}
                </div>
            </div>`,
        onConfirm: () => {
            closeActionModal();
            openAddGradeModal(mat);
        }
    });
}

/** ← → între materii (când nu scrii nimic) și glisare stânga/dreapta pe detalii, pe telefon. */
function bindCatalogNav() {
    document.addEventListener("keydown", event => {
        if (ui.activeTab !== "tab-catalog" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (isTyping(event.target) || event.target.closest?.("select, .cat-menu") || document.body.classList.contains("modal-open") || tour.open) return;
        event.preventDefault();
        stepCatalog(event.key === "ArrowLeft" ? -1 : 1);
    });
    const pane = $("cat-detail");
    if (!pane) return;
    let start = null;
    pane.addEventListener("touchstart", event => {
        const t = event.touches[0];
        const edge = t.clientX < 24 || t.clientX > innerWidth - 24; // marginile sunt ale gestului „înapoi” din Safari
        start = event.touches.length === 1 && !edge && !event.target.closest(".cat-strip, input, select, textarea") ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
    }, { passive: true });
    pane.addEventListener("touchend", event => {
        if (!start) return;
        const t = event.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        const quick = Date.now() - start.at < 700;
        start = null;
        if (quick && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) stepCatalog(dx < 0 ? 1 : -1);
    }, { passive: true });
}

/* ---------- foile de jos: trage în jos ca să închizi (ca pe iPhone) ---------- */
function bindSheetDrag() {
    const SHEETS = [
        { root: "action-modal", card: ".modal-card", scroller: "#action-modal-body", close: () => closeActionModal(), allowed: () => !cloud.asking,
          fade: (el, p) => { el.style.backgroundColor = p === null ? "" : `rgba(15, 23, 42, ${(0.3 * (1 - p)).toFixed(3)})`; } },
        { root: "quick-add", card: ".quick-add-card", close: () => closeQuickAdd(),
          fade: (el, p) => { const b = el.querySelector(".quick-add-backdrop"); if (b) b.style.opacity = p === null ? "" : String(1 - p); } },
        { root: "more-menu", card: ".quick-add-card", close: () => closeMoreMenu(),
          fade: (el, p) => { const b = el.querySelector(".quick-add-backdrop"); if (b) b.style.opacity = p === null ? "" : String(1 - p); } }
    ];
    let drag = null;
    const reset = d => {
        d.card.style.transition = "";
        d.card.style.transform = "";
        d.sheet.fade(d.root, null);
    };
    document.addEventListener("touchstart", event => {
        if (event.touches.length !== 1) return;
        const t = event.touches[0];
        for (const sheet of SHEETS) {
            const root = $(sheet.root);
            const card = root && !root.hidden ? root.querySelector(sheet.card) : null;
            if (!card || !card.contains(event.target)) continue;
            const r = card.getBoundingClientRect();
            // doar când e foaie lipită de marginea de jos (pe ecrane mari e fereastră în mijloc)
            if (r.bottom < innerHeight - 4 || r.width < innerWidth - 4) return;
            // se poate trage de oriunde (și de pe un câmp: o atingere care alunecă nu-l deschide), mai puțin din ce se derulează singur
            if (event.target.closest("textarea, input[type='range'], [contenteditable='true'], .cal-lessons, .cat-strip")) return;
            const scroller = sheet.scroller ? root.querySelector(sheet.scroller) : null;
            const inScroller = scroller?.contains(event.target);
            drag = { sheet, root, card, scroller, inScroller, y: t.clientY, x: t.clientX, t: Date.now(), dy: 0, active: false, h: r.height };
            return;
        }
    }, { passive: true });
    document.addEventListener("touchmove", event => {
        if (!drag) return;
        const t = event.touches[0];
        const dy = t.clientY - drag.y;
        const dx = t.clientX - drag.x;
        if (!drag.active) {
            if (Math.abs(dx) > Math.abs(dy) || dy < -4) { drag = null; return; } // derulare sau gest lateral
            if (dy < 8) return;
            // din conținut se trage doar când e derulat complet sus; altfel e derulare obișnuită
            if (drag.inScroller && drag.scroller.scrollTop > 0) { drag = null; return; }
            drag.active = true;
            drag.y = t.clientY;
            drag.lastY = t.clientY;
            drag.lastT = Date.now();
            drag.v = 0;
            document.activeElement?.blur?.(); // tastatura coboară odată cu foaia
        }
        event.preventDefault();
        drag.dy = Math.max(0, t.clientY - drag.y);
        // viteza din ultimele mișcări: o „aruncare” scurtă și rapidă închide foaia
        const now = Date.now();
        const dt = Math.max(1, now - drag.lastT);
        drag.v = 0.6 * ((t.clientY - drag.lastY) / dt) + 0.4 * drag.v;
        drag.lastY = t.clientY;
        drag.lastT = now;
        drag.card.style.transition = "none";
        drag.card.style.transform = `translateY(${drag.dy}px)`;
        drag.sheet.fade(drag.root, Math.min(1, drag.dy / drag.h));
    }, { passive: false });
    const end = () => {
        const d = drag;
        drag = null;
        if (!d?.active) return;
        const speed = Date.now() - d.lastT < 120 ? d.v : 0; // dacă degetul s-a oprit înainte să-l ridici, nu e aruncare
        const allowed = d.sheet.allowed ? d.sheet.allowed() : true;
        if (allowed && (d.dy > Math.min(140, d.h * 0.3) || (speed > 0.55 && d.dy > 30))) {
            d.card.style.transition = "transform 0.2s cubic-bezier(.3, .6, .4, 1)";
            d.card.style.transform = `translateY(${d.h + 24}px)`;
            d.sheet.fade(d.root, 1);
            setTimeout(() => { d.sheet.close(); reset(d); }, 200);
        } else {
            d.card.style.transition = "transform 0.28s cubic-bezier(.2, 1.3, .4, 1)";
            d.card.style.transform = "";
            d.sheet.fade(d.root, null);
            setTimeout(() => { if (!drag) d.card.style.transition = ""; }, 300);
        }
    };
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
}

/* ---------- telefon (mai ales iPhone) ---------- */
function bindPhoneHelpers() {
    const root = document.documentElement;
    // Safari pe iPhone aplică stilurile „:active” (apăsat) doar dacă pagina ascultă atingerile.
    document.addEventListener("touchstart", () => {}, { passive: true });
    // Tastatura: pe iPhone nu micșorează pagina, ci doar „fereastra vizibilă”. O urmărim, ca foile de jos
    // (formularele) să stea deasupra tastaturii, iar bara de jos să se ascundă cât scrii.
    const vv = window.visualViewport;
    const typingEl = el => el?.matches?.("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button]), textarea, select, [contenteditable='true']");
    // Tastatura e deschisă când fereastra vizibilă e mult mai scundă decât cea mai înaltă văzută la lățimea asta
    // (merge și pe iPhone, unde pagina nu se micșorează, și pe Android, unde se micșorează).
    let tallest = 0;
    let tallestW = 0;
    const sync = () => {
        let kb = typingEl(document.activeElement) && matchMedia("(pointer: coarse)").matches;
        if (vv) {
            if (innerWidth !== tallestW) { tallestW = innerWidth; tallest = 0; }
            tallest = Math.max(tallest, vv.height);
            root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
            root.style.setProperty("--vvtop", `${Math.round(vv.offsetTop)}px`);
            kb = kb && vv.height < tallest - 120;
        }
        document.body.classList.toggle("kb-open", Boolean(kb));
    };
    if (vv) {
        vv.addEventListener("resize", sync);
        vv.addEventListener("scroll", sync);
    }
    sync();
    document.addEventListener("focusin", event => {
        if (!typingEl(event.target)) return;
        sync();
        // câmpul ales rămâne la vedere după ce urcă tastatura
        const el = event.target;
        setTimeout(() => {
            sync();
            if (document.activeElement === el && document.body.classList.contains("kb-open") && el.closest(".modal-card, .setup-card, .auth-card")) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 350);
    });
    document.addEventListener("focusout", () => setTimeout(sync, 60));
    // Deschisă de pe ecranul principal: aceeași aplicație, fără bara browserului
    const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    document.body.classList.toggle("is-standalone", standalone);
    // Merge și fără internet (după prima deschidere)
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
        const reg = () => navigator.serviceWorker.register("sw.js").catch(() => {});
        if (document.readyState === "complete") reg(); else addEventListener("load", reg);
    }
}

function bindCatMenu() {
    const list = $("cat-list");
    const menu = $("cat-menu");
    if (!list || !menu) return;
    const rowAt = event => {
        const row = event.target.closest?.(".cat-row") || document.elementFromPoint?.(event.clientX, event.clientY)?.closest(".cat-row");
        return row && list.contains(row) && state.subjects[row.dataset.mat] ? row : null;
    };
    const open = event => {
        const row = rowAt(event);
        if (!row) return;
        event.preventDefault();
        window.getSelection?.()?.removeAllRanges(); // dublu-clicul nu mai selectează textul
        openCatMenu(row.dataset.mat, event.clientX + 4, event.clientY + 4, row);
    };
    // Dublu-clicul e detectat de mână: primul clic redesenează lista (alege materia), deci browserul
    // nu mai vede „același element” de două ori și nu trimite mereu „dblclick”.
    list.addEventListener("click", event => {
        const row = rowAt(event);
        if (!row) return;
        const mat = row.dataset.mat;
        const now = performance.now();
        const last = catMenu.last;
        const second = event.detail === 2 || (last.mat === mat && now - last.t < 450 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 14);
        catMenu.last = second ? { mat: "", t: 0, x: 0, y: 0 } : { mat, t: now, x: event.clientX, y: event.clientY };
        if (!second) return;
        window.getSelection?.()?.removeAllRanges();
        const x = event.clientX + 4;
        const y = event.clientY + 4;
        // după ce clicul și-a terminat treaba (selectarea materiei), ca meniul să rămână deschis și cu focus
        setTimeout(() => openCatMenu(mat, x, y, list.querySelector(`.cat-row[data-mat="${CSS.escape(mat)}"]`)), 0);
    });
    list.addEventListener("dblclick", open);
    // Apăsare lungă pe ecrane tactile. Safari pe iPhone nu trimite „contextmenu”, așa că o măsurăm noi;
    // pe Android vine și „contextmenu” — îl ignorăm dacă meniul s-a deschis deja.
    let press = null;
    let pressedAt = 0;
    const cancelPress = () => { if (press) clearTimeout(press.timer); press = null; };
    list.addEventListener("touchstart", event => {
        cancelPress();
        const row = event.touches.length === 1 ? rowAt(event) : null;
        if (!row) return;
        const t = event.touches[0];
        press = { x: t.clientX, y: t.clientY, fired: false };
        press.timer = setTimeout(() => {
            if (!press) return;
            press.fired = true;
            pressedAt = Date.now();
            navigator.vibrate?.(12);
            openCatMenu(row.dataset.mat, press.x + 4, press.y + 4, row);
        }, 480);
    }, { passive: true });
    list.addEventListener("touchmove", event => {
        if (!press || press.fired) return;
        const t = event.touches[0];
        if (Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) cancelPress();
    }, { passive: true });
    list.addEventListener("touchend", event => {
        // după o apăsare lungă nu mai vrem și „clicul” care ar alege materia (și ar închide meniul)
        if (press?.fired) event.preventDefault();
        cancelPress();
    });
    list.addEventListener("touchcancel", cancelPress);
    list.addEventListener("contextmenu", event => {
        if (Date.now() - pressedAt < 1000) { event.preventDefault(); return; }
        cancelPress();
        open(event);
    });
    list.addEventListener("keydown", event => {
        if (!((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) return;
        const row = event.target.closest(".cat-row");
        if (!row || !state.subjects[row.dataset.mat]) return;
        event.preventDefault();
        const r = row.getBoundingClientRect();
        openCatMenu(row.dataset.mat, r.left + 24, r.bottom - 4, row);
    });
    document.addEventListener("mousedown", event => {
        if (!menu.hidden && !menu.contains(event.target)) closeCatMenu({ restoreFocus: false });
    });
    let lastW = innerWidth;
    window.addEventListener("resize", () => { if (innerWidth !== lastW) { lastW = innerWidth; closeCatMenu({ restoreFocus: false }); } });
    window.addEventListener("scroll", () => { if (performance.now() - catMenu.openedAt > 400) closeCatMenu({ restoreFocus: false }); }, { passive: true });
    menu.addEventListener("keydown", event => {
        const items = [...menu.querySelectorAll("[role='menuitem']")];
        const i = items.indexOf(document.activeElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeCatMenu(); }
        else if (event.key === "ArrowDown") { event.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (event.key === "ArrowUp") { event.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (event.key === "Home") { event.preventDefault(); items[0].focus(); }
        else if (event.key === "End") { event.preventDefault(); items.at(-1).focus(); }
        else if (event.key === "Tab") closeCatMenu({ restoreFocus: false });
    });
}

const CAT_MENU_ACTIONS = {
    "cat-menu-edit": () => { const mat = catMenu.mat; closeCatMenu(); openEditSubjectModal(mat); },
    "cat-menu-grade": () => { const mat = catMenu.mat; closeCatMenu(); openAddGradeModal(mat); },
    "cat-menu-glance": () => { const mat = catMenu.mat; closeCatMenu(); openSubjectGlance(mat); }
};

/* ---------- CALENDAR ---------- */
function renderCalendar() {
    const body = $("cal-body");
    if (!body) return;

    document.querySelectorAll("[data-action='cal-view']").forEach(btn => {
        btn.setAttribute("aria-pressed", String(btn.dataset.view === ui.cal.view));
    });

    renderCalOverview();
    if (ui.cal.view === "month") renderMonthView();
    else renderWeekView();
}

/* ---------- rezumat: ce urmează + ce necesită atenție ---------- */
function renderCalOverview() {
    const box = $("cal-overview");
    if (!box) return;

    const today = getLocalDateKey();
    const links = gradeLinks();
    const upcoming = occurrencesBetween(today, addDays(today, 30))
        .filter(o => NEEDS_GRADE.has(o.ev.type) && !isOccurrenceDone(o.ev, o.date, links));
    const homework = occurrencesBetween(today, addDays(today, 6))
        .filter(o => o.ev.type === "Temă" && !isOccurrenceDone(o.ev, o.date, links));
    // Pentru o serie repetată arătăm doar cea mai recentă apariție ratată (+ câte mai vechi), nu câte un rând pe săptămână.
    const attention = missedOccurrences(links, today);

    const cards = [];

    // 1. Ce urmează
    const [first, ...rest] = upcoming;
    cards.push(`
        <section class="glass-card cal-ov-card" aria-labelledby="cal-ov-next">
            <div class="cal-ov-head">
                <h3 id="cal-ov-next">${icon("calendar-check")} Urmează</h3>
                <span class="subtitle">teste și evaluări, următoarele 30 de zile</span>
            </div>
            ${first ? `
                <button type="button" class="cal-next-hero ev-${EVENT_TYPE_CLASS[first.ev.type]}" data-action="cal-goto" data-date="${first.date}">
                    <span class="cal-countdown">
                        <b>${daysBetween(today, first.date) === 0 ? "Azi" : daysBetween(today, first.date)}</b>
                        <small>${daysBetween(today, first.date) === 0 ? "" : daysBetween(today, first.date) === 1 ? "zi" : "zile"}</small>
                    </span>
                    <span class="cal-next-main">
                        <b>${escapeHTML(first.ev.title)}</b>
                        <small>${icon(EVENT_TYPE_ICON[first.ev.type])} ${escapeHTML([first.ev.type, first.ev.subject, `${weekdayLabel(first.date)}${first.ev.time ? `, ${first.ev.time}` : ""}`].filter(Boolean).join(" · "))}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                </button>
                ${rest.length ? `<ul class="cal-ov-list">${rest.slice(0, 4).map(o => `
                    <li><button type="button" class="cal-ov-row" data-action="cal-goto" data-date="${o.date}">
                        <span class="cal-ov-when">${escapeHTML(relativeDayLabel(o.date))}</span>
                        <span class="cal-ov-title"><i class="ev-dot ev-${EVENT_TYPE_CLASS[o.ev.type]}" aria-hidden="true"></i>${escapeHTML(o.ev.title)}</span>
                        <span class="cal-ov-meta">${escapeHTML(weekdayLabel(o.date))}</span>
                    </button></li>`).join("")}</ul>` : ""}`
            : `<p class="muted-small cal-ov-empty">${icon("sparkles")} Niciun test sau examen în următoarele 30 de zile.</p>`}
            <p class="cal-ov-foot">${icon("notebook")} ${homework.length ? `${plural(homework.length, "temă de predat", "teme de predat")} în următoarele 7 zile` : "Nicio temă de predat în următoarele 7 zile"}</p>
        </section>`);

    // 2. Ce necesită atenție (teste trecute fără notă, teme nebifate)
    if (attention.length) {
        cards.push(`
            <section class="glass-card cal-ov-card cal-ov-attention" aria-labelledby="cal-ov-att">
                <div class="cal-ov-head">
                    <h3 id="cal-ov-att">${icon("alert")} Necesită atenție <span class="cat-count">${attention.length}</span></h3>
                    <span class="subtitle">evenimente trecute nefinalizate</span>
                </div>
                <ul class="cal-ov-list">
                    ${attention.slice(0, 5).map(({ ev, date, older }) => `
                        <li class="cal-att-row">
                            <span class="cal-att-info">
                                <b><i class="ev-dot ev-${EVENT_TYPE_CLASS[ev.type]}" aria-hidden="true"></i>${escapeHTML(ev.title)}</b>
                                <small>${escapeHTML([ev.subject, `${relativeDayLabel(date)} (${shortDayLabel(date)})`, older && `+${older} mai ${older === 1 ? "veche" : "vechi"}`].filter(Boolean).join(" · "))}</small>
                            </span>
                            <span class="cal-att-actions">
                                ${canGradeOccurrence(ev, date, links) && NEEDS_GRADE.has(ev.type) ? `<button type="button" class="btn btn-primary btn-sm" data-action="event-grade" data-id="${escapeHTML(ev.id)}" data-date="${date}">${icon("plus")} Notă</button>` : ""}
                                <button type="button" class="btn btn-glass btn-sm" data-action="event-done" data-id="${escapeHTML(ev.id)}" data-date="${date}"
                                    title="${NEEDS_GRADE.has(ev.type) ? "Marchează ca încheiat fără notă" : "Marchează ca făcut"}">${icon("check")} ${NEEDS_GRADE.has(ev.type) ? "Fără notă" : "Făcut"}</button>
                            </span>
                        </li>`).join("")}
                </ul>
                ${attention.length > 5 ? `<p class="cal-ov-foot">și încă ${attention.length - 5}…</p>` : ""}
            </section>`);
    } else if (Object.keys(state.timetable).length === 0 && Object.keys(state.subjects).length) {
        // Fără orar: îl propunem, pentru că face adăugarea mult mai rapidă.
        cards.push(`
            <section class="glass-card cal-ov-card cal-ov-tip">
                <div class="cal-ov-head"><h3>${icon("calendar-days")} Adaugă-ți orarul</h3></div>
                <p class="muted-small">Cu orarul, fiecare zi îți arată orele, iar un test sau o temă se adaugă dintr-o atingere pe materie. Poți alege și „următoarea oră” ca dată.</p>
                <button type="button" class="btn btn-primary mt-3" data-action="timetable">Completează orarul</button>
            </section>`);
    }

    box.innerHTML = cards.join("");
}

/* ---------- săptămână ---------- */
function renderWeekView() {
    const start = weekStart(ui.cal.date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const today = getLocalDateKey();
    const links = gradeLinks();
    const occ = occurrencesBetween(days[0], days[6]);

    const sameMonth = parseDateKey(days[0]).getMonth() === parseDateKey(days[6]).getMonth();
    const endD = parseDateKey(days[6]);
    setText("cal-title", sameMonth
        ? `${parseDateKey(days[0]).getDate()} – ${endD.getDate()} ${MONTHS[endD.getMonth()].toLowerCase()} ${endD.getFullYear()}`
        : `${shortDayLabel(days[0])} – ${shortDayLabel(days[6])} ${endD.getFullYear()}`);
    const diff = Math.round(daysBetween(weekStart(today), start) / 7);
    setText("cal-caption", diff === 0 ? "Săptămâna aceasta" : diff === 1 ? "Săptămâna viitoare" : diff === -1 ? "Săptămâna trecută"
        : diff > 0 ? `Peste ${plural(diff, "săptămână", "săptămâni")}` : `Acum ${plural(-diff, "săptămână", "săptămâni")}`);

    $("cal-body").innerHTML = `<div class="cal-week">${days.map(date => dayColumnHTML(date, occ.filter(o => o.date === date), links, today)).join("")}</div>`;
}

function dayColumnHTML(date, items, links, today) {
    const d = parseDateKey(date);
    const wd = d.getDay();
    const lessons = state.timetable[wd] || [];
    const classes = [
        "cal-col",
        date === today && "is-today",
        date < today && "is-past",
        (wd === 0 || wd === 6) && "is-weekend",
        !items.length && !lessons.length && !calPlanHTML(date) && "is-empty"
    ].filter(Boolean).join(" ");

    return `
        <section class="${classes}" data-date="${date}" aria-label="${escapeHTML(`${WEEKDAY_LONG[wd]}, ${getDateLabel(date)}`)}">
            <header class="cal-col-head">
                <span class="cal-col-wd">${WEEKDAY_SHORT[wd]}</span>
                <span class="cal-col-date">${d.getDate()}</span>
                <span class="cal-col-month">${MONTH_SHORT[d.getMonth()]}</span>
                ${date === today ? '<span class="cal-today-tag">Azi</span>' : ""}
                <button type="button" class="cal-add-mini" data-action="add-event" data-date="${date}" aria-label="Adaugă pe ${escapeHTML(getDateLabel(date))}">${icon("plus")}</button>
            </header>
            ${lessons.length ? `
                <div class="cal-lessons" aria-label="Orar">
                    ${lessons.map((m, i) => `
                        <button type="button" class="cal-lesson" data-action="add-event" data-date="${date}" data-mat="${escapeHTML(m)}"
                            title="${escapeHTML(`Ora ${i + 1}: ${m} — adaugă un test sau o temă`)}"><span class="cal-lesson-n">${i + 1}</span><span class="cal-lesson-name">${escapeHTML(m)}</span></button>`).join("")}
                </div>` : ""}
            <div class="cal-items">${items.map(o => eventCardHTML(o, links)).join("")}</div>
            ${calPlanHTML(date)}
            <button type="button" class="cal-add" data-action="add-event" data-date="${date}">${icon("plus")} Adaugă</button>
        </section>`;
}

/** Sesiunile din plan, discrete, sub evenimentele zilei (dacă elevul vrea să le vadă în Calendar). */
function calPlanHTML(date) {
    if (!state.plan.prefs.setup || !state.plan.prefs.calendar) return "";
    const items = planItemsOn(date);
    if (!items.length) return "";
    return `<div class="cal-plan" aria-label="Din plan">${items.map(it => `
        <button type="button" class="cal-plan-item ${it.done ? "is-done" : ""}" data-action="nav" data-tab="tab-plan" title="${escapeHTML(`${PLAN_KINDS[it.kind].label} · ${it.min} min${it.reason ? ` · ${it.reason}` : ""}`)}">
            ${icon(it.done ? "check" : PLAN_KINDS[it.kind].icon)}<span>${escapeHTML(it.mat)} · ${it.min}′</span></button>`).join("")}</div>`;
}

function eventCardHTML({ ev, date }, links) {
    const link = linkedGrade(links, ev, date);
    const done = isOccurrenceDone(ev, date, links);
    const id = escapeHTML(ev.id);
    let gradeBtn = "";
    if (link) {
        gradeBtn = `<button type="button" class="cal-ev-grade cat-grade-val tone-${gradeTone(Number(link.grade.val))}" data-action="edit-grade"
            data-mat="${escapeHTML(link.mat)}" data-index="${link.idx}" title="Nota primită — apasă ca s-o modifici">Nota ${escapeHTML(link.grade.val)}</button>`;
    } else if (NEEDS_GRADE.has(ev.type) && canGradeOccurrence(ev, date, links)) {
        gradeBtn = `<button type="button" class="cal-ev-addgrade" data-action="event-grade" data-id="${id}" data-date="${date}">+ Notă</button>`;
    }

    return `
        <article class="cal-ev ev-${EVENT_TYPE_CLASS[ev.type] || "personal"} ${done ? "is-done" : ""}" draggable="true" data-id="${id}" data-date="${date}">
            <button type="button" class="cal-ev-check" data-action="event-done" data-id="${id}" data-date="${date}" aria-pressed="${done}"
                ${link ? "disabled" : ""} title="${link ? "Are notă — e încheiat" : done ? "Marchează ca nefăcut" : "Marchează ca făcut"}"
                aria-label="${escapeHTML(`${done ? "Nefăcut" : "Făcut"}: ${ev.title}`)}">${done ? "✓" : ""}</button>
            <button type="button" class="cal-ev-main" data-action="event-open" data-id="${id}" data-date="${date}" title="Editează">
                <span class="cal-ev-top">
                    ${ev.time ? `<span class="cal-ev-time">${escapeHTML(ev.time)}</span>` : ""}
                    <span class="cal-ev-type">${icon(EVENT_TYPE_ICON[ev.type] || "pin")} ${escapeHTML(ev.type)}</span>
                    ${ev.repeat ? `<span class="cal-ev-rep" title="${ev.repeat.every === 2 ? "Se repetă la 2 săptămâni" : "Se repetă săptămânal"}">↻</span>` : ""}
                </span>
                <b class="cal-ev-title">${escapeHTML(ev.title)}</b>
                ${ev.subject && ev.title !== autoEventTitle(ev.type, ev.subject) ? `<small class="cal-ev-sub">${escapeHTML(ev.subject)}</small>` : ""}
            </button>
            ${gradeBtn}
        </article>`;
}

/* ---------- lună ---------- */
function renderMonthView() {
    const anchor = parseDateKey(ui.cal.date);
    const first = getLocalDateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    const last = getLocalDateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
    const gridStart = weekStart(first);
    const gridEnd = addDays(weekStart(last), 6);
    const today = getLocalDateKey();
    const links = gradeLinks();
    const occ = occurrencesBetween(gridStart, gridEnd);

    setText("cal-title", `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`);
    const monthDiff = (anchor.getFullYear() - new Date().getFullYear()) * 12 + anchor.getMonth() - new Date().getMonth();
    setText("cal-caption", monthDiff === 0 ? "Luna aceasta" : monthDiff === 1 ? "Luna viitoare" : monthDiff === -1 ? "Luna trecută" : "Apasă o zi pentru detalii");

    const cells = [];
    for (let date = gridStart; date <= gridEnd; date = addDays(date, 1)) {
        const items = occ.filter(o => o.date === date);
        const out = date < first || date > last;
        cells.push(`
            <button type="button" class="cal-mcell ${out ? "is-out" : ""} ${date === today ? "is-today" : ""}" data-action="cal-goto" data-date="${date}"
                aria-label="${escapeHTML(`${getDateLabel(date)}${items.length ? `, ${plural(items.length, "eveniment", "evenimente")}` : ""}`)}">
                <b>${parseDateKey(date).getDate()}</b>
                ${items.slice(0, 3).map(({ ev, date: d }) => `<span class="cal-mpill ev-${EVENT_TYPE_CLASS[ev.type] || "personal"} ${isOccurrenceDone(ev, d, links) ? "is-done" : ""}">${escapeHTML(ev.title)}</span>`).join("")}
                ${items.length > 3 ? `<span class="cal-mmore">+${items.length - 3}</span>` : ""}
            </button>`);
    }

    $("cal-body").innerHTML = `
        <div class="cal-month">
            ${[1, 2, 3, 4, 5, 6, 0].map(wd => `<span class="cal-month-wd" aria-hidden="true">${WEEKDAY_SHORT[wd]}</span>`).join("")}
            ${cells.join("")}
        </div>`;
}

/* ---------- navigare ---------- */
function calNavigate(offset) {
    const d = parseDateKey(ui.cal.date);
    ui.cal.date = ui.cal.view === "month"
        ? getLocalDateKey(new Date(d.getFullYear(), d.getMonth() + offset, 1))
        : addDays(ui.cal.date, offset * 7);
    renderCalendar();
}

function calGoto(dateKey, { view = "week" } = {}) {
    if (!DATE_KEY_RE.test(String(dateKey))) return;
    ui.cal.date = dateKey;
    ui.cal.view = view;
    if (ui.activeTab !== "tab-calendar") switchTab("tab-calendar");
    else renderCalendar();

    const col = document.querySelector(`.cal-col[data-date="${dateKey}"]`);
    if (col) {
        col.scrollIntoView({ block: "nearest", behavior: "smooth" });
        col.classList.add("flash");
        setTimeout(() => col.classList.remove("flash"), 1600);
    }
}

/** Folosită de Dashboard, Catalog și căutare. */
function showDateInCalendar(dateKey) {
    calGoto(dateKey);
}

/* ---------- ALERTE ---------- */
function renderAlerts() {
    const cont = $("alerte-container");
    if (!cont) return;

    cont.innerHTML = alerts.length
        ? alerts.map(al => `
            <div class="alert-card ${escapeHTML(al.type)} ${al.unread ? "unread" : ""}">
                <button type="button" class="alert-open" data-action="alert-open" data-id="${escapeHTML(al.id)}">
                    ${icon(al.icon || "info", "alert-ico")}<span>${escapeHTML(al.text)}</span>
                </button>
                <button type="button" class="btn btn-text" data-action="dismiss-alert" data-id="${escapeHTML(al.id)}"
                    title="Elimină alerta" aria-label="Elimină alerta">${icon("x")}</button>
            </div>`).join("")
        : `<div class="alert-card success"><span>${icon("check-circle")} Nu există nicio alertă activă. Felicitări!</span></div>`;
}

/** Deschide locul la care se referă o notificare (materia sau ziua din calendar). */
function openAlertTarget(id) {
    const al = alerts.find(a => a.id === id);
    if (!al) return;
    state.alertMeta.read[id] = true; // refresh() salvează
    closeNotifPanel({ restoreFocus: false });
    if (al.tab) switchTab(al.tab);
    else if (al.date) showDateInCalendar(al.date);
    else if (al.mat) openSubjectInCatalog(al.mat);
    else if (al.filter && CATALOG_FILTERS[al.filter]) {
        ui.catalog.filter = al.filter;
        ui.catalog.query = "";
        ui.catalog.showDetail = false;
        switchTab("tab-catalog");
    }
    refresh();
}

/* ---------- SETĂRI ---------- */
const SETTINGS_FIELDS = {
    "set-primary-goal": ["goals", "primary"],
    "set-target-gpa": ["goals", "targetGPA"],
    "set-min-gpa": ["goals", "minGPA"],
    "set-target-tens": ["targets", "tens"],
    "set-target-evals": ["targets", "evals"],
    "set-calc-method": ["calc", "method"],
    "set-rounding": ["calc", "rounding"],
    "set-risk-gpa": ["calc", "riskThreshold"],
    "set-risk-drop": ["calc", "riskDrop"],
    "set-theme": ["appearance", "theme"],
    "set-accent": ["appearance", "accent"],
    "set-density": ["appearance", "density"],
    "set-cursor": ["appearance", "cursor"],
    "set-island": ["appearance", "island"],
    "set-name": ["profile", "name"],
    "set-buddy": ["profile", "buddy"]
};

function loadSettingsIntoUI() {
    for (const [id, [group, key]] of Object.entries(SETTINGS_FIELDS)) {
        const el = $(id);
        if (el) el.value = state.settings[group][key];
    }
    renderModulesSettings();
    renderBackupStatus();
    renderBuddyPreview();
    renderProgrammeSettings();
    if (guest.on) renderGuestBar(); // câmpurile rămân blocate pentru vizitatori
}

/** „Programa ta” (Setări): profilul și clasa, de care depind materiile care se pot adăuga. */
function renderProgrammeSettings() {
    const box = $("programme-settings");
    if (!box) return;
    const outside = Object.keys(state.subjects).filter(m => !inProgramme(m));
    box.innerHTML = myProgramme() ? `
        <p class="programme-now"><b>${escapeHTML(programmeLabel())}</b><small>Limba modernă 2: ${escapeHTML(state.settings.school.lm2)}</small></p>
        <p class="subtitle">Poți adăuga doar materiile din programa asta, plus dirigenția și maximum un opțional.${outside.length ? ` ${plural(outside.length, "materie e", "materii sunt")} în afara programei: ${escapeHTML(outside.join(", "))}.` : ""}</p>
        <button type="button" class="btn btn-glass btn-sm mt-3" data-action="programme-change">${icon("graduation")} Schimbă clasa sau profilul</button>` : `
        <p class="subtitle">Nu ți-ai ales încă programa. Cu ea, materiile se completează singure din planul-cadru al clasei tale.</p>
        <button type="button" class="btn btn-primary btn-sm mt-3" data-action="programme-change">${icon("graduation")} Alege profilul și clasa</button>`;
}

/** Mascota de lângă câmpurile „Tu și colegul tău” (Setări), cu numele scris în câmp. */
function renderBuddyPreview() {
    const box = $("set-buddy-preview");
    if (!box) return;
    const name = cleanName($("set-buddy")?.value, 20) || DEFAULT_SETTINGS.profile.buddy;
    const who = cleanName($("set-name")?.value, 40).split(" ")[0];
    box.innerHTML = `${buddySVG("happy")}<p class="buddy-bubble is-sm"><b class="buddy-name">${escapeHTML(name)}</b><span>${who ? `Salut, ${escapeHTML(who)}!` : "Salut!"}</span></p>`;
}

/* ==================== LISTE DERULANTE PERSONALIZATE ==================== */
/*
 * Elementul <select> rămâne cel real (valoare, evenimente „change”, aspectul închis),
 * doar lista care se deschide e înlocuită cu una în stilul aplicației.
 * Pe telefon/tabletă (pointer „coarse”) rămâne selectorul sistemului, care e mai comod la atingere.
 */
const customSelect = { open: null, typed: "", typedTimer: 0 };

function initCustomSelects() {
    if (!window.matchMedia?.("(pointer: fine)").matches) return;

    document.addEventListener("mousedown", event => {
        const select = event.target.closest?.("select");
        if (!select || event.button !== 0 || select.disabled || select.multiple || select.size > 1) return;
        event.preventDefault();
        if (customSelect.open?.select === select) {
            closeCustomSelect();
            return;
        }
        select.focus({ preventScroll: true });
        openCustomSelect(select);
    }, true);

    document.addEventListener("keydown", event => {
        const select = event.target;
        if (!(select instanceof HTMLSelectElement) || select.disabled || customSelect.open) return;
        const opens = [" ", "Enter", "ArrowDown", "ArrowUp", "F4"].includes(event.key);
        if (!opens || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        openCustomSelect(select);
    }, true);

    // O derulare care mută lista închisă o închide (altfel lista ar rămâne „plutind”);
    // controalele lipite sus (sticky) nu se mișcă la derulare, așa că lista lor rămâne deschisă.
    document.addEventListener("scroll", event => {
        const open = customSelect.open;
        if (!open || open.pop.contains(event.target)) return;
        const r = open.select.getBoundingClientRect();
        if (Math.abs(r.top - open.anchorTop) > 2 || Math.abs(r.left - open.anchorLeft) > 2) closeCustomSelect({ restoreFocus: false });
    }, true);
    window.addEventListener("resize", () => closeCustomSelect({ restoreFocus: false }));
    document.addEventListener("mousedown", event => {
        const open = customSelect.open;
        if (open && !open.pop.contains(event.target) && event.target !== open.select) closeCustomSelect({ restoreFocus: false });
    });
}

function customOptionItems() {
    return [...customSelect.open.pop.querySelectorAll(".cs-opt:not(.is-disabled)")];
}

function openCustomSelect(select) {
    closeCustomSelect({ restoreFocus: false });
    const options = [...select.options].filter(o => !o.hidden);
    if (options.length === 0) return;

    const pop = document.createElement("div");
    pop.className = "cs-pop";
    pop.id = "cs-pop";
    pop.tabIndex = -1;
    pop.setAttribute("role", "listbox");
    const label = select.getAttribute("aria-label") || select.labels?.[0]?.textContent || "";
    if (label.trim()) pop.setAttribute("aria-label", label.trim());

    pop.innerHTML = options.map(o => `
        <div class="cs-opt ${o.selected ? "is-selected" : ""} ${o.disabled ? "is-disabled" : ""} ${o.value === "" ? "is-placeholder" : ""}"
            role="option" id="cs-opt-${o.index}" data-index="${o.index}" aria-selected="${o.selected}" ${o.disabled ? 'aria-disabled="true"' : ""}>
            <span class="cs-check" aria-hidden="true"></span>
            <span class="cs-label">${escapeHTML(o.textContent.trim())}</span>
            ${o.dataset.meta ? `<span class="cs-meta">${escapeHTML(o.dataset.meta)}</span>` : ""}
        </div>`).join("");

    document.body.appendChild(pop);
    const anchor = select.getBoundingClientRect();
    customSelect.open = { select, pop, anchorTop: anchor.top, anchorLeft: anchor.left };
    select.setAttribute("aria-expanded", "true");
    select.classList.add("cs-open");
    positionCustomSelect();

    pop.addEventListener("mousedown", event => event.preventDefault()); // focusul rămâne în listă
    pop.addEventListener("click", event => {
        const opt = event.target.closest(".cs-opt");
        if (opt && !opt.classList.contains("is-disabled")) chooseCustomOption(Number(opt.dataset.index));
    });
    pop.addEventListener("mousemove", event => {
        const opt = event.target.closest(".cs-opt:not(.is-disabled)");
        if (opt && !opt.classList.contains("is-active")) setActiveCustomOption(opt, { scroll: false });
    });
    pop.addEventListener("keydown", handleCustomSelectKey);
    pop.addEventListener("focusout", event => {
        if (customSelect.open?.pop === pop && !pop.contains(event.relatedTarget) && event.relatedTarget !== select) {
            closeCustomSelect({ restoreFocus: false });
        }
    });

    const items = customOptionItems();
    setActiveCustomOption(items.find(el => el.classList.contains("is-selected")) || items[0], { center: true });
    pop.focus({ preventScroll: true });
    requestAnimationFrame(() => pop.classList.add("is-open"));
}

function positionCustomSelect() {
    const { select, pop } = customSelect.open;
    const r = select.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    pop.style.minWidth = `${Math.round(r.width)}px`;

    const below = window.innerHeight - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const natural = Math.min(pop.scrollHeight, 340);
    const openUp = below < natural && above > below;
    pop.style.maxHeight = `${Math.max(120, Math.min(340, openUp ? above : below))}px`;
    pop.classList.toggle("opens-up", openUp);

    const h = pop.offsetHeight;
    const w = pop.offsetWidth;
    pop.style.top = `${Math.round(openUp ? r.top - gap - h : r.bottom + gap)}px`;
    pop.style.left = `${Math.round(Math.max(margin, Math.min(r.left, window.innerWidth - w - margin)))}px`;
}

function setActiveCustomOption(el, { scroll = true, center = false } = {}) {
    const open = customSelect.open;
    if (!open || !el) return;
    open.pop.querySelector(".cs-opt.is-active")?.classList.remove("is-active");
    el.classList.add("is-active");
    open.pop.setAttribute("aria-activedescendant", el.id);
    if (center) el.scrollIntoView({ block: "center" });
    else if (scroll) el.scrollIntoView({ block: "nearest" });
}

function handleCustomSelectKey(event) {
    const open = customSelect.open;
    if (!open) return;
    const items = customOptionItems();
    const i = items.findIndex(el => el.classList.contains("is-active"));
    const go = index => setActiveCustomOption(items[Math.max(0, Math.min(items.length - 1, index))]);

    switch (event.key) {
        case "ArrowDown": go(i + 1); break;
        case "ArrowUp": go(i - 1); break;
        case "Home": go(0); break;
        case "End": go(items.length - 1); break;
        case "PageDown": go(i + 8); break;
        case "PageUp": go(i - 8); break;
        case "Enter":
        case " ":
            if (items[i]) chooseCustomOption(Number(items[i].dataset.index));
            break;
        case "Escape":
        case "Tab":
            closeCustomSelect();
            break;
        default:
            // Tastare rapidă: „ma” sare la „Matematică” (fără diacritice).
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                clearTimeout(customSelect.typedTimer);
                customSelect.typed += foldText(event.key);
                customSelect.typedTimer = setTimeout(() => { customSelect.typed = ""; }, 700);
                const start = customSelect.typed.length === 1 ? i + 1 : i;
                const ordered = [...items.slice(start), ...items.slice(0, start)];
                const hit = ordered.find(el => foldText(el.querySelector(".cs-label").textContent).startsWith(customSelect.typed));
                if (hit) setActiveCustomOption(hit);
                break;
            }
            return; // alte taste: comportament normal
    }
    event.preventDefault();
    event.stopPropagation(); // ex. Escape nu închide și dialogul
}

function chooseCustomOption(index) {
    const { select } = customSelect.open || {};
    if (!select) return;
    closeCustomSelect();
    if (select.selectedIndex === index) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
}

function closeCustomSelect({ restoreFocus = true } = {}) {
    const open = customSelect.open;
    if (!open) return;
    customSelect.open = null;
    open.select.removeAttribute("aria-expanded");
    open.select.classList.remove("cs-open");
    open.pop.remove();
    if (restoreFocus && open.select.isConnected) open.select.focus({ preventScroll: true });
}

/* ==================== TOOLTIP GRAFICE ==================== */
/** Tooltip HTML în stilul aplicației, în locul celui negru, implicit, din Chart.js. */
function chartTooltip({ value = v => String(v), title = t => t } = {}) {
    return ({ chart, tooltip }) => {
        let el = $("chart-tip");
        if (!el) {
            el = document.createElement("div");
            el.id = "chart-tip";
            el.className = "chart-tip";
            el.setAttribute("role", "tooltip");
            document.body.appendChild(el);
        }
        if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
            el.classList.remove("is-visible");
            return;
        }

        const type = chart.config.type;
        el.innerHTML = `
            <b class="chart-tip-title">${escapeHTML(title((tooltip.title || []).join(" ")))}</b>
            ${tooltip.dataPoints.map((dp, i) => {
                const c = tooltip.labelColors?.[i] || {};
                const color = type === "line" ? c.borderColor : c.backgroundColor;
                return `
                    <span class="chart-tip-row">
                        <i style="background:${escapeHTML(String(color || "currentColor"))}"></i>
                        <span>${escapeHTML(dp.dataset.label || "")}</span>
                        <b>${escapeHTML(value(dp.raw, dp))}</b>
                    </span>`;
            }).join("")}`;

        const r = chart.canvas.getBoundingClientRect();
        const x = r.left + tooltip.caretX;
        const y = r.top + tooltip.caretY;
        el.classList.add("is-visible");
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const below = y - h - 14 < 8;
        el.classList.toggle("is-below", below);
        el.style.left = `${Math.round(Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)))}px`;
        el.style.top = `${Math.round(below ? y + 14 : y - h - 14)}px`;
    };
}

/** Același tooltip pentru elemente simple (ex. punctele din graficul unei materii). */
function bindHoverTips() {
    document.addEventListener("mouseover", event => {
        const el = event.target.closest?.("[data-tip-value], [data-tip-lines]");
        if (!el) return;
        let tip = $("chart-tip");
        if (!tip) {
            chartTooltip()({ chart: null, tooltip: null });
            tip = $("chart-tip");
        }
        const lines = el.dataset.tipLines !== undefined
            ? el.dataset.tipLines.split("\n").map(l => l.split("|"))
            : [["Nota", el.dataset.tipValue]];
        tip.innerHTML = `
            <b class="chart-tip-title">${escapeHTML(el.dataset.tipTitle || "")}</b>
            ${lines.map(([label, value]) => `<span class="chart-tip-row"><span>${escapeHTML(label || "")}</span><b>${escapeHTML(value || "")}</b></span>`).join("")}`;
        tip.classList.add("is-visible");
        const r = el.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        const below = r.top - h - 10 < 8;
        tip.classList.toggle("is-below", below);
        tip.style.left = `${Math.round(Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)))}px`;
        tip.style.top = `${Math.round(below ? r.bottom + 10 : r.top - h - 10)}px`;
    });
    document.addEventListener("mouseout", event => {
        if (event.target.closest?.("[data-tip-value], [data-tip-lines]")) hideChartTip();
    });
    document.addEventListener("scroll", hideChartTip, true);
}

function hideChartTip() {
    $("chart-tip")?.classList.remove("is-visible");
}

const TIP = {
    avg: { value: v => Number(v).toFixed(2) },
    subjectAvg: { value: v => (Number(v) > 0 ? `${Number(v).toFixed(2)} → ${Math.round(v)}` : "fără note") },
    count: { value: v => plural(Number(v), "notă", "note") },
    distribution: { value: v => plural(Number(v), "notă", "note"), title: t => `Nota ${t}` }
};

let chartDefaultsApplied = false;
function applyChartDefaults() {
    if (chartDefaultsApplied || !chartsAvailable()) return;
    chartDefaultsApplied = true;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
}

/* ==================== GRAFICE ==================== */
function chartsAvailable() {
    return typeof window.Chart === "function";
}

function chartTheme() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || ACCENTS.violet.light;
    return {
        accent,
        surface: document.body.classList.contains("dark-mode") ? "#111827" : "#ffffff",
        text: document.body.classList.contains("dark-mode") ? "#94a3b8" : "#64748b",
        grid: document.body.classList.contains("dark-mode") ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.12)"
    };
}

function baseChartOptions(theme, { legend = true, yMax = null, tip = TIP.avg } = {}) {
    const axis = { ticks: { color: theme.text }, grid: { color: theme.grid } };
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
            x: axis,
            y: yMax === null ? { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } } : { ...axis, min: 0, max: yMax }
        },
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: legend ? { labels: { color: theme.text, usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8 } } : { display: false },
            tooltip: { enabled: false, external: chartTooltip(tip) }
        }
    };
}

function destroyChart(id) {
    const chart = ui.charts[id];
    if (!chart) return;
    try {
        chart.destroy();
    } catch (err) {
        console.warn(`Nu s-a putut distruge graficul ${id}.`, err);
    }
    delete ui.charts[id];
}

function destroyAllCharts() {
    Object.keys(ui.charts).forEach(destroyChart);
}

/** Creează sau actualizează un grafic. Fără Chart.js (offline), afișează un mesaj în loc. */
function upsertChart(id, config) {
    const canvas = $(id);
    if (!canvas) {
        destroyChart(id);
        return;
    }

    const frame = canvas.parentElement;
    if (!chartsAvailable()) {
        frame?.classList.add("chart-unavailable");
        return;
    }
    frame?.classList.remove("chart-unavailable");

    const existing = ui.charts[id];
    if (existing) {
        existing.data = config.data;
        existing.options = config.options;
        existing.update("none");
        return;
    }

    try {
        applyChartDefaults();
        ui.charts[id] = new Chart(canvas, config);
    } catch (err) {
        console.error(`Graficul ${id} nu a putut fi creat.`, err);
    }
}

/* ==================== STATISTICI ==================== */
/*
 * Pagina are cinci secțiuni (Acum · Obiective · Materii · Note · Timp) cu un meniu lipit sus.
 * „Acum” și „Obiective” arată mereu situația de azi; „Materii”, „Note” și „Timp” urmează perioada aleasă
 * (tot anul, ultimele 30 de zile sau un modul). Toate cifrele vin din aceleași calcule ca restul aplicației.
 */
const TREND_WINDOW_DAYS = 21;
const TREND_STABLE = 0.05;
const STATS_SECTIONS = [
    { id: "sec-now", label: "Acum" },
    { id: "sec-goals", label: "Obiective" },
    { id: "sec-subjects", label: "Materii" },
    { id: "sec-grades", label: "Note" },
    { id: "sec-time", label: "Timp" }
];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const avgOfGrades = list => list.reduce((s, g) => s + Number(g.val), 0) / list.length;
const pctPos = v => `${Math.max(0, Math.min(100, ((v - 1) / 9) * 100)).toFixed(2)}%`;

/* ---------- perioada analizată ---------- */
function statsPeriods() {
    const p = metrics.purtare || purtareInfo();
    return [
        { id: "year", label: "Tot anul" },
        { id: "30d", label: "Ultimele 30 de zile" },
        ...p.modules.map(m => ({ id: `m${m.n}`, label: `Modulul ${m.n}${m.status === "current" ? " · acum" : ""}`, disabled: m.status === "upcoming" }))
    ];
}

function currentPeriod() {
    const ok = statsPeriods().find(p => p.id === ui.statsPeriod && !p.disabled);
    return ok ? ok.id : "year";
}

function periodRange(id = currentPeriod()) {
    const today = getLocalDateKey();
    if (id === "30d") return { from: addDays(today, -29), to: today };
    const m = /^m([1-5])$/.exec(id);
    if (m) {
        const mod = state.settings.modules[Number(m[1]) - 1];
        return { from: mod.start, to: mod.end < today ? mod.end : today };
    }
    return null;
}

function periodLabel(id = currentPeriod()) {
    return statsPeriods().find(p => p.id === id)?.label.replace(" · acum", "") || "Tot anul";
}

const inRange = (g, range) => !range || Boolean(g.date && g.date >= range.from && g.date <= range.to);

function periodSubjects(range) {
    if (!range) return state.subjects;
    return Object.fromEntries(Object.entries(state.subjects).map(([mat, sub]) => [mat, { ...sub, grades: sub.grades.filter(g => inRange(g, range)) }]));
}

/* ---------- calcule ---------- */
/**
 * Evoluția mediei generale, reconstruită din datele notelor (nu doar din zilele în care a fost deschisă aplicația).
 * Un punct pentru fiecare zi cu note; notele fără dată contează de la început.
 */
function averageTimeline() {
    const today = getLocalDateKey();
    const dates = new Set();
    Object.values(state.subjects).forEach(sub => sub.grades.forEach(g => {
        if (g.date && g.date <= today) dates.add(g.date);
    }));
    return [...dates].sort().slice(-60).map(date => {
        const subset = Object.fromEntries(Object.entries(state.subjects).map(([mat, sub]) => [
            mat, { ...sub, grades: sub.grades.filter(g => !g.date || g.date <= date) }
        ]));
        return { date, avg: calculateMetrics(subset).rawGlobalAvg };
    }).filter(p => p.avg > 0);
}

/** Cum s-a schimbat media generală: față de acum 30 de zile sau, dacă nu există, față de primul punct. */
function generalChange(timeline) {
    if (timeline.length < 2 || metrics.rawGlobalAvg <= 0) return null;
    const cutoff = addDays(getLocalDateKey(), -30);
    const past = [...timeline].reverse().find(p => p.date <= cutoff);
    const base = past || timeline[0];
    return { delta: metrics.rawGlobalAvg - base.avg, label: past ? "în ultimele 30 de zile" : `față de ${shortDayLabel(base.date)}` };
}

/**
 * Tendința unei materii: media de acum față de media de acum 3 săptămâni;
 * dacă toate notele sunt recente (sau toate vechi), față de media dinaintea ultimei note.
 */
function subjectTrend(sub) {
    const chrono = gradesChrono(sub).map(x => x.g);
    if (chrono.length < 2) return null;
    const cutoff = addDays(getLocalDateKey(), -TREND_WINDOW_DAYS);
    const older = chrono.filter(g => !g.date || g.date < cutoff);
    const now = avgOfGrades(chrono);
    if (older.length && older.length < chrono.length) {
        return { delta: now - avgOfGrades(older), basis: "față de acum 3 săptămâni" };
    }
    return { delta: now - avgOfGrades(chrono.slice(0, -1)), basis: "față de dinaintea ultimei note" };
}

function trendDirection(trend) {
    if (!trend) return "none";
    return trend.delta >= TREND_STABLE ? "up" : trend.delta <= -TREND_STABLE ? "down" : "flat";
}

function trendChipHTML(trend) {
    const dir = trendDirection(trend);
    if (dir === "none") return `<span class="trend-chip is-none" title="Tendința apare de la a doua notă">—</span>`;
    const sign = trend.delta > 0 ? "+" : "−";
    const icon = { up: "▲", down: "▼", flat: "■" }[dir];
    const text = dir === "flat" ? "stabil" : `${sign}${Math.abs(trend.delta).toFixed(2)}`;
    return `<span class="trend-chip is-${dir}" title="${escapeHTML(trend.basis)}"><span aria-hidden="true">${icon}</span> ${text}</span>`;
}

/** Starea unei materii: risc → sub țintă → la țintă (cu iconiță și text, nu doar culoare). */
function subjectStanding(sub, d) {
    if (!sub.grades.length) return { key: "none", label: "Fără note", icon: "○" };
    if (d.exactAvg < state.settings.calc.riskThreshold) return { key: "risk", label: "Risc", icon: "!" };
    if (!reachesTarget(d, sub.target)) return { key: "below", label: "Sub țintă", icon: "↓" };
    return { key: "ok", label: "La țintă", icon: "✓" };
}

function statsEntries(subs = state.subjects, m = metrics) {
    return Object.entries(subs).map(([mat, sub]) => ({
        mat,
        sub,
        d: m.subjects[mat],
        trend: subjectTrend(sub),
        standing: subjectStanding(sub, m.subjects[mat])
    }));
}

const STANDING_RANK = { risk: 0, below: 1, ok: 2, none: 3 };
const STATS_SORTS = {
    attention: (a, b) => STANDING_RANK[a.standing.key] - STANDING_RANK[b.standing.key]
        || (a.standing.key === "below" ? targetGap(b) - targetGap(a) : a.d.rawAvg - b.d.rawAvg)
        || a.mat.localeCompare(b.mat, "ro"),
    "avg-desc": (a, b) => b.d.rawAvg - a.d.rawAvg || a.mat.localeCompare(b.mat, "ro"),
    trend: (a, b) => (a.trend?.delta ?? 0) - (b.trend?.delta ?? 0) || a.mat.localeCompare(b.mat, "ro"),
    name: (a, b) => a.mat.localeCompare(b.mat, "ro")
};

function targetGap(e) {
    return (Number.isInteger(e.sub.target) ? e.sub.target - 0.5 : e.sub.target) - e.d.rawAvg;
}

/** Cât trage fiecare materie media generală în sus sau în jos: media fără ea, comparată cu media cu ea. */
function subjectImpacts(subs, m) {
    if (m.rawGlobalAvg <= 0) return [];
    return Object.entries(subs)
        .filter(([, sub]) => sub.grades.length && !sub.excludeFromGPA)
        .map(([mat, sub]) => {
            const without = calculateMetrics({ ...subs, [mat]: { ...sub, excludeFromGPA: true } }).rawGlobalAvg;
            return { mat, avg: m.subjects[mat].rawAvg, impact: without > 0 ? m.rawGlobalAvg - without : 0, without };
        })
        .filter(x => x.without > 0)
        .sort((a, b) => b.impact - a.impact);
}

/** Toate notele (cu materia lor), în ordine cronologică; notele fără dată primele. */
function allGradesChrono(subs) {
    const list = [];
    Object.entries(subs).forEach(([mat, sub]) => sub.grades.forEach((g, i) => list.push({ mat, g, i })));
    return list.sort((a, b) => (a.g.date || "").localeCompare(b.g.date || "") || a.mat.localeCompare(b.mat, "ro") || a.i - b.i);
}

function typeBreakdown(subs) {
    const map = new Map();
    Object.values(subs).forEach(sub => sub.grades.forEach(g => {
        const t = GRADE_TYPES.includes(g.type) ? g.type : "Altele";
        const x = map.get(t) || { n: 0, sum: 0, tens: 0 };
        x.n++;
        x.sum += Number(g.val);
        if (Number(g.val) === 10) x.tens++;
        map.set(t, x);
    }));
    return [...map.entries()].map(([type, x]) => ({ type, n: x.n, avg: x.sum / x.n, tens: x.tens })).sort((a, b) => b.n - a.n || b.avg - a.avg);
}

/** Cu cât a mutat fiecare notă media materiei ei (față de media dinaintea ei). */
function gradeDeltas(subs) {
    const deltas = new Map();
    Object.values(subs).forEach(sub => {
        const chrono = gradesChrono(sub).map(x => x.g);
        let sum = 0;
        chrono.forEach((g, k) => {
            const before = k ? sum / k : null;
            sum += Number(g.val);
            deltas.set(g, before === null ? null : sum / (k + 1) - before);
        });
    });
    return deltas;
}

function gradeRecords(subs) {
    const all = allGradesChrono(subs);
    if (all.length < 2) return null;
    const today = getLocalDateKey();
    let run9 = 0, best9 = 0, run10 = 0, best10 = 0;
    all.forEach(({ g }) => {
        const v = Number(g.val);
        run9 = v >= 9 ? run9 + 1 : 0;
        run10 = v === 10 ? run10 + 1 : 0;
        best9 = Math.max(best9, run9);
        best10 = Math.max(best10, run10);
    });

    const byMonth = new Map();
    const byDay = new Map();
    all.forEach(({ g }) => {
        if (!g.date) return;
        const mk = g.date.slice(0, 7);
        byMonth.set(mk, [...(byMonth.get(mk) || []), g]);
        byDay.set(g.date, (byDay.get(g.date) || 0) + 1);
    });
    const bestMonth = [...byMonth.entries()].filter(([, l]) => l.length >= 2)
        .map(([k, l]) => ({ k, avg: avgOfGrades(l), n: l.length })).sort((a, b) => b.avg - a.avg)[0] || null;
    const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];

    const counts = Object.entries(subs).map(([mat, sub]) => ({ mat, n: sub.grades.length })).sort((a, b) => b.n - a.n);
    const deltas = gradeDeltas(subs);
    let jump = null;
    all.forEach(({ mat, g }) => {
        const d = deltas.get(g);
        if (d !== null && d !== undefined && (!jump || d > jump.delta)) jump = { mat, g, delta: d };
    });
    const lastDated = [...all].reverse().find(x => x.g.date);

    return {
        best9,
        best10,
        bestMonth,
        busiest: busiest && busiest[1] >= 2 ? { date: busiest[0], n: busiest[1] } : null,
        topSubject: counts[0]?.n ? counts[0] : null,
        jump: jump && jump.delta > 0 ? jump : null,
        sinceLast: lastDated ? daysBetween(lastDated.g.date, today) : null,
        lastDated
    };
}

/** Media generală pe fiecare modul început (din notele cu dată din intervalul modulului). */
function moduleAverages() {
    const p = metrics.purtare || purtareInfo();
    return p.modules.map(m => {
        if (m.status === "upcoming") return { ...m, avg: null, grades: 0 };
        const subs = periodSubjects({ from: m.start, to: m.end });
        const mm = calculateMetrics(subs);
        return { ...m, avg: mm.rawGlobalAvg || null, grades: mm.totalGrades };
    });
}

function weekdayStats(subs) {
    const map = new Map();
    Object.values(subs).forEach(sub => sub.grades.forEach(g => {
        if (!g.date) return;
        const wd = parseDateKey(g.date).getDay();
        const x = map.get(wd) || { n: 0, sum: 0 };
        x.n++;
        x.sum += Number(g.val);
        map.set(wd, x);
    }));
    return WEEKDAY_ORDER
        .filter(wd => wd >= 1 && wd <= 5 || map.has(wd))
        .map(wd => ({ wd, n: map.get(wd)?.n || 0, avg: map.get(wd) ? map.get(wd).sum / map.get(wd).n : null }));
}

/**
 * „Ce-ar fi dacă”: adaugă la fiecare materie notele care îi lipsesc până la minim, toate cu valoarea `v`.
 * Fără note lipsă, adaugă câte o notă la fiecare materie.
 */
function whatIfSubjects(v) {
    const missingTotal = Object.keys(state.subjects).reduce((n, mat) => n + metrics.subjects[mat].requiredNotes, 0);
    const subs = Object.fromEntries(Object.entries(state.subjects).map(([mat, sub]) => {
        const k = missingTotal > 0 ? metrics.subjects[mat].requiredNotes : 1;
        return [mat, { ...sub, grades: [...sub.grades, ...Array.from({ length: k }, () => ({ val: v, type: "Test" }))] }];
    }));
    return { subs, added: missingTotal > 0 ? missingTotal : Object.keys(state.subjects).length, mode: missingTotal > 0 ? "missing" : "one-each" };
}

function whatIfNeededForTarget() {
    const target = state.settings.goals.targetGPA;
    for (let v = 1; v <= 10.0001; v += 0.1) {
        const r = calculateMetrics(whatIfSubjects(Math.round(v * 10) / 10).subs);
        if (r.rawGlobalAvg >= target - 0.005) return Math.round(v * 10) / 10;
    }
    return null;
}

/** Ritmul (note pe săptămână) și când ajungi la o țintă de număr de note. */
function paceTo(count, target, filter = () => true) {
    const dated = Object.values(state.subjects).flatMap(sub => sub.grades.filter(g => g.date && filter(g)));
    if (count >= target) return { done: true };
    if (dated.length < 2) return null;
    const first = dated.map(g => g.date).sort()[0];
    const weeks = Math.max(1, daysBetween(first, getLocalDateKey()) / 7);
    const rate = dated.length / weeks;
    if (rate <= 0) return null;
    const weeksLeft = (target - count) / rate;
    const eta = addDays(getLocalDateKey(), Math.ceil(weeksLeft * 7));
    const yearEnd = state.settings.modules[4].end;
    return { rate, eta, beforeYearEnd: eta <= yearEnd, needRate: Math.max(0, (target - count) / Math.max(1, daysBetween(getLocalDateKey(), yearEnd) / 7)) };
}

/** Concluziile, în ordinea importanței. Fiecare are o materie la care duce (dacă e cazul). */
function buildInsights(entries) {
    const items = [];
    const risk = state.settings.calc.riskThreshold;
    const graded = entries.filter(e => e.sub.grades.length);

    entries.filter(e => e.standing.key === "risk").sort((a, b) => a.d.rawAvg - b.d.rawAvg).forEach(e => {
        const plan = planForCondition(e.mat, d => d.exactAvg >= risk);
        const text = plan.impossible
            ? "Media nu mai poate trece pragul doar cu note noi în acest an; vorbește cu profesorul despre o recuperare."
            : plan.tens
                ? `Ca să ieși din risc îți trebuie ${plan.tens} note de 10 la rând.`
                : `La următoarea evaluare îți trebuie cel puțin ${plan.next} ca să ieși din risc.`;
        items.push({ tone: "critical", icon: "alert", mat: e.mat, title: `${e.mat}: media ${e.d.exactAvg.toFixed(2)}, sub pragul de risc (${risk.toFixed(2)})`, text });
    });

    entries.filter(e => trendDirection(e.trend) === "down" && e.trend.delta <= -0.3 && e.standing.key !== "risk")
        .sort((a, b) => a.trend.delta - b.trend.delta).slice(0, 2).forEach(e => {
            items.push({ tone: "warning", icon: "trend-down", mat: e.mat, title: `${e.mat} a scăzut cu ${Math.abs(e.trend.delta).toFixed(2)}`, text: `Media e acum ${e.d.exactAvg.toFixed(2)} (${e.trend.basis}).` });
        });

    entries.filter(e => e.standing.key === "below")
        .map(e => ({ e, plan: planForCondition(e.mat, d => reachesTarget(d, e.sub.target)) }))
        .filter(x => x.plan.next && x.plan.next >= 2)
        .sort((a, b) => a.plan.next - b.plan.next).slice(0, 2).forEach(({ e, plan }) => {
            items.push({ tone: "info", icon: "target", mat: e.mat, title: `${e.mat}: un ${plan.next} te aduce la ținta ${fmtTarget(e.sub.target)}`, text: `Media ar urca de la ${e.d.exactAvg.toFixed(2)} cu o singură notă de cel puțin ${plan.next}.` });
        });

    const missing = entries.filter(e => e.d.requiredNotes > 0).sort((a, b) => b.d.requiredNotes - a.d.requiredNotes || b.sub.ore - a.sub.ore);
    const totalMissing = missing.reduce((n, e) => n + e.d.requiredNotes, 0);
    if (totalMissing > 0) {
        const top = missing.slice(0, 3).map(e => `${e.mat} (${e.d.requiredNotes})`).join(", ");
        const none = entries.filter(e => !e.sub.grades.length).length;
        items.push({ tone: "info", icon: "note", mat: missing[0].mat, title: `Îți lipsesc ${plural(totalMissing, "notă", "note")} până la minimul de note`, text: `${none ? `${plural(none, "materie nu are", "materii nu au")} încă nicio notă. ` : ""}Cele mai multe lipsesc la ${top}.` });
    }

    entries.filter(e => trendDirection(e.trend) === "up" && e.trend.delta >= 0.3)
        .sort((a, b) => b.trend.delta - a.trend.delta).slice(0, 1).forEach(e => {
            items.push({ tone: "good", icon: "trend-up", mat: e.mat, title: `${e.mat} crește: +${e.trend.delta.toFixed(2)}`, text: `Media e acum ${e.d.exactAvg.toFixed(2)} (${e.trend.basis}). Continuă așa!` });
        });

    const best = [...graded].sort((a, b) => b.d.rawAvg - a.d.rawAvg)[0];
    if (best && best.d.exactAvg >= 9) {
        items.push({ tone: "good", icon: "star", mat: best.mat, title: `Cea mai bună materie: ${best.mat}`, text: `Media ${best.d.exactAvg.toFixed(2)}.` });
    }

    const purtare = metrics.purtare;
    if (purtare && purtare.value < 10) {
        items.push({ tone: "warning", icon: "medal", mat: PURTARE_KEY, title: `Purtarea e ${purtare.value} în ${purtare.current ? `Modulul ${purtare.current.n}` : "ultimul modul"}`, text: "Se reînnoiește la 10 la începutul modulului următor." });
    }

    return items.slice(0, 6);
}

/* ---------- animație: cifrele urcă, barele cresc (doar la deschiderea tabului / schimbarea perioadei) ---------- */
function countUpHTML(value, decimals = 0, extraClass = "") {
    const v = Number(value);
    return `<span class="count-up ${extraClass}" data-count="${v}" data-decimals="${decimals}">${v.toFixed(decimals)}</span>`;
}

function runStatsAnimations(root) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.remove("is-animating");
    void root.offsetWidth; // repornește animațiile CSS
    root.classList.add("is-animating");
    clearTimeout(runStatsAnimations.timer);
    runStatsAnimations.timer = setTimeout(() => root.classList.remove("is-animating"), 1400);

    const nodes = [...root.querySelectorAll(".count-up")];
    const start = performance.now();
    const duration = 750;
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        nodes.forEach(el => {
            const target = Number(el.dataset.count);
            el.textContent = (target * ease).toFixed(Number(el.dataset.decimals));
        });
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/* ---------- randare ---------- */
function renderStatistics() {
    const body = $("stats-body");
    if (!body) return;
    const year = statsEntries();
    const hasSubjects = year.length > 0;
    $("stats-empty").hidden = hasSubjects;
    body.hidden = !hasSubjects;
    $("stats-nav").hidden = !hasSubjects;
    if (!hasSubjects) {
        ["chartStatTrend", "chartStatDistributie"].forEach(destroyChart);
        return;
    }

    const period = currentPeriod();
    const range = periodRange(period);
    const subs = periodSubjects(range);
    const pm = range ? calculateMetrics(subs) : metrics;
    const timeline = averageTimeline();

    renderStatsNav(period);
    renderStatsHero(timeline);
    renderStatsKpis(year);
    renderStatsInsights(year);
    renderStatsTrends(year);
    renderStatsBrief();
    renderStatsGoals();
    renderStatsWhatIf();
    document.querySelectorAll(".period-badge").forEach(el => { el.innerHTML = `${icon("calendar")} ${escapeHTML(periodLabel(period))}`; });
    renderStatsSubjects(statsEntries(subs, pm), { range });
    renderStatsImpact(subs, pm);
    renderStatsTypes(subs);
    renderStatsRecords(subs);
    renderStatsRecent(subs);
    renderStatsModules(period);
    renderStatsWeekdays(subs);
    renderStatsHeatmap(range);
    renderStatsCharts(timeline, range, pm);

    if (ui.statsAnimate) {
        ui.statsAnimate = false;
        runStatsAnimations(body);
    }
}

function renderStatsNav(period) {
    const sel = $("stats-period");
    if (sel) {
        sel.innerHTML = statsPeriods().map(p => `<option value="${p.id}" ${p.id === period ? "selected" : ""} ${p.disabled ? "disabled" : ""}>${escapeHTML(p.label)}${p.disabled ? " (urmează)" : ""}</option>`).join("");
    }
}

function renderStatsHero(timeline) {
    const s = state.settings;
    const avg = metrics.globalAvg;
    const has = avg > 0;
    const target = s.goals.targetGPA;
    const change = generalChange(timeline);
    const gap = target - metrics.rawGlobalAvg;
    const purtare = metrics.purtare;
    const dir = change ? trendDirection(change) : "none";

    let verdict;
    if (!has) verdict = "Adaugă prima notă ca să-ți vezi media generală.";
    else if (gap <= 0.004) verdict = `✓ Ești la ținta de ${target.toFixed(2)}.`;
    else verdict = `Îți lipsesc ${gap.toFixed(2)} puncte până la ținta de ${target.toFixed(2)}.`;

    $("stats-hero").innerHTML = `
        <span class="kpi-title">Media generală</span>
        <div class="stats-hero-row">
            <b class="stats-hero-value ${has ? "" : "is-empty"}">${has ? countUpHTML(avg, 2) : "–"}</b>
            ${change ? `<span class="trend-chip is-${dir}" title="${escapeHTML(change.label)}">
                <span aria-hidden="true">${dir === "up" ? "▲" : dir === "down" ? "▼" : "■"}</span>
                ${dir === "flat" ? "stabilă" : `${change.delta > 0 ? "+" : "−"}${Math.abs(change.delta).toFixed(2)}`}
                <small>${escapeHTML(change.label)}</small></span>` : ""}
        </div>
        <p class="stats-hero-verdict">${escapeHTML(verdict)}</p>
        <div class="stats-meter" role="img" aria-label="${escapeHTML(has ? `Media ${avg.toFixed(2)} din 10; ținta ${target.toFixed(2)}; pragul de risc ${s.calc.riskThreshold.toFixed(2)}` : "Încă fără medie")}">
            <span class="stats-meter-risk" style="width:${pctPos(s.calc.riskThreshold)}"></span>
            ${has ? `<span class="stats-meter-fill anim-grow" style="width:${pctPos(metrics.rawGlobalAvg)}"></span>` : ""}
            <span class="stats-meter-target" style="left:${pctPos(target)}"></span>
        </div>
        <div class="stats-meter-scale" aria-hidden="true"><span>1</span><span>5</span><span>10</span></div>
        <p class="stats-hero-foot">
            ${escapeHTML(s.calc.method === "weighted" ? "Ponderată după ore" : "Media aritmetică")}
            ${state.purtare.excludeFromGPA ? "" : ` · include purtarea (${purtare?.value ?? 10})`}
            · <span class="legend-swatch is-risk"></span> risc sub ${s.calc.riskThreshold.toFixed(2)}
            · <span class="legend-swatch is-target"></span> ținta
        </p>`;
}

function renderStatsKpis(entries) {
    const risk = entries.filter(e => e.standing.key === "risk");
    const missing = entries.reduce((n, e) => n + e.d.requiredNotes, 0);
    const recentFrom = addDays(getLocalDateKey(), -30);
    const recent = entries.reduce((n, e) => n + e.sub.grades.filter(g => g.date && g.date >= recentFrom).length, 0);
    const share = metrics.totalGrades ? Math.round((metrics.tensCount / metrics.totalGrades) * 100) : 0;
    const tile = (title, value, caption, tone = "") => `
        <div class="glass-card stats-kpi ${tone}">
            <span class="kpi-title">${title}</span>
            <b>${countUpHTML(value)}</b>
            <small>${caption}</small>
        </div>`;

    $("stats-kpis").innerHTML = [
        tile("În risc", risk.length, risk.length ? escapeHTML(risk.slice(0, 2).map(e => e.mat).join(", ") + (risk.length > 2 ? "…" : "")) : "nicio materie", risk.length ? "is-danger" : "is-ok"),
        tile("Note lipsă", missing, missing ? "până la minimul pe materii" : "✓ minimul atins peste tot", missing ? "is-warn" : "is-ok"),
        tile("Note", metrics.totalGrades, recent ? `${plural(recent, "adăugată", "adăugate")} în ultimele 30 de zile` : "niciuna în ultimele 30 de zile"),
        tile("Note de 10", metrics.tensCount, metrics.totalGrades ? `${share}% din toate notele` : "încă niciuna")
    ].join("");
}

function renderStatsInsights(entries) {
    const items = buildInsights(entries);
    const list = $("stats-insights");
    if (items.length === 0) {
        list.innerHTML = `<li class="insight is-good"><span class="insight-icon" aria-hidden="true">${icon("sparkles")}</span>
            <span class="insight-main"><b>Totul arată bine</b><small>Nicio materie în risc și minimul de note e atins.</small></span></li>`;
        return;
    }
    const shown = ui.statsAllInsights ? items : items.slice(0, INSIGHTS_SHOWN);
    list.innerHTML = shown.map((it, i) => `
        <li class="insight is-${it.tone} anim-rise" style="--i:${i}">
            <span class="insight-icon" aria-hidden="true">${icon(it.icon)}</span>
            <span class="insight-main"><b>${escapeHTML(it.title)}</b><small>${escapeHTML(it.text)}</small></span>
            ${it.mat ? `<button type="button" class="btn btn-text insight-go" data-action="open-subject" data-mat="${escapeHTML(it.mat)}"
                aria-label="${escapeHTML(`Deschide ${it.mat === PURTARE_KEY ? "Purtare" : it.mat} în catalog`)}">Deschide →</button>` : ""}
        </li>`).join("") + (items.length > INSIGHTS_SHOWN ? `
        <li class="insights-more"><button type="button" class="btn btn-text" data-action="stats-insights-more" aria-expanded="${Boolean(ui.statsAllInsights)}">
            ${ui.statsAllInsights ? "Arată mai puține" : `Arată toate (încă ${items.length - INSIGHTS_SHOWN})`}</button></li>` : "");
}

const INSIGHTS_SHOWN = 4;

/** „Pe scurt”: câteva repere de azi, mereu utile (și când tendințele încă nu există). */
function renderStatsBrief() {
    const box = $("stats-brief");
    if (!box) return;
    const today = getLocalDateKey();
    const links = gradeLinks();
    const rows = [];
    const next = occurrencesBetween(today, addDays(today, 60)).find(o => NEEDS_GRADE.has(o.ev.type) && !isOccurrenceDone(o.ev, o.date, links));
    rows.push(["Următoarea evaluare", next
        ? `<button type="button" class="brief-link" data-action="cal-goto" data-date="${next.date}">${escapeHTML(next.ev.title)}</button> <small>${escapeHTML(dayWord(next.date, today))}</small>`
        : `<small>nimic în următoarele 60 de zile</small>`]);
    const graded = Object.entries(state.subjects).filter(([, sub]) => sub.grades.length).map(([mat]) => ({ mat, avg: metrics.subjects[mat].exactAvg }));
    if (graded.length) {
        const best = graded.reduce((a, b) => (b.avg > a.avg ? b : a));
        const worst = graded.reduce((a, b) => (b.avg < a.avg ? b : a));
        const link = e => `<button type="button" class="brief-link" data-action="open-subject" data-mat="${escapeHTML(e.mat)}">${escapeHTML(e.mat)}</button> <b class="brief-num tone-${gradeTone(e.avg)}">${e.avg.toFixed(2)}</b>`;
        rows.push(["Cea mai bună medie", link(best)]);
        if (worst.mat !== best.mat) rows.push(["Cea mai slabă medie", link(worst)]);
        let last = null;
        Object.entries(state.subjects).forEach(([mat, sub]) => sub.grades.forEach(g => {
            if (g.date && (!last || g.date > last.g.date)) last = { mat, g };
        }));
        if (last) rows.push(["Ultima notă", `<b class="brief-num tone-${gradeTone(Number(last.g.val))}">${escapeHTML(last.g.val)}</b> la ${escapeHTML(last.mat)} <small>${escapeHTML(relativeDayLabel(last.g.date))}</small>`]);
    } else {
        rows.push(["Note", "<small>încă nicio notă</small>"]);
    }
    const p = metrics.purtare;
    rows.push(["Purtare", `<b class="brief-num">${p ? p.value : 10}</b>${p?.current ? ` <small>Modulul ${p.current.n}</small>` : ""}`]);
    box.innerHTML = rows.map(([k, v]) => `<div class="brief-row"><dt>${k}</dt><dd>${v}</dd></div>`).join("")
        + ($("stats-trends")?.closest(".glass-card")?.hidden ? `<p class="subtitle brief-note">${icon("arrows-v")} Tendințele (ce urcă, ce coboară) apar când o materie are cel puțin două note.</p>` : "");
}

function renderStatsTrends(entries) {
    const withTrend = entries.filter(e => e.trend);
    const up = withTrend.filter(e => trendDirection(e.trend) === "up").sort((a, b) => b.trend.delta - a.trend.delta);
    const down = withTrend.filter(e => trendDirection(e.trend) === "down").sort((a, b) => a.trend.delta - b.trend.delta);
    const flat = withTrend.filter(e => trendDirection(e.trend) === "flat").length;
    const col = (title, list, empty) => `
        <div class="trend-col">
            <h4>${title}</h4>
            ${list.length ? `<ul>${list.slice(0, 4).map(e => `
                <li><button type="button" class="trend-row" data-action="open-subject" data-mat="${escapeHTML(e.mat)}">
                    <span class="trend-row-name">${escapeHTML(e.mat)}</span>
                    <span class="trend-row-avg">${e.d.exactAvg.toFixed(2)}</span>
                    ${trendChipHTML(e.trend)}
                </button></li>`).join("")}</ul>` : `<p class="muted-small">${empty}</p>`}
        </div>`;

    // Fără tendințe, cardul ar fi doar o propoziție: îl ascundem, iar „Pe scurt” spune când apar.
    $("stats-trends").closest(".glass-card").hidden = withTrend.length === 0;
    $("stats-trends").innerHTML = withTrend.length === 0
        ? `<p class="muted-small stats-trends-empty">Tendințele apar când o materie are cel puțin două note. Fiecare materie e comparată cu media ei de acum 3 săptămâni.</p>`
        : `${col(`${icon("trend-up")} În creștere`, up, "Nicio materie în creștere.")}
           ${col(`${icon("trend-down")} În scădere`, down, "Nicio materie în scădere.")}
           <p class="subtitle trend-foot">${flat ? `${plural(flat, "materie stabilă", "materii stabile")} · ` : ""}comparat cu media de acum 3 săptămâni (sau dinaintea ultimei note)</p>`;
}

/* ---------- Obiective ---------- */
function ringHTML(pct, { label, value, sub, primary = false, tone = "" }) {
    const r = 34;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct));
    return `
        <div class="goal ${primary ? "is-primary" : ""} ${tone}">
            <svg class="goal-ring" viewBox="0 0 84 84" role="img" aria-label="${escapeHTML(`${label}: ${Math.round(p * 100)}%`)}">
                <circle class="goal-track" cx="42" cy="42" r="${r}"/>
                <circle class="goal-arc" cx="42" cy="42" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" style="--c:${c.toFixed(2)}"/>
                <text x="42" y="47" text-anchor="middle" class="goal-pct">${Math.round(p * 100)}%</text>
            </svg>
            <div class="goal-text">
                <span class="kpi-title">${label}${primary ? ' <span class="goal-star" title="Obiectivul principal din Setări">★</span>' : ""}</span>
                <b>${value}</b>
                <small>${sub}</small>
            </div>
        </div>`;
}

function renderStatsGoals() {
    const s = state.settings;
    const primary = s.goals.primary;
    const avg = metrics.rawGlobalAvg;
    const tens = metrics.tensCount;
    const evals = metrics.totalGrades;
    const paceTens = paceTo(tens, s.targets.tens, g => Number(g.val) === 10);
    const paceEvals = paceTo(evals, s.targets.evals);
    const paceText = (pace, unit) => {
        if (!pace) return "ritmul apare după câteva note cu dată";
        if (pace.done) return "✓ ținta e atinsă";
        return pace.beforeYearEnd
            ? `la ritmul actual o atingi pe ${shortDayLabel(pace.eta)}`
            : `la ritmul actual nu ajungi până în iunie; îți trebuie ~${pace.needRate.toFixed(1)} ${unit}/săpt.`;
    };

    $("stats-goals").innerHTML = [
        ringHTML(avg > 0 ? (avg - 1) / (s.goals.targetGPA - 1 || 1) : 0, {
            label: "Media generală", primary: primary === "gpa",
            value: `${avg > 0 ? countUpHTML(metrics.globalAvg, 2) : "–"} <span class="sim-round">/ ${s.goals.targetGPA.toFixed(2)}</span>`,
            sub: avg <= 0 ? "încă fără medie" : avg >= s.goals.targetGPA ? "✓ ținta e atinsă" : avg < s.goals.minGPA ? `sub minimul acceptat (${s.goals.minGPA.toFixed(2)})` : `peste minimul de ${s.goals.minGPA.toFixed(2)}`,
            tone: avg > 0 && avg < s.goals.minGPA ? "is-warn" : ""
        }),
        ringHTML(tens / s.targets.tens, {
            label: "Note de 10", primary: primary === "tens",
            value: `${countUpHTML(tens)} <span class="sim-round">/ ${s.targets.tens}</span>`,
            sub: escapeHTML(paceText(paceTens, "note de 10"))
        }),
        ringHTML(evals / s.targets.evals, {
            label: "Evaluări", primary: primary === "evals",
            value: `${countUpHTML(evals)} <span class="sim-round">/ ${s.targets.evals}</span>`,
            sub: escapeHTML(paceText(paceEvals, "note"))
        })
    ].join("");
}

/* ---------- Ce-ar fi dacă ---------- */
function renderStatsWhatIf() {
    const slider = $("whatif-range");
    if (!slider) return;
    if (!slider.dataset.bound) {
        slider.dataset.bound = "1";
        slider.addEventListener("input", () => updateWhatIf());
    }
    updateWhatIf();
}

function updateWhatIf() {
    const slider = $("whatif-range");
    const v = Number(slider.value);
    const { subs, added, mode } = whatIfSubjects(v);
    const r = calculateMetrics(subs);
    const now = metrics.rawGlobalAvg;
    const delta = now > 0 ? r.rawGlobalAvg - now : null;
    const riskNow = Object.values(metrics.subjects).filter(d => d.exactAvg > 0 && d.exactAvg < state.settings.calc.riskThreshold).length;
    const riskThen = Object.values(r.subjects).filter(d => d.exactAvg > 0 && d.exactAvg < state.settings.calc.riskThreshold).length;
    const needed = whatIfNeededForTarget();
    const target = state.settings.goals.targetGPA;
    slider.style.setProperty("--p", `${((v - slider.min) / (slider.max - slider.min)) * 100}%`);

    setText("whatif-value", v % 1 ? v.toFixed(1) : String(v));
    $("whatif-question").innerHTML = mode === "missing"
        ? `…iei în medie <b>${v % 1 ? v.toFixed(1) : v}</b> la cele <b>${added}</b> note care îți lipsesc până la minim`
        : `…iei <b>${v % 1 ? v.toFixed(1) : v}</b> la următoarea notă, la fiecare dintre cele ${added} materii`;
    $("whatif-result").innerHTML = `
        <div class="whatif-big">
            <span class="kpi-title">Media generală ar fi</span>
            <b>${r.rawGlobalAvg > 0 ? roundValue(r.rawGlobalAvg, Number(state.settings.calc.rounding)).toFixed(2) : "–"}</b>
            ${delta !== null ? `<span class="trend-chip is-${delta >= TREND_STABLE ? "up" : delta <= -TREND_STABLE ? "down" : "flat"}">${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} față de acum</span>` : ""}
        </div>
        <div class="whatif-facts">
            <span><b>${riskThen}</b> ${riskThen === 1 ? "materie" : "materii"} în risc <small>(acum ${riskNow})</small></span>
            <span>${needed === null
                ? `Ținta de ${target.toFixed(2)} nu se atinge doar cu aceste note.`
                : needed <= 1 ? `Ținta de ${target.toFixed(2)} rămâne atinsă orice ai lua.` : `Pentru ținta de ${target.toFixed(2)}: media <b>${needed.toFixed(1)}</b> la aceste note.`}</span>
        </div>`;
}

/* ---------- Materii ---------- */
function sparklineSVG(sub) {
    const chrono = gradesChrono(sub).map(x => Number(x.g.val));
    if (chrono.length < 2) return `<span class="spark is-empty" aria-hidden="true"></span>`;
    const W = 64, H = 22;
    let sum = 0;
    const running = chrono.map((v, i) => (sum += v) / (i + 1));
    // Scara proprie (minim 1 punct), ca direcția să se vadă și când diferențele sunt mici.
    let lo = Math.min(...running), hi = Math.max(...running);
    if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
    const pts = running.map((a, i) => [(i / (running.length - 1)) * (W - 4) + 2, H - 2 - ((a - lo) / (hi - lo)) * (H - 4)]);
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ")}"/>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5"/>
    </svg>`;
}

function renderStatsSubjects(entries, { range = null } = {}) {
    const sort = STATS_SORTS[ui.statsSort] ? ui.statsSort : "attention";
    const sel = $("stats-sort");
    if (sel && sel.value !== sort) sel.value = sort;

    const graded = entries.filter(e => e.sub.grades.length).sort(STATS_SORTS[sort]);
    const none = entries.filter(e => !e.sub.grades.length).sort(STATS_SORTS.name);
    const risk = state.settings.calc.riskThreshold;

    const row = ({ mat, sub, d, trend, standing }, i) => `
        <li class="anim-rise" style="--i:${i}">
            <button type="button" class="stat-row is-${standing.key}" data-action="open-subject" data-mat="${escapeHTML(mat)}">
                <span class="stat-row-head">
                    <span class="stat-badge is-${standing.key}" title="${standing.label}"><span aria-hidden="true">${standing.icon}</span><span class="sr-only">${standing.label}</span></span>
                    <span class="stat-row-name">${escapeHTML(mat)}${sub.excludeFromGPA ? ' <span class="cat-tag">exclusă</span>' : ""}</span>
                </span>
                <span class="stat-track" aria-hidden="true">
                    <span class="stat-track-risk" style="width:${pctPos(risk)}"></span>
                    <span class="stat-track-fill anim-grow is-${standing.key}" style="width:${pctPos(d.rawAvg)}"></span>
                    <span class="stat-track-target" style="left:${pctPos(Math.min(10, sub.target))}"></span>
                </span>
                <span class="stat-row-avg"><b>${d.exactAvg.toFixed(2)}</b><small>→ ${d.roundedAvg} · ținta ${fmtTarget(sub.target)}</small></span>
                <span class="stat-row-meta">
                    ${sparklineSVG(sub)}
                    ${range ? "" : trendChipHTML(trend)}
                    <span class="stat-row-count ${!range && d.requiredNotes ? "is-missing" : ""}">${range ? plural(sub.grades.length, "notă", "note") : `${sub.grades.length}/${sub.grades.length + d.requiredNotes} note`}</span>
                </span>
            </button>
        </li>`;

    const p = metrics.purtare;
    const purtareRow = p && !range ? `<li><button type="button" class="stat-row is-purtare" data-action="open-subject" data-mat="${PURTARE_KEY}">
        <span class="stat-row-head"><span class="stat-badge is-purtare" aria-hidden="true">${icon("medal")}</span><span class="stat-row-name">Purtare</span></span>
        <span class="stat-track" aria-hidden="true"><span class="stat-track-fill anim-grow is-${p.value >= 10 ? "ok" : p.value >= 6 ? "below" : "risk"}" style="width:${pctPos(p.avg)}"></span></span>
        <span class="stat-row-avg"><b>${p.avg.toFixed(2)}</b><small>${p.current ? `Modulul ${p.current.n}: ${p.value}` : `ultimul modul: ${p.value}`}</small></span>
        <span class="stat-row-meta"><span class="stat-row-count">${state.purtare.excludeFromGPA ? "exclusă din medie" : "în media generală"}</span></span>
    </button></li>` : "";

    $("stats-subject-list").innerHTML = graded.length
        ? `<ol class="stat-rows">${graded.map(row).join("")}${purtareRow}</ol>`
        : `<p class="muted-small stats-no-graded">${range ? `Nicio notă în perioada „${escapeHTML(periodLabel())}”.` : "Încă nu ai note. Adaugă-le din <b>Materii & Note</b> și aici vei vedea fiecare materie față de ținta ei."}</p>`;

    $("stats-nogrades").innerHTML = none.length ? `
        <div class="nogrades-head">
            <span class="kpi-title">${range ? "Fără note în perioadă" : "Fără note încă"} · ${none.length}</span>
            <button type="button" class="btn btn-text" data-action="add-grade">+ Adaugă notă</button>
        </div>
        <div class="nogrades-chips">
            ${none.map(e => `<button type="button" class="nogrades-chip" data-action="open-subject" data-mat="${escapeHTML(e.mat)}">${escapeHTML(e.mat)}${range ? "" : `<small>${e.d.requiredNotes}</small>`}</button>`).join("")}
        </div>` : "";
}

function renderStatsImpact(subs, pm) {
    const list = subjectImpacts(subs, pm);
    const box = $("stats-impact");
    if (list.length < 2) {
        box.innerHTML = `<p class="muted-small chart-empty is-small">Apare când ai note la cel puțin două materii care intră în medie.</p>`;
        return;
    }
    const max = Math.max(...list.map(x => Math.abs(x.impact)), 0.01);
    const down = list.filter(x => x.impact < -0.005).sort((a, b) => a.impact - b.impact)[0];
    const up = list.filter(x => x.impact > 0.005)[0];

    box.innerHTML = `
        <p class="impact-lead">
            ${down ? `<b>${escapeHTML(down.mat)}</b> trage media în jos cu <b class="impact-neg">${Math.abs(down.impact).toFixed(2)}</b> (fără ea ai avea ${roundValue(down.without, 2).toFixed(2)}).` : "Nicio materie nu trage media în jos."}
            ${up ? ` <b>${escapeHTML(up.mat)}</b> o ridică cel mai mult: <b class="impact-pos">+${up.impact.toFixed(2)}</b>.` : ""}
        </p>
        <ol class="impact-rows">
            ${list.map((x, i) => {
                const w = (Math.abs(x.impact) / max) * 50;
                const sign = x.impact > 0.005 ? "pos" : x.impact < -0.005 ? "neg" : "zero";
                return `
                <li class="anim-rise" style="--i:${i}">
                    <button type="button" class="impact-row" data-action="open-subject" data-mat="${escapeHTML(x.mat)}"
                        aria-label="${escapeHTML(`${x.mat}: ${x.impact >= 0 ? "ridică" : "coboară"} media cu ${Math.abs(x.impact).toFixed(2)}`)}">
                        <span class="impact-name">${escapeHTML(x.mat)}</span>
                        <span class="impact-bar" aria-hidden="true">
                            <span class="impact-mid"></span>
                            <span class="impact-fill is-${sign} anim-grow" style="${sign === "neg" ? `right:50%;` : `left:50%;`}width:${w.toFixed(2)}%"></span>
                        </span>
                        <span class="impact-val is-${sign}">${x.impact >= 0 ? "+" : "−"}${Math.abs(x.impact).toFixed(2)}</span>
                    </button>
                </li>`;
            }).join("")}
        </ol>
        <p class="subtitle impact-legend"><span class="legend-swatch is-neg"></span> trage media în jos · <span class="legend-swatch is-pos"></span> o ridică · cifra = diferența față de media fără materia respectivă</p>`;
}

/* ---------- Note ---------- */
function renderStatsTypes(subs) {
    const list = typeBreakdown(subs);
    const box = $("stats-types");
    if (list.length === 0) {
        box.innerHTML = `<p class="muted-small chart-empty is-small">Nicio notă în perioadă.</p>`;
        return;
    }
    const best = list.length > 1 ? [...list].filter(x => x.n >= 2).sort((a, b) => b.avg - a.avg)[0] : null;
    const worst = list.length > 1 ? [...list].filter(x => x.n >= 2).sort((a, b) => a.avg - b.avg)[0] : null;
    const maxN = Math.max(...list.map(x => x.n));
    box.innerHTML = `
        ${best && worst && best.type !== worst.type ? `<p class="impact-lead">Cel mai bine îți merge la <b>${escapeHTML(best.type)}</b> (${best.avg.toFixed(2)}), cel mai slab la <b>${escapeHTML(worst.type)}</b> (${worst.avg.toFixed(2)}).</p>` : ""}
        <ol class="type-rows">
            ${list.map((x, i) => `
                <li class="type-row anim-rise" style="--i:${i}">
                    <span class="type-name">${escapeHTML(x.type)}<small>${plural(x.n, "notă", "note")}${x.tens ? ` · ${x.tens}× 10` : ""}</small></span>
                    <span class="type-track" aria-hidden="true"><span class="type-fill anim-grow" style="width:${pctPos(x.avg)}"></span></span>
                    <b class="type-avg">${x.avg.toFixed(2)}</b>
                    <span class="type-count" aria-hidden="true"><span style="width:${((x.n / maxN) * 100).toFixed(1)}%"></span></span>
                </li>`).join("")}
        </ol>
        <p class="subtitle impact-legend">bara: media pe scala 1–10 · linia subțire: câte note de acest tip</p>`;
}

function renderStatsRecords(subs) {
    const r = gradeRecords(subs);
    const box = $("stats-records");
    if (!r) {
        box.innerHTML = `<p class="muted-small chart-empty is-small">Recordurile apar de la două note.</p>`;
        return;
    }
    const monthName = k => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
    const tiles = [
        { icon: "flame", value: r.best9, label: "note de 9+ la rând", sub: "cea mai lungă serie" },
        { icon: "award", value: r.best10, label: r.best10 === 1 ? "notă de 10 la rând" : "note de 10 la rând", sub: "cea mai lungă serie de 10" },
        r.jump && { icon: "rocket", value: `+${r.jump.delta.toFixed(2)}`, label: `${r.jump.mat}`, sub: `cel mai mare salt după o notă (${r.jump.g.val}${r.jump.g.date ? `, ${shortDayLabel(r.jump.g.date)}` : ""})`, mat: r.jump.mat },
        r.bestMonth && { icon: "calendar-check", value: r.bestMonth.avg.toFixed(2), label: monthName(r.bestMonth.k), sub: `cea mai bună lună (${plural(r.bestMonth.n, "notă", "note")})` },
        r.busiest && { icon: "zap", value: r.busiest.n, label: weekdayLabel(r.busiest.date), sub: "cele mai multe note într-o zi" },
        r.topSubject && { icon: "notebook", value: r.topSubject.n, label: r.topSubject.mat, sub: "materia cu cele mai multe note", mat: r.topSubject.mat },
        r.sinceLast !== null && { icon: "timer", value: r.sinceLast, label: r.sinceLast === 1 ? "zi de la ultima notă" : "zile de la ultima notă", sub: r.lastDated ? `${r.lastDated.mat}: ${r.lastDated.g.val}` : "" }
    ].filter(Boolean);

    box.innerHTML = tiles.map((t, i) => `
        <${t.mat ? `button type="button" data-action="open-subject" data-mat="${escapeHTML(t.mat)}"` : "div"} class="record anim-rise" style="--i:${i}">
            <span class="record-icon" aria-hidden="true">${icon(t.icon)}</span>
            <b class="record-value">${typeof t.value === "number" ? countUpHTML(t.value) : escapeHTML(t.value)}</b>
            <span class="record-label">${escapeHTML(String(t.label))}</span>
            <small>${escapeHTML(t.sub)}</small>
        </${t.mat ? "button" : "div"}>`).join("");
}

function renderStatsRecent(subs) {
    const deltas = gradeDeltas(state.subjects);
    const list = allGradesChrono(subs).reverse().slice(0, 8);
    const box = $("stats-recent");
    // Cu puține note, Recorduri și Ultimele note stau una sub alta (altfel rămâne o gaură lângă lista scurtă).
    box.closest(".stats-grades-grid")?.classList.toggle("is-stacked", list.length < 4);
    if (list.length === 0) {
        box.innerHTML = `<p class="muted-small chart-empty is-small">Nicio notă în perioadă.</p>`;
        return;
    }
    box.innerHTML = `<ol class="recent-list">${list.map(({ mat, g }, i) => {
        const d = deltas.get(g);
        const dir = d === null || d === undefined ? "none" : d >= TREND_STABLE ? "up" : d <= -TREND_STABLE ? "down" : "flat";
        return `
            <li class="anim-rise" style="--i:${i}">
                <button type="button" class="recent-row" data-action="open-subject" data-mat="${escapeHTML(mat)}">
                    <span class="cat-grade-val tone-${gradeTone(Number(g.val))}">${escapeHTML(g.val)}</span>
                    <span class="recent-main"><b>${escapeHTML(mat)}</b><small>${escapeHTML(`${g.type || "Altele"} · ${g.date ? relativeDayLabel(g.date) : "fără dată"}`)}</small></span>
                    ${dir === "none" ? `<span class="trend-chip is-none" title="Prima notă la materie">prima</span>`
                        : `<span class="trend-chip is-${dir}" title="Cât a mutat media materiei">${dir === "up" ? "▲" : dir === "down" ? "▼" : "■"} ${dir === "flat" ? "0.00" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`}</span>`}
                </button>
            </li>`;
    }).join("")}</ol>`;
}

/* ---------- Timp ---------- */
function renderStatsModules(period) {
    const mods = moduleAverages();
    const box = $("stats-modules");
    const done = mods.filter(m => m.avg);
    if (done.length === 0) {
        box.innerHTML = `<p class="muted-small chart-empty is-small">Apare după primele note cu dată dintr-un modul.</p>`;
        return;
    }
    const prevDelta = (() => {
        if (done.length < 2) return null;
        const [a, b] = done.slice(-2);
        return { from: a.n, to: b.n, delta: b.avg - a.avg };
    })();
    box.innerHTML = `
        ${prevDelta ? `<p class="impact-lead">Modulul ${prevDelta.to} față de Modulul ${prevDelta.from}: <b class="${prevDelta.delta >= 0 ? "impact-pos" : "impact-neg"}">${prevDelta.delta >= 0 ? "+" : "−"}${Math.abs(prevDelta.delta).toFixed(2)}</b></p>` : ""}
        <div class="mod-cols">
            ${mods.map((m, i) => `
                <button type="button" class="mod-col ${m.status === "current" ? "is-current" : ""} ${m.avg ? "" : "is-empty"} ${period === `m${m.n}` ? "is-selected" : ""}"
                    data-action="stats-period" data-period="m${m.n}" ${m.status === "upcoming" ? "disabled" : ""}
                    aria-label="${escapeHTML(`Modulul ${m.n}${m.avg ? `: media ${m.avg.toFixed(2)}, ${plural(m.grades, "notă", "note")}` : ""}`)}">
                    <span class="mod-val">${m.avg ? m.avg.toFixed(2) : m.status === "upcoming" ? "" : "–"}</span>
                    <span class="mod-bar"><span class="anim-grow-y" style="height:${m.avg ? (((m.avg - 1) / 9) * 100).toFixed(1) : 0}%; --i:${i}"></span></span>
                    <span class="mod-name">M${m.n}${m.status === "current" ? " · acum" : ""}</span>
                    <small>${m.status === "upcoming" ? `din ${escapeHTML(shortDayLabel(m.start))}` : m.grades ? plural(m.grades, "notă", "note") : "fără note"}</small>
                </button>`).join("")}
        </div>
        <p class="subtitle impact-legend">Apasă pe un modul ca să vezi statisticile doar pentru el.</p>`;
}

function renderStatsWeekdays(subs) {
    const list = weekdayStats(subs);
    const box = $("stats-weekdays");
    const withData = list.filter(x => x.n);
    if (withData.length === 0) {
        box.innerHTML = `<p class="muted-small chart-empty is-small">Apare după note cu dată.</p>`;
        return;
    }
    const best = withData.filter(x => x.n >= 2).sort((a, b) => b.avg - a.avg)[0];
    box.innerHTML = `
        ${best ? `<p class="impact-lead">Ziua ta cea mai bună: <b>${WEEKDAY_LONG[best.wd]}</b> (${best.avg.toFixed(2)})</p>` : ""}
        <ol class="wd-bars" aria-label="Media notelor pe zile ale săptămânii">
            ${list.map((x, i) => `
                <li class="wd-col ${x.n ? "" : "is-empty"} ${best && best.wd === x.wd ? "is-best" : ""}" style="--i:${i}"
                    aria-label="${escapeHTML(`${WEEKDAY_LONG[x.wd]}: ${x.n ? `media ${x.avg.toFixed(2)}, ${plural(x.n, "notă", "note")}` : "nicio notă"}`)}">
                    <b class="wd-val" aria-hidden="true">${x.n ? x.avg.toFixed(2) : "–"}</b>
                    <span class="wd-track" aria-hidden="true">${x.n ? `<span class="wd-fill anim-grow-y" style="height:${pctPos(x.avg)}"></span>` : ""}</span>
                    <span class="wd-name" aria-hidden="true">${WEEKDAY_SHORT[x.wd]}</span>
                    <small aria-hidden="true">${x.n ? plural(x.n, "notă", "note") : "—"}</small>
                </li>`).join("")}
        </ol>`;
}

/** Hartă de activitate: o pătrățică pe zi, din septembrie până azi; culoarea = câte note ai primit. */
function renderStatsHeatmap(range) {
    const box = $("stats-heatmap");
    const today = getLocalDateKey();
    const mods = state.settings.modules;
    const byDay = new Map();
    Object.entries(state.subjects).forEach(([mat, sub]) => sub.grades.forEach(g => {
        if (!g.date) return;
        byDay.set(g.date, [...(byDay.get(g.date) || []), { mat, g }]);
    }));
    const dates = [...byDay.keys()].sort();
    let start = weekStart(dates[0] && dates[0] < mods[0].start ? dates[0] : mods[0].start);
    if (daysBetween(start, today) > 371) start = weekStart(addDays(today, -364));
    // Tot anul școlar, până în iunie: zilele care urmează apar estompate, ca să se vadă cât a trecut din an.
    const lastDay = mods[4].end > today ? mods[4].end : today;
    const end = addDays(weekStart(lastDay), 6);
    const inSchool = d => mods.some(m => d >= m.start && d <= m.end);

    const weeks = [];
    for (let w = start; w <= end; w = addDays(w, 7)) weeks.push(w);
    const total = dates.filter(d => d >= start).reduce((n, d) => n + byDay.get(d).length, 0);
    const activeDays = dates.filter(d => d >= start).length;

    const cell = date => {
        const items = byDay.get(date) || [];
        const n = items.length;
        const lvl = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3;
        const cls = [
            "hm-cell", `l${lvl}`,
            date > today && "is-future",
            !inSchool(date) && "is-break",
            date === today && "is-today",
            range && (date < range.from || date > range.to) && "is-dim"
        ].filter(Boolean).join(" ");
        const lines = n ? items.map(({ mat, g }) => `${mat} · ${g.type || "Altele"}|${g.val}`).join("\n") : (inSchool(date) ? "Nicio notă|" : "Vacanță / weekend|");
        return `<span class="${cls}" data-tip-title="${escapeHTML(weekdayLabel(date))}" data-tip-lines="${escapeHTML(lines)}"></span>`;
    };

    let lastMonth = -1;
    const monthLabels = weeks.map(w => {
        const m = parseDateKey(w).getMonth();
        const label = m !== lastMonth ? MONTH_SHORT[m] : "";
        lastMonth = m;
        return `<span>${label}</span>`;
    }).join("");

    box.innerHTML = `
        <p class="impact-lead"><b>${plural(total, "notă", "note")}</b> în <b>${plural(activeDays, "zi", "zile")}</b> de la începutul anului școlar.</p>
        <div class="hm-scroll" id="hm-scroll" tabindex="0" role="region" aria-label="Activitatea pe zile (derulează orizontal)">
            <div class="hm" style="--weeks:${weeks.length}">
                <div class="hm-months" aria-hidden="true">${monthLabels}</div>
                <div class="hm-days" aria-hidden="true"><span>Lu</span><span></span><span>Mi</span><span></span><span>Vi</span><span></span><span></span></div>
                <div class="hm-grid" role="img" aria-label="${escapeHTML(`Activitate: ${plural(total, "notă", "note")} în ${plural(activeDays, "zi", "zile")}`)}">
                    ${weeks.map(w => `<div class="hm-week">${[0, 1, 2, 3, 4, 5, 6].map(i => cell(addDays(w, i))).join("")}</div>`).join("")}
                </div>
            </div>
        </div>
        <div class="hm-legend" aria-hidden="true">
            <span>mai puține</span><span class="hm-cell l0"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span><span class="hm-cell l3"></span><span>mai multe</span>
            <span class="hm-legend-break"><span class="hm-cell l0 is-break"></span> vacanță / weekend</span>
        </div>`;
    // Pe ecrane înguste, derulează până la săptămâna de azi.
    const scroller = $("hm-scroll");
    const todayCell = scroller?.querySelector(".hm-cell.is-today");
    if (scroller && todayCell) scroller.scrollLeft = Math.max(0, todayCell.offsetLeft - scroller.clientWidth * 0.6);
}

function renderStatsCharts(timeline, range, pm) {
    const theme = chartTheme();
    const target = state.settings.goals.targetGPA;
    const tl = range ? timeline.filter(p => p.date >= range.from && p.date <= range.to) : timeline;

    const trendEmpty = tl.length < 2;
    $("stats-trend-frame").hidden = trendEmpty;
    $("stats-trend-empty").hidden = !trendEmpty;
    if (trendEmpty) {
        destroyChart("chartStatTrend");
        $("stats-trend-empty").textContent = metrics.totalGrades
            ? (range ? "Prea puține zile cu note în perioada aleasă pentru un grafic." : "Graficul apare când ai note în cel puțin două zile diferite (cu dată).")
            : "Graficul apare după primele note.";
    } else {
        const values = tl.map(p => roundValue(p.avg, 2));
        const low = Math.max(1, Math.floor(Math.min(...values, target) - 0.5));
        const options = baseChartOptions(theme, { yMax: 10, tip: TIP.avg });
        options.scales.y = { ...options.scales.y, min: low, max: 10 };
        upsertChart("chartStatTrend", {
            type: "line",
            data: {
                labels: tl.map(p => getShortDateLabel(p.date)),
                datasets: [
                    { label: "Media generală", data: values, borderColor: theme.accent, backgroundColor: `${theme.accent}22`, pointBackgroundColor: theme.accent, pointBorderColor: theme.surface, pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2, fill: true, tension: 0.25 },
                    { label: "Ținta", data: values.map(() => target), borderColor: theme.text, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0, fill: false }
                ]
            },
            options
        });
    }

    const dist = Array(10).fill(0);
    Object.values(periodSubjects(range)).forEach(sub => sub.grades.forEach(g => {
        const v = Math.round(Number(g.val));
        if (v >= 1 && v <= 10) dist[v - 1]++;
    }));
    const count = dist.reduce((a, b) => a + b, 0);
    const distEmpty = count < 3;
    $("stats-dist-frame").hidden = distEmpty;
    $("stats-dist-empty").hidden = !distEmpty;
    if (distEmpty) {
        destroyChart("chartStatDistributie");
        $("stats-dist-empty").textContent = `Distribuția apare de la 3 note (acum: ${plural(count, "notă", "note")}${range ? " în perioadă" : ""}).`;
    } else {
        upsertChart("chartStatDistributie", {
            type: "bar",
            data: { labels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], datasets: [{ label: "Note", data: dist, backgroundColor: theme.accent, borderRadius: 4, maxBarThickness: 32, borderSkipped: "start" }] },
            options: baseChartOptions(theme, { legend: false, tip: TIP.distribution })
        });
    }
}

/* ---------- meniul secțiunilor (lipit sus) + evidențierea secțiunii vizibile ---------- */
function bindStatsNav() {
    const nav = $("stats-nav");
    if (!nav || nav.dataset.bound) return;
    nav.dataset.bound = "1";
    $("stats-period")?.addEventListener("change", event => setStatsPeriod(event.target.value));

    // Secțiunea activă = ultima al cărei început a trecut de meniul lipit.
    let ticking = false;
    const update = () => {
        ticking = false;
        if (ui.activeTab !== "tab-statistici" || nav.hidden) return;
        const line = nav.getBoundingClientRect().bottom + 48;
        let active = STATS_SECTIONS[0].id;
        STATS_SECTIONS.forEach(sec => {
            const el = $(sec.id);
            if (el && el.getBoundingClientRect().top <= line) active = sec.id;
        });
        // La finalul paginii, ultima secțiune e cea activă chiar dacă începutul ei nu a ajuns sus.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = STATS_SECTIONS[STATS_SECTIONS.length - 1].id;
        nav.querySelectorAll(".stats-nav-link").forEach(a => a.classList.toggle("active", a.dataset.target === active));
    };
    window.addEventListener("scroll", () => {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
}

function setStatsPeriod(id) {
    ui.statsPeriod = statsPeriods().some(p => p.id === id && !p.disabled) ? id : "year";
    ui.statsAnimate = true;
    renderStatistics();
}

/* ---------- raport pentru printare ---------- */
/* ==================== RAPORT PENTRU PRINTARE ==================== */
/*
 * Înainte de printare se deschide un panou: nume și clasă (pentru antet), perioada și secțiunile dorite.
 * Alegerile se păstrează în Setări (settings.report), deci și Ctrl+P din browser folosește ultimele opțiuni.
 */
function reportPeriod() {
    const id = state.settings.report.period;
    return statsPeriods().some(p => p.id === id && !p.disabled) ? id : "year";
}

function openReportPanel() {
    const r = state.settings.report;
    const period = reportPeriod();
    openModal({
        layout: "panel",
        title: "Raport pentru printare",
        guestOk: true,
        confirmText: "Printează",
        body: `
            <p class="modal-hint">Se deschide fereastra de printare a browserului. Ca să-l trimiți, alege „Salvează ca PDF”.</p>
            <div class="form-row">
                <div class="form-group">
                    <label for="rep-name">Numele elevului <span class="label-hint">(opțional)</span></label>
                    <input id="rep-name" class="glass-input" maxlength="60" autocomplete="name" value="${escapeHTML(r.name || state.settings.profile.name)}" placeholder="ex: Andrei Popescu">
                </div>
                <div class="form-group">
                    <label for="rep-cls">Clasa <span class="label-hint">(opțional)</span></label>
                    <input id="rep-cls" class="glass-input" maxlength="30" value="${escapeHTML(r.cls)}" placeholder="ex: a IX-a B">
                </div>
            </div>
            <div class="form-group">
                <label for="rep-period">Perioada</label>
                <select id="rep-period" class="glass-select">
                    ${statsPeriods().filter(p => !p.disabled).map(p => `<option value="${p.id}" ${p.id === period ? "selected" : ""}>${escapeHTML(p.label)}</option>`).join("")}
                </select>
            </div>
            <fieldset class="rep-sections">
                <legend>Ce include</legend>
                ${REPORT_SECTIONS.map(x => `
                    <label class="check-row"><input type="checkbox" id="rep-sec-${x.key}" ${r.sections[x.key] ? "checked" : ""}> ${escapeHTML(x.label)}</label>`).join("")}
            </fieldset>`,
        onConfirm: () => {
            r.name = field("rep-name").trim().slice(0, 60);
            r.cls = field("rep-cls").trim().slice(0, 30);
            r.period = field("rep-period") || "year";
            REPORT_SECTIONS.forEach(x => { r.sections[x.key] = Boolean($(`rep-sec-${x.key}`)?.checked); });
            saveState();
            closeActionModal();
            buildPrintReport();
            // Lăsăm panoul să se închidă înainte ca browserul să blocheze pagina cu fereastra de printare.
            setTimeout(() => window.print(), 50);
        }
    });
}

/** Graficul mediei generale, desenat simplu pentru hârtie (fără culori obligatorii). */
function reportChartSVG(timeline, target, risk) {
    if (timeline.length < 2) return `<p class="pr-empty">Graficul apare după note din cel puțin două zile diferite.</p>`;
    const W = 340, H = 130, L = 26, R = 8, T = 8, B = 18;
    const vals = timeline.map(p => p.avg);
    const lo = Math.max(1, Math.floor(Math.min(...vals, risk) - 0.5));
    const hi = 10;
    const x = i => L + (i * (W - L - R)) / (timeline.length - 1);
    const y = v => T + ((hi - v) * (H - T - B)) / (hi - lo);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const ticks = [];
    for (let v = hi; v >= lo; v -= hi - lo > 5 ? 2 : 1) ticks.push(v);
    const hl = (v, cls) => `<line class="${cls}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    return `
        <svg class="pr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evoluția mediei generale">
            ${ticks.map(v => `<text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>${hl(v, "pr-grid")}`).join("")}
            ${target <= 10 && target >= lo ? hl(target, "pr-target") : ""}
            ${risk >= lo ? hl(risk, "pr-risk") : ""}
            <polyline points="${pts}"/>
            ${vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.8"/>`).join("")}
            <text x="${L}" y="${H - 4}">${escapeHTML(shortDayLabel(timeline[0].date))}</text>
            <text x="${W - R}" y="${H - 4}" text-anchor="end">${escapeHTML(shortDayLabel(timeline.at(-1).date))}</text>
        </svg>
        <p class="pr-legend"><i class="pr-k-line"></i> media generală <i class="pr-k-target"></i> ținta ${target.toFixed(2)} <i class="pr-k-risk"></i> prag de risc ${risk.toFixed(2)}</p>`;
}

/** Ce notă îi trebuie unei materii la următoarea evaluare (risc întâi, apoi ținta). */
function reportNeed(mat, sub) {
    const d = metrics.subjects[mat];
    if (!sub.grades.length) return "orice notă";
    const risk = state.settings.calc.riskThreshold;
    const atRisk = d.exactAvg < risk;
    const plan = atRisk ? planForCondition(mat, x => x.exactAvg >= risk) : planForCondition(mat, x => reachesTarget(x, sub.target));
    if (plan.now) return "✓ ținta e atinsă";
    const what = atRisk ? "ieși din risc" : `ținta ${fmtTarget(sub.target)}`;
    if (plan.next) return `${plan.next === 1 ? "orice notă" : `minim ${plan.next}`} → ${what}`;
    if (plan.tens) return `${plan.tens} note de 10 → ${what}`;
    return `peste 20 de note de 10 → ${what}`;
}

function buildPrintReport() {
    const box = $("print-report");
    if (!box) return;
    const r = state.settings.report;
    const on = key => r.sections[key] !== false && (r.sections[key] ?? REPORT_SECTIONS.find(x => x.key === key)?.on);
    const s = state.settings;
    const periodId = reportPeriod();
    const range = periodRange(periodId);
    const subs = periodSubjects(range);
    const m = range ? calculateMetrics(subs) : metrics;
    const entries = statsEntries(subs, m).sort(STATS_SORTS.name);
    const p = metrics.purtare || purtareInfo();
    const now = new Date();
    const today = getLocalDateKey(now);
    const avg = m.globalAvg;
    const target = s.goals.targetGPA;
    const risk = s.calc.riskThreshold;
    const riskCount = entries.filter(e => e.standing.key === "risk").length;
    const modN = /^m([1-5])$/.exec(periodId)?.[1];
    const purtareVal = modN ? (p.modules[modN - 1].val ?? "–") : p.value;
    const periodText = range ? `${periodLabel(periodId)} · ${shortDayLabel(range.from)} – ${shortDayLabel(range.to)}` : `Tot anul școlar · ${shortDayLabel(s.modules[0].start)} – ${shortDayLabel(s.modules[4].end)}`;
    const who = [r.name, r.cls && `Clasa ${r.cls.replace(/^clasa\s+/i, "")}`].filter(Boolean).join(" · ");
    const gap = target - (m.rawGlobalAvg || 0);
    const status = avg <= 0 ? "încă fără note" : gap <= 0.004 ? "✓ ținta e atinsă" : `lipsesc ${gap.toFixed(2)} puncte până la țintă`;

    const gradeList = sub => {
        const chrono = gradesChrono(sub).map(x => x.g);
        if (!chrono.length) return `<span class="pr-muted">—</span>`;
        return chrono.map(g => `<span class="pr-g ${Number(g.val) < 5 ? "is-low" : Number(g.val) === 10 ? "is-ten" : ""}" title="${escapeHTML(g.type || "")}">${escapeHTML(g.val)}</span>`).join(" ");
    };

    const rows = entries.map(({ mat, sub, d, standing }) => `
        <tr class="is-${standing.key}">
            <th scope="row">${escapeHTML(mat)}${sub.excludeFromGPA ? ` <em>exclusă</em>` : ""}${sub.priority ? " ★" : ""}</th>
            ${on("grades") ? `<td class="pr-grades">${gradeList(sub)}</td>` : `<td>${sub.grades.length}</td>`}
            <td class="pr-num">${sub.grades.length ? d.exactAvg.toFixed(2) : "–"}</td>
            <td class="pr-num pr-final">${sub.grades.length ? d.roundedAvg : "–"}</td>
            <td class="pr-num">${fmtTarget(sub.target)}</td>
            ${on("need") ? `<td class="pr-need">${escapeHTML(reportNeed(mat, state.subjects[mat]))}</td>` : ""}
            <td class="pr-status">${standing.icon} ${standing.label}</td>
        </tr>`).join("");

    const modules = moduleAverages();
    const modulesHTML = `
        <section class="pr-block">
            <h2>Pe module</h2>
            <table class="pr-mini">
                <thead><tr><th>Modul</th><th>Perioada</th><th class="pr-num">Media</th><th class="pr-num">Note</th><th class="pr-num">Purtare</th></tr></thead>
                <tbody>${modules.map(x => `
                    <tr class="${x.status === "current" ? "is-current" : ""} ${x.status === "upcoming" ? "is-future" : ""}">
                        <th scope="row">Modulul ${x.n}${x.status === "current" ? " · acum" : ""}</th>
                        <td>${escapeHTML(moduleRange(x))}</td>
                        <td class="pr-num">${x.avg ? x.avg.toFixed(2) : "–"}</td>
                        <td class="pr-num">${x.status === "upcoming" ? "–" : x.grades}</td>
                        <td class="pr-num">${x.val ?? "–"}${x.reason ? `<small>${escapeHTML(x.reason)}</small>` : ""}</td>
                    </tr>`).join("")}</tbody>
            </table>
            <p class="pr-note">Media purtării pe an: ${p.avg.toFixed(2)}${state.purtare.excludeFromGPA ? " (exclusă din media generală)" : ""}.</p>
        </section>`;

    const timeline = averageTimeline().filter(pt => !range || (pt.date >= range.from && pt.date <= range.to));
    const chartHTML = `
        <section class="pr-block">
            <h2>Evoluția mediei generale</h2>
            ${reportChartSVG(timeline, target, risk)}
        </section>`;

    const links = gradeLinks();
    const upcoming = occurrencesBetween(today, addDays(today, 30)).filter(o => (NEEDS_GRADE.has(o.ev.type) || o.ev.type === "Temă") && !isOccurrenceDone(o.ev, o.date, links));
    const upcomingHTML = `
        <section class="pr-block">
            <h2>Urmează (30 de zile)</h2>
            ${upcoming.length ? `<ul class="pr-list">${upcoming.slice(0, 10).map(o => `
                <li><b>${escapeHTML(weekdayLabel(o.date))}</b> ${escapeHTML(o.ev.title)} <span class="pr-muted">· ${escapeHTML([o.ev.type, o.ev.subject && !foldText(o.ev.title).includes(foldText(o.ev.subject)) ? o.ev.subject : ""].filter(Boolean).join(", "))}</span></li>`).join("")}</ul>
                ${upcoming.length > 10 ? `<p class="pr-note">și încă ${upcoming.length - 10}.</p>` : ""}`
            : `<p class="pr-empty">Nicio evaluare sau temă programată.</p>`}
        </section>`;

    const tips = buildInsights(statsEntries()).slice(0, 5);
    const tipsHTML = `
        <section class="pr-block">
            <h2>Recomandări</h2>
            ${tips.length ? `<ol class="pr-list pr-tips">${tips.map(it => `<li><b>${escapeHTML(it.title)}.</b> ${escapeHTML(it.text)}</li>`).join("")}</ol>`
            : `<p class="pr-empty">Nicio materie în risc și minimul de note e atins.</p>`}
        </section>`;

    const pair = (a, b) => a && b ? `<div class="pr-cols">${a}${b}</div>` : (a || b || "");
    const planDaysList = state.plan.prefs.setup ? planDays().map(d => [d, planItemsOn(d)]).filter(([, items]) => items.length) : [];
    const planHTML = `
        <section class="pr-block">
            <h2>Planul de studiu · următoarele 7 zile</h2>
            ${planDaysList.length ? `<ul class="pr-list pr-plan">${planDaysList.map(([d, items]) => `<li><b>${escapeHTML(planDayLabel(d, getLocalDateKey()))}:</b> ${items.map(it => `${escapeHTML(it.mat)} (${escapeHTML(PLAN_KINDS[it.kind].label.toLocaleLowerCase("ro"))}, ${it.min} min${it.done ? ", făcut" : ""})`).join("; ")}</li>`).join("")}</ul>`
                : `<p class="pr-empty">${state.plan.prefs.setup ? "Nicio sesiune în următoarele 7 zile." : "Planul de studiu nu a fost încă făcut (pagina „Plan”)."}</p>`}
        </section>`;

    box.innerHTML = `
        <header class="pr-head">
            <div class="pr-title">
                <p class="pr-kicker">Raport școlar</p>
                <h1>${who ? escapeHTML(who) : "Situația la învățătură"}</h1>
                <p>${escapeHTML(periodText)}</p>
                <p class="pr-made">Generat pe ${escapeHTML(formatDateTime(now))}</p>
            </div>
            <div class="pr-avg">
                <span>Media generală${range ? ` · ${escapeHTML(periodLabel(periodId))}` : ""}</span>
                <b>${avg > 0 ? avg.toFixed(2) : "–"}</b>
                <small>ținta ${target.toFixed(2)} · ${escapeHTML(status)}</small>
            </div>
        </header>

        <section class="pr-kpis">
            <div><span>Purtare</span><b>${purtareVal}</b></div>
            <div class="${riskCount ? "is-risk" : ""}"><span>Materii în risc</span><b>${riskCount}</b><small>sub ${risk.toFixed(2)}</small></div>
            <div><span>Note</span><b>${m.totalGrades}</b><small>${plural(entries.filter(e => e.sub.grades.length).length, "materie", "materii")} cu note</small></div>
            <div><span>Note de 10</span><b>${m.tensCount}</b></div>
            <div><span>Note lipsă</span><b>${entries.reduce((n, e) => n + e.d.requiredNotes, 0)}</b><small>până la minim</small></div>
        </section>

        <section class="pr-block">
            <h2>Situația pe materii</h2>
            <table class="pr-table">
                <thead><tr>
                    <th scope="col">Materie</th>
                    <th scope="col">${on("grades") ? "Note" : "Nr. note"}</th>
                    <th scope="col" class="pr-num">Media</th>
                    <th scope="col" class="pr-num">Finală</th>
                    <th scope="col" class="pr-num">Ținta</th>
                    ${on("need") ? `<th scope="col">La următoarea notă</th>` : ""}
                    <th scope="col">Situație</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <p class="pr-note">Media generală ${s.calc.method === "weighted" ? "ponderată după numărul de ore" : "aritmetică (ca în catalog)"}${state.purtare.excludeFromGPA ? "" : ", cu purtarea inclusă"}. „Finală” = media rotunjită. Notele sub 5 sunt subliniate, notele de 10 îngroșate.${on("need") ? " „La următoarea notă” e calculat pentru situația de azi." : ""}</p>
        </section>

        ${pair(on("chart") ? chartHTML : "", on("modules") ? modulesHTML : "")}
        ${pair(on("upcoming") ? upcomingHTML : "", on("tips") ? tipsHTML : "")}
        ${on("plan") ? planHTML : ""}

        ${on("sign") ? `
            <section class="pr-sign">
                <div><span>Am luat la cunoștință — părinte / tutore</span><i></i></div>
                <div><span>Data</span><i></i></div>
            </section>` : ""}`;
}

function printStatsReport() {
    openReportPanel();
}

/* ==================== CONFIGURARE LA PRIMA PORNIRE ==================== */
/*
 * Un asistent în 4 pași (profil → materii → ținte → orar) care apare când caietul e gol.
 * Materiile propuse urmează planurile-cadru (liceu: clasa a IX-a, OMEC nr. 4350/2025; gimnaziu: planul în vigoare).
 * Orele sunt orientative: școlile pot redistribui orele, iar elevul le poate corecta în pasul 2.
 */
const SETUP_DONE_KEY = "pro_setup_done_v4";
const SETUP_STEPS = ["Profil", "Materii", "Ținte", "Orar"];
/*
 * Materiile propuse urmează planurile-cadru oficiale, după profil ȘI clasă (verificate în octombrie 2026):
 *   – clasa a IX-a: planul-cadru nou, OMEC 4350/2025 (modificat prin OMEC 4152/2026; intensiv informatică: OMEC 6873/2025),
 *     aplicat din 2026–2027 doar la a IX-a;
 *   – clasele X–XII: planurile din 2009 (OMECI 3410/2009, filiera teoretică și vocațională; pedagogic OMECTS 5347/2011;
 *     tehnologic OMECTS 3081/2010 și OMECI 3412/2009), cu anexa pentru XI–XII înlocuită prin OME 3667/2023 și OME 7723/2024
 *     (Istoria evreilor. Holocaustul în a XI-a, Istoria comunismului din România în a XII-a);
 *   – gimnaziul: OMENCS 3590/2016, anexa 2.
 * La vocațional și tehnologic, împărțirea orelor de specialitate pe discipline diferă între școli: e orientativă.
 * Orele de CDȘ / opționale nu apar (le alege fiecare școală). Totul se poate corecta în pasul 2.
 */
const LICEU = [9, 10, 11, 12];
const ROMAN = { 5: "V", 6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X", 11: "XI", 12: "XII" };
const LM2 = ["Limba franceză", { hint: "limba modernă 2" }];
const LM2_CHOICES = ["Limba franceză", "Limba germană", "Limba spaniolă", "Limba italiană", "Limba rusă", "Limba portugheză"];
/* Dirigenția: în gimnaziu și în noua clasă a IX-a apare în planul-cadru sub alt nume; la celelalte clase o adăugăm noi. */
const DIRIG = "Dirigenție";
const DIRIG_ALIASES = ["Consiliere și dezvoltare personală", "Dezvoltare personală și consiliere pentru carieră"];
/* Opționalul (curriculum la decizia școlii): un singur loc, căruia elevul îi scrie doar tema. */
const OPT = "Opțional";
const isOptionalName = name => name === OPT || String(name).startsWith(`${OPT} · `);
const optionalTopic = name => isOptionalName(name) && name !== OPT ? name.slice(OPT.length + 3) : "";
const optionalName = topic => {
    const t = cleanName(topic, 40);
    return t ? `${OPT} · ${t}` : OPT;
};

/**
 * Pornește de la o listă de bază [nume, ore], schimbă orele (`set`), scoate materii (`drop`)
 * și adaugă materiile de specialitate (`add`). Orele 0 din `set` scot materia.
 */
function plan(base, { set = {}, drop = [], add = [] } = {}) {
    const rows = base
        .filter(([name]) => !drop.includes(name))
        .map(([name, ore, opt]) => [name, name in set ? set[name] : ore, opt])
        .filter(([, ore]) => ore > 0);
    return [...rows, ...add].map(([name, ore, opt]) => opt ? [name, ore, opt] : [name, ore]);
}
const withLm2 = (rows, ore) => rows.map(r => r[0] === LM2[0] ? [r[0], ore ?? r[1], LM2[1]] : r);

/* ---------- Clasa a IX-a: planul-cadru nou (OMEC 4350/2025, modificat prin OMEC 4152/2026), din 2026–2027 ---------- */
// Trunchiul comun, la fel pentru toate profilurile (19 ore); orele de „curriculum de specialitate” se adaugă peste el.
const TC_IX = [
    ["Limba și literatura română", 3], ["Limba engleză", 2], [LM2[0], 1],
    ["Matematică", 2], ["Fizică", 1], ["Chimie", 1], ["Biologie", 1],
    ["Istorie", 1], ["Geografie", 1], ["Logică", 1], ["Religie", 1],
    ["Educație artistică", 1, { hint: "educație muzicală și vizuală, câte o jumătate de oră" }],
    ["Educație fizică și sport", 1], ["TIC", 1], ["Dezvoltare personală și consiliere pentru carieră", 1]
];
const ix = opts => withLm2(plan(TC_IX, opts));

/* ---------- Clasele X–XII: planurile din 2009 (OMECI 3410/2009), cu modificările din 2023 și 2024 ---------- */
// Clasa a X-a (ciclul inferior al liceului, anexa 1 — neschimbată din 2009). Profilul real și cel umanist au câte un tabel comun.
const X_REAL = [
    ["Limba și literatura română", 3], ["Limba engleză", 2], [LM2[0], 2],
    ["Matematică", 4], ["Fizică", 3], ["Chimie", 2], ["Biologie", 2], ["Informatică", 1],
    ["Istorie", 1], ["Geografie", 1], ["Psihologie", 1], ["Religie", 1],
    ["Educație artistică", 1, { hint: "muzică și arte vizuale, alternativ" }], ["Educație fizică", 2], ["TIC", 1], ["Educație antreprenorială", 1]
];
const X_UMAN = [
    ["Limba și literatura română", 4], ["Limba engleză", 3], [LM2[0], 2], ["Limba latină", 1],
    ["Matematică", 2], ["Fizică", 2], ["Chimie", 1], ["Biologie", 1],
    ["Istorie", 3], ["Geografie", 2], ["Psihologie", 2], ["Religie", 1],
    ["Educație artistică", 1, { hint: "muzică și arte vizuale, alternativ" }], ["Educație fizică", 1], ["TIC", 1], ["Educație antreprenorială", 1]
];
// Trunchiul comun vocațional în a X-a (19 ore), peste care vin disciplinele artistice / sportive / teologice.
const X_VOC = [
    ["Limba și literatura română", 3], ["Limba engleză", 2], [LM2[0], 1],
    ["Matematică", 2], ["Fizică", 2], ["Chimie", 1], ["Biologie", 1],
    ["Istorie", 1], ["Geografie", 1], ["Psihologie", 1], ["Religie", 1],
    ["Educație fizică", 1], ["TIC", 1], ["Educație antreprenorială", 1]
];
// Clasele XI–XII (ciclul superior, anexa 2 înlocuită prin OME 3667/2023 și OME 7723/2024):
// în a XI-a „Istoria evreilor. Holocaustul”, în a XII-a „Istoria comunismului din România” — câte o oră, obligatorii.
const XI_XII_ISTORIE = cls => cls === 11 ? ["Istoria evreilor. Holocaustul", 1] : ["Istoria comunismului din România", 1];
const SOCIO_SUP = cls => cls === 11 ? "Economie" : "Filosofie";
const SUP_COMMON = cls => [
    ["Limba și literatura română", 3], ["Limba engleză", 2], [LM2[0], 2],
    ["Istorie", 1], XI_XII_ISTORIE(cls), ["Geografie", 1], [SOCIO_SUP(cls), 1], ["Religie", 1]
];
const sup = (cls, opts) => withLm2(plan(SUP_COMMON(cls), opts));

/* ---------- Clasele X–XII, filiera tehnologică (OMECTS 3081/2010; OMECI 3412/2009 cu OME 3664/2023 și 7724/2024) ---------- */
function tehnologicSup(cls, kind) {
    const servicii = kind === "servicii";
    const resurse = kind === "resurse";
    return withLm2([
        ["Limba și literatura română", 3], ["Limba engleză", 2], [LM2[0], 2],
        ["Matematică", 3],
        ...(servicii ? [] : resurse
            ? [["Chimie", cls === 11 ? 2 : 1], ["Biologie", cls === 11 ? 1 : 2]]
            : [["Fizică", 2], ["Chimie", 1]]),
        ["Istorie", servicii && cls === 11 ? 2 : 1], XI_XII_ISTORIE(cls), ["Geografie", servicii && cls === 12 ? 2 : 1],
        [cls === 11 ? "Economie" : "Economie aplicată", servicii ? 2 : 1], ["Religie", 1], ["Educație fizică", 1], ["TIC", 1],
        ["Cultură de specialitate", 6, { hint: "modulele calificării tale, la un loc" }],
        ["Pregătire practică", servicii && cls === 11 ? 6 : 5, { hint: "plus stagiile de practică de la sfârșitul anului" }]
    ]);
}
const TEHNOLOGIC_IX = [
    ["Pregătire teoretică de specialitate", 4, { hint: "modulele calificării tale, la un loc" }],
    ["Laborator tehnologic și instruire practică", 6, { hint: "plus 5 săptămâni de stagiu de practică pe an" }]
];
const TEHNOLOGIC_X = kind => withLm2(plan(X_VOC, {
    set: { "Matematică": kind === "servicii" ? 2 : 3, "Fizică": kind === "servicii" ? 1 : 2, [LM2[0]]: 2 },
    add: [
        ["Pregătire de specialitate", 6, { hint: "modulele calificării tale, la un loc" }],
        ["Instruire practică", 5, { hint: "plus 3 săptămâni de stagiu de practică pe an" }]
    ]
}));

const SETUP_GROUPS = [
    { id: "teoretic", label: "Liceu teoretic" },
    { id: "vocational", label: "Liceu vocațional" },
    { id: "tehnologic", label: "Liceu tehnologic" },
    { id: "alte", label: "Gimnaziu și altele" }
];

const SETUP_PROFILES = {
    "mate-info": {
        group: "teoretic", label: "Matematică-informatică", hint: "profil real", classes: LICEU,
        variantLabel: "Tipul clasei",
        variants: [{ id: "normal", label: "Normală" }, { id: "intensiv", label: "Intensiv informatică" }],
        subjects: ({ cls, variant }) => {
            const intensiv = variant?.id === "intensiv";
            if (cls === 9) return ix({ set: { "Matematică": 4, "Fizică": 3, "Chimie": 2 }, add: [["Informatică", intensiv ? 4 : 2]] });
            if (cls === 10) return withLm2(plan(X_REAL, { set: { "Informatică": intensiv ? 4 : 1 } }));
            return sup(cls, { add: [["Matematică", 4], ["Fizică", 3], ["Chimie", 1], ["Biologie", 1], ["Informatică", intensiv ? 7 : 4], ["Educație fizică", 1]] });
        }
    },
    "stiinte": {
        group: "teoretic", label: "Științe ale naturii", hint: "profil real", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({ set: { "Matematică": 3, "Fizică": 3, "Chimie": 3, "Biologie": 3 }, add: [["Informatică", 1]] });
            if (cls === 10) return withLm2(plan(X_REAL));
            return sup(cls, { add: [["Matematică", 3], ["Fizică", 3], ["Chimie", 2], ["Biologie", 2], ["TIC", cls === 11 ? 2 : 1], ["Educație fizică", 1]] });
        }
    },
    "filologie": {
        group: "teoretic", label: "Filologie", hint: "profil umanist", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({ set: { "Limba și literatura română": 5, "Limba engleză": 3, [LM2[0]]: 2, "Istorie": 2, "Geografie": 2, "Logică": 2 }, add: [["Limba latină", 1]] });
            if (cls === 10) return withLm2(plan(X_UMAN));
            return sup(cls, {
                set: { "Limba și literatura română": 4, "Limba engleză": 3, [LM2[0]]: 3, "Istorie": 2, [SOCIO_SUP(cls)]: cls === 12 ? 2 : 1 },
                add: [["Limba latină", cls === 11 ? 2 : 1], ["Literatură universală", 1], ["Științe", 1], ...(cls === 11 ? [["Sociologie", 1]] : []),
                    ["TIC", 1], ["Educație artistică", 1], ["Educație fizică", 1]]
            });
        }
    },
    "sociale": {
        group: "teoretic", label: "Științe sociale", hint: "profil umanist", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({ set: { "Limba și literatura română": 4, "Limba engleză": 3, [LM2[0]]: 2, "Istorie": 2, "Geografie": 2, "Logică": 2 }, add: [["Limba latină", 1]] });
            if (cls === 10) return withLm2(plan(X_UMAN));
            return sup(cls, {
                set: { "Istorie": 3, "Geografie": 2, [SOCIO_SUP(cls)]: cls === 11 ? 2 : 3 },
                add: [["Matematică", 2], ...(cls === 11 ? [["Sociologie", 2]] : [["Studii sociale", 1, { hint: "disciplina socio-umană a școlii" }]]),
                    ["TIC", cls === 11 ? 2 : 1], ["Educație artistică", 1], ["Educație fizică", 1]]
            });
        }
    },
    "arte-vizuale": {
        group: "vocational", label: "Arte vizuale", hint: "arte plastice, decorative, arhitectură, design", classes: LICEU,
        variantLabel: "Specializarea",
        variants: [
            { id: "plastice", label: "Arte plastice" },
            { id: "decorative", label: "Arte decorative" },
            { id: "arhitectura", label: "Arhitectură" },
            { id: "design", label: "Design" }
        ],
        subjects: ({ cls, variant }) => {
            const id = variant?.id || "plastice";
            const atelier = { plastice: "Atelier de specialitate", decorative: "Atelier de arte decorative", arhitectura: "Atelier de arhitectură", design: "Atelier de design" }[id];
            // În a IX-a, toate specializările de arte vizuale au aceleași discipline (OMEC 4350/2025, anexa 12).
            if (cls === 9) return ix({
                drop: ["Educație artistică"],
                add: [["Educație muzicală", 1], [atelier, 2], ["Studiul formelor în desen", 2], ["Studiul formelor în culoare", 2], ["Studiul formelor în volum", 2],
                    ["Crochiuri", 1], ["Istoria artelor și a arhitecturii", 1]]
            });
            const arhi = id === "arhitectura" || id === "design"; // în X–XII, design-ul e în tabelul „arhitectură, arte ambientale și design”
            if (cls === 10) return withLm2(plan(X_VOC, {
                add: [["Educație muzicală", 1], ["Studiul formelor în desen", 2], [arhi ? "Geometrie descriptivă și perspectivă" : "Studiul formelor în culoare și studiul culorii", 2],
                    ["Studiul formelor în volum", 2], [atelier, 2], [arhi ? "Istoria artelor și a arhitecturii" : "Istoria artelor", 1]]
            }));
            return sup(cls, {
                add: arhi
                    ? [["Matematică", 2], ["Desen", 3], ["Geometrie descriptivă și perspectivă", 2], [atelier, 4], ["Istoria artelor și a arhitecturii", 2],
                        ["Procesarea computerizată a imaginii", 2], ["Educație fizică", 1]]
                    : [["Studiul formelor în desen", 3], ["Crochiuri", 1], [atelier, 4], ["Studiul corpului și al figurii umane", 3], ["Istoria artelor", 2],
                        ["Procesarea computerizată a imaginii", 2], ["Educație fizică", 1]]
            });
        }
    },
    "muzica": {
        group: "vocational", label: "Muzică", hint: "instrument, canto, teorie", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({
                drop: ["Educație artistică"],
                add: [["Instrument principal", 3, { hint: "sau canto, după secție" }], ["Ansamblu", 3, { hint: "coral, orchestral sau cameral" }], ["Teorie-solfegiu-dicteu", 3],
                    ["Istoria muzicii", 1], ["Pian complementar", 1], ["Armonie", 1]]
            });
            if (cls === 10) return withLm2(plan(X_VOC, {
                add: [["Educație vizuală", 1], ["Instrument principal", 3, { hint: "sau canto, după secție" }], ["Teorie-solfegiu-dicteu", 2], ["Ansamblu", 2, { hint: "coral, orchestral sau cameral" }],
                    ["Armonie", 1], ["Istoria muzicii", 1], ["Pian complementar", 1]]
            }));
            return sup(cls, {
                add: [["Instrument principal", 4, { hint: "sau canto, după secție" }], ["Teorie-solfegiu-dicteu", 2], ["Armonie", 2], ["Istoria muzicii", 2],
                    ["Ansamblu", 2, { hint: "coral, orchestral sau cameral" }], ["Forme muzicale", 1], ["Pian complementar", 1], ["Educație fizică", 1], ["TIC", 1]]
            });
        }
    },
    "coregrafie": {
        group: "vocational", label: "Coregrafie", hint: "dans clasic și contemporan", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({
                drop: ["Educație artistică", "Educație fizică și sport"],
                add: [["Dans clasic", 8], ["Dans contemporan", 1], ["Dans de caracter", 1], ["Dans românesc", 1], ["Repertoriu individual", 1], ["Repertoriu de ansamblu", 1],
                    ["Istoria baletului", 1], ["Educație muzicală", 1], ["Laborator de creație", 1]]
            });
            if (cls === 10) return withLm2(plan(X_VOC, {
                drop: ["Educație fizică"],
                add: [["Educație muzicală", 1], ["Educație vizuală", 1], ["Dans clasic", 7], ["Dans contemporan", 2], ["Dans de caracter", 2], ["Dans românesc", 1], ["Istoria baletului", 1]]
            }));
            return sup(cls, {
                add: [["Biologie", 1], ["Educație muzicală", 1], ["Dans clasic", 8], ["Dans contemporan", 2], ["Dans de caracter", 2], ["Dans românesc", 1],
                    ["Repertoriu", cls === 11 ? 1 : 2], ["Istoria baletului", 1], ...(cls === 11 ? [["TIC", 1]] : [])]
            });
        }
    },
    "teatru": {
        group: "vocational", label: "Arta actorului", hint: "teatru", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({
                drop: ["Educație artistică"],
                add: [["Arta actorului", 4], ["Mișcare scenică", 2], ["Dicție și vorbire scenică", 1], ["Istoria teatrului", 1], ["Artele spectacolului", 1],
                    ["Educație muzicală", 1], ["Educație vizuală", 1]]
            });
            if (cls === 10) return withLm2(plan(X_VOC, {
                add: [["Educație muzicală", 1], ["Educație vizuală", 1], ["Arta actorului", 4], ["Mișcare scenică", 2], ["Dicție și vorbire scenică", 1], ["Istoria teatrului", 1]]
            }));
            return sup(cls, {
                add: [["Arta actorului", 5], ["Mișcare scenică", 2], ["Dicție și vorbire scenică", 1], ["Istoria teatrului", 1], ["Artele spectacolului", 1],
                    ["Educație muzicală", 1], ["Educație fizică", 2], ["TIC", 1]]
            });
        }
    },
    "sportiv": {
        group: "vocational", label: "Sportiv", hint: "instructor sportiv", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({ drop: ["Educație fizică și sport"], add: [["Pregătire sportivă teoretică", 2], ["Pregătire sportivă practică", 12]] });
            if (cls === 10) return withLm2(plan(X_VOC, {
                drop: ["Educație fizică"],
                add: [["Educație muzicală", 1], ["Educație vizuală", 1], ["Pregătire sportivă teoretică", 2], ["Pregătire sportivă practică", 10]]
            }));
            return sup(cls, { add: [["Matematică", 1], ["Biologie", 1], ["Educație muzicală", 1], ["Pregătire sportivă teoretică", 2], ["Pregătire sportivă practică", 14]] });
        }
    },
    "pedagogic": {
        group: "vocational", label: "Pedagogic", hint: "învățător-educatoare", classes: LICEU,
        subjects: ({ cls }) => {
            if (cls === 9) return ix({ set: { "Limba și literatura română": 5 }, add: [["Pedagogie", 2], ["Practică pedagogică", 3], ["Managementul emoțiilor", 1]] });
            if (cls === 10) return withLm2(plan(X_VOC, {
                set: { "Limba și literatura română": 4, [LM2[0]]: 2, "Fizică": 1, "TIC": 2 },
                add: [["Psihologie generală", 2], ["Teoria și practica instruirii și evaluării", 1], ["Educație muzicală", 1], ["Educație vizuală", 1],
                    ["Pregătire practică de specialitate", 3]]
            }));
            if (cls === 11) return withLm2([
                ["Limba și literatura română", 4], ["Metodica predării limbii române", 1], ["Limba engleză", 2], [LM2[0], 1],
                ["Matematică", 1], ["Aritmetică", 1], ["Metodica predării matematicii", 1], ["Științe ale naturii", 1], ["Metodica predării științelor", 1],
                ["Istorie", 1], XI_XII_ISTORIE(11), ["Geografie", 1], ["Metodica predării istoriei și geografiei", 1], ["Economie", 1], ["Religie", 1],
                ["Managementul clasei de elevi", 1], ["Psihologia vârstelor", 1], ["Practică pedagogică", 4],
                ["Educație muzicală și plastică", 1], ["Metodica educației muzicale și plastice", 1], ["Educație fizică", 1], ["Metodica educației fizice", 1], ["TIC", 1]
            ]);
            return withLm2([
                ["Limba și literatura română", 4], ["Limba engleză", 2], [LM2[0], 2],
                ["Matematică", 1], ["Aritmetică", 1], ["Științe", 2], ["Istorie", 1], XI_XII_ISTORIE(12), ["Geografie", 1], ["Filosofie", 1], ["Religie", 1],
                ["Psihopedagogie specială", 1], ["Psihologia educației", 1], ["Didactici inovative", 1], ["Practică pedagogică", 4],
                ["Educație muzicală și plastică", 2], ["Educație fizică", 1], ["TIC", 1]
            ]);
        }
    },
    "teologic": {
        group: "vocational", label: "Teologic", hint: "teologie ortodoxă", classes: LICEU,
        subjects: ({ cls }) => {
            // Ora de religie din trunchiul comun devine disciplină teologică.
            if (cls === 9) return ix({
                drop: ["Religie"],
                add: [["Studiul Sfintei Scripturi", 2], ["Învățătura de credință ortodoxă", 1], ["Liturgică și teologie practică", 3], ["Muzică bisericească", 3],
                    ["Spiritualitate și formare duhovnicească", 1], ["Limba latină", 1], ["Limba greacă", 1]]
            });
            if (cls === 10) return withLm2(plan(X_VOC, {
                drop: ["Religie"], set: { "Limba și literatura română": 4 },
                add: [["Studiul Sfintei Scripturi", 2], ["Liturgică", 2], ["Muzică bisericească", 2], ["Învățătura de credință ortodoxă", 1],
                    ["Limba latină", 1], ["Limba greacă", 1], ["Educație muzicală", 1], ["Educație vizuală", 1]]
            }));
            return sup(cls, {
                drop: ["Religie"],
                add: [["Studiul Sfintei Scripturi", 2], ["Învățătura de credință ortodoxă", 2], ["Liturgică", 2], ["Muzică bisericească", 3], ["Istoria bisericii", 2],
                    ["Morală și spiritualitate ortodoxă", 1], ["Pastorală", 1], ["Limba latină", 1], ["Limba greacă", 1],
                    ["Educație artistică", 1], ["Educație muzicală", 1], ["Educație fizică", 1], ["TIC", 1]]
            });
        }
    },
    "tehnic": {
        group: "tehnologic", label: "Tehnic", hint: "electronică, mecanică, construcții…", classes: LICEU,
        subjects: ({ cls }) => cls === 9 ? ix({ add: TEHNOLOGIC_IX }) : cls === 10 ? TEHNOLOGIC_X("tehnic") : tehnologicSup(cls, "tehnic")
    },
    "servicii": {
        group: "tehnologic", label: "Servicii", hint: "economic, turism, comerț…", classes: LICEU,
        subjects: ({ cls }) => cls === 9 ? ix({ add: TEHNOLOGIC_IX }) : cls === 10 ? TEHNOLOGIC_X("servicii") : tehnologicSup(cls, "servicii")
    },
    "resurse": {
        group: "tehnologic", label: "Resurse naturale și protecția mediului", hint: "agricultură, alimentație, ecologie…", classes: LICEU,
        subjects: ({ cls }) => cls === 9 ? ix({ add: TEHNOLOGIC_IX }) : cls === 10 ? TEHNOLOGIC_X("resurse") : tehnologicSup(cls, "resurse")
    },
    "gimnaziu": {
        // OMENCS 3590/2016, anexa 2 (cu modificările din 2018 și 2019), în vigoare și în 2026–2027
        group: "alte", label: "Gimnaziu", hint: "clasele V–VIII", classes: [5, 6, 7, 8],
        subjects: ({ cls }) => withLm2([
            ["Limba și literatura română", 4], ["Limba engleză", 2], [LM2[0], 2],
            ...(cls === 7 ? [["Elemente de limbă latină și de cultură romanică", 1]] : []),
            ["Matematică", 4], ...(cls >= 6 ? [["Fizică", 2]] : []), ...(cls >= 7 ? [["Chimie", 2]] : []),
            ["Biologie", cls === 6 || cls === 7 ? 2 : 1],
            ["Educație socială", 1, { hint: { 5: "gândire critică și drepturile copilului", 6: "educație interculturală", 7: "educație pentru cetățenie democratică", 8: "educație economico-financiară" }[cls] }],
            ["Istorie", cls === 5 || cls === 8 ? 2 : 1], ["Geografie", cls === 8 ? 2 : 1], ["Religie", 1],
            ["Educație plastică", 1], ["Educație muzicală", 1], ["Educație fizică și sport", 2],
            ["Educație tehnologică și aplicații practice", 1], ["Informatică și TIC", 1], ["Consiliere și dezvoltare personală", 1]
        ])
    }
};

/** Ce plan stă la baza propunerii, spus pe scurt sub alegerea clasei. */
function setupPlanNote(profile, cls) {
    if (profile === "gimnaziu") return "După planul-cadru pentru gimnaziu din 2016 (OMENCS 3590/2016), încă în vigoare.";
    const group = SETUP_PROFILES[profile]?.group;
    const special = group === "vocational" || group === "tehnologic"
        ? " Orele disciplinelor de specialitate diferă de la o școală la alta: verifică-le cu orarul tău."
        : "";
    return cls === 9
        ? `Clasa a IX-a are planul-cadru nou (OMEC 4350/2025), aplicat din 2026–2027: 19 ore comune pentru toate profilurile, plus cele ale profilului tău.${special}`
        : `Clasa a ${ROMAN[cls]}-a rămâne pe planul-cadru din 2009 (OMECI 3410/2009${group === "tehnologic" ? ", 3081/2010 și 3412/2009" : ""}), cu modificările din 2023 și 2024${cls >= 11 ? (cls === 11 ? " (ora de Istoria evreilor. Holocaustul)" : " (ora de Istoria comunismului din România)") : ""}.${special}`;
}

function setupDone() {
    try { return localStorage.getItem(SETUP_DONE_KEY) === "1"; } catch (_) { return true; }
}

function markSetupDone() {
    try { localStorage.setItem(SETUP_DONE_KEY, "1"); } catch (_) { /* fără stocare: nu insistăm */ }
}

/** Asistentul apare singur doar când caietul e complet gol și nu a fost închis înainte. */
function shouldOfferSetup() {
    if (!canEdit()) return false;
    return !setupDone() && Object.keys(state.subjects).length === 0 && Object.keys(state.calendar).length === 0;
}

function openSetup(step = 0) {
    if (!requireAccount()) return;
    const s = state.settings;
    ui.setup = {
        step,
        profile: "",
        cls: 9,
        variant: "",
        lm2: s.school.lm2,
        rows: [],
        target: s.goals.targetGPA,
        risk: s.calc.riskThreshold,
        method: Object.keys(state.subjects).length ? s.calc.method : "arithmetic",
        // Datele de module modificate de mână rămân neatinse dacă elevul nu alege altă structură.
        preset: matchingModulePreset(s.modules) === "custom" ? "keep" : matchingModulePreset(s.modules),
        returnFocus: document.activeElement
    };
    // Programa aleasă înainte rămâne selectată (de ex. când elevul trece în clasa următoare)
    const mine = myProgramme();
    if (mine) {
        Object.assign(ui.setup, { profile: mine.profile, cls: mine.cls || ui.setup.cls, variant: mine.variant });
        ui.setup.rows = setupRowsFor(mine.profile, ui.setup.cls, mine.variant, ui.setup.lm2);
    }
    closeQuickAdd({ restoreFocus: false });
    closeMoreMenu({ restoreFocus: false });
    closeCmdk({ restoreFocus: false });
    closeNotifPanel({ restoreFocus: false });
    closeActionModal();
    $("setup").hidden = false;
    document.body.classList.add("modal-open");
    renderSetup();
}

function closeSetup() {
    $("setup").hidden = true;
    if ($("action-modal").hidden) document.body.classList.remove("modal-open");
    const back = ui.setup?.returnFocus;
    ui.setup = null;
    if (back && document.contains(back) && back !== document.body) back.focus();
}

/** Materiile din programa unui profil și a unei clase: [{ name, ore, hint, kind }] (kind: subject | lm2 | dirig | opt). */
function programmeRows(profile, cls, variantId, lm2 = LM2_CHOICES[0]) {
    const p = SETUP_PROFILES[profile];
    if (!p) return [];
    const variant = p.variants ? (p.variants.find(v => v.id === variantId) || p.variants[0]) : null;
    const rows = p.subjects({ cls, variant }).map(([name, ore, opt = {}]) => {
        if (DIRIG_ALIASES.includes(name)) return { name: DIRIG, ore, hint: `în planul-cadru: ${name}`, kind: "dirig", off: false };
        if (name === LM2[0]) return { name: lm2, ore, hint: "limba modernă 2: alege-o pe a ta", kind: "lm2", off: Boolean(opt.off) };
        return { name, ore, hint: opt.hint || "", kind: "subject", off: Boolean(opt.off) };
    });
    if (!rows.some(r => r.kind === "dirig")) rows.push({ name: DIRIG, ore: 1, hint: cls >= 9 ? "ora de dirigenție (de obicei fără note, nu intră în medie)" : "ora de dirigenție", kind: "dirig", off: false });
    rows.push({ name: OPT, ore: 1, hint: "maximum un opțional: scrie ce faci la ora la decizia școlii", kind: "opt", off: true });
    return rows;
}

function setupRowsFor(profile, cls, variantId, lm2) {
    return programmeRows(profile, cls, variantId, lm2).map(r => {
        const existing = r.kind === "opt" ? Object.keys(state.subjects).find(isOptionalName) : findSubjectName(r.name);
        return { ...r, on: !r.off, topic: "", exists: Boolean(existing), shown: existing || r.name };
    });
}

/** Programa salvată a elevului, sau null dacă nu și-a ales-o încă (ex. date vechi sau un backup importat). */
function myProgramme() {
    const sc = state.settings.school;
    return sc.profile && SETUP_PROFILES[sc.profile] ? sc : null;
}
function myProgrammeRows() {
    const sc = myProgramme();
    return sc ? programmeRows(sc.profile, sc.cls, sc.variant, sc.lm2) : [];
}
function programmeLabel() {
    const sc = myProgramme();
    if (!sc) return "";
    const p = SETUP_PROFILES[sc.profile];
    const variant = p.variants?.find(v => v.id === sc.variant);
    return [p.label, variant && variant.id !== p.variants[0].id ? variant.label : "", p.classes ? `clasa a ${ROMAN[sc.cls]}-a` : ""].filter(Boolean).join(" · ");
}
/** O materie e în programă? Fără programă aleasă nu judecăm (nu marcăm nimic). */
const firstOptional = () => Object.keys(state.subjects).find(isOptionalName) || null;
function inProgramme(name) {
    if (isOptionalName(name)) return !myProgramme() || firstOptional() === name; // maximum un opțional: al doilea iese din programă
    if (!myProgramme()) return true;
    const low = String(name).toLocaleLowerCase("ro");
    return myProgrammeRows().some(r => r.name.toLocaleLowerCase("ro") === low)
        || DIRIG_ALIASES.some(a => a.toLocaleLowerCase("ro") === low);
}
/** Ce mai poate adăuga: materiile din programă care lipsesc din catalog (+ opționalul, dacă nu-l are). */
function missingProgrammeRows() {
    const hasOpt = Object.keys(state.subjects).some(isOptionalName);
    return myProgrammeRows().filter(r => r.kind === "opt" ? !hasOpt : !findSubjectName(r.name) && !(r.kind === "dirig" && DIRIG_ALIASES.some(a => findSubjectName(a))));
}

/** Numele unei materii existente, fără să conteze literele mari/mici. */
function findSubjectName(name) {
    const low = String(name).trim().toLocaleLowerCase("ro");
    return Object.keys(state.subjects).find(m => m.toLocaleLowerCase("ro") === low) || null;
}

function renderSetup() {
    const st = ui.setup;
    if (!st) return;
    const steps = $("setup-steps");
    steps.innerHTML = SETUP_STEPS.map((label, i) => {
        const n = i + 1;
        const state_ = st.step === n ? "is-current" : st.step > n ? "is-done" : "";
        return `<li class="${state_}" ${st.step === n ? 'aria-current="step"' : ""}><span>${st.step > n ? icon("check") : n}</span>${label}</li>`;
    }).join("");
    steps.classList.toggle("is-hidden", st.step === 0);
    steps.setAttribute("aria-hidden", String(st.step === 0));
    const keep = st.renderedStep === st.step ? $("setup-body").scrollTop : 0;
    $("setup-body").innerHTML = [setupWelcomeHTML, setupProfileHTML, setupSubjectsHTML, setupTargetsHTML, setupTimetableHTML][st.step]();
    $("setup-foot").innerHTML = setupFootHTML();
    $("setup-body").scrollTop = keep;
    // Pas nou: de sus, cu focus pe titlu. Același pas (ex. ai ales un profil): rămâne unde erai.
    if (st.renderedStep !== st.step) {
        st.renderedStep = st.step;
        $("setup-body").scrollTop = 0;
        const focus = $("setup-body").querySelector("[data-autofocus]") || $("setup-body").querySelector("h2");
        focus?.focus({ preventScroll: true });
    }
}

function setupFootHTML() {
    const { step, profile } = ui.setup;
    if (step === 0) return "";
    const back = `<button type="button" class="btn btn-text" data-action="setup-back">${icon("undo")} Înapoi</button>`;
    if (step === 1) return `${back}<button type="button" class="btn btn-primary" data-action="setup-next" ${profile ? "" : "disabled"}>Continuă</button>`;
    if (step === 2 || step === 3) return `${back}<button type="button" class="btn btn-primary" data-action="setup-next">Continuă</button>`;
    return `${back}<span></span>`;
}

function setupWelcomeHTML() {
    const has = Object.keys(state.subjects).length > 0;
    return `
        <div class="setup-hero">
            <h2 id="setup-title" tabindex="-1">${has ? "Configurare rapidă" : "Bun venit în urNotes!"}</h2>
            <p>${has
                ? "Adaugă dintr-o dată materiile unui profil și stabilește ținta și anul școlar. Materiile și notele pe care le ai rămân neatinse."
                : "În patru pași scurți îți pregătesc materiile, ținta și anul școlar. Poți schimba orice mai târziu, din Catalog și Setări."}</p>
        </div>
        <div class="setup-me">
            <div class="setup-me-buddy" id="setup-buddy" aria-hidden="true">${setupBuddyHTML()}</div>
            <div class="setup-me-fields">
                <div class="form-group">
                    <label for="setup-me-name">Cum te cheamă?</label>
                    <input type="text" id="setup-me-name" class="glass-input" maxlength="40" autocomplete="given-name" placeholder="ex: Tudor" value="${escapeHTML(state.settings.profile.name)}">
                </div>
                <div class="form-group">
                    <label for="setup-me-buddy">Cum îl botezi pe colegul tău, post-it-ul?</label>
                    <input type="text" id="setup-me-buddy" class="glass-input" maxlength="20" autocomplete="off" placeholder="${DEFAULT_SETTINGS.profile.buddy}" value="${escapeHTML(state.settings.profile.buddy)}">
                </div>
            </div>
        </div>
        <div class="setup-choices">
            <button type="button" class="setup-choice" data-action="setup-next" data-autofocus>
                ${icon("sparkles")}<span><b>${has ? "Alege un profil" : "Încep de la zero"}</b><small>Aleg profilul, iar materiile se completează singure.</small></span>${icon("chevron", "setup-arrow")}
            </button>
            <button type="button" class="setup-choice" data-action="setup-import">
                ${icon("upload")}<span><b>Am deja un backup</b><small>Încarc fișierul .json exportat din această aplicație.</small></span>${icon("chevron", "setup-arrow")}
            </button>
        </div>`;
}

function setupBuddyHTML() {
    const who = firstName();
    return `${buddySVG("happy")}<p class="buddy-bubble is-sm"><b class="buddy-name">${escapeHTML(buddyName())}</b><span>${who ? `Încântat, ${escapeHTML(who)}!` : "Salut! Cum te cheamă?"}</span></p>`;
}

function setupProfileHTML() {
    const { profile } = ui.setup;
    return `
        <h2 id="setup-title" tabindex="-1">Ce profil ai?</h2>
        <p class="setup-lead">Îți propun materiile din planul-cadru. În pasul următor le poți bifa, redenumi și ajusta.</p>
        <div role="radiogroup" aria-labelledby="setup-title">
            ${SETUP_GROUPS.map(g => `
                <h3 class="setup-group" id="setup-g-${g.id}">${escapeHTML(g.label)}</h3>
                <div class="setup-profiles" role="group" aria-labelledby="setup-g-${g.id}">
                    ${Object.entries(SETUP_PROFILES).filter(([, p]) => p.group === g.id).map(([id, p]) => `
                        <button type="button" class="setup-profile" role="radio" aria-checked="${profile === id}" data-action="setup-profile" data-id="${id}">
                            <b>${escapeHTML(p.label)}</b><small>${escapeHTML(p.hint)}</small>
                        </button>`).join("")}
                </div>
                ${SETUP_PROFILES[profile]?.group === g.id ? setupProfileExtraHTML() : ""}`).join("")}
        </div>
`;
}

/** Sub profilul ales: clasa (gimnaziu) sau specializarea (ex. Arte vizuale), chiar în grupul lui. */
function setupProfileExtraHTML() {
    const { profile, cls, variant } = ui.setup;
    const p = SETUP_PROFILES[profile];
    if (!p || (!p.classes && !p.variants)) return "";
    const note = p.classes ? setupPlanNote(profile, cls) : "";
    return `
        <div class="setup-extra">
            ${p.classes ? `
                <div class="setup-field">
                    <span class="setup-label" id="setup-cls-label">În ce clasă ești?</span>
                    <div class="azi-seg setup-seg" role="group" aria-labelledby="setup-cls-label">
                        ${p.classes.map(c => `<button type="button" data-action="setup-class" data-cls="${c}" aria-pressed="${cls === c}">a ${ROMAN[c]}-a</button>`).join("")}
                    </div>
                </div>` : ""}
            ${p.variants ? `
                <div class="setup-field">
                    <span class="setup-label" id="setup-var-label">${escapeHTML(p.variantLabel || "Specializarea")}</span>
                    <div class="azi-seg setup-seg" role="group" aria-labelledby="setup-var-label">
                        ${p.variants.map(v => `<button type="button" data-action="setup-variant" data-variant="${v.id}" aria-pressed="${variant === v.id}">${escapeHTML(v.label)}</button>`).join("")}
                    </div>
                </div>` : ""}
            ${note ? `<p class="setup-note">${icon("info")} ${escapeHTML(note)}</p>` : ""}
        </div>`;
}

function setupSubjectsHTML() {
    const { rows } = ui.setup;
    const on = rows.filter(r => r.on && !r.exists);
    const hours = on.reduce((s, r) => s + r.ore, 0);
    return `
        <h2 id="setup-title" tabindex="-1">Materiile tale${SETUP_PROFILES[ui.setup.profile]?.classes ? ` · clasa a ${ROMAN[ui.setup.cls]}-a` : ""}</h2>
        <p class="setup-lead">Bifează ce ai în orar și corectează orele pe săptămână dacă diferă. Alege-ți limba modernă 2 și, dacă ai un opțional, scrie ce e.</p>
        <ul class="setup-rows">
            ${rows.map((r, i) => `
                <li class="setup-row ${r.on ? "" : "is-off"} ${r.exists ? "is-existing" : ""}" data-name="${escapeHTML(r.exists ? r.shown : r.name)}" data-kind="${r.kind}">
                    <input type="checkbox" class="setup-check" data-i="${i}" ${r.on ? "checked" : ""} ${r.exists ? "disabled" : ""} aria-label="${escapeHTML(`Include ${r.name}`)}">
                    <span class="setup-name-cell">
                        ${r.exists ? `<b class="setup-name-text">${escapeHTML(r.shown)}</b>`
                            : r.kind === "lm2" ? `<select class="glass-select setup-lm2" data-i="${i}" aria-label="Limba modernă 2">${LM2_CHOICES.map(l => `<option ${l === r.name ? "selected" : ""}>${escapeHTML(l)}</option>`).join("")}</select>`
                            : r.kind === "opt" ? `<span class="setup-opt"><b class="setup-name-text">${OPT}</b><input type="text" class="glass-input setup-opt-topic" data-i="${i}" value="${escapeHTML(r.topic)}" maxlength="40" placeholder="ce opțional? (ex: Educație financiară)" aria-label="Tema opționalului"></span>`
                            : `<b class="setup-name-text">${escapeHTML(r.name)}</b>`}
                        ${r.hint && !r.exists ? `<small class="setup-row-hint">${escapeHTML(r.hint)}</small>` : ""}
                    </span>
                    ${r.exists ? `<span class="setup-exists">există deja</span>` : `
                    <span class="setup-hours" role="group" aria-label="${escapeHTML(`Ore pe săptămână la ${r.name}`)}">
                        <button type="button" data-action="setup-hours" data-i="${i}" data-d="-1" aria-label="O oră mai puțin" ${r.ore <= 1 ? "disabled" : ""}>−</button>
                        <b aria-live="polite">${r.ore}</b><small>${r.ore === 1 ? "oră" : "ore"}</small>
                        <button type="button" data-action="setup-hours" data-i="${i}" data-d="1" aria-label="O oră în plus" ${r.ore >= 10 ? "disabled" : ""}>+</button>
                    </span>`}
                </li>`).join("")}
        </ul>
        <p class="setup-note">${icon("info")} ${helpDot("programme")} Lista vine din planul-cadru al clasei tale; poți scoate ce nu faci și corecta orele. Alte materii nu se pot adăuga.</p>
        <p class="setup-count">${plural(on.length, "materie nouă", "materii noi")} · ${plural(hours, "oră", "ore")} pe săptămână · Purtarea e deja în catalog</p>`;
}

function setupTargetsHTML() {
    const { target, risk, method, preset } = ui.setup;
    const chips = (action, values, current, fmt) => values.map(v => `
        <button type="button" data-action="${action}" data-v="${v}" aria-pressed="${current === v}">${fmt(v)}</button>`).join("");
    return `
        <h2 id="setup-title" tabindex="-1">Ținta și anul școlar</h2>
        <p class="setup-lead">Le folosesc pe pagina Azi, în Statistici și în Simulator.</p>
        <div class="setup-field">
            <span class="setup-label" id="setup-target-l">Ce medie generală îți dorești?</span>
            <div class="azi-seg setup-seg" role="group" aria-labelledby="setup-target-l">${chips("setup-target", [8, 8.5, 9, 9.5, 10], target, v => v.toFixed(2))}</div>
        </div>
        <div class="setup-field">
            <span class="setup-label" id="setup-risk-l">De la ce medie a unei materii să te avertizez?</span>
            <div class="azi-seg setup-seg" role="group" aria-labelledby="setup-risk-l">${chips("setup-risk", [5, 6, 7, 8, 9], risk, v => `sub ${v}`)}</div>
        </div>
        <div class="setup-field">
            <span class="setup-label" id="setup-method-l">Cum se calculează media generală?</span>
            <div class="setup-options" role="radiogroup" aria-labelledby="setup-method-l">
                <button type="button" class="setup-option" role="radio" aria-checked="${method === "arithmetic"}" data-action="setup-method" data-v="arithmetic">
                    <b>Ca în catalog</b><small>media aritmetică a mediilor pe materii (recomandat)</small>
                </button>
                <button type="button" class="setup-option" role="radio" aria-checked="${method === "weighted"}" data-action="setup-method" data-v="weighted">
                    <b>Ponderată</b><small>materiile cu mai multe ore contează mai mult</small>
                </button>
            </div>
        </div>
        <div class="setup-field">
            <label class="setup-label" for="setup-preset">Vacanța mobilă (de ea depind modulele 3 și 4)</label>
            <select id="setup-preset" class="glass-select">
                ${matchingModulePreset(state.settings.modules) === "custom" ? `<option value="keep" ${preset === "keep" ? "selected" : ""}>Păstrez datele mele (din Setări)</option>` : ""}
                ${Object.entries(MODULE_PRESETS).map(([id, p]) => `<option value="${id}" ${id === preset ? "selected" : ""}>${escapeHTML(p.label)}</option>`).join("")}
            </select>
        </div>`;
}

function setupTimetableHTML() {
    const { rows, target } = ui.setup;
    const n = rows.filter(r => r.on && !r.exists && r.name.trim()).length;
    return `
        <div class="setup-hero">
            <h2 id="setup-title" tabindex="-1">Aproape gata!</h2>
            <p>Adaug ${plural(n, "materie", "materii")}, cu ținta ${target.toFixed(2)}. Ultimul pas: orarul. Cu el, pagina Azi îți arată orele fiecărei zile, iar testele se adaugă dintr-o atingere.</p>
        </div>
        <div class="setup-choices">
            <button type="button" class="setup-choice is-primary" data-action="setup-finish" data-timetable="1" data-autofocus>
                ${icon("calendar-days")}<span><b>Completez orarul acum</b><small>durează cam două minute</small></span>${icon("chevron", "setup-arrow")}
            </button>
            <button type="button" class="setup-choice" data-action="setup-finish">
                ${icon("clock")}<span><b>Mai târziu</b><small>îl găsești pe pagina Azi și în Calendar</small></span>${icon("chevron", "setup-arrow")}
            </button>
        </div>`;
}

function validSetupPreset(value, fallback) {
    return value === "keep" || MODULE_PRESETS[value] ? value : fallback;
}

/** Verifică lista de materii înainte de pasul următor; întoarce un mesaj de eroare sau null. */
function setupRowsError() {
    const seen = new Set();
    for (const r of ui.setup.rows) {
        if (!r.on || r.exists) continue;
        const name = (r.kind === "opt" ? optionalName(r.topic) : r.name).trim().replace(/\s+/g, " ");
        if (!name) return "O materie bifată nu are nume.";
        if (name === "__proto__" || name === PURTARE_KEY || isLegacyPurtareName(name)) return "Purtarea e deja în catalog; nu o adăuga ca materie.";
        const low = name.toLocaleLowerCase("ro");
        if (seen.has(low)) return `„${name}” apare de două ori.`;
        if (findSubjectName(name)) return `Materia ${findSubjectName(name)} există deja.`;
        seen.add(low);
    }
    return null;
}

function setupNext() {
    const st = ui.setup;
    if (st.step === 1 && !st.profile) return;
    if (st.step === 2) {
        const err = setupRowsError();
        if (err) {
            showToast(`⚠️ ${err}`);
            return;
        }
    }
    if (st.step === 3) st.preset = validSetupPreset(field("setup-preset"), st.preset);
    st.step = Math.min(4, st.step + 1);
    renderSetup();
}

function finishSetup(withTimetable) {
    const st = ui.setup;
    if (!st) return;
    const added = [];
    st.rows.forEach(r => {
        const name = (r.kind === "opt" ? optionalName(r.topic) : r.name).trim().replace(/\s+/g, " ");
        if (!r.on || r.exists || !name || findSubjectName(name)) return;
        if (r.kind === "opt" && firstOptional()) return; // maximum un opțional
        // dirigenția din liceu nu are note: nu trage media în jos
        state.subjects[name] = { ore: r.ore, target: st.target, grades: [], priority: false, excludeFromGPA: r.kind === "dirig" && st.cls >= 9 };
        added.push(name);
    });
    const s = state.settings;
    if (SETUP_PROFILES[st.profile]) s.school = { profile: st.profile, cls: SETUP_PROFILES[st.profile].classes ? st.cls : 0, variant: st.variant || "", lm2: st.lm2 || LM2_CHOICES[0] };
    s.goals.targetGPA = st.target;
    s.goals.minGPA = Math.min(s.goals.minGPA, st.target);
    s.calc.riskThreshold = st.risk;
    s.calc.method = st.method;
    if (MODULE_PRESETS[st.preset]) s.modules = presetModules(st.preset);
    // Clasa aleasă ajunge și pe antetul raportului (dacă elevul nu a scris deja alta).
    if (SETUP_PROFILES[st.profile]?.classes && !s.report.cls) s.report.cls = `a ${ROMAN[st.cls]}-a`;
    addActivity(added.length ? `Configurare: ai adăugat ${plural(added.length, "materie", "materii")}.` : "Configurare: ținte și an școlar actualizate.");
    markSetupDone();
    closeSetup();
    ui.home.day = null;
    switchTab("tab-dashboard");
    refresh();
    if (withTimetable && Object.keys(state.subjects).length) {
        ui.tourAfterModal = true; // turul vine după ce închide orarul
        openTimetableModal();
    } else {
        showToast(`✅ Gata! ${added.length ? `Ai ${plural(Object.keys(state.subjects).length, "materie", "materii")} în catalog.` : "Setările au fost salvate."}`);
        setTimeout(maybeStartTour, 400);
    }
}

/* ==================== PLANUL MEU ==================== */
/*
 * Un plan de studiu pe 7 zile, făcut din ce știe deja aplicația: note și ținte, materiile la risc,
 * testele și temele din calendar, orarul. Elevul spune o singură dată cât timp are; restul e automat.
 *
 * Reguli (fără AI, merge offline):
 *   – înaintea unui test: „învață” cu ~4 zile înainte, „exersează” cu ~2 zile, „recapitulează” în ajun;
 *   – o temă: o sesiune în ziua dinainte;
 *   – o materie la risc: 2 sesiuni pe săptămână, de preferință în ajunul orei ei (din orar);
 *   – o materie sub țintă: o sesiune (două dacă e marcată prioritară);
 *   – timpul rămas: încă o recapitulare pentru materiile care au nevoie, fără să treacă de minutele zilei;
 *   – preferințele elevului: materiile „îmi place” primesc o sesiune în plus (chiar și la țintă),
 *     iar cele „doar la teste” apar în plan numai înaintea testelor (fără teme, risc sau recapitulări).
 * Planul se reface singur când se schimbă ceva (un test nou, o notă). Sesiunile bifate sau mutate de elev rămân.
 * Totul e determinist (id-uri din cerere + zi), ca două dispozitive să ajungă la același plan, fără conflicte la sincronizare.
 */
const PLAN_DAYS = 7;
const PLAN_KEEP_DAYS = 60;
const PLAN_KINDS = {
    homework: { label: "Temă", icon: "note", rank: 0 },
    review: { label: "Recapitulează", icon: "repeat", rank: 1 },
    practice: { label: "Exersează", icon: "pen", rank: 2 },
    learn: { label: "Învață", icon: "notebook", rank: 3 },
    free: { label: "Studiu", icon: "book", rank: 4 }
};
const PLAN_MINUTES = [0, 15, 30, 45, 60, 90, 120, 150, 180];
const PLAN_SESSIONS = [15, 20, 25, 30, 45, 60];
const EV_ARTICLE = { Test: "testul", Examen: "examenul", Proiect: "proiectul", Prezentare: "prezentarea", "Temă": "tema" };

function defaultPlan() {
    return { prefs: { school: 45, weekend: 60, session: 30, rest: -1, calendar: true, setup: false, subjects: {} }, items: [], removed: {}, sig: "" };
}

function sanitizePlan(raw) {
    const plan = defaultPlan();
    if (!isPlainObject(raw)) return plan;
    const pr = isPlainObject(raw.prefs) ? raw.prefs : {};
    plan.prefs = {
        school: clampInteger(pr.school, 0, 600, 45),
        weekend: clampInteger(pr.weekend, 0, 600, 60),
        session: PLAN_SESSIONS.includes(Number(pr.session)) ? Number(pr.session) : 30,
        rest: Number.isInteger(Number(pr.rest)) && Number(pr.rest) >= -1 && Number(pr.rest) <= 6 ? Number(pr.rest) : -1,
        calendar: pr.calendar !== false,
        setup: pr.setup === true,
        // Preferințele pe materii: „fav” = îmi place (mai mult timp), „tests” = doar înaintea testelor; restul = normal
        subjects: Object.fromEntries(Object.entries(isPlainObject(pr.subjects) ? pr.subjects : {})
            .filter(([mat, v]) => typeof mat === "string" && mat.trim() && mat !== "__proto__" && mat.length <= 60 && (v === "fav" || v === "tests")).slice(0, 80))
    };
    const today = getLocalDateKey();
    const cutoff = addDays(today, -PLAN_KEEP_DAYS);
    plan.items = (Array.isArray(raw.items) ? raw.items : []).filter(isPlainObject).map(it => ({
        id: String(it.id || uid()).slice(0, 200),
        date: typeof it.date === "string" && DATE_KEY_RE.test(it.date) ? it.date : "",
        mat: typeof it.mat === "string" ? it.mat.trim().slice(0, 60) : "",
        kind: PLAN_KINDS[it.kind] ? it.kind : "free",
        min: clampInteger(it.min, 5, 240, 30),
        reason: typeof it.reason === "string" ? it.reason.slice(0, 160) : "",
        done: it.done === true,
        manual: it.manual === true,
        demand: typeof it.demand === "string" ? it.demand.slice(0, 200) : ""
    })).filter(it => it.date && it.mat && it.date >= cutoff).slice(0, 600);
    plan.removed = Object.fromEntries(Object.entries(isPlainObject(raw.removed) ? raw.removed : {})
        .filter(([, until]) => typeof until === "string" && DATE_KEY_RE.test(until) && until >= today).slice(0, 300));
    plan.sig = typeof raw.sig === "string" ? raw.sig.slice(0, 40) : "";
    return plan;
}

const subjectPref = mat => state.plan.prefs.subjects[mat] || "normal";
const planDays = (today = getLocalDateKey()) => Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today, i));

/** Câte minute are elevul într-o zi: ziua liberă = 0; în vacanță și în weekend, timpul de weekend. */
function planMinutesOn(date) {
    const p = state.plan.prefs;
    const wd = parseDateKey(date).getDay();
    if (wd === p.rest) return 0;
    return isSchoolDay(date) ? p.school : p.weekend;
}

const weekdayLower = date => WEEKDAY_LONG[parseDateKey(date).getDay()].toLocaleLowerCase("ro");
function eventPhrase(type, date, from) {
    const what = EV_ARTICLE[type] || "evaluarea";
    const n = daysBetween(from, date);
    if (n === 0) return `${what} de azi`;
    if (n === 1) return `${what} de mâine`;
    const d = parseDateKey(date);
    return n <= 6 ? `${what} de ${weekdayLower(date)}` : `${what} din ${d.getDate()} ${MONTHS[d.getMonth()].toLocaleLowerCase("ro")}`;
}

function hashText(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/** Tot ce influențează planul; dacă nu s-a schimbat nimic, planul nu se reface. */
function planSignature(today) {
    const links = gradeLinks();
    const occ = occurrencesBetween(today, addDays(today, PLAN_DAYS + 4))
        .filter(o => (NEEDS_GRADE.has(o.ev.type) || o.ev.type === "Temă") && state.subjects[o.ev.subject])
        .map(o => [o.key, o.ev.type, o.ev.subject, isOccurrenceDone(o.ev, o.date, links) ? 1 : 0]);
    const subs = Object.entries(state.subjects).map(([m, s]) => [m, s.ore, s.target, s.priority ? 1 : 0, metrics.subjects[m]?.exactAvg ?? 0, s.grades.length]);
    return hashText(JSON.stringify([today, state.plan.prefs, occ, subs, state.timetable, state.settings.calc.riskThreshold, state.settings.modules, state.plan.removed]));
}

/** Cererile de studiu: ce ar trebui făcut, cu zilele potrivite în ordinea preferinței. */
function planDemands(today) {
    const S = state.plan.prefs.session;
    const half = Math.max(15, Math.round(S / 2 / 5) * 5);
    const days = planDays(today);
    const inPlan = date => date >= today && date <= days[days.length - 1];
    const links = gradeLinks();
    const out = [];
    const push = d => out.push({ ...d, candidates: d.candidates.filter(inPlan) });

    // 1. Testele (până la 10 zile înainte)
    occurrencesBetween(addDays(today, 1), addDays(today, PLAN_DAYS + 3)).forEach(o => {
        if (!NEEDS_GRADE.has(o.ev.type) || !state.subjects[o.ev.subject] || isOccurrenceDone(o.ev, o.date, links)) return;
        const D = daysBetween(today, o.date);
        const at = k => addDays(o.date, -k);
        const base = { mat: o.ev.subject, test: true };
        const why = from => `pentru ${eventPhrase(o.ev.type, o.date, from)}`;
        if (D >= 4) push({ ...base, id: `t|${o.key}|learn`, kind: "learn", min: S, prio: 100 - D, candidates: [at(4), at(3), at(5), at(2)], why });
        if (D >= 2) push({ ...base, id: `t|${o.key}|practice`, kind: "practice", min: S, prio: 101 - D, candidates: [at(2), at(3), at(1)], why });
        push({ ...base, id: `t|${o.key}|review`, kind: "review", min: D === 1 ? S : half, prio: 102 - D, candidates: [at(1), at(2)], why });
    });
    // 2. Temele (nu și la materiile „doar la teste”)
    occurrencesBetween(addDays(today, 1), addDays(today, PLAN_DAYS)).forEach(o => {
        if (o.ev.type !== "Temă" || !state.subjects[o.ev.subject] || subjectPref(o.ev.subject) === "tests" || isOccurrenceDone(o.ev, o.date, links)) return;
        const D = daysBetween(today, o.date);
        push({ id: `h|${o.key}`, mat: o.ev.subject, kind: "homework", min: S, prio: 95 - D, test: true,
            candidates: [addDays(o.date, -1), addDays(o.date, -2)], why: from => eventPhrase("Temă", o.date, from) });
    });
    // 3. Materiile la risc și cele sub țintă
    const risk = state.settings.calc.riskThreshold;
    const spread = [1, 3, 5, 0, 2, 4, 6].map(i => days[i]);
    const classEves = mat => days.filter(d => lessonsOn(addDays(d, 1)).includes(mat));
    const orderFor = mat => [...new Set([...classEves(mat), ...spread])];
    const need = [];
    statsEntries().forEach(e => {
        const pref = subjectPref(e.mat);
        if (pref === "tests") return; // elevul vrea să o învețe doar înaintea testelor
        if (e.standing.key === "risk") {
            const p = planForCondition(e.mat, d => d.exactAvg >= risk);
            need.push({ e, prio: 80 + Math.min(8, (risk - e.d.rawAvg) * 2), count: 2, why: () => `ca să ieși din risc (${p.next ? `${planPill(p).text} la următoarea notă` : `îți trebuie ${planPill(p).text}`})` });
        } else if (e.standing.key === "below") {
            need.push({ e, prio: 60 + Math.min(8, Math.max(0, targetGap(e)) * 4) + (e.sub.priority || pref === "fav" ? 8 : 0), count: e.sub.priority || pref === "fav" ? 2 : 1, why: () => `ca să ajungi la ținta de ${fmtTarget(e.sub.target)}` });
        } else if (pref === "fav") {
            need.push({ e, prio: 66, count: 1, why: () => "pentru că îți place" });
        }
    });
    need.sort((a, b) => b.prio - a.prio).forEach(n => {
        const order = orderFor(n.e.mat);
        for (let k = 1; k <= n.count; k++) {
            // a doua sesiune: pornește de la mijlocul săptămânii, ca să nu cadă lângă prima
            const cand = k === 1 ? order : [...order.slice(Math.ceil(order.length / 2)), ...order.slice(0, Math.ceil(order.length / 2))];
            push({ id: `s|${n.e.mat}|${k}`, mat: n.e.mat, kind: "practice", min: S, prio: n.prio - k, candidates: cand, why: n.why });
        }
    });
    // 4. Timp rămas: încă o recapitulare pentru cine are nevoie
    need.forEach(n => push({ id: `x|${n.e.mat}`, mat: n.e.mat, kind: "review", min: S, prio: 20 + n.prio / 10,
        candidates: [...spread].reverse(), why: () => "ca să fixezi ce ai învățat" }));
    return out.sort((a, b) => b.prio - a.prio);
}

/** Reface planul pe următoarele 7 zile; păstrează istoricul, sesiunile bifate și pe cele schimbate de elev. */
function buildPlan(today = getLocalDateKey()) {
    const p = state.plan;
    const days = planDays(today);
    const end = days[days.length - 1];
    const kept = p.items.filter(it => it.date < today || it.done || (it.manual && it.date <= end && state.subjects[it.mat]));
    const recent = addDays(today, -10);
    const satisfied = new Set(kept.filter(it => it.demand && (it.date >= today || (it.done && it.date >= recent))).map(it => it.demand));
    const cap = Object.fromEntries(days.map(d => [d, planMinutesOn(d)]));
    const busy = new Map(days.map(d => [d, new Set()]));
    kept.filter(it => it.date >= today && it.date <= end).forEach(it => {
        cap[it.date] -= it.min;
        busy.get(it.date).add(it.mat);
    });

    const fresh = [];
    planDemands(today).forEach(d => {
        if (satisfied.has(d.id) || p.removed[d.id] || !d.candidates.length) return;
        let date = d.candidates.find(c => cap[c] >= d.min && !busy.get(c).has(d.mat));
        if (!date && d.test) date = d.candidates.find(c => !busy.get(c).has(d.mat)) || d.candidates[0]; // testele încap oricum
        if (!date) return;
        cap[date] -= d.min;
        busy.get(date).add(d.mat);
        satisfied.add(d.id);
        fresh.push({ id: `${d.id}|${date}`, date, mat: d.mat, kind: d.kind, min: d.min, reason: d.why(date), done: false, manual: false, demand: d.id });
    });
    p.items = [...kept, ...fresh];
    p.sig = planSignature(today);
}

/** Apelată la fiecare calcul: reface planul doar dacă s-a schimbat ceva care îl influențează. */
function updatePlan() {
    if (!state.plan.prefs.setup) return;
    const today = getLocalDateKey();
    if (planSignature(today) !== state.plan.sig) buildPlan(today);
}

const planItemsOn = date => state.plan.items
    .filter(it => it.date === date)
    .sort((a, b) => Number(a.done) - Number(b.done) || PLAN_KINDS[a.kind].rank - PLAN_KINDS[b.kind].rank || a.mat.localeCompare(b.mat, "ro"));

/** Zile la rând cu planul făcut (zilele fără sesiuni nu rup șirul; azi nu-l rupe cât timp nu s-a terminat). */
function planStreak(today = getLocalDateKey()) {
    let count = 0;
    for (let i = 0; i < PLAN_KEEP_DAYS; i++) {
        const date = addDays(today, -i);
        const items = state.plan.items.filter(it => it.date === date);
        if (!items.length) continue;
        if (items.every(it => it.done)) count++;
        else if (i > 0) break;
    }
    return count;
}

function planWeekProgress(today = getLocalDateKey()) {
    const end = addDays(today, PLAN_DAYS - 1);
    const items = state.plan.items.filter(it => it.date >= today && it.date <= end);
    const done = items.filter(it => it.done);
    return { total: items.length, done: done.length, minutes: items.reduce((n, it) => n + it.min, 0), doneMinutes: done.reduce((n, it) => n + it.min, 0) };
}

/** Ținte pe modul: ce notă trebuie, unde, pentru materiile care au nevoie. */
function planGoals() {
    const risk = state.settings.calc.riskThreshold;
    const nextTest = mat => upcomingForSubject(mat, 6).find(ev => NEEDS_GRADE.has(ev.type));
    const goals = statsEntries()
        .filter(e => e.standing.key === "risk" || e.standing.key === "below")
        .sort((a, b) => STANDING_RANK[a.standing.key] - STANDING_RANK[b.standing.key] || a.d.rawAvg - b.d.rawAvg)
        .map(e => {
            const isRisk = e.standing.key === "risk";
            const plan = planForCondition(e.mat, isRisk ? d => d.exactAvg >= risk : d => reachesTarget(d, e.sub.target));
            return { mat: e.mat, avg: e.d.exactAvg, risk: isRisk, goal: isRisk ? `ieși din risc (${risk.toFixed(2)})` : `ajungi la ${fmtTarget(e.sub.target)}`, pill: planPill(plan), plan, test: nextTest(e.mat), testsOnly: subjectPref(e.mat) === "tests" };
        });
    Object.entries(state.subjects).forEach(([mat, sub]) => {
        const test = !sub.grades.length && nextTest(mat);
        if (test) goals.push({ mat, avg: 0, first: true, goal: "prima notă", test });
    });
    return goals;
}

/* ---------- desenare ---------- */
/** Ce faci concret într-o sesiune, pe scurt (apare și în cronometru). */
const PLAN_HOWTO = {
    learn: "Citește lecția, fă-ți o schemă și scrie 3 întrebări la care știi răspunsul.",
    practice: "Rezolvă exerciții de tipul celor de la test; verifică-te la final.",
    review: "Recapitulează schema și greșelile tale; încearcă 2–3 exerciții rapide.",
    homework: "Fă tema de la cap la coadă, apoi recitește-o o dată.",
    free: "Lucrează la ce simți că ai nevoie la materia asta."
};

function planItemHTML(it, { compact = false } = {}) {
    const k = PLAN_KINDS[it.kind];
    const id = escapeHTML(it.id);
    const label = `${it.mat}: ${k.label}, ${it.min} minute`;
    const today = getLocalDateKey();
    return `
        <li class="plan-item ${it.done ? "is-done" : ""} kind-${it.kind}">
            <label class="plan-check">
                <input type="checkbox" data-action="plan-toggle" data-id="${id}" ${it.done ? "checked" : ""} aria-label="${escapeHTML(`${it.done ? "Făcut" : "De făcut"}: ${label}`)}">
                <span class="plan-box" aria-hidden="true">${icon("check")}</span>
            </label>
            <span class="plan-main">
                <b>${escapeHTML(it.mat)}${subjectPref(it.mat) === "fav" ? ` <span class="plan-fav-star" title="Îți place">${icon("star")}</span>` : ""}</b>
                <small><span class="plan-kind">${icon(k.icon)} ${k.label}</span> · ${it.min} min</small>
                ${it.reason && !compact ? `<small class="plan-why">${icon("info")} De ce: ${escapeHTML(it.reason)}</small>` : ""}
            </span>
            ${!it.done && it.date <= addDays(today, 0) ? `<button type="button" class="btn btn-glass btn-sm plan-start" data-action="focus-start" data-id="${id}" aria-label="${escapeHTML(`Începe: ${label}`)}">${icon("timer")} <span>Începe</span></button>` : ""}
            ${compact ? "" : `
                <span class="plan-tools">
                    <button type="button" class="icon-btn btn btn-text" data-action="plan-move" data-id="${id}" aria-label="${escapeHTML(`Mută: ${label}`)}" title="Mută în altă zi">${icon("arrows-v")}</button>
                    <button type="button" class="icon-btn btn btn-text" data-action="plan-delete" data-id="${id}" aria-label="${escapeHTML(`Șterge: ${label}`)}" title="Scoate din plan">${icon("trash")}</button>
                </span>`}
        </li>`;
}

function planDayLabel(date, today) {
    const n = daysBetween(today, date);
    const wd = WEEKDAY_LONG[parseDateKey(date).getDay()];
    return n === 0 ? `Azi · ${wd}` : n === 1 ? `Mâine · ${wd}` : longDateLabel(date);
}

const PLAN_CHIPS_SCHOOL = [15, 30, 45, 60, 90];
const PLAN_CHIPS_WEEKEND = [0, 30, 60, 90, 120];
const planMinFmt = v => v === 0 ? "deloc" : v < 60 ? `${v} min` : `${Math.floor(v / 60)} h${v % 60 ? ` ${v % 60}` : ""}`;

function planPrefsHTML(prefix = "plan") {
    const p = state.plan.prefs;
    const near = (list, v) => list.reduce((best, x) => Math.abs(x - v) < Math.abs(best - v) ? x : best, list[0]);
    const chips = (name, list, value, label) => `
        <div class="plan-q">
            <span class="plan-q-label" id="${prefix}-${name}-l">${label}</span>
            <div class="plan-chips" role="radiogroup" aria-labelledby="${prefix}-${name}-l">
                ${list.map(v => `<label class="plan-chip"><input type="radio" name="${prefix}-${name}" value="${v}" ${v === near(list, value) ? "checked" : ""}><span>${planMinFmt(v)}</span></label>`).join("")}
            </div>
        </div>`;
    return `
        <div class="plan-prefs">
            ${chips("school", PLAN_CHIPS_SCHOOL, p.school, "Cât poți învăța într-o zi de școală?")}
            ${chips("weekend", PLAN_CHIPS_WEEKEND, p.weekend, "Și în weekend sau în vacanță?")}
        </div>
        <details class="plan-more">
            <summary>Mai multe opțiuni <small>(cât ține o sesiune, zi liberă, materiile preferate)</small></summary>
            <div class="plan-more-body">
                <div class="form-row">
                    <div class="form-group">
                        <label for="${prefix}-session">O sesiune durează</label>
                        <select id="${prefix}-session" class="glass-select">${PLAN_SESSIONS.map(v => `<option value="${v}" ${v === p.session ? "selected" : ""}>${v} min</option>`).join("")}</select>
                    </div>
                    <div class="form-group">
                        <label for="${prefix}-rest">Zi liberă</label>
                        <select id="${prefix}-rest" class="glass-select">
                            <option value="-1" ${p.rest === -1 ? "selected" : ""}>Fără zi liberă</option>
                            ${WEEKDAY_ORDER.map(wd => `<option value="${wd}" ${p.rest === wd ? "selected" : ""}>${WEEKDAY_LONG[wd]}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <label class="check-row plan-cal-row"><input type="checkbox" id="${prefix}-calendar" ${p.calendar ? "checked" : ""}> Arată sesiunile și în Calendar</label>
                ${planSubjectPrefsHTML(prefix)}
            </div>
        </details>`;
}

const PLAN_PREFS = [
    { v: "fav", label: "Îmi place", hint: "mai mult timp" },
    { v: "normal", label: "Normal", hint: "" },
    { v: "tests", label: "Doar la teste", hint: "" }
];

/** Ce materii îi plac elevului și pe care vrea să le învețe doar înaintea testelor. */
function planSubjectPrefsHTML(prefix) {
    const mats = Object.keys(state.subjects);
    if (!mats.length) return "";
    return `
        <fieldset class="plan-favs" id="${prefix}-favs">
            <legend>Ce materii îți plac?</legend>
            <p class="subtitle">„Îmi place” primește mai mult timp. „Doar la teste” apare în plan numai înaintea testelor.</p>
            ${mats.map((mat, i) => `
                <div class="plan-fav-row" role="radiogroup" aria-label="${escapeHTML(mat)}" data-mat="${escapeHTML(mat)}">
                    <span class="plan-fav-name">${escapeHTML(mat)}</span>
                    <span class="azi-seg plan-fav-seg">
                        ${PLAN_PREFS.map(o => `<label class="plan-fav-opt"><input type="radio" name="${prefix}-fav-${i}" value="${o.v}" ${subjectPref(mat) === o.v ? "checked" : ""}><span>${o.v === "fav" ? `${icon("star")} ` : ""}${o.label}</span></label>`).join("")}
                    </span>
                </div>`).join("")}
        </fieldset>`;
}

function readPlanPrefs(prefix = "plan") {
    const p = state.plan.prefs;
    const picked = name => document.querySelector(`input[name="${prefix}-${name}"]:checked`)?.value ?? field(`${prefix}-${name}`);
    p.school = clampInteger(picked("school"), 0, 600, p.school);
    p.weekend = clampInteger(picked("weekend"), 0, 600, p.weekend);
    p.session = PLAN_SESSIONS.includes(Number(field(`${prefix}-session`))) ? Number(field(`${prefix}-session`)) : p.session;
    const rest = Number(field(`${prefix}-rest`));
    p.rest = Number.isInteger(rest) && rest >= -1 && rest <= 6 ? rest : -1;
    p.calendar = Boolean($(`${prefix}-calendar`)?.checked);
    const subjects = {};
    document.querySelectorAll(`#${prefix}-favs .plan-fav-row`).forEach(row => {
        const v = row.querySelector("input:checked")?.value;
        if ((v === "fav" || v === "tests") && state.subjects[row.dataset.mat]) subjects[row.dataset.mat] = v;
    });
    p.subjects = subjects;
    p.setup = true;
}

function renderPlan() {
    const box = $("plan-body");
    if (!box) return;
    const p = state.plan;
    const tools = $("plan-tools");
    if (tools) tools.hidden = !p.prefs.setup;
    if (!p.prefs.setup) {
        box.innerHTML = `
            <section class="glass-card plan-setup" aria-labelledby="plan-setup-title">
                <div class="plan-setup-buddy" aria-hidden="true">${buddySVG("happy")}</div>
                <div class="plan-setup-main">
                    <h3 id="plan-setup-title">Hai să-ți facem un plan${firstName() ? `, ${escapeHTML(firstName())}` : ""}!</h3>
                    <p class="subtitle">Spune-mi cât timp ai, iar eu împart săptămâna: înainte de teste, pentru teme și pentru materiile care au nevoie de tine. Îl poți schimba oricând.</p>
                    ${planPrefsHTML("plan")}
                    <button type="button" class="btn btn-primary" data-action="plan-create">${icon("sparkles")} Fă-mi planul</button>
                </div>
            </section>`;
        return;
    }
    const today = getLocalDateKey();
    const days = planDays(today);
    if (!days.includes(ui.planDay)) ui.planDay = today;
    const sel = ui.planDay;
    const prog = planWeekProgress(today);
    const streak = planStreak(today);
    const goals = planGoals();
    const mod = moduleAt(today);
    const pct = prog.total ? Math.round(prog.done / prog.total * 100) : 0;
    const todayItems = planItemsOn(today);
    const todayDone = todayItems.filter(it => it.done).length;
    const next = todayItems.find(it => !it.done);
    const links = gradeLinks();
    const eventsOn = date => occurrencesBetween(date, date).filter(o => !isOccurrenceDone(o.ev, o.date, links));
    const ring = (done, total, size) => {
        const r = (size - 8) / 2, c = 2 * Math.PI * r, part = total ? done / total : 0;
        return `<svg class="plan-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
            <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="plan-ring-bg"/>
            <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="plan-ring-fg" stroke-dasharray="${(c * part).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
    };
    const selItems = planItemsOn(sel);
    const selMinutes = planMinutesOn(sel);
    const selEvents = eventsOn(sel);

    box.innerHTML = `
        <section class="glass-card plan-today" aria-labelledby="plan-today-title">
            <div class="plan-today-ring">${ring(todayDone, todayItems.length, 92)}<b>${todayItems.length ? `${todayDone}/${todayItems.length}` : "–"}</b></div>
            <div class="plan-today-main">
                <h3 id="plan-today-title">${todayItems.length
                    ? todayDone === todayItems.length ? `Gata pe azi${firstName() ? `, ${escapeHTML(firstName())}` : ""}! 🎉` : `Azi ai ${plural(todayItems.length - todayDone, "sesiune", "sesiuni")} (${todayItems.filter(it => !it.done).reduce((n, it) => n + it.min, 0)} min)`
                    : "Azi n-ai nimic în plan"}</h3>
                <p class="subtitle">${next
                    ? `Urmează <b>${escapeHTML(next.mat)}</b>: ${escapeHTML(PLAN_KINDS[next.kind].label.toLocaleLowerCase("ro"))}, ${next.min} min${next.reason ? `, ${escapeHTML(next.reason)}` : ""}.`
                    : todayItems.length ? "Ai bifat tot. Restul zilei e al tău." : "Timp liber sau de citit ce-ți place."}</p>
                <div class="plan-today-actions">
                    ${next ? `<button type="button" class="btn btn-primary" data-action="focus-start" data-id="${escapeHTML(next.id)}">${icon("timer")} Începe acum · ${next.min} min</button>` : ""}
                    <span class="plan-chip-stat" title="Zile la rând în care ai bifat tot">${icon("flame")} ${plural(streak, "zi", "zile")} la rând</span>
                    <span class="plan-chip-stat" title="Cât din săptămână ai făcut">${icon("trend-up")} ${pct}% din săptămână</span>
                </div>
            </div>
        </section>

        <nav class="plan-strip" aria-label="Zilele săptămânii">
            ${days.map(date => {
                const items = planItemsOn(date);
                const used = items.reduce((n, it) => n + it.min, 0);
                const minutes = planMinutesOn(date);
                const load = minutes ? Math.min(1, used / minutes) : 0;
                const done = items.length && items.every(it => it.done);
                const tests = eventsOn(date).filter(o => NEEDS_GRADE.has(o.ev.type)).length;
                const d = parseDateKey(date);
                return `
                <button type="button" class="plan-strip-day ${date === sel ? "is-on" : ""} ${date === today ? "is-today" : ""} ${done ? "is-done" : ""} ${minutes === 0 ? "is-rest" : ""}" data-action="plan-day" data-date="${date}" aria-pressed="${date === sel}" aria-label="${escapeHTML(`${planDayLabel(date, today)}: ${items.length ? `${plural(items.length, "sesiune", "sesiuni")}, ${used} minute` : minutes === 0 ? "zi liberă" : "nimic programat"}${tests ? `, ${plural(tests, "test", "teste")}` : ""}`)}">
                    <span class="plan-strip-wd">${date === today ? "Azi" : WEEKDAY_SHORT[d.getDay()]}</span>
                    <b class="plan-strip-n">${d.getDate()}</b>
                    <span class="plan-strip-load" aria-hidden="true"><i style="height:${Math.round(load * 100)}%"></i></span>
                    <span class="plan-strip-meta" aria-hidden="true">${done ? icon("check") : items.length ? `${used}′` : minutes === 0 ? "liber" : "–"}</span>
                    ${tests ? `<span class="plan-strip-test" aria-hidden="true" title="test">${tests}</span>` : ""}
                </button>`;
            }).join("")}
        </nav>

        <div class="plan-grid">
            <section class="glass-card plan-week" aria-labelledby="plan-day-title">
                <div class="azi-card-head"><h3 id="plan-day-title">${icon("calendar-check")} ${escapeHTML(planDayLabel(sel, today))}</h3>
                    <span class="cat-count">${selMinutes === 0 && !selItems.length ? "zi liberă" : `${selItems.reduce((n, it) => n + it.min, 0)} din ${selMinutes} min`}</span></div>
                ${selEvents.length ? `<p class="plan-day-events">${icon("flag")} În ziua asta: ${selEvents.map(o => escapeHTML(o.ev.title || o.ev.type)).join(", ")}</p>` : ""}
                ${selItems.length ? `<ul class="plan-list">${selItems.map(it => planItemHTML(it)).join("")}</ul>`
                    : `<p class="plan-empty">${selMinutes === 0 ? "Zi liberă: odihnește-te, îți prinde bine." : "Nimic programat: timp liber sau de citit ce-ți place."}</p>`}
                <button type="button" class="btn btn-text btn-sm plan-add-here" data-action="plan-add" data-date="${sel}">${icon("plus")} Adaugă o sesiune în ziua asta</button>
            </section>
            <div class="plan-side">
                <section class="glass-card plan-goals" aria-labelledby="plan-goals-title">
                    <div class="azi-card-head"><h3 id="plan-goals-title">${icon("target")} Ținte pe modul ${helpDot("target")}</h3></div>
                    ${mod ? `<p class="subtitle">Până la sfârșitul modulului ${mod.n} (${escapeHTML(longDateLabel(mod.end).split(", ")[1])}).</p>` : ""}
                    ${goals.length ? `<ul class="plan-goal-list">${goals.map(g => `
                        <li><button type="button" class="azi-watch-row" data-action="open-subject" data-mat="${escapeHTML(g.mat)}">
                            <span class="azi-watch-main"><b>${escapeHTML(g.mat)}</b>
                                <small>${g.first
                                    ? `Prima notă: ${escapeHTML(eventPhrase(g.test.type, g.test.date, today))}.`
                                    : `Ca să ${escapeHTML(g.goal)}: ${g.plan.next ? `<span class="azi-need is-${g.pill.tone}">${escapeHTML(g.pill.text)}</span> la următoarea notă` : `<span class="azi-need is-${g.pill.tone}">${escapeHTML(g.pill.text)}</span>`}${g.test ? ` (${escapeHTML(eventPhrase(g.test.type, g.test.date, today))})` : ""}.${g.testsOnly ? ` <span class="plan-goal-note">Planific doar înaintea testelor.</span>` : ""}`}</small>
                            </span>
                            ${g.first ? "" : `<span class="azi-lesson-avg tone-${gradeTone(g.avg)}">${g.avg.toFixed(2)}</span>`}
                        </button></li>`).join("")}</ul>`
                        : emptyNote(Object.keys(state.subjects).length ? "Toate materiile sunt la țintă. Planul se ocupă doar de teste și teme." : "Adaugă-ți materiile ca să-ți pot face ținte.")}
                </section>
                <details class="glass-card plan-how">
                    <summary>${icon("bulb")} Cum îți fac planul?</summary>
                    <ul>
                        <li><b>Înainte de un test:</b> învăți cu ~4 zile înainte, exersezi cu 2 zile înainte și recapitulezi în ajun.</li>
                        <li><b>O temă:</b> o sesiune în ziua dinainte.</li>
                        <li><b>O materie la risc:</b> 2 sesiuni pe săptămână, de preferat în ajunul orei ei.</li>
                        <li><b>Sub țintă:</b> o sesiune pe săptămână (două dacă e prioritară).</li>
                        <li>Nu trec niciodată de timpul pe care mi l-ai dat. Ce bifezi sau muți rămâne cum ai lăsat.</li>
                    </ul>
                </details>
            </div>
        </div>`;
}

/** Cardul „Planul de azi” de pe pagina Azi. */
function homePlanHTML(today) {
    if (!state.plan.prefs.setup) {
        return `
            ${homeCardHead("azi-plan-title", "calendar-check", "Planul de azi")}
            <p class="azi-more-line">Spune-mi cât timp ai de învățat și îți împart săptămâna pe teste, teme și materiile care au nevoie.</p>
            <button type="button" class="btn btn-primary btn-sm" data-action="nav" data-tab="tab-plan">${icon("sparkles")} Fă-ți un plan</button>`;
    }
    const items = planItemsOn(today);
    const done = items.filter(it => it.done).length;
    const next = items.length ? null : state.plan.items.filter(it => it.date > today && !it.done).sort((a, b) => a.date.localeCompare(b.date))[0];
    return `
        ${homeCardHead("azi-plan-title", "calendar-check", "Planul de azi", items.length ? `<span class="cat-count">${done} din ${items.length}</span>` : "")}
        ${items.length
            ? `<ul class="plan-list is-compact">${items.map(it => planItemHTML(it, { compact: true })).join("")}</ul>
               ${done === items.length ? `<p class="plan-done-line">${icon("check-circle")} Gata pe azi! ${planStreak(today) > 1 ? `${planStreak(today)} zile la rând.` : ""}</p>` : ""}`
            : `<p class="azi-more-line">Azi n-ai nimic în plan.${next ? ` Următoarea sesiune: ${escapeHTML(next.mat)}, ${escapeHTML(relativeDay(next.date))}.` : ""}</p>`}
        <button type="button" class="btn btn-text btn-sm" data-action="nav" data-tab="tab-plan">${icon("calendar-check")} Tot planul</button>`;
}

/* ---------- cronometrul de concentrare ---------- */
/* „Începe” deschide un cronometru pentru sesiune; la final (sau cu „Am terminat”) sesiunea se bifează.
   Ecranul telefonului rămâne aprins cât merge cronometrul (unde browserul permite). */
const focusRun = { it: null, total: 0, startedAt: 0, elapsed: 0, paused: false, timer: 0, wake: null, title: "" };

function startFocus(id) {
    const it = findPlanItem(id);
    if (!it || it.done) return;
    const k = PLAN_KINDS[it.kind];
    Object.assign(focusRun, { it, total: it.min * 60000, startedAt: Date.now(), elapsed: 0, paused: false, title: document.title });
    openModal({
        title: `${it.mat} · ${k.label}`,
        confirmText: "Am terminat",
        cancelText: "Renunț",
        body: `
            <div class="focus" id="focus-timer">
                <div class="focus-dial">
                    <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="88" class="focus-bg"/><circle cx="100" cy="100" r="88" class="focus-fg" id="focus-arc" transform="rotate(-90 100 100)"/></svg>
                    <div class="focus-time"><b id="focus-left" role="timer" aria-live="off">${it.min}:00</b><small id="focus-state">rămase</small></div>
                </div>
                <p class="focus-how">${icon(k.icon)} ${escapeHTML(PLAN_HOWTO[it.kind] || PLAN_HOWTO.free)}</p>
                ${it.reason ? `<p class="focus-why">De ce acum: ${escapeHTML(it.reason)}</p>` : ""}
                <div class="focus-tools">
                    <button type="button" class="btn btn-glass" data-action="focus-pause" id="focus-pause">${icon("clock")} Pauză</button>
                    <button type="button" class="btn btn-glass" data-action="focus-more">${icon("plus")} 5 min</button>
                </div>
                <p class="focus-tip">Pune telefonul cu ecranul în jos și nu te uita la notificări până la final. Poți închide fereastra oricând.</p>
            </div>`,
        onConfirm: () => finishFocus(true)
    });
    if (!$("focus-timer")) return; // (vizitator: s-a deschis autentificarea)
    clearInterval(focusRun.timer);
    focusRun.timer = setInterval(tickFocus, 500);
    tickFocus();
    navigator.wakeLock?.request?.("screen").then(lock => { focusRun.wake = lock; }).catch(() => {});
}

function focusLeft() {
    const ran = focusRun.elapsed + (focusRun.paused ? 0 : Date.now() - focusRun.startedAt);
    return Math.max(0, focusRun.total - ran);
}

function tickFocus() {
    const box = $("focus-timer");
    if (!box || !focusRun.it) { stopFocus(); return; }
    const left = focusLeft();
    const m = Math.floor(left / 60000), sec = Math.floor(left % 60000 / 1000);
    const text = `${m}:${String(sec).padStart(2, "0")}`;
    $("focus-left").textContent = text;
    const c = 2 * Math.PI * 88;
    $("focus-arc").setAttribute("stroke-dasharray", `${(c * (1 - left / focusRun.total)).toFixed(1)} ${c.toFixed(1)}`);
    document.title = `${focusRun.paused ? "⏸" : "⏱"} ${text} · ${focusRun.it.mat}`;
    if (left <= 0) finishFocus(true, { auto: true });
}

function toggleFocusPause() {
    if (!focusRun.it) return;
    if (focusRun.paused) { focusRun.startedAt = Date.now(); focusRun.paused = false; }
    else { focusRun.elapsed += Date.now() - focusRun.startedAt; focusRun.paused = true; }
    $("focus-pause").innerHTML = focusRun.paused ? `${icon("timer")} Continuă` : `${icon("clock")} Pauză`;
    $("focus-state").textContent = focusRun.paused ? "în pauză" : "rămase";
    tickFocus();
}

function stopFocus() {
    clearInterval(focusRun.timer);
    focusRun.timer = 0;
    if (focusRun.title) document.title = focusRun.title;
    focusRun.wake?.release?.().catch?.(() => {});
    focusRun.wake = null;
    focusRun.it = null;
}

function finishFocus(done, { auto = false } = {}) {
    const it = focusRun.it;
    stopFocus();
    closeActionModal();
    if (!it || !done || !findPlanItem(it.id)) return;
    it.done = true;
    refresh();
    const today = getLocalDateKey();
    const left = state.plan.items.filter(x => x.date === today && !x.done);
    buddyReact(left.length ? "happy" : "love");
    if (auto) { try { navigator.vibrate?.([120, 80, 120]); } catch (_) { /* fără vibrație */ } }
    showToast(left.length ? `✅ Bravo! ${it.mat} e bifată. Mai ai ${plural(left.length, "sesiune", "sesiuni")} azi.` : "🎉 Gata planul de azi!");
}

/* ---------- acțiuni ---------- */
const findPlanItem = id => state.plan.items.find(it => it.id === id);

function togglePlanItem(el) {
    const it = findPlanItem(el.dataset.id);
    if (!it) return;
    it.done = Boolean(el.checked);
    const today = getLocalDateKey();
    const todays = state.plan.items.filter(x => x.date === today);
    refresh();
    if (it.done && it.date === today) buddyReact(todays.every(x => x.done) ? "love" : "giggle");
    // focusul rămâne pe aceeași bifă după redesenare
    document.querySelector(`[data-action="plan-toggle"][data-id="${CSS.escape(it.id)}"]`)?.focus();
}

function openPlanMove(id) {
    const it = findPlanItem(id);
    if (!it) return;
    const today = getLocalDateKey();
    openModal({
        title: `Mută: ${it.mat}`,
        confirmText: "",
        cancelText: "Renunță",
        body: `
            <p class="modal-hint">În ce zi vrei să faci sesiunea „${escapeHTML(PLAN_KINDS[it.kind].label)}” (${it.min} min)?</p>
            <div class="plan-move-days">
                ${planDays(today).map(d => `<button type="button" class="btn ${d === it.date ? "btn-primary" : "btn-glass"}" data-action="plan-move-to" data-id="${escapeHTML(it.id)}" data-date="${d}" ${d === it.date ? 'aria-current="true"' : ""}>${escapeHTML(planDayLabel(d, today))}</button>`).join("")}
            </div>`
    });
}

function movePlanItem(id, date) {
    const it = findPlanItem(id);
    if (!it || !DATE_KEY_RE.test(date)) return;
    it.date = date;
    it.manual = true;
    closeActionModal();
    refresh();
    showToast(`Am mutat ${it.mat} pe ${planDayLabel(date, getLocalDateKey()).toLocaleLowerCase("ro")}.`);
}

function deletePlanItem(id) {
    const it = findPlanItem(id);
    if (!it) return;
    withUndo(`Am scos ${it.mat} din plan.`, () => {
        state.plan.items = state.plan.items.filter(x => x !== it);
        if (it.demand) state.plan.removed[it.demand] = addDays(getLocalDateKey(), PLAN_DAYS); // nu-l pune la loc săptămâna asta
    });
}

function openPlanAdd(preDate = "") {
    const mats = Object.keys(state.subjects);
    if (!mats.length) {
        showToast("⚠️ Adaugă întâi o materie în catalog.");
        return;
    }
    const today = getLocalDateKey();
    openModal({
        title: "Adaugă o sesiune",
        confirmText: "Adaugă",
        body: `
            <div class="form-group"><label for="plan-add-mat">Materia</label>
                <select id="plan-add-mat" class="glass-select">${mats.map(m => `<option>${escapeHTML(m)}</option>`).join("")}</select></div>
            <div class="form-group"><label for="plan-add-day">Ziua</label>
                <select id="plan-add-day" class="glass-select">${planDays(today).map(d => `<option value="${d}" ${d === preDate ? "selected" : ""}>${escapeHTML(planDayLabel(d, today))}</option>`).join("")}</select></div>
            <div class="form-group"><label for="plan-add-kind">Ce faci</label>
                <select id="plan-add-kind" class="glass-select">${Object.entries(PLAN_KINDS).map(([k, v]) => `<option value="${k}" ${k === "practice" ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
            <div class="form-group"><label for="plan-add-min">Cât timp</label>
                <select id="plan-add-min" class="glass-select">${PLAN_SESSIONS.map(v => `<option value="${v}" ${v === state.plan.prefs.session ? "selected" : ""}>${v} min</option>`).join("")}</select></div>`,
        onConfirm: () => {
            const mat = field("plan-add-mat");
            const date = field("plan-add-day");
            if (!state.subjects[mat] || !DATE_KEY_RE.test(date)) return;
            const kind = PLAN_KINDS[field("plan-add-kind")] ? field("plan-add-kind") : "practice";
            state.plan.items.push({ id: `m|${uid()}`, date, mat, kind, min: clampInteger(field("plan-add-min"), 5, 240, 30), reason: "adăugată de tine", done: false, manual: true, demand: "" });
            closeActionModal();
            refresh();
            showToast(`✅ Am pus ${mat} în plan.`);
        }
    });
}

function openPlanPrefs() {
    openModal({
        title: "Timpul și materiile tale",
        confirmText: "Salvează și refă planul",
        body: planPrefsHTML("planm"),
        onConfirm: () => {
            readPlanPrefs("planm");
            closeActionModal();
            rebuildPlanNow();
        }
    });
}

function rebuildPlanNow() {
    // Refacerea de mână pune la loc și ce ai scos din plan săptămâna asta (dar nu atinge ce ai bifat sau mutat).
    state.plan.removed = {};
    buildPlan();
    refresh();
    showToast("✅ Planul a fost refăcut.");
}

/** Mascota reacționează scurt (fără text) — ex. când bifezi o sesiune. */
function buddyReact(mood) {
    const btn = document.querySelector("#azi-buddy .buddy-poke");
    if (!btn) return;
    btn.innerHTML = buddySVG(mood);
    clearTimeout(buddyPoke.timer);
    buddyPoke.timer = setTimeout(() => {
        if (buddyPoke.rest && document.contains(btn)) btn.innerHTML = buddySVG(buddyPoke.rest.mood);
    }, 3500);
}

const PLAN_ACTIONS = {
    "plan-toggle": el => togglePlanItem(el),
    "plan-move": el => openPlanMove(el.dataset.id),
    "plan-move-to": el => movePlanItem(el.dataset.id, el.dataset.date),
    "plan-delete": el => deletePlanItem(el.dataset.id),
    "plan-add": el => openPlanAdd(el?.dataset?.date || ""),
    "plan-day": el => {
        ui.planDay = el.dataset.date;
        renderPlan();
        document.querySelector(`.plan-strip-day[data-date="${el.dataset.date}"]`)?.focus({ preventScroll: true });
    },
    "focus-start": el => startFocus(el.dataset.id),
    "focus-pause": () => toggleFocusPause(),
    "focus-more": () => { if (focusRun.it) { focusRun.total += 5 * 60000; tickFocus(); } },
    "plan-prefs": () => openPlanPrefs(),
    "plan-rebuild": () => rebuildPlanNow(),
    "plan-create": () => {
        readPlanPrefs("plan");
        buildPlan();
        refresh();
        const n = planWeekProgress().total;
        showToast(n ? `✅ Gata! Ți-am pus ${plural(n, "sesiune", "sesiuni")} în următoarele 7 zile.` : "✅ Planul e gata. Momentan nu e nimic urgent de pus în el.");
        buddyReact("love");
    }
};

/* ==================== INSULA (doar pe iPhone-urile cu Dynamic Island) ==================== */
/* O „activitate live” care coboară din insula telefonului: mic, arată fața mascotei și un singur lucru
   (planul de azi, următorul test sau media); la o notă nouă sau la o sesiune bifată se deschide singură
   o clipă, iar la atingere arată un mini-rezumat. Pe alte telefoane și pe calculator nu există. */

/** Ecranele (în puncte, portret) ale iPhone-urilor cu Dynamic Island: 14 Pro/Pro Max, 15, 16, 17 și Air. */
const ISLAND_SCREENS = new Set(["393x852", "430x932", "402x874", "440x956", "420x912"]);
const island = { on: false, open: "", timer: null, snap: null, haptic: null };

function detectDynamicIsland() {
    if (/[?&]insula=1\b/.test(location.search)) return true; // previzualizare pe orice ecran
    const ua = navigator.userAgent || "";
    if (!/iPhone/.test(ua) || /iPad|Macintosh/.test(ua)) return false;
    const w = Math.min(screen.width, screen.height);
    const h = Math.max(screen.width, screen.height);
    return ISLAND_SCREENS.has(`${w}x${h}`);
}

function islandEnabled() {
    return island.supported && state.settings.appearance.island !== "off";
}

/** O vibrație scurtă pe iPhone (iOS 18+): Safari o dă când se apasă eticheta unui comutator. Doar în urma unei atingeri. */
function islandHaptic() {
    if (!island.haptic) {
        const label = document.createElement("label");
        label.className = "island-haptic";
        label.setAttribute("aria-hidden", "true");
        label.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        label.addEventListener("click", event => event.stopPropagation());
        document.body.append(label);
        island.haptic = label;
    }
    try { island.haptic.click(); } catch { /* fără vibrație, nicio problemă */ }
}

function islandData() {
    const today = getLocalDateKey();
    const links = gradeLinks();
    const next = occurrencesBetween(today, addDays(today, 21))
        .find(o => NEEDS_GRADE.has(o.ev.type) && !isOccurrenceDone(o.ev, o.date, links));
    const plan = state.plan.prefs.setup ? state.plan.items.filter(it => it.date === today) : [];
    const done = plan.filter(it => it.done).length;
    return { today, next, plan, done, avg: metrics.totalGrades > 0 ? metrics.globalAvg : null };
}

function islandRing(done, total, size = 18) {
    const r = (size - 3) / 2;
    const c = 2 * Math.PI * r;
    const part = total ? done / total : 0;
    return `<svg class="island-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="island-ring-bg"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="island-ring-fg" stroke-dasharray="${(c * part).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
}

const islandDays = n => n === 0 ? "azi" : n === 1 ? "mâine" : `${n} zile`;

/** Partea mică: fața mascotei + un singur lucru, cel mai util acum. */
function islandCompact(d) {
    if (d.plan.length && d.done < d.plan.length) {
        return { mood: "focused", html: `${islandRing(d.done, d.plan.length)}<span>${d.done}/${d.plan.length}</span>`, label: `Planul de azi: ${d.done} din ${d.plan.length}` };
    }
    if (d.next && daysBetween(d.today, d.next.date) <= 3) {
        const n = daysBetween(d.today, d.next.date);
        return { mood: n <= 1 ? "worried" : "focused", html: `${icon("calendar")}<span>${islandDays(n)}</span>`, label: `${d.next.ev.title || d.next.ev.type}: ${islandDays(n)}` };
    }
    if (d.plan.length) return { mood: "love", html: `${icon("check")}<span>gata</span>`, label: "Planul de azi e gata" };
    if (d.avg !== null) return { mood: d.avg >= 9 ? "happy" : "focused", html: `<span class="tone-${gradeTone(d.avg)}">${formatAvg(d.avg)}</span>`, label: `Media generală ${formatAvg(d.avg)}` };
    return { mood: "happy", html: "<span>urNotes</span>", label: "urNotes" };
}

function renderIsland() {
    const box = $("island");
    if (!box) return;
    if (!islandEnabled()) {
        box.hidden = true;
        document.body.classList.remove("has-island");
        return;
    }
    document.body.classList.add("has-island");
    box.hidden = false;
    if (island.open) return; // conținutul deschis rămâne până se strânge
    const c = islandCompact(islandData());
    box.className = "island";
    box.innerHTML = `
        <button type="button" class="island-pill" aria-expanded="false" aria-label="${escapeHTML(`${c.label}. Atinge pentru rezumat`)}">
            <span class="island-face" aria-hidden="true">${buddySVG(c.mood)}</span>
            <span class="island-compact">${c.html}</span>
        </button>`;
}

function collapseIsland() {
    if (!island.open) return;
    clearTimeout(island.timer);
    island.open = "";
    const box = $("island");
    box.classList.add("is-closing");
    box.classList.remove("is-open");
    setTimeout(() => { box.classList.remove("is-closing"); renderIsland(); }, 260);
}

function openIsland(kind, html, { auto = 0 } = {}) {
    const box = $("island");
    if (!box || !islandEnabled() || document.body.classList.contains("modal-open") && kind === "summary") return;
    clearTimeout(island.timer);
    island.open = kind;
    box.className = `island is-open is-${kind}`;
    box.innerHTML = `<div class="island-panel" role="${kind === "summary" ? "dialog" : "status"}" aria-label="urNotes">${html}</div>`;
    if (kind === "summary") box.querySelector("[data-island-go]")?.focus({ preventScroll: true });
    if (auto) island.timer = setTimeout(collapseIsland, auto);
}

function islandEventHTML({ mood, title, sub, big, bigTone = "", ring = null }) {
    return `
        <div class="island-event">
            <span class="island-face is-big" aria-hidden="true">${buddySVG(mood)}</span>
            <span class="island-ev-text"><b>${escapeHTML(title)}</b>${sub ? `<small>${escapeHTML(sub)}</small>` : ""}</span>
            ${ring ? `<span class="island-big-ring">${islandRing(ring[0], ring[1], 38)}<b>${ring[0]}/${ring[1]}</b></span>` : `<b class="island-big ${bigTone}">${escapeHTML(big)}</b>`}
        </div>`;
}

function openIslandSummary() {
    const d = islandData();
    const name = firstName();
    const n = d.next ? daysBetween(d.today, d.next.date) : null;
    const left = d.plan.filter(it => !it.done).map(it => it.mat);
    const rows = [
        d.next && `<button type="button" class="island-row" data-island-go="calendar" data-date="${d.next.date}">
            ${icon("calendar")}<span><b>${escapeHTML(d.next.ev.title || d.next.ev.type)}</b><small>${escapeHTML(capitalize(eventPhrase(d.next.ev.type, d.next.date, d.today)))}${d.next.ev.subject ? ` · ${escapeHTML(d.next.ev.subject)}` : ""}</small></span>
            <em class="${n <= 1 ? "is-hot" : ""}">${islandDays(n)}</em></button>`,
        state.plan.prefs.setup && `<button type="button" class="island-row" data-island-go="tab-plan">
            ${islandRing(d.done, d.plan.length || 1, 18)}<span><b>Planul de azi</b><small>${d.plan.length ? (left.length ? `Mai ai: ${escapeHTML(left.join(", "))}` : "Gata pe azi!") : "Nimic programat azi"}</small></span>
            <em>${d.done}/${d.plan.length}</em></button>`,
        `<button type="button" class="island-row" data-island-go="tab-statistici">
            ${icon("chart")}<span><b>Media generală</b><small>${metrics.riskCount ? `${plural(metrics.riskCount, "materie", "materii")} la risc` : "nicio materie la risc"}</small></span>
            <em class="${d.avg !== null ? `tone-${gradeTone(d.avg)}` : ""}">${d.avg !== null ? formatAvg(d.avg) : "–"}</em></button>`
    ].filter(Boolean).join("");
    openIsland("summary", `
        <div class="island-head">
            <span class="island-face is-big" aria-hidden="true">${buddySVG("happy")}</span>
            <span class="island-ev-text"><b>${escapeHTML(name ? `Salut, ${name}!` : "Salut!")}</b><small>${escapeHTML(buddyName())} îți ține evidența</small></span>
            <button type="button" class="island-close" data-island-close aria-label="Strânge">${icon("chevron", "is-up")}</button>
        </div>
        <div class="island-rows">${rows}</div>`);
}

/** Apelat la fiecare redesenare: observă o notă nouă sau o sesiune bifată și deschide insula o clipă. */
function islandAfterRefresh() {
    if (!island.supported) return;
    const counts = Object.fromEntries(Object.entries(state.subjects).map(([m, s]) => [m, s.grades.length]));
    const today = getLocalDateKey();
    const plan = state.plan.prefs.setup ? state.plan.items.filter(it => it.date === today) : [];
    const snap = { counts, total: metrics.totalGrades, avg: metrics.globalAvg, done: plan.filter(it => it.done).length, len: plan.length };
    const prev = island.snap;
    island.snap = snap;
    renderIsland();
    if (!prev || !islandEnabled()) return;
    const grew = Object.keys(counts).filter(m => counts[m] === (prev.counts[m] ?? 0) + 1);
    const same = Object.keys(counts).every(m => grew.includes(m) || counts[m] === prev.counts[m]);
    if (grew.length === 1 && same && grew[0] in prev.counts) {
        const mat = grew[0];
        const g = state.subjects[mat].grades.at(-1);
        const val = Number(g.val);
        const mood = val >= 9 ? "love" : val >= 7 ? "happy" : val >= 5 ? "surprised" : "worried";
        const sub = prev.total ? `Media ${formatAvg(prev.avg)} → ${formatAvg(snap.avg)}` : `Prima notă! Media ${formatAvg(snap.avg)}`;
        openIsland("event", islandEventHTML({ mood, title: `Notă nouă · ${mat}`, sub, big: String(val), bigTone: `tone-${gradeTone(val)}` }), { auto: 4200 });
        islandHaptic();
    } else if (snap.len && snap.len === prev.len && snap.done === prev.done + 1) {
        const all = snap.done === snap.len;
        const left = plan.filter(it => !it.done).map(it => it.mat);
        openIsland("event", islandEventHTML({
            mood: all ? "love" : "giggle",
            title: all ? "Planul de azi e gata!" : "Sesiune bifată",
            sub: all ? "Bravo, ai terminat tot ce era azi" : `Mai ai: ${left.join(", ")}`,
            ring: [snap.done, snap.len]
        }), { auto: 3600 });
        islandHaptic();
    }
}

function bindIsland() {
    island.supported = detectDynamicIsland();
    const box = $("island");
    if (!island.supported || !box) return;
    $("set-island-group")?.removeAttribute("hidden");
    box.addEventListener("click", event => {
        if (event.target.closest(".island-pill")) { islandHaptic(); openIslandSummary(); return; }
        if (event.target.closest("[data-island-close]")) { collapseIsland(); box.querySelector(".island-pill")?.focus(); return; }
        const go = event.target.closest("[data-island-go]");
        if (go) {
            collapseIsland();
            if (go.dataset.islandGo === "calendar") showDateInCalendar(go.dataset.date);
            else switchTab(go.dataset.islandGo);
            return;
        }
        if (island.open === "event") collapseIsland(); // o atingere pe notificare o strânge
    });
    const outside = event => { if (island.open && !box.contains(event.target)) collapseIsland(); };
    document.addEventListener("touchstart", outside, { passive: true });
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", event => { if (event.key === "Escape" && island.open === "summary") { collapseIsland(); box.querySelector(".island-pill")?.focus(); } });
    let y = scrollY;
    addEventListener("scroll", () => { if (Math.abs(scrollY - y) > 60) { y = scrollY; if (island.open === "summary") collapseIsland(); } }, { passive: true });
    islandAfterRefresh();
}

/* ==================== TUR GHIDAT (pentru cei noi) ==================== */
/*
 * Mascota îl plimbă pe elev prin aplicație: un „reflector” peste fiecare zonă importantă
 * și un bilețel cu explicația. Pornește singur o dată, după configurare; se poate relua din Setări,
 * din „Mai mult” sau din căutare. Pașii ale căror ținte nu sunt pe ecran (ex. pe telefon) se sar.
 */
const TOUR_DONE_KEY = "pro_tour_done_v4";
const tour = { open: false, i: 0, steps: [], returnFocus: null };
const isPhoneLayout = () => Boolean(window.matchMedia?.("(max-width: 900px)").matches);
const navSel = tab => isPhoneLayout() ? `.mobile-nav-btn[data-tab="${tab}"]` : `.side-link[data-tab="${tab}"]`;

function tourSteps() {
    const name = firstName();
    const hey = name ? `, ${name}` : "";
    const phone = isPhoneLayout();
    return [
        { text: `Salut${hey}! Eu sunt ${buddyName()}, colegul tău de bancă. În mai puțin de un minut îți arăt cum merge urNotes.` },
        { target: ".azi-head-text", text: "Asta e pagina Azi. În fiecare zi găsești aici ce ore ai, ce teste urmează și ce note mai aștepți." },
        { target: phone ? "#azi-plan" : navSel("tab-plan"), text: "La „Plan” îți fac un program de învățat pe 7 zile: înainte de teste, pentru teme și pentru materiile care au nevoie. Tu bifezi ce ai făcut." },
        { target: phone ? ".mobile-add" : "#quick-add-btn", text: `Cu „Adaugă” pui o notă, un test, o temă sau o materie nouă.${phone ? "" : " Merge și tasta N."}` },
        { target: navSel("tab-catalog"), text: "În Catalog ai toate materiile, cu notele și mediile lor. Deschide o materie ca să vezi ce notă îți trebuie ca să-ți atingi ținta." },
        { target: navSel("tab-calendar"), text: "Calendarul ține testele, tezele și temele. Când primești nota, o treci direct din calendar." },
        { target: navSel("tab-statistici"), text: "La Statistici vezi cum evoluează media: pe materii, pe module și pe zile ale săptămânii." },
        phone
            ? { target: "#more-btn", text: "În „Mai mult” găsești Simulatorul („ce-ar fi dacă aș lua un 9?”), contul tău și Setările." }
            : { target: navSel("tab-simulator"), text: "Simulatorul: „ce-ar fi dacă aș lua un 9 la mate?”. Încerci note fără să-ți atingi media reală." },
        { target: ".cmdk-trigger", text: `Aici cauți orice: materii, note, teste sau comenzi rapide.${phone ? "" : " Scurtătură: Ctrl K sau /."}` },
        { target: "#notif-btn", text: "Clopoțelul te anunță când o materie intră în risc sau când un test își așteaptă nota." },
        { target: phone ? "#tour-none" : "#account-chip", text: cloud.user ? "Ești în cont: notele se salvează singure și apar pe orice telefon sau calculator." : "Intră în cont ca notele să te urmeze pe orice telefon sau calculator." },
        { target: "#azi-buddy", text: "Și eu stau aici, pe pagina Azi: îți spun ce contează și mă bucur de fiecare 10. Mă poți gâdila cu un clic… dar nu prea tare! Numele noastre le schimbi din Setări." },
        { text: `Gata${hey}! Poți relua turul oricând din Setări. Spor la note mari!`, last: true }
    ];
}

const tourDone = () => { try { return localStorage.getItem(TOUR_DONE_KEY) === "1"; } catch (_) { return true; } };
function maybeStartTour() {
    if (!tourDone()) startTour();
}

function startTour() {
    if (!$("tour") || tour.open) return;
    if (!$("setup").hidden || ($("auth") && !$("auth").hidden)) return;
    closeActionModal();
    closeQuickAdd({ restoreFocus: false });
    closeMoreMenu({ restoreFocus: false });
    closeCmdk({ restoreFocus: false });
    closeNotifPanel({ restoreFocus: false });
    if (!$("action-modal").hidden) return; // o întrebare care cere răspuns (ex. sincronizarea) are prioritate
    switchTab("tab-dashboard");
    window.scrollTo(0, 0);
    tour.open = true;
    tour.steps = tourSteps();
    tour.returnFocus = document.activeElement;
    $("tour").hidden = false;
    document.body.classList.add("tour-open");
    window.addEventListener("resize", placeTour);
    window.addEventListener("scroll", placeTour, { passive: true });
    showTourStep(0, 1);
}

function endTour() {
    if (!tour.open) return;
    tour.open = false;
    $("tour").hidden = true;
    document.body.classList.remove("tour-open");
    window.removeEventListener("resize", placeTour);
    window.removeEventListener("scroll", placeTour);
    try { localStorage.setItem(TOUR_DONE_KEY, "1"); } catch (_) { /* fără stocare: tot nu insistăm */ }
    const back = tour.returnFocus;
    tour.returnFocus = null;
    if (back && document.contains(back) && back !== document.body) back.focus();
}

/** Elementul unui pas, doar dacă se vede pe ecran. */
function tourTarget(step) {
    if (!step?.target) return null;
    const el = document.querySelector(step.target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" ? el : null;
}
const tourVisible = (step, k, all) => k === 0 || k === all.length - 1 || Boolean(tourTarget(step));

/** Arată pasul `i`; dacă ținta lui nu e pe ecran, merge mai departe în direcția `dir`. */
function showTourStep(i, dir) {
    const steps = tour.steps;
    while (i > 0 && i < steps.length - 1 && !tourTarget(steps[i])) i += dir;
    tour.i = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[tour.i];
    const el = tourTarget(step);
    if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > innerHeight - 70) el.scrollIntoView({ block: "center" });
    }
    const visible = steps.map(tourVisible);
    const pos = visible.slice(0, tour.i + 1).filter(Boolean).length;
    $("tour-buddy").innerHTML = buddySVG(step.last ? "giggle" : tour.i === 0 ? "happy" : "focused");
    $("tour-step").textContent = `${buddyName()} · ${pos} din ${visible.filter(Boolean).length}`;
    $("tour-text").textContent = step.text;
    $("tour-back").hidden = tour.i === 0;
    $("tour-next").textContent = step.last ? "Hai să începem!" : tour.i === 0 ? "Arată-mi" : "Mai departe";
    $("tour-skip").hidden = Boolean(step.last);
    placeTour();
    $("tour-next").focus({ preventScroll: true });
}

/** Reflectorul peste țintă și bilețelul lângă ea (dedesubt dacă încape, altfel deasupra). */
function placeTour() {
    if (!tour.open) return;
    const el = tourTarget(tour.steps[tour.i]);
    const hole = $("tour-hole");
    const card = $("tour-card");
    const pad = 8;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    $("tour").classList.toggle("is-centered", !el);
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    if (!el) {
        hole.hidden = true;
        card.style.left = `${Math.max(12, (vw - cw) / 2)}px`;
        card.style.top = `${Math.max(12, (vh - ch) / 2)}px`;
        return;
    }
    const r = el.getBoundingClientRect();
    hole.hidden = false;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const gap = 14;
    let top = r.bottom + pad + gap;
    if (top + ch > vh - 12) top = r.top - pad - gap - ch;
    if (top < 12) top = Math.max(12, vh - ch - 12); // nu încape nici sus, nici jos: îl ținem pe ecran
    const left = Math.max(12, Math.min(vw - cw - 12, r.left + r.width / 2 - cw / 2));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
}

const TOUR_ACTIONS = {
    "tour-start": () => startTour(),
    "tour-next": () => tour.i >= tour.steps.length - 1 ? endTour() : showTourStep(tour.i + 1, 1),
    "tour-back": () => showTourStep(tour.i - 1, -1),
    "tour-skip": () => endTour(),
    "buddy-poke": (el, event) => pokeBuddy(el, event)
};

/** Tastele cât timp e deschis turul: Escape îl închide, săgețile schimbă pasul, Tab rămâne în bilețel. */
function handleTourKey(event) {
    const k = event.key;
    if (k === "Escape") { event.preventDefault(); endTour(); return; }
    if (k === "ArrowRight") { event.preventDefault(); TOUR_ACTIONS["tour-next"](); return; }
    if (k === "ArrowLeft" && tour.i > 0) { event.preventDefault(); TOUR_ACTIONS["tour-back"](); return; }
    if (k === "Tab") trapFocusIn($("tour-card"), event);
}

const SETUP_ACTIONS = {
    "setup-open": () => openSetup(0),
    "programme-change": () => openSetup(1),
    "help": el => openHelp(el.dataset.key),
    "start-hide": () => { try { localStorage.setItem(START_HIDE_KEY, "1"); } catch (_) { /* fără stocare */ } renderDashboard(); },
    "setup-skip": () => {
        markSetupDone();
        closeSetup();
        setTimeout(maybeStartTour, 300);
        showToast("Poți porni configurarea oricând din Setări sau din căutare (Ctrl+K).");
    },
    "setup-next": () => setupNext(),
    "setup-back": () => {
        ui.setup.step = Math.max(0, ui.setup.step - 1);
        renderSetup();
    },
    "setup-import": () => {
        markSetupDone();
        closeSetup();
        $("backup-file-input")?.click();
    },
    "setup-profile": el => {
        const st = ui.setup;
        if (!SETUP_PROFILES[el.dataset.id]) return;
        st.profile = el.dataset.id;
        const prof = SETUP_PROFILES[st.profile];
        // Clasa rămâne aleasă când treci de la un profil la altul, dacă există și la noul profil.
        if (prof.classes && !prof.classes.includes(st.cls)) st.cls = prof.classes[0];
        if (prof.variants && !prof.variants.some(v => v.id === st.variant)) st.variant = prof.variants[0].id;
        st.rows = setupRowsFor(st.profile, st.cls, st.variant, st.lm2);
        renderSetup();
        $("setup-body").querySelector(`[data-id="${st.profile}"]`)?.focus({ preventScroll: true });
        $("setup-body").querySelector(".setup-extra")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    },
    "setup-variant": el => {
        const st = ui.setup;
        const prof = SETUP_PROFILES[st.profile];
        if (!prof?.variants?.some(v => v.id === el.dataset.variant)) return;
        st.variant = el.dataset.variant;
        st.rows = setupRowsFor(st.profile, st.cls, st.variant, st.lm2);
        renderSetup();
        $("setup-body").querySelector(`[data-variant="${st.variant}"]`)?.focus();
    },
    "setup-class": el => {
        const st = ui.setup;
        const classes = SETUP_PROFILES[st.profile]?.classes || [];
        const c = Number(el.dataset.cls);
        if (!classes.includes(c)) return;
        st.cls = c;
        st.rows = setupRowsFor(st.profile, st.cls, st.variant, st.lm2);
        renderSetup();
        $("setup-body").querySelector(`[data-cls="${st.cls}"]`)?.focus();
    },
    "setup-hours": el => {
        const r = ui.setup.rows[Number(el.dataset.i)];
        if (!r) return;
        r.ore = Math.min(10, Math.max(1, r.ore + Number(el.dataset.d)));
        renderSetup();
        $("setup-body").querySelector(`[data-action="setup-hours"][data-i="${el.dataset.i}"][data-d="${el.dataset.d}"]:not(:disabled)`)?.focus();
    },
    "setup-target": el => { ui.setup.target = clampNumber(el.dataset.v, 5, 10, 10); rerenderSetupKeepFocus(el); },
    "setup-risk": el => { ui.setup.risk = clampNumber(el.dataset.v, 1, 10, 8); rerenderSetupKeepFocus(el); },
    "setup-method": el => { ui.setup.method = el.dataset.v === "weighted" ? "weighted" : "arithmetic"; rerenderSetupKeepFocus(el); },
    "setup-finish": el => finishSetup(el.dataset.timetable === "1")
};

/** Redesenează pasul curent și pune focusul înapoi pe butonul echivalent (pentru tastatură). */
function rerenderSetupKeepFocus(el) {
    const sel = `[data-action="${el.dataset.action}"][data-v="${el.dataset.v}"]`;
    ui.setup.preset = validSetupPreset(field("setup-preset"), ui.setup.preset);
    renderSetup();
    $("setup-body").querySelector(sel)?.focus();
}

function bindSetupEvents() {
    const box = $("setup");
    if (!box) return;
    box.addEventListener("change", event => {
        const t = event.target;
        if (t.classList.contains("setup-check")) {
            const r = ui.setup?.rows[Number(t.dataset.i)];
            if (r) { r.on = t.checked; renderSetup(); $("setup-body").querySelector(`.setup-check[data-i="${t.dataset.i}"]`)?.focus(); }
        } else if (t.id === "setup-preset" && ui.setup) {
            ui.setup.preset = validSetupPreset(t.value, ui.setup.preset);
        }
    });
    box.addEventListener("input", event => {
        const t = event.target;
        if (t.id === "setup-me-name" || t.id === "setup-me-buddy") {
            // Se salvează pe loc: numele rămân chiar dacă elevul sare peste restul configurării.
            const p = state.settings.profile;
            if (t.id === "setup-me-name") p.name = cleanName(t.value, 40);
            else p.buddy = cleanName(t.value, 20) || DEFAULT_SETTINGS.profile.buddy;
            saveState();
            $("setup-buddy").innerHTML = setupBuddyHTML();
            return;
        }
        if (t.classList.contains("setup-opt-topic")) {
            const r = ui.setup?.rows[Number(t.dataset.i)];
            if (r) {
                r.topic = t.value;
                // a scris tema: opționalul se bifează singur
                if (t.value.trim() && !r.on) {
                    r.on = true;
                    t.closest(".setup-row")?.classList.remove("is-off");
                    const chk = t.closest(".setup-row")?.querySelector(".setup-check");
                    if (chk) chk.checked = true;
                }
            }
        }
    });
    box.addEventListener("change", event => {
        const t = event.target;
        if (!t.classList.contains("setup-lm2")) return;
        const r = ui.setup?.rows[Number(t.dataset.i)];
        if (!r || !LM2_CHOICES.includes(t.value)) return;
        r.name = t.value;
        ui.setup.lm2 = t.value;
        r.exists = Boolean(findSubjectName(r.name));
        r.shown = findSubjectName(r.name) || r.name;
        renderSetup();
        $("setup-body").querySelector(".setup-lm2")?.focus();
    });
}

/* ==================== CONT ȘI SINCRONIZARE ==================== */
/*
 * Opțional: cu Firebase configurat (firebase-config.js), elevul își poate face cont (Google sau email + parolă),
 * iar datele îl urmează pe orice dispozitiv. Fără configurare, nimic din secțiunea asta nu apare.
 *
 * Datele rămân „local-first”: localStorage e copia de lucru (merge și offline); la fiecare salvare,
 * după o pauză scurtă, întregul backup (același format ca exportul) se urcă în cont.
 * Schimbările venite de pe alt dispozitiv se aplică singure, dacă aici nu există modificări nesincronizate;
 * altfel elevul alege ce păstrează. La prima conectare, datele deja existente pe dispozitiv nu se pierd niciodată fără întrebare.
 */
const SYNC_KEYS = { meta: "pro_sync_meta_v4", device: "pro_device_id_v4", choice: "pro_auth_choice_v4" };
const SYNC_DELAY = 1500;
const SYNC_RETRY = 30000;
const cloud = {
    configured: Boolean(window.ZECE_FIREBASE?.apiKey),
    api: undefined,      // undefined = încă se încarcă; null = indisponibil
    user: null,
    seenUser: false,     // a venit primul răspuns „cine e conectat”
    status: "local",     // local | syncing | pending | synced | offline | error
    dirty: false,
    lastSyncAt: 0,
    timer: 0,
    busy: false,
    again: false,
    applying: false,
    unwatch: null,
    asking: false,
    needsReconcile: false,
    reconciling: false
};

function lsGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function lsSet(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch (_) { /* fără stocare: sincronizarea merge, doar nu se ține minte între sesiuni */ }
}
function deviceId() {
    let id = lsGet(SYNC_KEYS.device);
    if (!id) {
        id = uid();
        lsSet(SYNC_KEYS.device, id);
    }
    return id;
}
function syncMeta() {
    const m = safeParseJSON(lsGet(SYNC_KEYS.meta), null);
    return isPlainObject(m) ? m : {};
}
function setSyncMeta(patch) { lsSet(SYNC_KEYS.meta, JSON.stringify({ ...syncMeta(), ...patch })); }
const dataJSON = () => JSON.stringify(buildBackup());
/** Conținutul fără momentul exportului, ca două copii identice să fie recunoscute ca atare. */
function dataFingerprint(json) {
    const parsed = safeParseJSON(json, null);
    return parsed && parsed.data ? JSON.stringify(parsed.data) : "";
}
const hasLocalData = () => Object.keys(state.subjects).length > 0 || Object.keys(state.calendar).length > 0;

function initCloud() {
    if (!cloud.configured) return; // aplicația rămâne exact ca înainte
    document.body.classList.add("has-cloud");
    const attach = api => {
        if (cloud.api) return;
        cloud.api = api || null;
        if (!cloud.api) {
            setSyncStatus("local");
            // Firebase nu a putut porni (ex. fără internet la prima deschidere): se poate doar răsfoi.
            cloud.seenUser = true;
            enterGuest();
            return;
        }
        cloud.api.onUser(user => { onCloudUser(user); });
    };
    if (window.ZeceCloud !== undefined) attach(window.ZeceCloud);
    window.addEventListener("zece-cloud", event => attach(event.detail));
    // Plasă de siguranță: dacă modulul de cont nu se încarcă deloc, aplicația pornește local după câteva secunde.
    setTimeout(() => { if (cloud.api === undefined) attach(null); }, 8000);
    window.addEventListener("online", () => {
        if (!cloud.user) return;
        if (cloud.needsReconcile) reconcileWithCloud();
        else if (cloud.dirty) scheduleUpload(0);
    });
    renderAccount();
}

async function onCloudUser(user) {
    const first = !cloud.seenUser;
    cloud.seenUser = true;
    cloud.unwatch?.();
    cloud.unwatch = null;
    cloud.user = user;

    if (!user) {
        cloud.dirty = false;
        setSyncStatus("local");
        enterGuest();
        renderAccount();
        // La fiecare deschidere arătăm autentificarea, mai puțin dacă a ales deja „doar mă uit” în sesiunea asta
        let browsing = false;
        try { browsing = sessionStorage.getItem(GUEST_SESSION_KEY) === "1"; } catch (_) { /* fără stocare */ }
        if (first && !browsing) openAuth();
        return;
    }

    lsSet(SYNC_KEYS.choice, "account");
    closeAuth();
    leaveGuest();
    renderAccount();
    await reconcileWithCloud();
    // Numele din contul Google devine numele elevului, dacă nu și-a scris deja altul.
    if (cloud.user?.uid === user.uid && !state.settings.profile.name && user.name) {
        state.settings.profile.name = cleanName(user.name, 40);
        refresh();
        loadSettingsIntoUI();
        // Configurarea deschisă deja: numele apare și acolo
        const input = $("setup-me-name");
        if (input && !input.value) {
            input.value = state.settings.profile.name;
            $("setup-buddy").innerHTML = setupBuddyHTML();
        }
    }
    if (cloud.user?.uid === user.uid) cloud.unwatch = cloud.api.watch(onRemoteChange);
}

/** La conectare: ce facem dacă și contul, și dispozitivul au date. */
async function reconcileWithCloud() {
    if (cloud.reconciling) return; // conexiunea revine și prin „online”, și prin watch: o singură comparație
    cloud.reconciling = true;
    try {
        await reconcileOnce();
    } finally {
        cloud.reconciling = false;
    }
}

async function reconcileOnce() {
    const user = cloud.user;
    setSyncStatus("syncing");
    let remote;
    try {
        remote = await cloud.api.load();
    } catch (err) {
        console.warn("Nu am putut citi datele din cont.", err);
        cloud.dirty = Boolean(syncMeta().dirty);
        cloud.needsReconcile = true; // la revenirea conexiunii comparăm din nou, înainte de orice urcare
        setSyncStatus(navigator.onLine === false ? "offline" : "error");
        clearTimeout(cloud.timer);
        cloud.timer = setTimeout(() => { if (cloud.needsReconcile && cloud.user) reconcileWithCloud(); }, SYNC_RETRY);
        return;
    }
    if (cloud.user?.uid !== user.uid) return;
    cloud.needsReconcile = false;
    const meta = syncMeta();
    const sameUser = meta.uid === user.uid;
    const localJSON = dataJSON();

    if (!remote) {
        // Cont nou (sau gol): datele de pe dispozitiv urcă în cont, dar doar cu acordul elevului.
        if (hasLocalData() && !sameUser) {
            const choice = await askSync("upload");
            if (choice === "fresh") {
                exportBackup(); // întâi o copie, ca nimic să nu se piardă
                applyRemoteData(null);
            }
        }
        await uploadNow();
        // Cont nou și caiet gol: configurarea apare mereu (chiar dacă pe acest browser a mai fost închisă cândva).
        if (!hasLocalData() && cloud.user?.uid === user.uid) openSetup(0);
        return;
    }
    if (dataFingerprint(remote.json) === dataFingerprint(localJSON)) {
        markSynced(remote.updatedAt);
        return;
    }
    if (sameUser && !meta.dirty) return applyRemoteData(remote);                       // dispozitivul e doar o copie a contului
    if (sameUser && remote.updatedAt <= (meta.lastSyncAt || 0)) return uploadNow();   // s-a schimbat doar aici (offline)
    if (!hasLocalData()) return applyRemoteData(remote);
    const choice = await askSync("conflict", remote);
    if (choice === "remote") applyRemoteData(remote);
    else await uploadNow();
}

/** Înlocuiește datele locale cu cele din cont (sau le golește, pentru `null`). */
function applyRemoteData(remote, { toast = "" } = {}) {
    let loaded;
    try {
        loaded = remote ? parseBackup(remote.json).loaded : readStoredData(() => null);
    } catch (err) {
        console.error("Datele din cont nu au putut fi citite.", err);
        setSyncStatus("error");
        showToast("⚠️ Datele din cont nu au putut fi citite. Cele de pe acest dispozitiv au rămas neschimbate.");
        return;
    }
    cloud.applying = true;
    try {
        applyImportedData(loaded);
    } finally {
        cloud.applying = false;
    }
    if (remote) markSynced(remote.updatedAt);
    if (toast) showToast(toast);
}

/** Apelată de saveState() când s-a schimbat ceva. */
function onLocalDataChange() {
    if (!cloud.user || cloud.applying) return;
    cloud.dirty = true;
    setSyncMeta({ uid: cloud.user.uid, dirty: true });
    setSyncStatus("pending");
    scheduleUpload();
}

function scheduleUpload(delay = SYNC_DELAY) {
    if (!cloud.user) return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(uploadNow, delay);
}

async function uploadNow() {
    if (!cloud.user || !cloud.api || cloud.needsReconcile) return; // fără să știm ce e în cont, nu suprascriem
    if (cloud.busy) {
        cloud.again = true;
        return;
    }
    clearTimeout(cloud.timer);
    cloud.busy = true;
    setSyncStatus("syncing");
    const uidAtStart = cloud.user.uid;
    const at = Date.now();
    try {
        await cloud.api.save(dataJSON(), deviceId(), at);
        if (cloud.user?.uid === uidAtStart) markSynced(at);
    } catch (err) {
        console.warn("Sincronizarea a eșuat; reîncerc.", err);
        cloud.dirty = true;
        setSyncMeta({ uid: uidAtStart, dirty: true });
        setSyncStatus(navigator.onLine === false ? "offline" : "error");
        cloud.timer = setTimeout(() => { if (cloud.dirty) uploadNow(); }, SYNC_RETRY);
    } finally {
        cloud.busy = false;
        if (cloud.again) {
            cloud.again = false;
            scheduleUpload(300);
        }
    }
}

function markSynced(at) {
    cloud.dirty = false;
    cloud.lastSyncAt = at;
    setSyncMeta({ uid: cloud.user.uid, lastSyncAt: at, dirty: false });
    setSyncStatus("synced");
}

/** O schimbare venită de pe alt dispozitiv. */
async function onRemoteChange(remote) {
    if (cloud.needsReconcile) return reconcileWithCloud(); // prima citire a eșuat: comparăm cu grijă, nu înlocuim orbește
    if (!remote?.json || !cloud.user || remote.device === deviceId() || remote.updatedAt <= cloud.lastSyncAt) return;
    if (dataFingerprint(remote.json) === dataFingerprint(dataJSON())) return markSynced(remote.updatedAt);
    if (!cloud.dirty) return applyRemoteData(remote, { toast: "↻ Am adus modificările făcute pe alt dispozitiv." });
    if (cloud.asking) return;
    const choice = await askSync("conflict", remote);
    if (choice === "remote") applyRemoteData(remote);
    else await uploadNow();
}

const SYNC_STATUS_TEXT = {
    local: "Doar pe acest dispozitiv",
    syncing: "Se sincronizează…",
    pending: "Modificări nesalvate în cont",
    synced: "Sincronizat",
    offline: "Offline · se urcă la revenire",
    error: "Sincronizare întreruptă · reîncerc"
};

function setSyncStatus(status) {
    cloud.status = status;
    document.querySelectorAll("[data-sync-status]").forEach(el => {
        el.dataset.syncStatus = status;
        const text = el.querySelector(".sync-text");
        if (text) text.textContent = SYNC_STATUS_TEXT[status];
    });
}

function userInitials(user) {
    const base = (user.name || user.email || "?").trim();
    const parts = base.split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || "?") + (user.name && parts[1] ? parts[1][0] : "")).toLocaleUpperCase("ro");
}

function avatarHTML(user, cls = "") {
    if (!user) return `<span class="avatar ${cls} is-guest" aria-hidden="true">${icon("user")}</span>`;
    return user.photo
        ? `<img class="avatar ${cls}" src="${escapeHTML(user.photo)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="avatar ${cls}" aria-hidden="true">${escapeHTML(userInitials(user))}</span>`;
}

/** Bucata „cont” din meniul lateral și din Setări. */
function renderAccount() {
    const u = cloud.user;
    const chip = $("account-chip");
    if (chip) {
        chip.innerHTML = `
            ${avatarHTML(u)}
            <span class="account-chip-text">
                <b>${escapeHTML(u ? (u.name || u.email) : "Intră în cont")}</b>
                <small class="sync-line" data-sync-status="${cloud.status}"><i class="sync-dot" aria-hidden="true"></i><span class="sync-text">${SYNC_STATUS_TEXT[cloud.status]}</span></small>
            </span>`;
        chip.setAttribute("aria-label", u ? `Contul tău: ${u.name || u.email}` : "Intră în cont");
    }
    const card = $("account-settings");
    if (card) {
        card.innerHTML = u ? `
            <div class="account-row">
                ${avatarHTML(u, "is-lg")}
                <div class="account-who"><b>${escapeHTML(u.name || u.email)}</b>${u.name ? `<small>${escapeHTML(u.email)}</small>` : ""}
                    <small class="sync-line" data-sync-status="${cloud.status}"><i class="sync-dot" aria-hidden="true"></i><span class="sync-text">${SYNC_STATUS_TEXT[cloud.status]}</span></small></div>
            </div>
            <div class="account-actions">
                <button type="button" class="btn btn-glass" data-action="sync-now">${icon("refresh")} Sincronizează acum</button>
                <button type="button" class="btn btn-glass" data-action="account-signout">${icon("undo")} Ieși din cont</button>
                <button type="button" class="btn btn-text text-danger" data-action="account-delete">${icon("trash")} Șterge contul</button>
            </div>` : `
            <p class="subtitle">Fără cont, datele stau doar în acest browser. Cu un cont (Google sau email), le ai pe orice telefon sau calculator, iar dacă browserul se golește nu pierzi nimic.</p>
            <div class="account-actions"><button type="button" class="btn btn-primary" data-action="auth-open">${icon("user")} Intră sau fă-ți cont</button></div>`;
    }
    setSyncStatus(cloud.status);
}

/* ---------- ecranul de autentificare ---------- */
const AUTH_ERRORS = {
    "auth/invalid-email": "Adresa de email nu e validă.",
    "auth/missing-email": "Scrie adresa de email.",
    "auth/missing-password": "Scrie parola.",
    "auth/user-not-found": "Email sau parolă greșite.",
    "auth/wrong-password": "Email sau parolă greșite.",
    "auth/invalid-credential": "Email sau parolă greșite.",
    "auth/invalid-login-credentials": "Email sau parolă greșite.",
    "auth/email-already-in-use": "Există deja un cont cu acest email. Intră în el sau folosește „Am uitat parola”.",
    "auth/weak-password": "Parola trebuie să aibă cel puțin 6 caractere.",
    "auth/too-many-requests": "Prea multe încercări. Așteaptă puțin și încearcă din nou.",
    "auth/network-request-failed": "Nu e conexiune la internet.",
    "auth/unauthorized-domain": "Acest site nu e încă autorizat în Firebase (Authentication → Settings → Authorized domains).",
    "auth/account-exists-with-different-credential": "Există deja un cont cu acest email, creat altfel (Google sau parolă). Intră cu metoda folosită prima dată.",
    "auth/user-disabled": "Acest cont a fost dezactivat.",
    "auth/requires-recent-login": "Din motive de siguranță, ieși din cont, intră din nou și reîncearcă."
};
const SILENT_AUTH = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);
const authMessage = err => AUTH_ERRORS[err?.code] || "Nu a mers. Încearcă din nou peste câteva momente.";

const authUI = { mode: "signin", busy: false, error: "", info: "", email: "", returnFocus: null, reason: "" };

function openAuth(mode = "signin") {
    if (!cloud.api) return;
    if (!$("setup").hidden) closeSetup();
    closeActionModal();
    closeQuickAdd({ restoreFocus: false });
    closeMoreMenu({ restoreFocus: false });
    closeCmdk({ restoreFocus: false });
    closeNotifPanel({ restoreFocus: false });
    Object.assign(authUI, { mode, busy: false, error: "", info: "", returnFocus: authUI.returnFocus || document.activeElement });
    $("auth").hidden = false;
    document.body.classList.add("modal-open");
    renderAuth();
}

function closeAuth() {
    const box = $("auth");
    if (!box || box.hidden) return;
    authUI.reason = "";
    box.hidden = true;
    if ($("action-modal").hidden && $("setup").hidden) document.body.classList.remove("modal-open");
    const back = authUI.returnFocus;
    authUI.returnFocus = null;
    if (back && document.contains(back) && back !== document.body) back.focus();
}

function renderAuth(focusId) {
    const { mode, busy, error, info, email } = authUI;
    const titles = { signin: "Intră în cont", signup: "Cont nou", reset: "Resetează parola" };
    $("auth-body").innerHTML = `
        <div class="auth-intro">
            <svg class="brand-logo auth-logo" viewBox="0 0 64 64" aria-hidden="true"><use href="#i-logo"/></svg>
            <h2 id="auth-title" tabindex="-1">${titles[mode]}</h2>
            <p>${mode === "reset" ? "Îți trimitem pe email un link pentru o parolă nouă." : authUI.reason ? escapeHTML(authUI.reason) : "Notele tale, pe orice telefon sau calculator. Fără cont poți doar să te uiți."}</p>
        </div>
        ${mode !== "reset" ? `
            <button type="button" class="btn auth-google" data-action="auth-google" ${busy ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true" class="g-logo"><path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/></svg>
                Continuă cu Google
            </button>
            <div class="auth-or"><span>sau cu email</span></div>
            <div class="azi-seg auth-tabs" role="group" aria-label="Ai deja cont?">
                <button type="button" aria-pressed="${mode === "signin"}" data-action="auth-mode" data-mode="signin">Am cont</button>
                <button type="button" aria-pressed="${mode === "signup"}" data-action="auth-mode" data-mode="signup">Cont nou</button>
            </div>` : ""}
        <form class="auth-form" data-auth-form novalidate>
            ${mode === "signup" ? `
                <div class="form-group">
                    <label for="auth-name">Numele tău <span class="label-hint">(opțional)</span></label>
                    <input id="auth-name" class="glass-input" autocomplete="name" maxlength="60">
                </div>` : ""}
            <div class="form-group">
                <label for="auth-email">Email</label>
                <input id="auth-email" class="glass-input" type="email" autocomplete="email" inputmode="email" required value="${escapeHTML(email)}">
            </div>
            ${mode !== "reset" ? `
                <div class="form-group">
                    <label for="auth-pass">Parolă${mode === "signup" ? ` <span class="label-hint">(cel puțin 6 caractere)</span>` : ""}</label>
                    <div class="auth-pass">
                        <input id="auth-pass" class="glass-input" type="password" required minlength="6" autocomplete="${mode === "signup" ? "new-password" : "current-password"}">
                        <button type="button" class="auth-eye" data-action="auth-eye" aria-label="Arată parola" aria-pressed="false">${icon("eye")}</button>
                    </div>
                </div>` : ""}
            <p class="auth-msg ${error ? "is-error" : info ? "is-info" : ""}" role="${error ? "alert" : "status"}" aria-live="polite">${escapeHTML(error || info)}</p>
            <button type="submit" class="btn btn-primary auth-submit" ${busy ? "disabled" : ""}>${busy ? "Așteaptă…" : mode === "signin" ? "Intră" : mode === "signup" ? "Creează contul" : "Trimite linkul"}</button>
        </form>
        <div class="auth-links">
            ${mode === "signin" ? `<button type="button" class="btn btn-text" data-action="auth-mode" data-mode="reset">Am uitat parola</button>` : ""}
            ${mode === "reset" ? `<button type="button" class="btn btn-text" data-action="auth-mode" data-mode="signin">${icon("undo")} Înapoi la autentificare</button>` : ""}
        </div>
        <div class="auth-foot">
            <button type="button" class="btn btn-text" data-action="auth-local">${icon("eye")} Doar mă uit, ca vizitator</button>
            <small>Ca vizitator poți răsfoi aplicația, dar nu poți adăuga sau schimba nimic.</small>
        </div>`;
    const target = focusId ? $(focusId) : (error ? ($("auth-pass") || $("auth-email")) : $("auth-email"));
    (target || $("auth-title"))?.focus({ preventScroll: true });
}

async function runAuth(task, { info = "" } = {}) {
    authUI.email = field("auth-email").trim() || authUI.email;
    authUI.busy = true;
    authUI.error = "";
    authUI.info = "";
    renderAuth();
    try {
        await task();
        authUI.busy = false;
        if (info) {
            authUI.info = info;
            renderAuth();
        }
    } catch (err) {
        authUI.busy = false;
        if (!SILENT_AUTH.has(err?.code)) authUI.error = authMessage(err);
        if (!$("auth").hidden) renderAuth();
    }
}

function submitAuth() {
    const email = field("auth-email").trim();
    const pass = field("auth-pass");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        authUI.error = AUTH_ERRORS["auth/invalid-email"];
        authUI.email = email;
        renderAuth("auth-email");
        return;
    }
    if (authUI.mode === "reset") {
        runAuth(() => cloud.api.resetPassword(email), { info: `Gata! Dacă există un cont pentru ${email}, ai primit un email cu linkul. Verifică și dosarul Spam.` });
        return;
    }
    if (pass.length < 6) {
        authUI.error = authUI.mode === "signup" ? AUTH_ERRORS["auth/weak-password"] : AUTH_ERRORS["auth/missing-password"];
        authUI.email = email;
        renderAuth("auth-pass");
        return;
    }
    if (authUI.mode === "signup") runAuth(() => cloud.api.signUpEmail(email, pass, field("auth-name").trim().slice(0, 60)));
    else runAuth(() => cloud.api.signInEmail(email, pass));
}

/* ---------- întrebări (prima conectare, conflicte) ---------- */
function syncSummaryHTML(title, data, simData, when) {
    const c = summarizeData(data, simData);
    return `
        <span class="sync-pick-title">${title}</span>
        <span class="sync-pick-meta">${escapeHTML(summaryText(c))}</span>
        ${when ? `<span class="sync-pick-meta">modificat ${escapeHTML(formatDateTime(new Date(when)))}</span>` : ""}`;
}

/** Întreabă ce date păstrăm. Întoarce o promisiune: „upload” / „fresh” sau „remote” / „local”. */
function askSync(kind, remote) {
    cloud.asking = true;
    return new Promise(resolve => {
        const done = choice => {
            cloud.asking = false;
            closeActionModal();
            resolve(choice);
        };
        cloud.resolveAsk = done;
        if (kind === "upload") {
            openModal({
                title: "Ai deja date pe acest dispozitiv",
                confirmText: "",
                cancelText: "",
                body: `
                    <p class="modal-hint">Contul tău e gol. Ce facem cu notele de aici?</p>
                    <button type="button" class="reset-option-card" data-action="sync-pick" data-pick="upload">
                        <span><span class="reset-option-title">${icon("upload")} Le urc în cont</span><span class="reset-option-hint">${escapeHTML(summaryText(summarizeData(state, sim)))} · apoi le ai pe orice dispozitiv</span></span>
                        <span class="reset-option-arrow" aria-hidden="true">→</span>
                    </button>
                    <button type="button" class="reset-option-card" data-action="sync-pick" data-pick="fresh">
                        <span><span class="reset-option-title">${icon("sparkles")} Încep cu un cont gol</span><span class="reset-option-hint">îți descarc întâi un backup cu datele de acum, ca să nu se piardă</span></span>
                        <span class="reset-option-arrow" aria-hidden="true">→</span>
                    </button>`
            });
            return;
        }
        let incoming = null;
        try { incoming = parseBackup(remote.json).loaded; } catch (_) { /* dacă nu se poate citi, rămâne varianta locală */ }
        if (!incoming) {
            done("local");
            return;
        }
        openModal({
            title: "Datele diferă",
            confirmText: "",
            cancelText: "",
            body: `
                <p class="modal-hint">Contul și acest dispozitiv au note diferite (de ex. ai lucrat offline sau pe alt telefon). Pe care le păstrezi? Celelalte vor fi înlocuite.</p>
                <button type="button" class="reset-option-card sync-pick" data-action="sync-pick" data-pick="remote">
                    <span>${syncSummaryHTML(`${icon("download")} Din cont`, incoming.data, incoming.sim, remote.updatedAt)}</span>
                    <span class="reset-option-arrow" aria-hidden="true">→</span>
                </button>
                <button type="button" class="reset-option-card sync-pick" data-action="sync-pick" data-pick="local">
                    <span>${syncSummaryHTML(`${icon("monitor")} De pe acest dispozitiv`, state, sim, null)}</span>
                    <span class="reset-option-arrow" aria-hidden="true">→</span>
                </button>
                <p class="subtitle mt-2">Nu ești sigur? Exportă întâi un backup din Setări; apoi poți alege liniștit.</p>`
        });
    });
}

/* ---------- ieșire, ștergere ---------- */
function confirmSignOut() {
    openModal({
        title: "Ieși din cont?",
        confirmText: "Ieși",
        body: `
            <p>Notele rămân în contul tău și le regăsești când intri din nou.</p>
            <label class="check-row mt-3"><input type="checkbox" id="signout-wipe"> Șterge și datele de pe acest dispozitiv</label>
            <p class="subtitle">Bifează pe un calculator sau telefon folosit și de alții.</p>`,
        onConfirm: async () => {
            const wipe = Boolean($("signout-wipe")?.checked);
            closeActionModal();
            if (cloud.dirty) await uploadNow(); // ultimele modificări ajung în cont înainte de ieșire
            try {
                await cloud.api.signOut();
            } catch (err) {
                showToast(`⚠️ ${authMessage(err)}`);
                return;
            }
            setSyncMeta({ uid: null, lastSyncAt: 0, dirty: false });
            lsSet(SYNC_KEYS.choice, null);
            if (wipe) {
                // vizitatorul nu poate schimba date, deci ștergerea se face înainte ca modul vizitator să le „înghețe”
                const wasGuest = guest.on;
                if (wasGuest) Object.assign(guest, { on: false, demo: false, base: null, fp: "" });
                applyRemoteData(null);
                if (wasGuest) enterGuest();
            }
            showToast(wipe ? "Ai ieșit din cont. Datele de pe acest dispozitiv au fost șterse." : "Ai ieșit din cont.");
        }
    });
}

function confirmDeleteAccount() {
    openModal({
        title: "Șterge contul",
        danger: true,
        confirmText: "Șterge definitiv",
        body: `
            <p>Se șterg contul <b>${escapeHTML(cloud.user?.email || "")}</b> și copia notelor din cloud. Nu se poate anula.</p>
            <p class="subtitle mt-2">Notele de pe acest dispozitiv rămân (poți exporta un backup din Setări).</p>`,
        onConfirm: async () => {
            closeActionModal();
            try {
                await cloud.api.deleteAccount();
                setSyncMeta({ uid: null, lastSyncAt: 0, dirty: false });
                lsSet(SYNC_KEYS.choice, null);
                showToast("Contul a fost șters. Notele au rămas pe acest dispozitiv.");
            } catch (err) {
                showToast(`⚠️ ${authMessage(err)}`, { duration: 6000 });
            }
        }
    });
}

function openAccountPanel() {
    if (!cloud.user) {
        openAuth();
        return;
    }
    const u = cloud.user;
    const method = u.providers.includes("google.com") ? "Google" : "email și parolă";
    openModal({
        layout: "panel",
        title: "Contul tău",
        confirmText: "",
        cancelText: "Închide",
        body: `
            <div class="account-row">
                ${avatarHTML(u, "is-lg")}
                <div class="account-who"><b>${escapeHTML(u.name || u.email)}</b>${u.name ? `<small>${escapeHTML(u.email)}</small>` : ""}<small>Intri cu ${method}</small></div>
            </div>
            <div class="account-sync-box">
                <span class="sync-line is-lg" data-sync-status="${cloud.status}"><i class="sync-dot" aria-hidden="true"></i><span class="sync-text">${SYNC_STATUS_TEXT[cloud.status]}</span></span>
                <small>${cloud.lastSyncAt ? `Ultima sincronizare: ${escapeHTML(formatDateTime(new Date(cloud.lastSyncAt)))}` : "Încă nesincronizat"}</small>
                <small>Notele se salvează în cont la câteva secunde după fiecare modificare și apar singure pe celelalte dispozitive.</small>
            </div>
            <div class="account-actions is-col">
                <button type="button" class="btn btn-glass" data-action="sync-now">${icon("refresh")} Sincronizează acum</button>
                <button type="button" class="btn btn-glass" data-action="account-signout">${icon("undo")} Ieși din cont</button>
                <button type="button" class="btn btn-text text-danger" data-action="account-delete">${icon("trash")} Șterge contul</button>
            </div>`
    });
}

const ACCOUNT_ACTIONS = {
    "account-open": () => openAccountPanel(),
    "auth-open": () => openAuth(),
    "auth-close": () => ACCOUNT_ACTIONS["auth-local"](), // închis fără să intre = răsfoiește ca vizitator
    "auth-mode": el => {
        authUI.email = field("auth-email").trim() || authUI.email;
        Object.assign(authUI, { mode: ["signin", "signup", "reset"].includes(el.dataset.mode) ? el.dataset.mode : "signin", error: "", info: "" });
        renderAuth();
    },
    "auth-google": () => runAuth(() => cloud.api.signInGoogle()),
    "auth-eye": el => {
        const input = $("auth-pass");
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        el.setAttribute("aria-pressed", String(show));
        el.setAttribute("aria-label", show ? "Ascunde parola" : "Arată parola");
    },
    "auth-local": () => {
        try { sessionStorage.setItem(GUEST_SESSION_KEY, "1"); } catch (_) { /* fără stocare */ }
        closeAuth();
    },
    "sync-now": async () => {
        await (cloud.needsReconcile ? reconcileWithCloud() : uploadNow());
        if (cloud.status === "synced") showToast("☁ Sincronizat.");
        if (!$("action-modal").hidden && $("action-modal-title").textContent === "Contul tău") openAccountPanel();
    },
    "sync-pick": el => cloud.resolveAsk?.(el.dataset.pick),
    "account-signout": () => confirmSignOut(),
    "account-delete": () => confirmDeleteAccount()
};

function bindAuthEvents() {
    $("auth")?.addEventListener("submit", event => {
        if (!event.target.matches("[data-auth-form]")) return;
        event.preventDefault();
        submitAuth();
    });
}

/* ==================== VIZITATOR (fără cont: doar te uiți) ==================== */
/* Fără cont se poate răsfoi tot, dar nu se poate adăuga sau schimba nimic: orice încercare deschide
   autentificarea. Cine n-are date pe acest dispozitiv vede un caiet de exemplu, ținut doar în memorie.
   Nimic din modul vizitator nu se salvează. */
const guest = { on: false, demo: false, base: null, fp: "", restoring: false };
const GUEST_SESSION_KEY = "pro_guest_browse_v4"; // a ales „doar mă uit” în această sesiune: nu-i mai arătăm autentificarea la pornire

/** Acțiunile care doar arată ceva (navigare, filtre, vederi). Restul cer cont. */
const GUEST_OK = new Set([
    "nav", "show-date", "cal-nav", "cal-today", "cal-view", "cal-goto",
    "cat-select", "cat-step", "cat-group", "cat-back", "cat-filter", "cat-clear-filters", "open-subject", "cat-menu-glance",
    "home-day", "home-risk", "plan-day", "help", "stats-print", "stats-insights-more", "stats-period", "stats-jump", "alert-open",
    "sim-scenario", "sim-toggle-all", "sim-pick-subject",
    "cmdk", "cmdk-close", "quick-add-close", "notif-open", "notif-close", "more-open", "more-close", "more-run",
    "modal-cancel", "none", "tour-start", "tour-next", "tour-back", "tour-skip", "buddy-poke",
    "account-open", "auth-open", "auth-close", "auth-mode", "auth-google", "auth-eye", "auth-local", "guest-signin"
]);
const GUEST_OK_MORE = new Set(["sim", "settings", "account", "tour", "plan"]);

/** Poate modifica? Fără conturi configurate (ex. teste locale) aplicația merge ca înainte. */
const canEdit = () => !cloud.configured || Boolean(cloud.user);

/** Când cineva fără cont încearcă să schimbe ceva: îi explicăm și îi deschidem autentificarea. */
function requireAccount() {
    if (canEdit()) return true;
    if (!cloud.seenUser && cloud.api !== null) {
        showToast("O clipă, verific dacă ești în cont…");
        return false;
    }
    if (!cloud.api) {
        showToast("⚠️ Fără internet nu poți intra în cont acum. Ca vizitator poți doar să te uiți.", { duration: 5000 });
        return false;
    }
    authUI.reason = "Ca vizitator poți doar să te uiți. Intră în cont ca să adaugi note, teste și planuri.";
    openAuth("signin");
    return false;
}

/** Ce contează ca „modificare făcută de om” (fără ce calculează aplicația singură: istoric, realizări, alerte, sesiuni generate). */
function guestFingerprint() {
    const { report, ...settings } = state.settings;
    return JSON.stringify([
        state.subjects, state.calendar, state.timetable, state.purtare.grades, state.purtare.excludeFromGPA, settings,
        state.plan.prefs, state.plan.items.filter(it => it.manual || it.done).map(it => [it.id, it.done, it.date]),
        sim.scenarios
    ]);
}

const guestSnapshot = () => JSON.parse(JSON.stringify(buildBackup().data));
function guestRestore(snap) {
    applyLoadedData(readStoredData(name => clone(snap[name] ?? null)));
}

/** Un caiet de exemplu, ca vizitatorul să vadă cum arată aplicația folosită. Datele sunt relative la azi. */
function demoData() {
    const today = getLocalDateKey();
    const k = n => addDays(today, n);
    const g = (val, type, n) => ({ val, type, date: k(n) });
    const subjects = {
        "Limba și literatura română": { ore: 4, target: 10, priority: true, grades: [g(9, "Teză", -27), g(10, "Ascultare", -15), g(9, "Test", -4)] },
        "Matematică": { ore: 4, target: 10, priority: true, grades: [g(7, "Test", -25), g(4, "Test", -9), g(6, "Ascultare", -3)] },
        "Limba engleză": { ore: 2, target: 10, grades: [g(10, "Test", -20), g(9, "Proiect", -6)] },
        "Fizică": { ore: 2, target: 9, grades: [g(8, "Test", -18), g(9, "Ascultare", -2)] },
        "Chimie": { ore: 2, target: 9, grades: [g(5, "Test", -16), g(6, "Ascultare", -5)] },
        "Biologie": { ore: 1, target: 9, grades: [g(10, "Proiect", -12)] },
        "Istorie": { ore: 2, target: 9, grades: [g(8, "Ascultare", -11), g(9, "Test", -1)] },
        "Geografie": { ore: 1, target: 9, grades: [] },
        "Informatică": { ore: 2, target: 10, grades: [g(10, "Proiect", -8)] },
        "Educație fizică și sport": { ore: 2, target: 10, grades: [g(10, "Altele", -14)] }
    };
    const ev = (id, title, type, subject, extra = {}) => ({ id, title, type, subject, ...extra });
    const calendar = {
        [k(-3)]: [ev("demo-t1", "Test chimie", "Test", "Chimie")],
        [k(1)]: [ev("demo-t2", "Test fizică – mișcarea", "Test", "Fizică", { time: "08:00" })],
        [k(2)]: [ev("demo-h1", "Eseu despre „Moara cu noroc”", "Temă", "Limba și literatura română")],
        [k(4)]: [ev("demo-e1", "Teză la matematică", "Examen", "Matematică", { time: "10:00" })],
        [k(6)]: [ev("demo-p1", "Prezentare la engleză", "Prezentare", "Limba engleză")],
        [k(9)]: [ev("demo-t3", "Test istorie", "Test", "Istorie")]
    };
    const timetable = {
        1: ["Matematică", "Fizică", "Limba și literatura română", "Limba engleză", "Istorie"],
        2: ["Chimie", "Biologie", "Matematică", "Informatică", "Educație fizică și sport"],
        3: ["Limba și literatura română", "Geografie", "Fizică", "Informatică", "Matematică"],
        4: ["Matematică", "Limba engleză", "Istorie", "Chimie", "Educație fizică și sport"],
        5: ["Limba și literatura română", "Limba engleză", "Matematică", "Biologie"]
    };
    return { subjects, calendar, timetable, plan: { prefs: { setup: true, school: 60, weekend: 90, session: 30 } } };
}

function enterGuest() {
    if (!cloud.configured || guest.on) return;
    guest.on = true;
    document.body.classList.add("is-guest");
    if (!hasLocalData()) {
        const demo = demoData();
        applyLoadedData(readStoredData(name => clone(demo[name] ?? null)));
        guest.demo = true;
    }
    guest.base = guestSnapshot();
    guest.fp = guestFingerprint();
    refresh();
    renderGuestBar();
}

/** La intrarea în cont: caietul de exemplu dispare (nu ajunge niciodată în cont), datele reale revin. */
function leaveGuest() {
    if (!guest.on) return;
    const wasDemo = guest.demo;
    Object.assign(guest, { on: false, demo: false, base: null, fp: "" });
    document.body.classList.remove("is-guest");
    if (wasDemo) loadState();
    try { sessionStorage.removeItem(GUEST_SESSION_KEY); } catch (_) { /* fără stocare */ }
    refresh();
    renderGuestBar();
    if (ui.activeTab === "tab-setari") loadSettingsIntoUI();
}

/** Plasa de siguranță, la fiecare redesenare: o schimbare ajunsă cumva în date se anulează. */
function guestGuard() {
    if (!guest.on || guest.restoring || !guest.base) return false;
    const fp = guestFingerprint();
    if (fp === guest.fp) return false;
    guest.restoring = true;
    guestRestore(guest.base);
    guest.restoring = false;
    requireAccount();
    return true;
}

function renderGuestBar() {
    const bar = $("guest-bar");
    if (!bar) return;
    bar.hidden = !guest.on;
    if (!guest.on) {
        document.querySelectorAll("#tab-setari [data-guest-locked]").forEach(el => { el.disabled = false; el.removeAttribute("data-guest-locked"); });
        return;
    }
    bar.innerHTML = `
        <span class="guest-bar-text">${icon("eye")}<span><b>Ești vizitator.</b> ${guest.demo ? "Te uiți la un caiet de exemplu." : "Te uiți la notele de pe acest dispozitiv."} Ca să adaugi sau să schimbi ceva, intră în cont.</span></span>
        <button type="button" class="btn btn-primary btn-sm" data-action="guest-signin">Intră în cont</button>`;
    // Setările se văd, dar nu se pot schimba
    document.querySelectorAll("#tab-setari input, #tab-setari select, #tab-setari textarea").forEach(el => {
        if (!el.disabled) { el.disabled = true; el.setAttribute("data-guest-locked", ""); }
    });
}

/* ==================== MODAL ==================== */
const FOCUSABLE = "button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Deschide fereastra de dialog.
 * `body` este HTML generat de aplicație (valorile utilizatorului sunt escapate de apelant).
 */
function openModal({ title, body = "", onConfirm = null, confirmText = "Confirmă", danger = false, cancelText = "Anulează", layout = "dialog", guestOk = false }) {
    if (!guestOk && !canEdit()) { requireAccount(); return; } // formularele (adăugare, editare, ștergere) cer cont
    const overlay = $("action-modal");
    const confirmBtn = $("action-modal-confirm");
    const cancelBtn = $("action-modal-cancel");

    if (overlay.hidden) {
        ui.modalReturnFocus = document.activeElement;
    }

    // Formularele se deschid ca panou lateral (pe telefon: foaie de jos); confirmările rămân la mijloc.
    overlay.classList.toggle("is-panel", layout === "panel");
    overlay.classList.toggle("is-dialog", layout !== "panel");
    $("action-modal-title").textContent = title;
    $("action-modal-body").innerHTML = body;

    confirmBtn.hidden = !confirmText;
    confirmBtn.textContent = confirmText || "";
    confirmBtn.className = danger ? "btn btn-danger" : "btn btn-primary";
    confirmBtn.onclick = typeof onConfirm === "function" ? onConfirm : null;
    cancelBtn.textContent = cancelText;
    cancelBtn.hidden = !cancelText;

    overlay.hidden = false;
    document.body.classList.add("modal-open");

    const firstField = overlay.querySelector("#action-modal-body input:not([readonly]), #action-modal-body select, #action-modal-body textarea, #action-modal-body button");
    (firstField || (confirmText ? confirmBtn : cancelBtn)).focus();
}

function closeActionModal() {
    const overlay = $("action-modal");
    if (!overlay || overlay.hidden) return;
    if (cloud.asking) return; // întrebarea despre date are nevoie de un răspuns (altfel s-ar putea pierde note)

    overlay.hidden = true;
    document.body.classList.remove("modal-open");
    if (focusRun.it) stopFocus(); // „Renunț” / Escape / fundal: cronometrul se oprește, sesiunea rămâne nebifată
    $("action-modal-confirm").onclick = null;
    $("action-modal-body").innerHTML = "";
    ui.ttDraft = null;

    const back = ui.modalReturnFocus;
    ui.modalReturnFocus = null;
    if (back && document.contains(back)) back.focus();
    if (ui.tourAfterModal) {
        ui.tourAfterModal = false;
        setTimeout(maybeStartTour, 300);
    }
}

function trapModalFocus(event) {
    const overlay = $("action-modal");
    if (overlay.hidden || event.key !== "Tab") return;

    const items = [...overlay.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function field(id) {
    return $(id)?.value ?? "";
}

function optionsHTML(values, selected) {
    return values.map(v => `<option value="${escapeHTML(v)}" ${v === selected ? "selected" : ""}>${escapeHTML(v)}</option>`).join("");
}

/* ==================== NOTE ==================== */
/** Formular comun pentru adăugarea și editarea unei note. */
function gradeFormHTML({ val = 10, type = "Test", date = getLocalDateKey() } = {}, subjectField = "") {
    const v = Number(val);
    return `
        ${subjectField}
        <div class="grade-pick" role="group" aria-label="Alege nota">
            ${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button type="button" class="grade-pick-btn tone-${gradeTone(n)}" data-action="grade-pick" data-val="${n}" aria-pressed="${n === v}">${n}</button>`).join("")}
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="modal-grade-val">Nota (1-10)</label>
                <input type="number" id="modal-grade-val" class="glass-input" min="1" max="10" step="1" value="${escapeHTML(val)}" inputmode="numeric">
            </div>
            <div class="form-group">
                <label for="modal-grade-type">Tip evaluare</label>
                <select id="modal-grade-type" class="glass-select">${optionsHTML(GRADE_TYPES, GRADE_TYPES.includes(type) ? type : "Altele")}</select>
            </div>
        </div>
        <div class="form-group">
            <label for="modal-grade-date">Data</label>
            <div class="grade-date-row">
                <input type="date" id="modal-grade-date" class="glass-input" value="${escapeHTML(date || "")}" max="${getLocalDateKey()}">
                <button type="button" class="btn btn-glass btn-sm" data-action="grade-date" data-days="0">Azi</button>
                <button type="button" class="btn btn-glass btn-sm" data-action="grade-date" data-days="1">Ieri</button>
            </div>
        </div>`;
}

/** Citește formularul de notă; întoarce null (cu mesaj) dacă ceva nu e valid. */
function readGradeForm() {
    const val = parseStrictInteger(field("modal-grade-val"), 1, 10);
    if (val === null) {
        showToast("⚠️ Nota trebuie să fie un număr întreg între 1 și 10.");
        $("modal-grade-val")?.focus();
        return null;
    }

    const date = field("modal-grade-date");
    if (date && (!DATE_KEY_RE.test(date) || Number.isNaN(parseDateKey(date).getTime()))) {
        showToast("⚠️ Data nu este validă.");
        $("modal-grade-date")?.focus();
        return null;
    }
    if (date > getLocalDateKey()) {
        showToast("⚠️ Data notei nu poate fi în viitor.");
        $("modal-grade-date")?.focus();
        return null;
    }

    const type = GRADE_TYPES.includes(field("modal-grade-type")) ? field("modal-grade-type") : "Altele";
    return { val, type, date };
}

/**
 * `link` (opțional) leagă nota de un test din calendar: { eventId, eventDate, type, title }.
 */
function openAddGradeModal(presetMat = null, link = null) {
    const subjects = Object.keys(state.subjects);
    if (subjects.length === 0) {
        showToast("⚠️ Adaugă mai întâi o materie.");
        return;
    }
    if (presetMat && !state.subjects[presetMat]) {
        showToast("⚠️ Materia nu mai există.");
        return;
    }

    // Fără materie dată, propunem materia deschisă în catalog.
    const suggested = state.subjects[ui.catalog.selected] ? ui.catalog.selected : subjects[0];
    const subjectField = presetMat ? "" : `
        <div class="form-group">
            <label for="modal-grade-mat">Materia</label>
            <select id="modal-grade-mat" class="glass-select">${optionsHTML(subjects, suggested)}</select>
        </div>`;

    openModal({
        layout: "panel",
        title: link ? `Nota la „${link.title}”` : presetMat ? `Notă nouă · ${presetMat}` : "Adaugă notă",
        confirmText: "Adaugă",
        body: (link ? `<p class="modal-hint">${escapeHTML(presetMat)} · ${escapeHTML(getDateLabel(link.eventDate))}. Nota apare în catalog și testul se bifează.</p>` : "")
            + gradeFormHTML(link ? { type: link.type, date: link.eventDate } : {}, subjectField),
        onConfirm: () => {
            const mat = presetMat || field("modal-grade-mat");
            if (!state.subjects[mat]) {
                showToast("⚠️ Materia selectată nu mai există.");
                return;
            }
            const values = readGradeForm();
            if (!values) return;

            const grade = { val: values.val, type: values.type };
            if (values.date) grade.date = values.date;
            if (link) {
                grade.eventId = link.eventId;
                grade.eventDate = link.eventDate;
            }
            state.subjects[mat].grades.push(grade);

            addActivity(`Ai adăugat nota ${values.val} (${values.type}) la ${mat}.`);
            ui.catalog.selected = mat;
            closeActionModal();
            refresh();
            showToast(`Ai adăugat nota ${values.val} la ${mat}.`);
        }
    });
    $("modal-grade-val")?.select();
}

function openEditGradeModal(mat, idx) {
    const grade = state.subjects[mat]?.grades[idx];
    if (!grade) return;

    openModal({
        layout: "panel",
        title: `Editează nota · ${mat}`,
        confirmText: "Salvează",
        body: gradeFormHTML({ val: grade.val, type: grade.type, date: grade.date || "" }),
        onConfirm: () => {
            const values = readGradeForm();
            if (!values) return;
            if (state.subjects[mat]?.grades[idx] !== grade) {
                closeActionModal();
                showToast("⚠️ Nota nu mai există.");
                return;
            }

            const before = grade.val;
            grade.val = values.val;
            grade.type = values.type;
            if (values.date) grade.date = values.date;
            else delete grade.date;

            addActivity(before === values.val
                ? `Ai modificat detaliile notei ${values.val} la ${mat}.`
                : `Ai modificat nota la ${mat}: ${before} → ${values.val}.`);
            closeActionModal();
            refresh();
            showToast("Notă actualizată.");
        }
    });
    $("modal-grade-val")?.select();
}

function deleteGrade(mat, idx) {
    const grade = state.subjects[mat]?.grades[idx];
    if (!grade) return;
    closeActionModal();
    withUndo(`Ai șters nota ${grade.val} de la ${mat}.`, () => {
        state.subjects[mat].grades.splice(idx, 1);
        addActivity(`Ai șters nota ${grade.val} de la ${mat}.`);
    });
}

/* ==================== MATERII ==================== */
/** Verifică numele unei materii; întoarce numele curățat sau null (cu mesaj). */
function validateSubjectName(raw, currentName = null) {
    const name = String(raw).trim().replace(/\s+/g, " ");
    if (!name) {
        showToast("⚠️ Introdu numele materiei.");
        return null;
    }
    if (name === "__proto__" || name === PURTARE_KEY) {
        showToast("⚠️ Numele materiei nu este valid.");
        return null;
    }
    if (isLegacyPurtareName(name) && !(currentName && isLegacyPurtareName(currentName))) {
        showToast("⚠️ Purtarea este deja în catalog (preinstalată).");
        return null;
    }
    const duplicate = Object.keys(state.subjects).find(m =>
        m !== currentName && m.toLocaleLowerCase("ro") === name.toLocaleLowerCase("ro"));
    if (duplicate) {
        showToast(`⚠️ Materia ${duplicate} există deja.`);
        return null;
    }
    return name;
}

function subjectFormHTML({ name = "", ore = 2, target = 10, priority = false, excludeFromGPA = false } = {}, { withFlags = false, withName = true } = {}) {
    return `
        ${withName ? subjectNameFieldHTML(name) : ""}
        <div class="form-row">
            <div class="form-group">
                <label for="subj-ore">Ore / săptămână</label>
                <input type="number" id="subj-ore" class="glass-input" value="${escapeHTML(ore)}" min="0.5" max="100" step="0.5" inputmode="decimal">
            </div>
            <div class="form-group">
                <label for="subj-target">Ținta (media finală)</label>
                <input type="number" id="subj-target" class="glass-input" value="${escapeHTML(target)}" min="1" max="10" step="0.5" inputmode="decimal">
            </div>
        </div>
        ${withFlags ? `
            <label class="check-row"><input type="checkbox" id="subj-priority" ${priority ? "checked" : ""}> ${icon("star")} Materie prioritară</label>
            <label class="check-row"><input type="checkbox" id="subj-exclude" ${excludeFromGPA ? "checked" : ""}> ${icon("ban")} Exclusă din media generală</label>` : ""}`;
}

/**
 * Numele unei materii la editare: din programă = fix; opționalul = doar tema; o materie din afara programei
 * se poate înlocui cu una din programă (notele rămân).
 */
function subjectNameFieldHTML(name) {
    if (isOptionalName(name)) return `
        <div class="form-group">
            <label for="subj-opt">Ce opțional faci?</label>
            <input type="text" id="subj-opt" class="glass-input" maxlength="40" placeholder="ex: Educație financiară" autocomplete="off" value="${escapeHTML(optionalTopic(name))}">
        </div>`;
    if (inProgramme(name)) return `
        <div class="form-group">
            <span class="form-label">Materia</span>
            <p class="subj-fixed">${escapeHTML(name)} <small>${myProgramme() ? "din programa ta" : ""}</small></p>
        </div>`;
    const options = missingProgrammeRows().filter(r => r.kind !== "opt");
    return `
        <div class="form-group">
            <label for="subj-swap">Materia <span class="label-hint">(în afara programei)</span></label>
            <select id="subj-swap" class="glass-select">
                <option value="">Rămâne „${escapeHTML(name)}”</option>
                ${options.map(r => `<option value="${escapeHTML(r.name)}">Devine ${escapeHTML(r.name)} (notele rămân)</option>`).join("")}
            </select>
        </div>`;
}

function promptAddMaterie() {
    if (!myProgramme()) {
        openModal({
            layout: "panel",
            title: "Materie nouă",
            confirmText: "Alege programa",
            body: `
                <p class="modal-hint">Materiile vin din programa clasei tale (planul-cadru), plus dirigenția și un opțional. Alege-ți mai întâi profilul și clasa; materiile pe care le ai deja rămân neatinse.</p>`,
            onConfirm: () => { closeActionModal(); openSetup(1); }
        });
        return;
    }
    const missing = missingProgrammeRows();
    if (!missing.length) {
        openModal({
            layout: "panel",
            title: "Materie nouă",
            confirmText: "Schimbă programa",
            cancelText: "Închide",
            body: `
                <p class="modal-hint">Ai deja toate materiile din programa ta (${escapeHTML(programmeLabel())}), plus dirigenția și opționalul.</p>
                <p class="modal-hint">Ai trecut în altă clasă sau ai schimbat profilul? Schimbă programa și îți propun materiile noi.</p>`,
            onConfirm: () => { closeActionModal(); openSetup(1); }
        });
        return;
    }
    const first = missing[0];
    openModal({
        layout: "panel",
        title: "Materie nouă",
        confirmText: "Adaugă",
        body: `
            <p class="modal-hint">Din programa ta: ${escapeHTML(programmeLabel())}.</p>
            <div class="form-group">
                <label for="subj-pick">Materia</label>
                <select id="subj-pick" class="glass-select">
                    ${missing.map(r => `<option value="${escapeHTML(r.kind === "opt" ? "__opt" : r.name)}" data-ore="${r.ore}">${escapeHTML(r.kind === "opt" ? `${OPT} (maximum unul; scrii tu tema)` : r.name)}</option>`).join("")}
                </select>
            </div>
            <div class="form-group" id="subj-opt-group" ${first.kind === "opt" ? "" : "hidden"}>
                <label for="subj-opt">Ce opțional faci?</label>
                <input type="text" id="subj-opt" class="glass-input" maxlength="40" placeholder="ex: Educație financiară" autocomplete="off">
            </div>
            ${subjectFormHTML({ ore: first.ore }, { withName: false })}`,
        onConfirm: () => {
            const pick = field("subj-pick");
            const row = missing.find(r => (r.kind === "opt" ? "__opt" : r.name) === pick);
            if (!row) return;
            const name = row.kind === "opt" ? optionalName(field("subj-opt")) : row.name;
            if (row.kind === "opt" && firstOptional()) {
                showToast(`⚠️ Poți avea un singur opțional (${firstOptional()}).`);
                return;
            }
            if (findSubjectName(name)) {
                showToast(`⚠️ ${name} e deja în catalog.`);
                return;
            }

            state.subjects[name] = {
                ore: clampNumber(field("subj-ore"), 0.5, 100, 2),
                target: clampNumber(field("subj-target"), 1, 10, 10),
                grades: [],
                priority: false,
                excludeFromGPA: row.kind === "dirig" && (myProgramme()?.cls || 9) >= 9
            };
            addActivity(`Ai adăugat materia ${name}.`);
            ui.catalog.selected = name;
            ui.catalog.showDetail = ui.activeTab === "tab-catalog";
            ui.catalog.autoPicked = false;
            closeActionModal();
            refresh();
            showToast(`Ai adăugat materia ${name}.`);
        }
    });
    // alegerea materiei completează orele din planul-cadru și arată câmpul pentru opțional
    $("subj-pick")?.addEventListener("change", event => {
        const opt = event.target.selectedOptions[0];
        if ($("subj-ore") && opt?.dataset.ore) $("subj-ore").value = opt.dataset.ore;
        const isOpt = event.target.value === "__opt";
        $("subj-opt-group").hidden = !isOpt;
        if (isOpt) $("subj-opt")?.focus();
    });
}

/**
 * Redenumește o materie și tot ce face referire la ea:
 * evenimentele din calendar, notele ipotetice din Simulator și starea alertelor.
 * Ordinea materiilor rămâne aceeași.
 */
function renameSubject(oldName, newName) {
    if (oldName === newName || !state.subjects[oldName]) return;

    state.subjects = Object.fromEntries(
        Object.entries(state.subjects).map(([k, v]) => [k === oldName ? newName : k, v])
    );

    Object.values(state.calendar).forEach(events => events.forEach(ev => {
        if (ev.subject === oldName) ev.subject = newName;
    }));

    sim.scenarios.forEach(sc => {
        if (sc.hypo[oldName]) {
            sc.hypo[newName] = sc.hypo[oldName];
            delete sc.hypo[oldName];
        }
    });
    if (sim.selected === oldName) sim.selected = newName;

    for (const day of Object.keys(state.timetable)) {
        state.timetable[day] = state.timetable[day].map(m => (m === oldName ? newName : m));
    }

    ["dismissed", "read"].forEach(bucket => ["nonote-", "risk-"].forEach(prefix => {
        if (state.alertMeta[bucket][prefix + oldName]) {
            state.alertMeta[bucket][prefix + newName] = true;
            delete state.alertMeta[bucket][prefix + oldName];
        }
    }));

    if (ui.catalog.selected === oldName) ui.catalog.selected = newName;
}

function openEditSubjectModal(mat) {
    const sub = state.subjects[mat];
    if (!sub) return;

    openModal({
        layout: "panel",
        title: `Editează · ${mat}`,
        confirmText: "Salvează",
        body: subjectFormHTML({ name: mat, ...sub }, { withFlags: true }),
        onConfirm: () => {
            if (!state.subjects[mat]) {
                closeActionModal();
                showToast("⚠️ Materia nu mai există.");
                return;
            }
            let name = mat;
            if (isOptionalName(mat)) name = optionalName(field("subj-opt"));
            else if (field("subj-swap")) name = field("subj-swap");
            if (name !== mat && findSubjectName(name) && findSubjectName(name) !== mat) {
                showToast(`⚠️ ${name} e deja în catalog.`);
                return;
            }

            const changes = [];
            const ore = clampNumber(field("subj-ore"), 0.5, 100, sub.ore);
            const target = clampNumber(field("subj-target"), 1, 10, sub.target);
            const priority = $("subj-priority")?.checked ?? sub.priority;
            const excludeFromGPA = $("subj-exclude")?.checked ?? sub.excludeFromGPA;

            if (ore !== sub.ore) changes.push(`ore ${fmtNumber(sub.ore)} → ${fmtNumber(ore)}`);
            if (target !== sub.target) changes.push(`ținta ${fmtTarget(sub.target)} → ${fmtTarget(target)}`);
            if (priority !== sub.priority) changes.push(priority ? "prioritară" : "nu mai e prioritară");
            if (excludeFromGPA !== sub.excludeFromGPA) changes.push(excludeFromGPA ? "exclusă din medie" : "inclusă în medie");
            Object.assign(sub, { ore, target, priority, excludeFromGPA });

            if (name !== mat) {
                renameSubject(mat, name);
                changes.unshift(`redenumită în ${name}`);
            }

            if (changes.length) addActivity(`${mat}: ${changes.join(", ")}.`);
            closeActionModal();
            refresh();
            showToast(changes.length ? "Materie actualizată." : "Nicio modificare.");
        }
    });
}

function deleteSubject(mat) {
    const sub = state.subjects[mat];
    if (!sub) return;
    closeActionModal();
    const n = sub.grades.length;
    withUndo(`Ai șters materia ${mat}${n ? ` și ${plural(n, "notă", "note")}` : ""}.`, () => {
        delete state.subjects[mat];
        if (ui.catalog.selected === mat) {
            ui.catalog.selected = "";
            ui.catalog.showDetail = false;
        }
        pruneSubjectAlertMeta();
        addActivity(`Ai șters materia ${mat}.`);
    }, {
        afterUndo: () => {
            ui.catalog.selected = mat;
            ui.catalog.autoPicked = false;
        }
    });
}

function togglePriority(mat) {
    const sub = state.subjects[mat];
    if (!sub) return;
    sub.priority = !sub.priority;
    addActivity(sub.priority ? `Ai marcat materia ${mat} ca prioritară.` : `Ai eliminat ${mat} din materiile prioritare.`);
    refresh();
}

function toggleExclude(mat) {
    const sub = state.subjects[mat];
    if (!sub) return;
    sub.excludeFromGPA = !sub.excludeFromGPA;
    addActivity(sub.excludeFromGPA ? `${mat} a fost exclusă din media generală.` : `${mat} a fost inclusă din nou în media generală.`);
    refresh();
}

/* ==================== CALENDAR ==================== */
/* ---------- formularul de eveniment (adăugare și editare) ---------- */
function eventFormHTML(v, { editing = false, occurrenceDate = "" } = {}) {
    const subjects = Object.keys(state.subjects);
    const isSeries = Boolean(v.repeat);
    return `
        <div class="ev-type-picker" role="radiogroup" aria-label="Tip eveniment">
            ${EVENT_TYPES.map(t => `
                <label class="ev-type-opt ev-${EVENT_TYPE_CLASS[t]}">
                    <input type="radio" name="ev-type" value="${escapeHTML(t)}" ${t === v.type ? "checked" : ""}>
                    <span>${icon(EVENT_TYPE_ICON[t])} ${escapeHTML(t)}</span>
                </label>`).join("")}
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="ev-subject">Materie</label>
                <select id="ev-subject" class="glass-select">
                    <option value="" ${v.subject ? "" : "selected"}>Fără materie</option>
                    ${subjects.map(m => `<option value="${escapeHTML(m)}" ${m === v.subject ? "selected" : ""}>${escapeHTML(m)}</option>`).join("")}
                </select>
            </div>
            <div class="form-group">
                <label for="ev-title">Titlu <span class="label-hint">(opțional)</span></label>
                <input type="text" id="ev-title" class="glass-input" maxlength="100" autocomplete="off"
                    value="${escapeHTML(v.title && v.title !== autoEventTitle(v.type, v.subject) ? v.title : "")}" placeholder="${escapeHTML(autoEventTitle(v.type, v.subject))}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="ev-date">${isSeries && editing ? "Începe pe" : "Data"}</label>
                <input type="date" id="ev-date" class="glass-input" value="${escapeHTML(v.date)}">
            </div>
            <div class="form-group">
                <label for="ev-time">Ora <span class="label-hint">(opțional)</span></label>
                <input type="time" id="ev-time" class="glass-input" value="${escapeHTML(v.time || "")}">
            </div>
        </div>
        <div id="ev-next-lesson" class="ev-hint"></div>
        <div class="form-row">
            <div class="form-group">
                <label for="ev-repeat">Se repetă</label>
                <select id="ev-repeat" class="glass-select">
                    <option value="0" ${!v.repeat ? "selected" : ""}>Nu</option>
                    <option value="1" ${v.repeat?.every === 1 ? "selected" : ""}>Săptămânal</option>
                    <option value="2" ${v.repeat?.every === 2 ? "selected" : ""}>La 2 săptămâni</option>
                </select>
            </div>
            <div class="form-group">
                <label for="ev-until">Până la <span class="label-hint">(opțional)</span></label>
                <input type="date" id="ev-until" class="glass-input" value="${escapeHTML(v.repeat?.until || "")}" ${v.repeat ? "" : "disabled"}>
            </div>
        </div>
        <div class="form-group">
            <label for="ev-description">Notițe <span class="label-hint">(opțional)</span></label>
            <textarea id="ev-description" class="glass-input" rows="2" maxlength="500" placeholder="ex: capitolele 3–4, de adus calculatorul">${escapeHTML(v.description || "")}</textarea>
        </div>
        ${editing ? `
            <div class="ev-edit-foot">
                ${isSeries ? `<p class="modal-hint">↻ Eveniment repetat: modificările se aplică întregii serii.</p>` : ""}
                <button type="button" class="btn btn-text text-danger" data-action="event-delete" data-id="${escapeHTML(v.id)}" data-date="${escapeHTML(occurrenceDate)}">${icon("trash")} Șterge evenimentul</button>
            </div>` : ""}`;
}

/** Actualizează în dialog: titlul propus, „următoarea oră” și câmpul „Până la”. */
function syncEventForm() {
    if (!$("ev-subject")) return;
    const type = document.querySelector("input[name='ev-type']:checked")?.value || "Test";
    const subject = $("ev-subject").value;
    $("ev-title").placeholder = autoEventTitle(type, subject);
    $("ev-until").disabled = $("ev-repeat").value === "0";

    const hint = $("ev-next-lesson");
    const next = subject ? nextLessonDate(subject) : null;
    hint.innerHTML = next
        ? `<button type="button" class="ev-hint-btn ${$("ev-date").value === next ? "is-active" : ""}" data-action="ev-use-date" data-date="${next}">
               ${icon("calendar")} Următoarea oră de ${escapeHTML(subject)}: <b>${escapeHTML(weekdayLabel(next))}</b></button>`
        : "";
}

function readEventForm() {
    const type = EVENT_TYPES.includes(document.querySelector("input[name='ev-type']:checked")?.value)
        ? document.querySelector("input[name='ev-type']:checked").value : "Personal";
    const subject = state.subjects[field("ev-subject")] ? field("ev-subject") : "";
    const date = field("ev-date");
    if (!DATE_KEY_RE.test(date) || Number.isNaN(parseDateKey(date).getTime())) {
        showToast("⚠️ Alege o dată.");
        $("ev-date")?.focus();
        return null;
    }
    const time = TIME_RE.test(field("ev-time")) ? field("ev-time") : "";
    const every = Number(field("ev-repeat"));
    const until = field("ev-until");
    if (every && until && (!DATE_KEY_RE.test(until) || until < date)) {
        showToast("⚠️ „Până la” trebuie să fie după data de început.");
        $("ev-until")?.focus();
        return null;
    }

    return {
        type,
        subject,
        date,
        time,
        title: field("ev-title").trim().replace(/\s+/g, " ").slice(0, 100) || autoEventTitle(type, subject),
        description: field("ev-description").trim().slice(0, 500),
        repeat: every === 1 || every === 2 ? { every, until: until || "" } : null
    };
}

function openEventModal({ id = null, date = "", subject = "", type = "" } = {}) {
    // Editare
    if (id) {
        const found = findEvent(id);
        if (!found) {
            showToast("⚠️ Evenimentul nu mai există.");
            return;
        }
        const { ev, start } = found;
        openModal({
            layout: "panel",
            title: `${ev.title}`,
            confirmText: "Salvează",
            body: eventFormHTML({ ...ev, date: start }, { editing: true, occurrenceDate: date || start }),
            onConfirm: () => {
                const values = readEventForm();
                if (!values) return;
                saveEventEdits(id, values);
            }
        });
        syncEventForm();
        return;
    }

    // Adăugare: data implicită = ziua aleasă, altfel următoarea oră a materiei, altfel azi.
    const preset = state.subjects[subject] ? subject : "";
    const when = DATE_KEY_RE.test(date) ? date : (preset && nextLessonDate(preset)) || getLocalDateKey();
    openModal({
        layout: "panel",
        title: `Eveniment nou · ${weekdayLabel(when)}`,
        confirmText: "Adaugă",
        body: eventFormHTML({ type: EVENT_TYPES.includes(type) ? type : "Test", subject: preset, date: when, title: "" }),
        onConfirm: () => {
            const values = readEventForm();
            if (!values) return;

            const ev = { id: uid(), title: values.title, time: values.time, type: values.type, subject: values.subject, description: values.description };
            if (values.repeat) ev.repeat = values.repeat;
            (state.calendar[values.date] ||= []).push(ev);

            addActivity(`Ai adăugat „${ev.title}” pentru ${getDateLabel(values.date)}${ev.repeat ? " (se repetă)" : ""}.`);
            ui.cal.date = values.date;
            closeActionModal();
            refresh();
            showToast(`Ai adăugat „${ev.title}”, ${relativeDayLabel(values.date)}.`);
        }
    });
    syncEventForm();
    // Cu materia deja aleasă, utilizatorul de obicei vrea doar să confirme.
    (preset ? $("action-modal-confirm") : $("ev-subject"))?.focus();
}

function saveEventEdits(id, values) {
    const found = findEvent(id);
    if (!found) {
        closeActionModal();
        showToast("⚠️ Evenimentul nu mai există.");
        return;
    }
    const { ev, start } = found;

    Object.assign(ev, { title: values.title, time: values.time, type: values.type, subject: values.subject, description: values.description });

    if (values.repeat) {
        ev.repeat = values.repeat;
    } else if (ev.repeat) {
        // Seria devine un eveniment unic, la data de început.
        delete ev.repeat;
        delete ev.skipDates;
        if (ev.doneDates) ev.doneDates = ev.doneDates[start] ? { [start]: true } : undefined;
        if (!ev.doneDates) delete ev.doneDates;
    }

    if (values.date !== start) moveEventStart(ev, start, values.date);

    clearEventAlertMeta(ev);
    addActivity(`Ai modificat „${ev.title}”.`);
    ui.cal.date = values.date;
    closeActionModal();
    refresh();
    showToast("Eveniment actualizat.");
}

/** Mută începutul unui eveniment; pentru unul unic, mută și starea „făcut” și legătura cu nota. */
function moveEventStart(ev, from, to) {
    const list = state.calendar[from] || [];
    const i = list.indexOf(ev);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) delete state.calendar[from];
    (state.calendar[to] ||= []).push(ev);

    if (!ev.repeat) {
        if (ev.doneDates?.[from]) ev.doneDates = { [to]: true };
        Object.values(state.subjects).forEach(sub => sub.grades.forEach(g => {
            if (g.eventId === ev.id && g.eventDate === from) g.eventDate = to;
        }));
    }
}

/** Mutare prin drag & drop: o apariție dintr-o serie devine un eveniment separat. */
function moveOccurrence(id, from, to) {
    if (!DATE_KEY_RE.test(String(to)) || from === to) return;
    const found = findEvent(id);
    if (!found) return;
    const { ev, start } = found;

    if (linkedGrade(gradeLinks(), ev, from)) {
        showToast("⚠️ Evenimentul are deja o notă, așa că rămâne la data lui.");
        return;
    }

    if (ev.repeat) {
        ev.skipDates = [...new Set([...(ev.skipDates || []), from])];
        if (ev.doneDates) delete ev.doneDates[from];
        const copy = { id: uid(), title: ev.title, time: ev.time, type: ev.type, subject: ev.subject, description: ev.description };
        (state.calendar[to] ||= []).push(copy);
    } else {
        moveEventStart(ev, start, to);
    }

    clearEventAlertMeta(ev);
    addActivity(`Ai mutat „${ev.title}” pe ${getDateLabel(to)}.`);
    refresh();
    showToast(`Ai mutat „${ev.title}” pe ${weekdayLabel(to)}.`);
}

function promptDeleteEvent(id, date) {
    const found = findEvent(id);
    if (!found) return;
    const { ev, start } = found;

    const removeSeries = () => {
        const list = state.calendar[start] || [];
        const i = list.indexOf(ev);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) delete state.calendar[start];
        clearEventAlertMeta(ev);
        addActivity(`Ai șters „${ev.title}”${ev.repeat ? " (toată seria)" : ""}.`);
    };

    if (!ev.repeat) {
        closeActionModal();
        withUndo(`Ai șters „${ev.title}”.`, removeSeries);
        return;
    }

    const occ = DATE_KEY_RE.test(String(date)) ? date : start;
    openModal({
        title: "Șterge evenimentul repetat",
        confirmText: "",
        cancelText: "Anulează",
        body: `
            <p class="modal-hint">„${escapeHTML(ev.title)}” se repetă ${ev.repeat.every === 2 ? "la 2 săptămâni" : "săptămânal"}.</p>
            <button type="button" class="reset-option-card" data-action="event-delete-one" data-id="${escapeHTML(id)}" data-date="${occ}">
                <span><span class="reset-option-title">Doar pe ${escapeHTML(weekdayLabel(occ))}</span>
                <span class="reset-option-hint">Celelalte apariții rămân.</span></span>
                <span class="reset-option-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="reset-option-card danger" data-action="event-delete-all" data-id="${escapeHTML(id)}">
                <span><span class="reset-option-title">Toată seria</span>
                <span class="reset-option-hint">Toate aparițiile, trecute și viitoare.</span></span>
                <span class="reset-option-arrow" aria-hidden="true">→</span>
            </button>`
    });
}

function deleteSeries(id) {
    const found = findEvent(id);
    if (!found) return;
    const { ev, start } = found;
    closeActionModal();
    withUndo(`Ai șters toată seria „${ev.title}”.`, () => {
        const list = state.calendar[start] || [];
        const i = list.indexOf(ev);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) delete state.calendar[start];
        clearEventAlertMeta(ev);
        addActivity(`Ai șters „${ev.title}” (toată seria).`);
    });
}

function deleteOccurrence(id, date) {
    const found = findEvent(id);
    if (!found || !found.ev.repeat) return;
    const { ev } = found;
    closeActionModal();
    withUndo(`Ai șters „${ev.title}” doar pe ${weekdayLabel(date)}.`, () => {
        ev.skipDates = [...new Set([...(ev.skipDates || []), date])];
        if (ev.doneDates) delete ev.doneDates[date];
        addActivity(`Ai șters „${ev.title}” din ${getDateLabel(date)}.`);
    });
}

/* ---------- făcut / notă ---------- */
function toggleEventDone(id, date) {
    const found = findEvent(id);
    if (!found || !DATE_KEY_RE.test(String(date))) return;
    const { ev } = found;
    if (linkedGrade(gradeLinks(), ev, date)) return;

    ev.doneDates ||= {};
    if (ev.doneDates[date]) delete ev.doneDates[date];
    else ev.doneDates[date] = true;
    const nowDone = Boolean(ev.doneDates[date]);
    if (Object.keys(ev.doneDates).length === 0) delete ev.doneDates;

    if (nowDone) addActivity(`Ai bifat „${ev.title}” ca făcut.`);
    refresh();
}

function openGradeForEvent(id, date) {
    const found = findEvent(id);
    if (!found) return;
    const { ev } = found;
    if (!canGradeOccurrence(ev, date, gradeLinks())) {
        showToast(state.subjects[ev.subject] ? "Nota se poate adăuga după data evenimentului." : "Alege mai întâi materia evenimentului.");
        return;
    }
    openAddGradeModal(ev.subject, { eventId: ev.id, eventDate: date, type: GRADE_TYPE_FOR_EVENT[ev.type], title: ev.title });
}

/* ---------- orar ---------- */
function openTimetableModal() {
    if (Object.keys(state.subjects).length === 0) {
        showToast("⚠️ Adaugă mai întâi materiile, apoi orarul.");
        return;
    }
    ui.ttDraft = clone(state.timetable);
    openModal({
        layout: "panel",
        title: "Orarul săptămânal",
        confirmText: "Salvează orarul",
        body: `
            <p class="modal-hint">Adaugă materiile în ordinea orelor. În calendar, fiecare zi îți arată orele; atinge o materie ca să programezi rapid un test sau o temă.</p>
            <div id="tt-editor" class="tt-editor">${ttEditorHTML()}</div>`,
        onConfirm: () => {
            state.timetable = {};
            TIMETABLE_DAYS.forEach(day => {
                const list = (ui.ttDraft[day] || []).filter(m => state.subjects[m]);
                if (list.length) state.timetable[day] = list;
            });
            ui.ttDraft = null;
            addActivity("Ai actualizat orarul.");
            closeActionModal();
            refresh();
            showToast("🗓️ Orar salvat.");
        }
    });
}

function ttEditorHTML() {
    const subjects = Object.keys(state.subjects);
    return TIMETABLE_DAYS.map(day => {
        const list = ui.ttDraft[day] || [];
        const full = list.length >= TIMETABLE_MAX;
        return `
            <div class="tt-day">
                <div class="tt-day-head">
                    <b>${WEEKDAY_LONG[day]}</b>
                    <small>${list.length ? plural(list.length, "oră", "ore") : "liber"}</small>
                </div>
                <div class="tt-chips">
                    ${list.map((m, i) => `
                        <span class="tt-chip"><span class="tt-num">${i + 1}</span>${escapeHTML(m)}
                            <button type="button" data-action="tt-remove" data-day="${day}" data-index="${i}" aria-label="${escapeHTML(`Scoate ${m}, ora ${i + 1}, ${WEEKDAY_LONG[day]}`)}">×</button>
                        </span>`).join("")}
                    <select class="glass-select tt-add" data-tt-add="${day}" aria-label="Adaugă o oră ${WEEKDAY_LONG[day]}" ${full ? "disabled" : ""}>
                        <option value="">Adaugă oră</option>
                        ${subjects.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join("")}
                    </select>
                </div>
            </div>`;
    }).join("");
}

function rerenderTimetableEditor(focusDay) {
    const box = $("tt-editor");
    if (!box) return;
    box.innerHTML = ttEditorHTML();
    box.querySelector(`[data-tt-add="${focusDay}"]`)?.focus();
}

/** Schimbările din câmpurile dialogului (formular eveniment, editor orar). */
function handleModalChange(event) {
    const el = event.target;
    if (el.matches("[data-tt-add]") && ui.ttDraft) {
        const day = el.dataset.ttAdd;
        if (state.subjects[el.value] && (ui.ttDraft[day] || []).length < TIMETABLE_MAX) {
            (ui.ttDraft[day] ||= []).push(el.value);
        }
        rerenderTimetableEditor(day);
        return;
    }
    if (el.id === "ev-subject" || el.id === "ev-repeat" || el.id === "ev-date" || el.name === "ev-type") syncEventForm();
}

/* ---------- drag & drop în săptămână ---------- */
function bindCalendarEvents() {
    const body = $("cal-body");
    if (!body) return;
    let dragging = null;

    body.addEventListener("dragstart", event => {
        const card = event.target.closest?.(".cal-ev");
        if (!card) return;
        dragging = { id: card.dataset.id, date: card.dataset.date };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.id);
        card.classList.add("dragging");
    });
    body.addEventListener("dragend", event => {
        event.target.closest?.(".cal-ev")?.classList.remove("dragging");
        body.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
        dragging = null;
    });
    body.addEventListener("dragover", event => {
        const col = event.target.closest?.(".cal-col");
        if (!dragging || !col) return;
        event.preventDefault();
        body.querySelectorAll(".drop-target").forEach(el => el !== col && el.classList.remove("drop-target"));
        col.classList.add("drop-target");
    });
    body.addEventListener("drop", event => {
        const col = event.target.closest?.(".cal-col");
        if (!dragging || !col) return;
        event.preventDefault();
        const { id, date } = dragging;
        dragging = null;
        moveOccurrence(id, date, col.dataset.date);
    });

    $("action-modal-body").addEventListener("change", handleModalChange);
}

/* ==================== RESETARE ==================== */
const RESET_OPTIONS = {
    1: {
        icon: "note", label: "Resetează toate notele", hint: "Păstrează materiile; purtarea revine la 10",
        title: "Confirmare resetare note",
        body: "<p>Ești sigur că vrei să ștergi toate notele? Materiile vor fi păstrate, iar purtarea revine la 10 pe toate modulele.</p>",
        danger: false,
        run() {
            Object.values(state.subjects).forEach(sub => { sub.grades = []; });
            state.purtare.grades = {};
            pruneSubjectAlertMeta();
            addActivity("Au fost resetate toate notele (inclusiv purtarea).");
            return "Toate notele au fost resetate.";
        }
    },
    2: {
        icon: "notebook", label: "Resetează materiile și toate notele", hint: "Elimină toate materiile și notele asociate",
        title: "Confirmare resetare materii",
        body: `<p>Ești sigur că vrei să ștergi toate materiile și toate notele?</p><p class="danger-note">Această acțiune nu poate fi anulată.</p>`,
        danger: true,
        run() {
            state.subjects = {};
            state.purtare.grades = {};
            ui.catalog.selected = "";
            pruneSubjectAlertMeta();
            addActivity("Au fost șterse toate materiile și notele.");
            return "Toate materiile și notele au fost eliminate.";
        }
    },
    3: {
        icon: "calendar", label: "Resetează calendarul", hint: "Șterge toate evenimentele",
        title: "Confirmare resetare calendar",
        body: "<p>Ești sigur că vrei să ștergi toate evenimentele din calendar?</p>",
        danger: false,
        run() {
            state.calendar = {};
            clearAllEventAlertMeta();
            addActivity("Calendarul a fost resetat.");
            return "Calendarul a fost resetat.";
        }
    },
    4: {
        icon: "alert", label: "Resetează tot", hint: "Șterge absolut toate datele", dangerCard: true,
        title: "Resetare completă",
        body: `
            <p class="danger-note">Toate materiile, notele, evenimentele, orarul, alertele, istoricul și realizările vor fi șterse definitiv.</p>
            <p class="mt-3">Setările aplicației vor fi păstrate.</p>`,
        confirmText: "Da, resetează tot",
        danger: true,
        run() {
            state.subjects = {};
            state.calendar = {};
            state.timetable = {};
            state.purtare = defaultPurtare();
            state.activity = [];
            state.history = [];
            state.alertMeta = { dismissed: {}, read: {} };
            state.achievements = Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, false]));
            ui.catalog.selected = "";
            sim = defaultSim();
            destroyAllCharts();
            return "Aplicația a fost resetată complet.";
        }
    }
};

function openResetMenu() {
    openModal({
        title: "Resetare date",
        confirmText: "",
        cancelText: "Închide",
        body: `
            <p class="modal-hint">Alege ce date dorești să elimini.</p>
            ${Object.entries(RESET_OPTIONS).map(([id, o]) => `
                <button type="button" class="reset-option-card ${o.dangerCard ? "danger" : ""}" data-action="reset-option" data-option="${id}">
                    <span>
                        <span class="reset-option-title">${icon(o.icon)} ${o.label}</span>
                        <span class="reset-option-hint">${o.hint}</span>
                    </span>
                    <span class="reset-option-arrow" aria-hidden="true">→</span>
                </button>`).join("")}`
    });
}

function confirmResetOption(id) {
    const option = RESET_OPTIONS[id];
    if (!option) return;

    openModal({
        title: option.title,
        body: option.body,
        confirmText: option.confirmText || "Confirmă resetarea",
        danger: option.danger,
        onConfirm: () => {
            const message = option.run();
            closeActionModal();
            refresh();
            showToast(message);
        }
    });
}

/* ==================== ALERTE ==================== */
function dismissAlert(id) {
    if (!id) return;
    withUndo("Notificare ascunsă.", () => { state.alertMeta.dismissed[id] = true; });
}

function markAllAlertsRead() {
    alerts.forEach(alert => { state.alertMeta.read[alert.id] = true; });
    refresh();
    showToast("Toate notificările sunt marcate ca citite.");
}

/* ==================== SETĂRI ==================== */
function saveSettings({ quiet = false } = {}) {
    const s = state.settings;
    let moduleError = "";

    // Modulele se verifică primele: cu date greșite nu salvăm nimic, ca utilizatorul să le poată corecta.
    // La salvarea automată (în timp ce scrii) salvăm restul și doar arătăm discret ce nu e în regulă la module.
    if ($("set-modules")) {
        const modules = readModulesFromSettings();
        const error = validateModules(modules);
        if (error && !quiet) {
            showToast(`⚠️ ${error}`);
            return;
        }
        if (error) moduleError = error;
        else s.modules = modules;
    }

    s.goals.primary = ["gpa", "tens", "evals"].includes(field("set-primary-goal")) ? field("set-primary-goal") : "gpa";
    s.goals.targetGPA = clampNumber(field("set-target-gpa"), 5, 10, 10);
    s.goals.minGPA = clampNumber(field("set-min-gpa"), 5, 10, 5);
    s.targets.tens = clampInteger(field("set-target-tens"), 1, 1000, 20);
    s.targets.evals = clampInteger(field("set-target-evals"), 1, 10000, 30);
    s.calc.method = field("set-calc-method") === "arithmetic" ? "arithmetic" : "weighted";
    s.calc.rounding = field("set-rounding") === "0" ? "0" : "2";
    s.calc.riskThreshold = clampNumber(field("set-risk-gpa"), 1, 10, 8);
    s.calc.riskDrop = clampNumber(field("set-risk-drop"), 0.1, 5, 0.5);
    s.appearance.theme = field("set-theme") || "system";
    s.appearance.accent = ACCENTS[field("set-accent")] ? field("set-accent") : "violet";
    s.appearance.density = field("set-density") || "normal";
    s.appearance.cursor = CURSOR_MODES.includes(field("set-cursor")) ? field("set-cursor") : "off";
    s.appearance.island = field("set-island") === "off" ? "off" : "on";
    s.profile.name = cleanName(field("set-name"), 40);
    s.profile.buddy = cleanName(field("set-buddy"), 20) || DEFAULT_SETTINGS.profile.buddy;

    applyAppearanceSettings();
    refresh();
    if (quiet) {
        // arată valorile corectate (ex. 12 → 10) fără să redeseneze modulele pe care le editezi
        for (const [id, [group, key]] of Object.entries(SETTINGS_FIELDS)) {
            const el = $(id);
            if (el && el !== document.activeElement) el.value = state.settings[group][key];
        }
        renderBuddyPreview();
        flashSettingsStatus(moduleError ? `⚠ ${moduleError}` : "✓ Salvat", Boolean(moduleError));
        return;
    }
    loadSettingsIntoUI(); // arată valorile corectate (ex. 12 → 10)
    showToast("⚙️ Setările au fost salvate.");
}

/** Mesajul discret de lângă titlul Setărilor („✓ Salvat”), pentru salvarea automată. */
function flashSettingsStatus(text, warn = false) {
    const el = $("settings-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-warn", warn);
    el.classList.add("is-on");
    clearTimeout(flashSettingsStatus.timer);
    if (!warn) flashSettingsStatus.timer = setTimeout(() => el.classList.remove("is-on"), 1800);
}

function resetSettings() {
    openModal({
        title: "Restabilește implicite",
        body: "<p>Se vor reseta doar preferințele vizuale și de calcul. Materiile și notele rămân intacte.</p>",
        confirmText: "Restabilește",
        danger: true,
        onConfirm: () => {
            state.settings = { ...clone(DEFAULT_SETTINGS), profile: state.settings.profile }; // numele rămân
            applyAppearanceSettings();
            closeActionModal();
            refresh();
            loadSettingsIntoUI();
            showToast("Setările au revenit la valorile implicite.");
        }
    });
}

/* ==================== BACKUP: EXPORT / IMPORT ==================== */
/*
 * Fișierul de backup e un JSON cu un antet (aplicație + versiune) și toate datele salvate.
 * La import, conținutul trece prin readStoredData() — aceleași verificări ca la pornire —
 * iar datele curente sunt păstrate ca să poată fi restaurate („Anulează importul”).
 */
// „app” rămâne identificatorul vechi, ca backup-urile făcute înainte de redenumire să se importe în continuare.
const BACKUP = { app: "evidenta-scolara-pro", version: 1, maxBytes: 5 * 1024 * 1024 };

class BackupError extends Error {}

function buildBackup() {
    return {
        app: BACKUP.app,
        version: BACKUP.version,
        exportedAt: new Date().toISOString(),
        data: {
            settings: state.settings,
            subjects: state.subjects,
            calendar: state.calendar,
            timetable: state.timetable,
            purtare: state.purtare,
            activity: state.activity,
            achievements: state.achievements,
            history: state.history,
            alertMeta: state.alertMeta,
            simulator: sim,
            plan: state.plan
        }
    };
}

/** Transformă textul unui fișier într-un set de date validat. Aruncă BackupError cu un mesaj clar. */
function parseBackup(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (_) {
        throw new BackupError("Fișierul nu este un JSON valid.");
    }

    if (!isPlainObject(raw) || raw.app !== BACKUP.app || !isPlainObject(raw.data)) {
        throw new BackupError("Fișierul nu pare să fie un backup al acestei aplicații.");
    }
    const version = Number(raw.version);
    if (!Number.isInteger(version) || version < 1) {
        throw new BackupError("Backup-ul are o versiune necunoscută.");
    }
    if (version > BACKUP.version) {
        throw new BackupError("Backup-ul a fost creat cu o versiune mai nouă a aplicației.");
    }

    const exportedAt = new Date(raw.exportedAt);
    return {
        loaded: readStoredData(name => raw.data[name] ?? null),
        exportedAt: Number.isNaN(exportedAt.getTime()) ? null : exportedAt
    };
}

function summarizeData(data, simData) {
    const subjects = Object.values(data.subjects);
    return {
        subjects: subjects.length,
        grades: subjects.reduce((n, sub) => n + sub.grades.length, 0),
        events: Object.values(data.calendar).reduce((n, list) => n + list.length, 0),
        scenarios: simData.scenarios.length,
        hypo: simData.scenarios.reduce((n, sc) => n + hypoCount(sc), 0)
    };
}

/** „1 notă”, „5 note”, „20 de note” (regula „de” din română). */
function plural(n, one, many) {
    if (n === 1) return `1 ${one}`;
    const needsDe = n !== 0 && (n % 100 === 0 || n % 100 >= 20);
    return `${n} ${needsDe ? "de " : ""}${many}`;
}

function summaryText(c) {
    return [
        plural(c.subjects, "materie", "materii"),
        plural(c.grades, "notă", "note"),
        plural(c.events, "eveniment", "evenimente"),
        plural(c.scenarios, "scenariu", "scenarii")
    ].join(" · ");
}

function formatDateTime(date) {
    return date.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readLocal(key) {
    try {
        return localStorage.getItem(key);
    } catch (_) {
        return null;
    }
}

function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup({ silent = false } = {}) {
    try {
        downloadJSON(buildBackup(), `urnotes-backup-${getLocalDateKey()}.json`);
    } catch (err) {
        console.error("Exportul a eșuat.", err);
        showToast("⚠️ Exportul a eșuat.");
        return false;
    }

    try {
        localStorage.setItem(KEYS.lastExport, new Date().toISOString());
    } catch (_) { /* nu e critic */ }

    renderBackupStatus();
    if (!silent) showToast("💾 Backup descărcat.");
    return true;
}

/** Păstrează datele curente ca să poată fi restaurate. Întoarce false dacă nu a reușit. */
function saveUndoSnapshot() {
    try {
        localStorage.setItem(KEYS.backupUndo, JSON.stringify(buildBackup()));
        return true;
    } catch (err) {
        console.warn("Copia pentru anulare nu a putut fi salvată.", err);
        return false;
    }
}

function clearUndoSnapshot() {
    try {
        localStorage.removeItem(KEYS.backupUndo);
    } catch (_) { /* ignorăm */ }
}

function readUndoSnapshot() {
    const raw = readLocal(KEYS.backupUndo);
    if (!raw) return null;
    try {
        return parseBackup(raw);
    } catch (_) {
        return null;
    }
}

/** Înlocuiește toate datele aplicației și redesenează tot. */
function applyImportedData(loaded) {
    applyLoadedData(loaded);
    ui.catalog = { ...ui.catalog, selected: "", showDetail: false };
    applyAppearanceSettings();
    refresh();
    loadSettingsIntoUI();
}

async function importBackupFile(file) {
    if (!requireAccount()) return;
    if (!file) return;
    if (file.size > BACKUP.maxBytes) {
        showToast("⚠️ Fișierul e prea mare pentru un backup (max. 5 MB).");
        return;
    }

    let parsed;
    try {
        parsed = parseBackup(await file.text());
    } catch (err) {
        if (!(err instanceof BackupError)) console.error("Import eșuat.", err);
        showToast(`⚠️ ${err instanceof BackupError ? err.message : "Fișierul de backup nu a putut fi citit."}`);
        return;
    }

    const incoming = summarizeData(parsed.loaded.data, parsed.loaded.sim);
    const current = summarizeData(state, sim);
    const hasCurrentData = current.subjects > 0 || current.events > 0;

    openModal({
        title: "Importă backup",
        confirmText: "Importă și înlocuiește",
        danger: hasCurrentData,
        body: `
            <div class="backup-summary">
                <span class="kpi-title">Din fișier</span>
                <b class="backup-file-name">${escapeHTML(file.name)}</b>
                ${parsed.exportedAt ? `<small>Creat pe ${escapeHTML(formatDateTime(parsed.exportedAt))}</small>` : ""}
                <span class="backup-counts">${escapeHTML(summaryText(incoming))}</span>
            </div>
            ${hasCurrentData ? `
                <div class="backup-summary is-current">
                    <span class="kpi-title">Se înlocuiesc datele actuale</span>
                    <span class="backup-counts">${escapeHTML(summaryText(current))}</span>
                </div>
                <p class="modal-hint mt-3">Toate datele actuale, inclusiv setările, sunt înlocuite cu cele din fișier. Datele actuale se păstrează: poți reveni la ele din Setări → „Anulează importul”.</p>`
            : `<p class="modal-hint mt-3">Nu ai încă date în aplicație, așa că nimic nu se pierde.</p>`}`,
        onConfirm: () => {
            let note = "";
            if (hasCurrentData) {
                if (!saveUndoSnapshot()) {
                    // Nu avem loc pentru copia de anulare → descărcăm datele actuale ca plasă de siguranță.
                    clearUndoSnapshot();
                    exportBackup({ silent: true });
                    note = " O copie a datelor anterioare a fost descărcată.";
                } else {
                    note = " Îl poți anula din Setări.";
                }
            } else {
                clearUndoSnapshot();
            }

            applyImportedData(parsed.loaded);
            addActivity(`Ai importat un backup (${summaryText(incoming)}).`);
            saveState();
            closeActionModal();
            renderBackupStatus();
            showToast(`✅ Backup importat.${note}`);
        }
    });
}

function undoImport() {
    const snap = readUndoSnapshot();
    if (!snap) {
        clearUndoSnapshot();
        renderBackupStatus();
        showToast("⚠️ Nu există un import de anulat.");
        return;
    }

    openModal({
        title: "Anulează importul",
        confirmText: "Revino la datele anterioare",
        danger: true,
        body: `
            <p>Revii la datele de dinainte de import${snap.exportedAt ? ` (${escapeHTML(formatDateTime(snap.exportedAt))})` : ""}:</p>
            <div class="backup-summary mt-3"><span class="backup-counts">${escapeHTML(summaryText(summarizeData(snap.loaded.data, snap.loaded.sim)))}</span></div>
            <p class="danger-note">Datele importate vor fi înlocuite. Dacă le vrei înapoi, va trebui să imporți din nou fișierul.</p>`,
        onConfirm: () => {
            applyImportedData(snap.loaded);
            clearUndoSnapshot();
            closeActionModal();
            renderBackupStatus();
            showToast("↩️ Importul a fost anulat.");
        }
    });
}

function renderBackupStatus() {
    const status = $("backup-status");
    if (status) {
        const last = new Date(readLocal(KEYS.lastExport) || "");
        const never = Number.isNaN(last.getTime());
        status.textContent = never
            ? "Nu ai exportat încă niciun backup. Datele există doar în acest browser."
            : `Ultimul export: ${formatDateTime(last)}`;
        status.classList.toggle("is-warning", never);
    }

    const undo = $("backup-undo");
    if (undo) {
        const snap = readUndoSnapshot();
        undo.hidden = !snap;
        if (snap) {
            setText("backup-undo-text", `Datele de dinainte de ultimul import${snap.exportedAt ? ` (${formatDateTime(snap.exportedAt)})` : ""} sunt păstrate.`);
        }
    }
}

function bindBackupEvents() {
    const input = $("backup-file-input");
    input?.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = ""; // permite alegerea aceluiași fișier de două ori la rând
        importBackupFile(file);
    });

    // Fișierul poate fi și tras direct peste card.
    const card = $("backup-card");
    if (!card) return;
    const hasFiles = event => [...(event.dataTransfer?.types || [])].includes("Files");
    card.addEventListener("dragover", event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", event => {
        if (!card.contains(event.relatedTarget)) card.classList.remove("drag-over");
    });
    card.addEventListener("drop", event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        card.classList.remove("drag-over");
        importBackupFile(event.dataTransfer.files[0]);
    });
}

/* ==================== ASPECT ==================== */
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyAppearanceSettings() {
    const a = state.settings.appearance;
    const dark = a.theme === "dark" || (a.theme === "system" && darkQuery.matches);

    document.body.classList.toggle("dark-mode", dark);
    document.documentElement.classList.toggle("theme-dark", dark); // bare de derulare și controale native întunecate
    // bara Safari și bara de stare a telefonului iau culoarea foii, chiar dacă tema din aplicație diferă de cea a telefonului
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? "#17132A" : "#FBF8F2"; m.removeAttribute("media"); });
    document.documentElement.style.setProperty("--accent-color", (ACCENTS[a.accent] || ACCENTS.violet)[dark ? "dark" : "light"]);

    document.body.classList.remove("layout-compact", "layout-spacious");
    if (a.density === "compact" || a.density === "spacious") document.body.classList.add(`layout-${a.density}`);
    applyCursorSetting();
    if (island.supported) renderIsland();
}

/* ==================== NAVIGARE ==================== */
/** Bara de sus: umbră doar după derulare + înălțimea reală în --appbar-h (folosită de lista lipită din catalog). */
function initAppBar() {
    const bar = $("app-bar");
    if (!bar) return;
    const onScroll = () => bar.classList.toggle("is-scrolled", window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const setHeight = () => document.documentElement.style.setProperty("--appbar-h", `${bar.offsetHeight}px`);
    setHeight();
    if (window.ResizeObserver) new ResizeObserver(setHeight).observe(bar);
}

function switchTab(tabId) {
    closeMoreMenu({ restoreFocus: false });
    if (!$(tabId)) return;
    hideChartTip();
    closeCustomSelect({ restoreFocus: false });
    const changed = ui.activeTab !== tabId;
    ui.activeTab = tabId;
    if (changed && tabId === "tab-statistici") ui.statsAnimate = true;
    // O pagină nouă începe de sus, cu titlul ei vizibil sub bară (nu la jumătatea derulării paginii anterioare).
    if (changed && window.scrollY > 0) window.scrollTo({ top: 0 });

    document.querySelectorAll(".tab-content").forEach(el => el.classList.toggle("active", el.id === tabId));
    $("more-btn")?.classList.toggle("is-active", tabId === "tab-simulator" || tabId === "tab-setari" || tabId === "tab-plan");
    document.querySelectorAll("[data-action='nav']").forEach(btn => {
        const active = btn.dataset.tab === tabId;
        btn.classList.toggle("active", active && (btn.classList.contains("tab-btn") || btn.classList.contains("mobile-nav-btn")));
        if (btn.classList.contains("tab-btn") || btn.classList.contains("mobile-nav-btn")) {
            if (active) btn.setAttribute("aria-current", "page");
            else btn.removeAttribute("aria-current");
        }
    });

    closeQuickAdd({ restoreFocus: false });
    renderActiveTab();
}

/* ==================== CĂUTARE ȘI COMENZI (Ctrl/⌘ K) ==================== */
/*
 * O singură casetă pentru tot: găsește materii, note și evenimente și rulează acțiuni
 * („Adaugă notă”, „Deschide Statistici”, „Exportă backup”…). Înlocuiește căutarea din antet.
 */
const CMDK_ACTIONS = [
    { label: "Configurare rapidă", hint: "profil, materii, ținte", icon: "sparkles", words: "configurare asistent profil setup start inceput materii plan cadru", run: () => openSetup(0) },
    { label: "Adaugă notă", hint: "o notă primită", icon: "note", keys: "N", words: "nota noua adauga", run: () => openAddGradeModal() },
    { label: "Adaugă test sau lucrare", hint: "în calendar", icon: "calendar-check", keys: "T", words: "test lucrare examen teza evaluare", run: () => openEventModal({ type: "Test" }) },
    { label: "Adaugă temă", hint: "în calendar", icon: "book", keys: "H", words: "tema homework", run: () => openEventModal({ type: "Temă" }) },
    { label: "Adaugă eveniment", hint: "proiect, prezentare, personal", icon: "calendar", keys: "E", words: "eveniment proiect prezentare", run: () => openEventModal({ type: "Proiect" }) },
    { label: "Adaugă materie", hint: "în catalog", icon: "plus", keys: "M", words: "materie noua", run: () => promptAddMaterie() },
    { label: "Mergi la Azi", icon: "home", words: "acasa dashboard azi start ore", run: () => switchTab("tab-dashboard") },
    { label: "Mergi la Catalog", icon: "notebook", words: "catalog materii note", run: () => switchTab("tab-catalog") },
    { label: "Mergi la Calendar", icon: "calendar", words: "calendar saptamana orar", run: () => switchTab("tab-calendar") },
    { label: "Mergi la Statistici", icon: "chart", words: "statistici analiza grafice", run: () => switchTab("tab-statistici") },
    { label: "Deschide Simulatorul", icon: "target", words: "simulator ipotetic scenariu ce-ar fi daca", run: () => switchTab("tab-simulator") },
    { label: "Notificări", icon: "bell", words: "notificari alerte", run: () => openNotifPanel() },
    { label: "Orarul săptămânal", icon: "calendar-days", words: "orar ore program", run: () => openTimetableModal() },
    { label: "Raport pentru printare", icon: "printer", words: "raport print pdf", run: () => openReportPanel() },
    { label: "Exportă backup", icon: "download", words: "backup export salvare fisier", run: () => exportBackup() },
    { label: "Schimbă tema (luminoasă / întunecată)", icon: "moon", words: "tema intunecat luminos dark light", run: () => toggleTheme() },
    { label: "Setări", icon: "settings", words: "setari preferinte", run: () => switchTab("tab-setari") },
    { label: "Turul aplicației", icon: "sparkles", words: "tur ghid tutorial ajutor cum merge", run: () => startTour() },
    { label: "Planul meu", icon: "calendar-check", words: "plan studiu invatat program sesiuni", run: () => switchTab("tab-plan") },
    { label: "Adaugă o sesiune în plan", icon: "plus", words: "plan sesiune studiu adauga", run: () => { switchTab("tab-plan"); if (state.plan.prefs.setup) openPlanAdd(); } }
];

const cmdk = { items: [], active: 0, returnFocus: null };

/** Materii, note, evenimente și purtarea care se potrivesc cu textul căutat. */
function searchData(query) {
    const q = foldText(String(query || "").trim());
    if (!q) return [];
    const results = [];
    if ("purtare".includes(q)) {
        const p = metrics.purtare || purtareInfo();
        results.push({ kind: "Purtare", label: "Purtare", meta: p.current ? `Modulul ${p.current.n}: ${p.value}` : String(p.value), icon: "medal", mat: PURTARE_KEY });
    }
    for (const [mat, sub] of Object.entries(state.subjects)) {
        if (foldText(mat).includes(q)) {
            const avg = metrics.subjects[mat]?.exactAvg;
            results.push({ kind: "Materie", label: mat, meta: avg > 0 ? `media ${avg.toFixed(2)}` : "fără note", icon: "notebook", mat });
        }
        sub.grades.forEach(g => {
            if (foldText(`${mat} ${g.val} ${g.type}`).includes(q)) {
                results.push({ kind: "Notă", label: `${mat}: ${g.val}`, meta: `${g.type || "Altele"}${g.date ? `, ${shortDayLabel(g.date)}` : ""}`, icon: "note", mat });
            }
        });
    }
    const today = getLocalDateKey();
    for (const [date, events] of Object.entries(state.calendar)) {
        events.forEach(ev => {
            if (foldText(`${ev.title} ${ev.type} ${ev.subject || ""} ${ev.description || ""}`).includes(q)) {
                const when = ev.repeat ? (seriesDates(ev, date, today, addDays(today, 400))[0] || date) : date;
                results.push({ kind: "Calendar", label: ev.title, meta: `${ev.type}, ${weekdayLabel(when)}${ev.repeat ? " (se repetă)" : ""}`, icon: EVENT_TYPE_ICON[ev.type] || "calendar", date: when });
            }
        });
    }
    return results.slice(0, 12);
}

function openCmdk(initial = "") {
    const box = $("cmdk");
    if (!box) return;
    closeQuickAdd({ restoreFocus: false });
    if (box.hidden) cmdk.returnFocus = document.activeElement;
    box.hidden = false;
    document.body.classList.add("modal-open");
    const input = $("cmdk-input");
    input.value = initial;
    renderCmdk();
    input.focus();
}

function closeCmdk({ restoreFocus = true } = {}) {
    const box = $("cmdk");
    if (!box || box.hidden) return;
    box.hidden = true;
    if ($("action-modal").hidden && $("notif-panel").hidden) document.body.classList.remove("modal-open");
    if (restoreFocus && cmdk.returnFocus && document.contains(cmdk.returnFocus)) cmdk.returnFocus.focus();
}

function renderCmdk() {
    const raw = $("cmdk-input").value;
    const q = foldText(raw.trim());
    const actions = CMDK_ACTIONS
        .map(a => {
            const hay = foldText(`${a.label} ${a.words || ""}`);
            const score = !q ? 1 : foldText(a.label).startsWith(q) ? 3 : hay.split(/\s+/).some(w => w.startsWith(q)) ? 2 : hay.includes(q) ? 1 : 0;
            return { ...a, score };
        })
        .filter(a => a.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, q ? 6 : 8);
    const data = searchData(raw);

    cmdk.items = [
        ...data.map(r => ({ type: "data", r })),
        ...actions.map(a => ({ type: "action", a }))
    ];
    cmdk.active = 0;

    const row = (it, i) => {
        const id = `cmdk-opt-${i}`;
        if (it.type === "data") {
            const r = it.r;
            return `<div class="cmdk-item" role="option" id="${id}" data-index="${i}" aria-selected="false">
                ${icon(r.icon)}<span class="cmdk-main"><b>${escapeHTML(r.label)}</b><small>${escapeHTML(r.meta)}</small></span><span class="cmdk-kind">${escapeHTML(r.kind)}</span></div>`;
        }
        const a = it.a;
        return `<div class="cmdk-item is-action" role="option" id="${id}" data-index="${i}" aria-selected="false">
            ${icon(a.icon)}<span class="cmdk-main"><b>${escapeHTML(a.label)}</b>${a.hint ? `<small>${escapeHTML(a.hint)}</small>` : ""}</span>${a.keys ? `<kbd>${a.keys}</kbd>` : ""}</div>`;
    };

    const list = $("cmdk-list");
    if (cmdk.items.length === 0) {
        list.innerHTML = `<p class="cmdk-empty">Nimic pentru „${escapeHTML(raw.trim())}”. Încearcă numele unei materii sau o acțiune, de exemplu „notă”.</p>`;
        return;
    }
    const nData = data.length;
    list.innerHTML = [
        nData ? `<p class="cmdk-group">Rezultate</p>${cmdk.items.slice(0, nData).map((it, i) => row(it, i)).join("")}` : "",
        actions.length ? `<p class="cmdk-group">${q ? "Acțiuni" : "Ce vrei să faci?"}</p>${cmdk.items.slice(nData).map((it, i) => row(it, i + nData)).join("")}` : ""
    ].join("");
    setCmdkActive(0);
}

function setCmdkActive(i) {
    const list = $("cmdk-list");
    const rows = [...list.querySelectorAll(".cmdk-item")];
    if (!rows.length) return;
    cmdk.active = (i + rows.length) % rows.length;
    rows.forEach((el, k) => {
        el.classList.toggle("is-active", k === cmdk.active);
        el.setAttribute("aria-selected", String(k === cmdk.active));
    });
    $("cmdk-input").setAttribute("aria-activedescendant", rows[cmdk.active].id);
    rows[cmdk.active].scrollIntoView({ block: "nearest" });
}

function runCmdkItem(i) {
    const it = cmdk.items[i];
    if (!it) return;
    closeCmdk({ restoreFocus: false });
    if (it.type === "action") {
        it.a.run();
        return;
    }
    if (it.r.date) showDateInCalendar(it.r.date);
    else openSubjectInCatalog(it.r.mat);
}

function toggleTheme() {
    const dark = document.body.classList.contains("dark-mode");
    state.settings.appearance.theme = dark ? "light" : "dark";
    applyAppearanceSettings();
    refresh();
    if (ui.activeTab === "tab-setari") loadSettingsIntoUI();
    showToast(dark ? "Tema: luminoasă." : "Tema: întunecată.");
}

/* ==================== ADAUGĂ RAPID (+) ==================== */
const QUICK_ADD = {
    grade: () => openAddGradeModal(),
    test: () => openEventModal({ type: "Test" }),
    homework: () => openEventModal({ type: "Temă" }),
    event: () => openEventModal({ type: "Proiect" }),
    subject: () => promptAddMaterie(),
    hypo: () => switchTab("tab-simulator")
};
const QUICK_ADD_KEYS = { n: "grade", t: "test", h: "homework", e: "event", m: "subject", s: "hypo" };
let quickAddReturn = null;

function openQuickAdd(anchor) {
    if (!requireAccount()) return;
    const box = $("quick-add");
    if (!box) return;
    if (!box.hidden) {
        closeQuickAdd();
        return;
    }
    quickAddReturn = anchor || document.activeElement;
    box.hidden = false;
    $("quick-add-btn")?.setAttribute("aria-expanded", "true");
    // Pe ecrane mari, meniul apare sub butonul „Adaugă”; pe telefon e o foaie care urcă de jos.
    const card = box.querySelector(".quick-add-card");
    const btn = $("quick-add-btn");
    if (btn && btn.offsetParent !== null && window.innerWidth > 900) {
        const r = btn.getBoundingClientRect();
        card.style.top = `${Math.round(r.bottom + 8)}px`;
        card.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    } else {
        card.style.top = "";
        card.style.right = "";
    }
    box.querySelector(".qa-item")?.focus();
}

function closeQuickAdd({ restoreFocus = true } = {}) {
    const box = $("quick-add");
    if (!box || box.hidden) return;
    box.hidden = true;
    $("quick-add-btn")?.setAttribute("aria-expanded", "false");
    if (restoreFocus && quickAddReturn && document.contains(quickAddReturn)) quickAddReturn.focus();
}

function runQuickAdd(kind) {
    if (!QUICK_ADD[kind]) return;
    closeQuickAdd({ restoreFocus: false });
    QUICK_ADD[kind]();
}

/* ==================== MAI MULT (telefon) ==================== */
let moreReturn = null;
const MORE_ACTIONS = {
    sim: () => switchTab("tab-simulator"),
    settings: () => switchTab("tab-setari"),
    theme: () => toggleTheme(),
    setup: () => openSetup(0),
    backup: () => exportBackup(),
    account: () => openAccountPanel(),
    tour: () => startTour(),
    plan: () => switchTab("tab-plan")
};

function openMoreMenu() {
    const box = $("more-menu");
    if (!box) return;
    if (!box.hidden) { closeMoreMenu(); return; }
    closeQuickAdd({ restoreFocus: false });
    // Safari nu pune focus pe butonul apăsat; revenim oricum la „…”.
    moreReturn = document.activeElement && document.activeElement !== document.body ? document.activeElement : $("more-btn");
    const dark = document.body.classList.contains("dark-mode");
    setText("more-theme-label", dark ? "Temă luminoasă" : "Temă întunecată");
    box.querySelector('[data-kind="theme"] use')?.setAttribute("href", dark ? "#i-sun" : "#i-moon");
    box.hidden = false;
    $("more-btn")?.setAttribute("aria-expanded", "true");
    box.querySelector(".qa-item")?.focus();
}

function closeMoreMenu({ restoreFocus = true } = {}) {
    const box = $("more-menu");
    if (!box || box.hidden) return;
    box.hidden = true;
    $("more-btn")?.setAttribute("aria-expanded", "false");
    if (restoreFocus && moreReturn && document.contains(moreReturn)) moreReturn.focus();
}

/* ==================== NOTIFICĂRI ==================== */
let notifReturn = null;

function openNotifPanel() {
    const panel = $("notif-panel");
    if (!panel) return;
    closeQuickAdd({ restoreFocus: false });
    notifReturn = document.activeElement;
    panel.hidden = false;
    document.body.classList.add("modal-open");
    renderAlerts();
    panel.querySelector(".drawer-card [data-action='notif-close']")?.focus();
}

function closeNotifPanel({ restoreFocus = true } = {}) {
    const panel = $("notif-panel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if ($("action-modal").hidden && $("cmdk").hidden) document.body.classList.remove("modal-open");
    if (restoreFocus && notifReturn && document.contains(notifReturn)) notifReturn.focus();
}

/** Ține focusul (Tab) în interiorul unui panou deschis. */
function trapFocusIn(container, event) {
    if (event.key !== "Tab" || !container) return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

const isTyping = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function bindShellEvents() {
    const input = $("cmdk-input");
    input?.addEventListener("input", renderCmdk);
    input?.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setCmdkActive(cmdk.active + 1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setCmdkActive(cmdk.active - 1); }
        else if (event.key === "Enter") { event.preventDefault(); runCmdkItem(cmdk.active); }
    });
    const list = $("cmdk-list");
    list?.addEventListener("click", event => {
        const row = event.target.closest(".cmdk-item");
        if (row) runCmdkItem(Number(row.dataset.index));
    });
    list?.addEventListener("mousemove", event => {
        const row = event.target.closest(".cmdk-item");
        if (row && Number(row.dataset.index) !== cmdk.active) setCmdkActive(Number(row.dataset.index));
    });

    // Scurtături globale (capturate înaintea celorlalte, ca Escape să închidă întâi panoul de sus)
    document.addEventListener("keydown", event => {
        if (customSelect.open) return; // tastele aparțin listei derulante deschise
        const k = event.key;
        // Configurarea ocupă tot ecranul: fără scurtături, focusul rămâne în ea
        if (!$("setup").hidden) {
            if ($("action-modal").hidden) trapFocusIn($("setup"), event);
            return;
        }
        // Turul ghidat: tastele lui, nimic altceva
        if (tour.open) {
            handleTourKey(event);
            return;
        }
        // La fel ecranul de autentificare (Escape îl închide doar dacă elevul a ales deja cum folosește aplicația)
        if (!$("auth").hidden) {
            if (!$("action-modal").hidden) return;
            if (k === "Escape" && cloud.seenUser && lsGet(SYNC_KEYS.choice)) closeAuth();
            else trapFocusIn($("auth"), event);
            return;
        }
        const modalOpen = !$("action-modal").hidden;
        if ((event.ctrlKey || event.metaKey) && k.toLowerCase() === "k") {
            event.preventDefault();
            if (modalOpen) return; // un formular deschis are prioritate (ar putea avea date nesalvate)
            if ($("cmdk").hidden) openCmdk(); else closeCmdk();
            return;
        }
        // Ctrl/⌘+Z: anulează ultima ștergere (doar cât timp mesajul cu „Anulează” e pe ecran și nu scrii într-un câmp)
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && k.toLowerCase() === "z" && pendingUndo && !isTyping(event.target)) {
            event.preventDefault();
            pendingUndo.run();
            return;
        }
        if (!$("cmdk").hidden) {
            if (k === "Escape") { event.preventDefault(); event.stopPropagation(); closeCmdk(); }
            else trapFocusIn($("cmdk"), event);
            return;
        }
        if (!$("more-menu").hidden) {
            if (k === "Escape") { event.preventDefault(); event.stopPropagation(); closeMoreMenu(); return; }
            if (k === "ArrowDown" || k === "ArrowUp") {
                event.preventDefault();
                const items = [...$("more-menu").querySelectorAll(".qa-item")];
                const i = items.indexOf(document.activeElement);
                items[(i + (k === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
            }
            trapFocusIn($("more-menu"), event);
            return;
        }
        if (!$("quick-add").hidden) {
            if (k === "Escape") { event.preventDefault(); event.stopPropagation(); closeQuickAdd(); return; }
            const kind = QUICK_ADD_KEYS[k.toLowerCase()];
            if (kind && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); runQuickAdd(kind); return; }
            if (k === "ArrowDown" || k === "ArrowUp") {
                event.preventDefault();
                const items = [...$("quick-add").querySelectorAll(".qa-item")];
                const i = items.indexOf(document.activeElement);
                items[(i + (k === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
            }
            trapFocusIn($("quick-add"), event);
            return;
        }
        if (!$("notif-panel").hidden && !modalOpen) {
            if (k === "Escape") { event.preventDefault(); event.stopPropagation(); closeNotifPanel(); }
            else trapFocusIn($("notif-panel"), event);
            return;
        }
        if (modalOpen || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
        if (k === "/") { event.preventDefault(); openCmdk(); }
        else if (k.toLowerCase() === "n") { event.preventDefault(); openQuickAdd($("quick-add-btn")); }
    }, true);

    // Închide meniul „Adaugă” la redimensionare (poziția lui depinde de buton).
    window.addEventListener("resize", () => closeQuickAdd({ restoreFocus: false }));
}

/* ==================== TOAST ==================== */
const TOAST_ICONS = { "🏆": "trophy", "🔥": "flame", "📈": "trend-up", "🎯": "target", "📚": "notebook", "💾": "save", "🗓": "calendar-days", "⚙": "settings", "↩": "undo", "🎖": "medal", "✅": "check-circle", "↻": "refresh", "☁": "check-circle" };

/**
 * Mesaj scurt jos pe ecran. Opțional cu un buton (ex. „Anulează”).
 * Cât timp mouse-ul e deasupra sau butonul are focus, mesajul nu dispare.
 */
function showToast(msg, { action = "", onAction = null, duration = 3000 } = {}) {
    const container = $("toast-container");
    if (!container) return null;

    // Un emoji la începutul mesajului alege iconița și tonul; textul afișat rămâne curat.
    const lead = /^\s*([\u2190-\u21FF\u2600-\u27BF\u{1F300}-\u{1FAFF}])\uFE0F?\s*/u.exec(msg);
    const warn = Boolean(lead) && lead[1] === "⚠";
    const text = lead ? msg.slice(lead[0].length) : msg;
    const toastIcon = warn ? "alert" : lead && TOAST_ICONS[lead[1]] ? TOAST_ICONS[lead[1]] : action ? "trash" : "check-circle";
    const toast = document.createElement("div");
    toast.className = `toast${warn ? " is-warn" : ""}${action ? " has-action" : ""}`;
    toast.innerHTML = `${icon(toastIcon, "toast-ico")}<span class="toast-text">${escapeHTML(text)}</span>${action
        ? `<button type="button" class="toast-action" title="${escapeHTML(`${action} (Ctrl+Z)`)}">${icon("undo")} ${escapeHTML(action)}</button>` : ""}`;
    container.appendChild(toast);

    let timer = 0;
    const leave = () => {
        clearTimeout(timer);
        if (toast.classList.contains("leaving")) return;
        toast.classList.add("leaving");
        setTimeout(() => toast.remove(), 300);
        toast.dispatchEvent(new CustomEvent("toast-gone"));
    };
    const arm = ms => { clearTimeout(timer); timer = setTimeout(leave, ms); };
    toast.addEventListener("mouseenter", () => clearTimeout(timer));
    toast.addEventListener("mouseleave", () => arm(2000));
    toast.addEventListener("focusin", () => clearTimeout(timer));
    toast.addEventListener("focusout", () => arm(2000));
    toast.querySelector(".toast-action")?.addEventListener("click", () => {
        onAction?.();
        leave();
    });
    toast.leave = leave;
    arm(duration);
    return toast;
}

/* ==================== ANULARE ==================== */
/*
 * Ștergerile simple nu mai cer confirmare: se fac imediat, iar mesajul de jos are „Anulează” (sau Ctrl+Z).
 * Înainte de ștergere se păstrează o copie a datelor; anularea o pune la loc doar dacă între timp
 * nu s-a mai salvat nimic altceva (altfel ar șterge și modificările făcute după).
 */
const UNDO_MS = 7000;
const UNDO_KEYS = ["subjects", "calendar", "timetable", "purtare", "activity", "history", "alertMeta", "achievements", "plan"];
let saveCounter = 0;
let pendingUndo = null;

function withUndo(message, mutate, { afterUndo = null } = {}) {
    const snap = clone(Object.fromEntries(UNDO_KEYS.map(k => [k, state[k]])));
    const simSnap = clone(sim);
    if (mutate() === false) return;
    refresh();

    const token = { at: saveCounter, toast: null };
    token.run = () => {
        if (pendingUndo !== token) return;
        pendingUndo = null;
        token.toast?.leave();
        if (saveCounter !== token.at) {
            showToast("⚠️ Nu mai pot anula: între timp s-au schimbat și alte date.");
            return;
        }
        closeActionModal(); // un formular deschis ar lucra pe obiectele de dinainte de anulare
        UNDO_KEYS.forEach(k => { state[k] = snap[k]; });
        sim = simSnap;
        afterUndo?.();
        refresh();
        showToast("↩ Am pus totul la loc.");
    };
    pendingUndo?.toast?.leave();
    pendingUndo = token;
    token.toast = showToast(message, { action: "Anulează", onAction: token.run, duration: UNDO_MS });
    token.toast?.addEventListener("toast-gone", () => { if (pendingUndo === token) pendingUndo = null; });
}

/* ==================== SIMULATOR ==================== */
/*
 * Notele ipotetice trăiesc doar în `sim` (cheie de stocare separată).
 * Proiecțiile se obțin rulând același calculateMetrics() pe o COPIE a materiilor
 * cu notele ipotetice adăugate, deci cifrele sunt identice cu ce ar arăta catalogul,
 * iar state.subjects nu este atins niciodată.
 */
const SIM_LIMITS = { scenarios: 6, perSubject: 30, nameLength: 40 };

let sim = defaultSim();

function defaultSim() {
    const id = uid();
    return {
        active: id,
        selected: "",
        addType: "Test",
        scenarios: [{ id, name: "Scenariul 1", hypo: {} }]
    };
}

function normalizeHypo(h) {
    if (!isPlainObject(h)) return null;
    const val = parseStrictInteger(h.val, 1, 10);
    if (val === null) return null;
    const entry = {
        id: String(h.id || uid()),
        val,
        type: GRADE_TYPES.includes(h.type) ? h.type : "Altele"
    };
    if (h.eventId) entry.eventId = String(h.eventId);
    return entry;
}

/** Validează datele Simulatorului (din localStorage sau dintr-un backup). */
function parseSimulator(raw) {
    if (!isPlainObject(raw) || !Array.isArray(raw.scenarios)) return defaultSim();

    const scenarios = raw.scenarios.filter(isPlainObject).slice(0, SIM_LIMITS.scenarios).map((sc, i) => ({
        id: String(sc.id || uid()),
        name: String(sc.name || `Scenariul ${i + 1}`).slice(0, SIM_LIMITS.nameLength),
        hypo: Object.fromEntries(
            Object.entries(isPlainObject(sc.hypo) ? sc.hypo : {})
                .map(([mat, list]) => [mat, (Array.isArray(list) ? list : []).map(normalizeHypo).filter(Boolean)])
                .filter(([, list]) => list.length)
        )
    }));

    if (scenarios.length === 0) return defaultSim();

    return {
        active: scenarios.some(s => s.id === raw.active) ? raw.active : scenarios[0].id,
        selected: typeof raw.selected === "string" ? raw.selected : "",
        addType: GRADE_TYPES.includes(raw.addType) ? raw.addType : "Test",
        scenarios
    };
}

/** Testele/examenele viitoare, indexate după id. */
function upcomingExamIndex() {
    const today = getLocalDateKey();
    const links = gradeLinks();
    const map = new Map();
    occurrencesBetween(today, addDays(today, 120)).forEach(({ ev, date, key }) => {
        if (EXAM_TYPES.has(ev.type) && !isOccurrenceDone(ev, date, links)) map.set(key, { ...ev, id: key, date });
    });
    return map;
}

/**
 * Curăță notele ipotetice care nu mai au sens: materia a fost ștearsă,
 * sau testul din calendar a fost șters / a trecut (nota reală o înlocuiește).
 */
function pruneSimulator() {
    const exams = upcomingExamIndex();
    sim.scenarios.forEach(sc => {
        for (const mat of Object.keys(sc.hypo)) {
            if (!state.subjects[mat]) {
                delete sc.hypo[mat];
                continue;
            }
            sc.hypo[mat] = sc.hypo[mat].filter(h => !h.eventId || exams.get(h.eventId)?.subject === mat);
            if (sc.hypo[mat].length === 0) delete sc.hypo[mat];
        }
    });
    if (!state.subjects[sim.selected]) {
        sim.selected = Object.keys(state.subjects)[0] || "";
    }
}

function activeScenario() {
    return sim.scenarios.find(s => s.id === sim.active) || sim.scenarios[0];
}

function hypoCount(scenario) {
    return Object.values(scenario.hypo).reduce((n, list) => n + list.length, 0);
}

/** Copie a materiilor reale + notele ipotetice (+ opțional o notă de test pentru marja de siguranță). */
function projectedSubjects(scenario, extra = null) {
    const out = {};
    for (const [mat, sub] of Object.entries(state.subjects)) {
        const hypo = scenario.hypo[mat] || [];
        const probe = extra && extra.mat === mat ? [extra.grade] : [];
        out[mat] = hypo.length || probe.length
            ? { ...sub, grades: [...sub.grades, ...hypo, ...probe] }
            : sub;
    }
    return out;
}

function projectMetrics(scenario) {
    return calculateMetrics(projectedSubjects(scenario));
}

/** Cea mai mică notă (1–10) cu care condiția e îndeplinită; null dacă nici 10 nu ajunge. */
function lowestGradeThatPasses(scenario, mat, passes) {
    for (let g = 1; g <= 10; g++) {
        const m = calculateMetrics(projectedSubjects(scenario, { mat, grade: { val: g } }));
        if (passes(m)) return g;
    }
    return null;
}

/* ---------- formatare ---------- */
function fmtAvg(d) {
    return d && d.exactAvg > 0 ? d.exactAvg.toFixed(2) : "-";
}

function fmtAvgWithRound(d) {
    return d && d.exactAvg > 0 ? `${d.exactAvg.toFixed(2)} <span class="sim-round">(→ ${d.roundedAvg})</span>` : "-";
}

function deltaHTML(before, after) {
    if (!(after > 0) || !(before > 0)) return `<span class="sim-delta">—</span>`;
    const diff = roundValue(after - before, 2);
    if (diff === 0) return `<span class="sim-delta">±0.00</span>`;
    return `<span class="sim-delta ${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : ""}${diff.toFixed(2)}</span>`;
}

function statusChangeHTML(before, after) {
    if (!before || !after || before.statusClass === after.statusClass) return "";
    if (after.statusClass === "badge-danger") return `<span class="badge badge-danger">intră în risc</span>`;
    if (before.statusClass === "badge-danger") return `<span class="badge badge-ok">iese din risc</span>`;
    return "";
}

function gradeOptions(selected, { empty = null } = {}) {
    const opts = empty !== null ? [`<option value="">${empty}</option>`] : [];
    for (let v = 10; v >= 1; v--) opts.push(`<option value="${v}" ${v === selected ? "selected" : ""}>${v}</option>`);
    return opts.join("");
}

/* ---------- randare ---------- */
function renderSimulator() {
    const root = $("sim-root");
    if (!root) return;

    pruneSimulator();
    const focusId = root.contains(document.activeElement) ? document.activeElement.id : "";

    if (Object.keys(state.subjects).length === 0) {
        root.innerHTML = `
            <div class="glass-card empty-state">
                <div class="empty-state-icon" aria-hidden="true">${icon("flask")}</div>
                <h3>Simulatorul are nevoie de materii</h3>
                <p>Adaugă o materie, apoi încearcă aici note ipotetice fără să-ți afectezi notele reale.</p>
                <button class="btn btn-primary" type="button" data-action="add-subject">+ Adaugă Materie</button>
            </div>`;
        return;
    }

    const scenario = activeScenario();
    const projected = projectMetrics(scenario);

    root.innerHTML = `
        ${scenarioBarHTML(scenario)}
        <div class="sim-layout">
            ${subjectPanelHTML(scenario, projected)}
            <div class="sim-side">
                ${safetyPanelHTML(scenario, projected)}
                ${projectionSummaryHTML(projected)}
            </div>
            ${generalPanelHTML(scenario, projected)}
            ${comparePanelHTML()}
        </div>`;

    if (focusId) $(focusId)?.focus();
}

function scenarioBarHTML(scenario) {
    const canAdd = sim.scenarios.length < SIM_LIMITS.scenarios;
    return `
        <div class="glass-card sim-scenario-bar">
            <div class="sim-scenario-chips" role="group" aria-label="Scenarii">
                ${sim.scenarios.map(sc => `
                    <button type="button" class="sim-chip ${sc.id === scenario.id ? "active" : ""}" data-action="sim-scenario" data-id="${escapeHTML(sc.id)}"
                        aria-pressed="${sc.id === scenario.id}">
                        ${escapeHTML(sc.name)} <span class="sim-chip-count">${hypoCount(sc)}</span>
                    </button>`).join("")}
                <button type="button" class="sim-chip sim-chip-add" data-action="sim-new" ${canAdd ? "" : "disabled"}
                    title="${canAdd ? "Scenariu nou, gol" : `Maximum ${SIM_LIMITS.scenarios} scenarii`}">${icon("plus")} Nou</button>
            </div>
            <div class="sim-scenario-actions">
                <button type="button" class="btn btn-text" data-action="sim-duplicate" ${canAdd ? "" : "disabled"}>Duplică</button>
                <button type="button" class="btn btn-text" data-action="sim-rename">Redenumește</button>
                <button type="button" class="btn btn-text" data-action="sim-clear" ${hypoCount(scenario) ? "" : "disabled"}>Golește</button>
                <button type="button" class="btn btn-text text-danger" data-action="sim-delete" ${sim.scenarios.length > 1 ? "" : "disabled"}>Șterge</button>
            </div>
        </div>`;
}

function subjectPanelHTML(scenario, projected) {
    const mat = sim.selected;
    const sub = state.subjects[mat];
    const now = metrics.subjects[mat];
    const next = projected.subjects[mat];
    const hypo = scenario.hypo[mat] || [];
    const manual = hypo.filter(h => !h.eventId);
    const slots = [...upcomingExamIndex().values()]
        .filter(ev => ev.subject === mat)
        .sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`));

    const realChips = sub.grades.length
        ? sub.grades.map(g => `<span class="grade-tag is-static">${escapeHTML(g.val)}</span>`).join("")
        : `<span class="muted-small">Nicio notă reală încă.</span>`;

    const hypoChips = manual.length
        ? manual.map(h => `
            <button type="button" class="grade-tag hypo" data-action="sim-remove" data-id="${escapeHTML(h.id)}"
                title="Elimină nota ipotetică" aria-label="Elimină nota ipotetică ${h.val}">
                ${h.val} <small>(${escapeHTML(h.type)})</small> <span aria-hidden="true">&times;</span>
            </button>`).join("")
        : `<span class="muted-small">Apasă o notă de mai jos ca s-o adaugi.</span>`;

    const slotRows = slots.length
        ? slots.map(ev => {
            const h = hypo.find(x => x.eventId === ev.id);
            return `
                <div class="sim-slot ${h ? "filled" : ""}">
                    <div class="sim-slot-info">
                        <b>${escapeHTML(ev.title)}</b>
                        <small>${escapeHTML(ev.type)} · ${escapeHTML(getDateLabel(ev.date))}${ev.time ? `, ${escapeHTML(ev.time)}` : ""}</small>
                    </div>
                    <label class="sr-only" for="sim-slot-${escapeHTML(ev.id)}">Nota estimată pentru ${escapeHTML(ev.title)}</label>
                    <select id="sim-slot-${escapeHTML(ev.id)}" class="glass-select sim-mini" data-slot-val="${escapeHTML(ev.id)}">
                        ${gradeOptions(h?.val ?? null, { empty: "—" })}
                    </select>
                </div>`;
        }).join("")
        : `<p class="muted-small">Nu ai teste sau examene programate la ${escapeHTML(mat)}. Le poți adăuga din Calendar.</p>`;

    return `
        <section class="glass-card sim-panel" id="sim-subject-card" aria-labelledby="sim-subject-title">
            <div class="sim-panel-head">
                <h3 id="sim-subject-title">${icon("flask")} Note ipotetice</h3>
                <select id="sim-subject" class="glass-select sim-subject-select" aria-label="Materia simulată">
                    ${Object.keys(state.subjects).map(m => `<option value="${escapeHTML(m)}" ${m === mat ? "selected" : ""} ${scenario.hypo[m]?.length ? `data-meta="${escapeHTML(plural(scenario.hypo[m].length, "ipotetică", "ipotetice"))}"` : ""}>${escapeHTML(m)}</option>`).join("")}
                </select>
            </div>

            <div class="sim-stats">
                <div class="sim-stat">
                    <span class="kpi-title">Acum</span>
                    <div class="sim-stat-value">${fmtAvgWithRound(now)}</div>
                    <span class="badge ${now.statusClass}">${escapeHTML(now.status)}</span>
                </div>
                <div class="sim-stat projected">
                    <span class="kpi-title">Cu notele ipotetice</span>
                    <div class="sim-stat-value">${fmtAvgWithRound(next)} ${deltaHTML(now.exactAvg, next.exactAvg)}</div>
                    <span class="badge ${next.statusClass}">${escapeHTML(next.status)}</span> ${statusChangeHTML(now, next)}
                </div>
            </div>

            <div class="sim-row">
                <span class="sim-row-label">Reale</span>
                <div class="grades-wrapper">${realChips}</div>
            </div>
            <div class="sim-row">
                <span class="sim-row-label">Ipotetice</span>
                <div class="grades-wrapper">${hypoChips}</div>
            </div>

            <div class="sim-add">
                <div class="sim-grade-buttons" role="group" aria-label="Adaugă o notă ipotetică">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<button type="button" id="sim-add-${v}" class="sim-grade-btn" data-action="sim-add" data-val="${v}">${v}</button>`).join("")}
                </div>
                <div class="sim-add-options">
                    <label for="sim-add-type">Tip</label>
                    <select id="sim-add-type" class="glass-select sim-mini">${optionsHTML(GRADE_TYPES, sim.addType)}</select>
                    <button type="button" class="btn btn-text" data-action="sim-clear-subject" ${hypo.length ? "" : "disabled"}>Golește materia</button>
                </div>
            </div>

            <div class="sim-calendar">
                <h4>${icon("calendar")} Din calendar</h4>
                <p class="muted-small mb-3">Alege nota la care te aștepți la testele programate. Dispar automat după data testului.</p>
                ${slotRows}
            </div>
        </section>`;
}

function safetyPanelHTML(scenario, projected) {
    const mat = sim.selected;
    const sub = state.subjects[mat];
    const base = projected.subjects[mat];
    const { riskThreshold } = state.settings.calc;
    const { minGPA } = state.settings.goals;
    const hasHypo = (scenario.hypo[mat] || []).length > 0;

    const result = g => g === null
        ? { text: "imposibil, nici cu 10", tone: "danger" }
        : g === 1
            ? { text: "orice notă", tone: "ok" }
            : { text: `minim ${g}`, tone: g >= 9 ? "warn" : "neutral" };

    const rows = [];

    rows.push({
        label: `Rămâi peste pragul de risc (${riskThreshold.toFixed(2)})`,
        ...result(lowestGradeThatPasses(scenario, mat, m => m.subjects[mat].exactAvg >= riskThreshold))
    });

    if (base.roundedAvg > 0) {
        rows.push({
            label: `Păstrezi media ${base.roundedAvg} la ${mat}`,
            ...result(lowestGradeThatPasses(scenario, mat, m => m.subjects[mat].roundedAvg >= base.roundedAvg))
        });
    }

    if (sub.excludeFromGPA) {
        rows.push({ label: `Media generală ≥ ${minGPA.toFixed(2)}`, text: "materia e exclusă din medie", tone: "neutral" });
    } else {
        rows.push({
            label: `Media generală rămâne ≥ ${minGPA.toFixed(2)}`,
            ...result(lowestGradeThatPasses(scenario, mat, m => m.globalAvg >= minGPA))
        });
    }

    return `
        <section class="glass-card sim-panel" aria-labelledby="sim-safety-title">
            <h3 id="sim-safety-title">${icon("shield")} Marja de siguranță</h3>
            <p class="muted-small mt-2">
                Cea mai mică notă pe care o poți lua la următoarea evaluare la <b>${escapeHTML(mat)}</b>${hasHypo ? ", după notele ipotetice din acest scenariu" : ""}.
            </p>
            <div class="sim-safety-list">
                ${rows.map(r => `
                    <div class="sim-safety-row">
                        <span>${escapeHTML(r.label)}</span>
                        <span class="sim-result ${r.tone}">${escapeHTML(r.text)}</span>
                    </div>`).join("")}
            </div>
            <p class="subtitle mt-3">Pragul de risc și media minimă se schimbă din Setări.</p>
        </section>`;
}

/** În coloana din dreapta: media generală și materiile în risc, acum → cu notele ipotetice. */
function projectionSummaryHTML(projected) {
    return `
        <section class="glass-card sim-panel" aria-labelledby="sim-proj-title">
            <h3 id="sim-proj-title">${icon("trend-up")} Media generală proiectată</h3>
            <div class="sim-big-numbers">
                <div>
                    <span class="kpi-title">Media generală</span>
                    <div class="sim-big">${metrics.globalAvg > 0 ? metrics.globalAvg.toFixed(2) : "-"} <span aria-hidden="true">→</span>
                        <span class="sim-big-projected">${projected.globalAvg > 0 ? projected.globalAvg.toFixed(2) : "-"}</span>
                        ${deltaHTML(metrics.globalAvg, projected.globalAvg)}</div>
                </div>
                <div>
                    <span class="kpi-title">Materii în risc</span>
                    <div class="sim-big">${metrics.riskCount} <span aria-hidden="true">→</span> <span class="sim-big-projected">${projected.riskCount}</span></div>
                </div>
            </div>
        </section>`;
}

function generalPanelHTML(scenario, projected) {
    const method = state.settings.calc.method === "weighted" ? "ponderată după numărul de ore" : "media aritmetică a materiilor";
    const all = Object.keys(state.subjects);
    // Implicit doar materiile care se schimbă (sau au note ipotetice) — restul tabelului ar fi doar repetiție.
    const changed = all.filter(mat => (scenario.hypo[mat] || []).length > 0 || metrics.subjects[mat].exactAvg !== projected.subjects[mat].exactAvg);
    const shown = ui.simAll ? all : changed;
    const rows = shown.map(mat => {
        const a = metrics.subjects[mat];
        const b = projected.subjects[mat];
        const touched = (scenario.hypo[mat] || []).length > 0;
        const excluded = state.subjects[mat].excludeFromGPA;
        return `
            <tr class="${touched ? "touched" : ""} ${mat === sim.selected ? "selected" : ""}">
                <th scope="row">
                    <button type="button" class="sim-link" data-action="sim-pick-subject" data-mat="${escapeHTML(mat)}">${escapeHTML(mat)}</button>
                    ${excluded ? `<small class="muted-small">(exclusă)</small>` : ""}
                </th>
                <td>${fmtAvg(a)}</td>
                <td>${fmtAvg(b)}</td>
                <td>${deltaHTML(a.exactAvg, b.exactAvg)}</td>
                <td>${statusChangeHTML(a, b)}</td>
            </tr>`;
    }).join("");

    return `
        <section class="glass-card sim-panel sim-wide" aria-labelledby="sim-general-title">
            <div class="sim-panel-head">
                <h3 id="sim-general-title">${icon("chart")} Proiecția pe materii</h3>
                <button type="button" class="btn btn-text btn-sm" data-action="sim-toggle-all" aria-pressed="${Boolean(ui.simAll)}">${ui.simAll ? "Doar cele schimbate" : `Toate materiile (${all.length})`}</button>
            </div>
            ${shown.length ? `
            <div class="table-scroll">
                <table class="sim-table">
                    <thead><tr><th scope="col">Materie</th><th scope="col">Acum</th><th scope="col">Proiectat</th><th scope="col">Diferență</th><th scope="col"><span class="sr-only">Schimbare de status</span></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>` : `<p class="sim-empty-line">Nimic schimbat încă. Apasă o notă ipotetică mai sus și aici apar materiile afectate.</p>`}
            <p class="subtitle mt-3">Calculată ca ${method}, la fel ca în restul aplicației. Apasă pe o materie ca s-o simulezi.</p>
        </section>`;
}

function comparePanelHTML() {
    // Cu un singur scenariu nu ai ce compara: doar o invitație scurtă, nu un tabel care repetă proiecția.
    if (sim.scenarios.length < 2) {
        return `
        <section class="glass-card sim-panel sim-wide sim-compare-invite" aria-labelledby="sim-compare-title">
            <div class="sim-panel-head">
                <h3 id="sim-compare-title">${icon("scale")} Compară scenariile</h3>
                <button type="button" class="btn btn-glass btn-sm" data-action="sim-new">${icon("plus")} Scenariu nou</button>
            </div>
            <p class="muted-small">Fă încă un scenariu (de ex. „dacă teza merge prost”) și le vezi aici unul lângă altul.</p>
        </section>`;
    }
    const columns = [
        { id: null, name: "Real", m: metrics, count: 0 },
        ...sim.scenarios.map(sc => ({ id: sc.id, name: sc.name, m: projectMetrics(sc), count: hypoCount(sc) }))
    ];
    const best = Math.max(...columns.map(c => c.m.globalAvg));
    const cell = (col, value, changed, extra = "") =>
        `<td class="${col.id === sim.active ? "active-col" : ""} ${changed ? "changed" : ""} ${extra}">${value}</td>`;

    const subjectRows = Object.keys(state.subjects)
        .filter(mat => columns.some(c => c.id && c.m.subjects[mat].exactAvg !== metrics.subjects[mat].exactAvg))
        .map(mat => `
        <tr>
            <th scope="row">${escapeHTML(mat)}</th>
            ${columns.map(c => cell(c, fmtAvg(c.m.subjects[mat]), c.id && c.m.subjects[mat].exactAvg !== metrics.subjects[mat].exactAvg)).join("")}
        </tr>`).join("");

    return `
        <section class="glass-card sim-panel sim-wide" aria-labelledby="sim-compare-title">
            <h3 id="sim-compare-title">${icon("scale")} Compară scenariile</h3>
            <div class="table-scroll mt-3">
                <table class="sim-table sim-compare">
                    <thead>
                        <tr>
                            <th scope="col"><span class="sr-only">Indicator</span></th>
                            ${columns.map(c => c.id
                                ? `<th scope="col" class="${c.id === sim.active ? "active-col" : ""}"><button type="button" class="sim-link" data-action="sim-scenario" data-id="${escapeHTML(c.id)}">${escapeHTML(c.name)}</button></th>`
                                : `<th scope="col">Real</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="sim-compare-key">
                            <th scope="row">Media generală</th>
                            ${columns.map(c => cell(c, c.m.globalAvg > 0 ? c.m.globalAvg.toFixed(2) : "-", c.id && c.m.globalAvg !== metrics.globalAvg,
                                c.m.globalAvg === best && best > 0 && columns.filter(x => x.m.globalAvg === best).length < columns.length ? "best" : "")).join("")}
                        </tr>
                        <tr>
                            <th scope="row">Materii în risc</th>
                            ${columns.map(c => cell(c, c.m.riskCount, c.id && c.m.riskCount !== metrics.riskCount)).join("")}
                        </tr>
                        <tr>
                            <th scope="row">Note ipotetice</th>
                            ${columns.map(c => cell(c, c.id ? c.count : "—", false)).join("")}
                        </tr>
                        ${subjectRows}
                    </tbody>
                </table>
            </div>
        </section>`;
}

/* ---------- acțiuni ---------- */
function commitSim() {
    saveState();
    renderSimulator();
}

function addHypo(mat, entry) {
    const scenario = activeScenario();
    const list = (scenario.hypo[mat] ||= []);
    if (list.length >= SIM_LIMITS.perSubject) {
        showToast(`⚠️ Poți avea cel mult ${SIM_LIMITS.perSubject} note ipotetice pe materie.`);
        return;
    }
    list.push({ id: uid(), ...entry });
}

function removeHypo(id) {
    const scenario = activeScenario();
    for (const mat of Object.keys(scenario.hypo)) {
        scenario.hypo[mat] = scenario.hypo[mat].filter(h => h.id !== id);
        if (scenario.hypo[mat].length === 0) delete scenario.hypo[mat];
    }
}

function setSlot(eventId, val) {
    const ev = upcomingExamIndex().get(eventId);
    if (!ev || !state.subjects[ev.subject]) return;

    const scenario = activeScenario();
    const list = scenario.hypo[ev.subject] || [];
    const existing = list.find(h => h.eventId === eventId);

    if (val === null) {
        if (existing) removeHypo(existing.id);
        return;
    }
    if (existing) {
        existing.val = val;
    } else {
        addHypo(ev.subject, { val, type: ev.type === "Examen" ? "Teză" : "Test", eventId });
    }
}

function promptScenarioName(title, initial, onSave) {
    openModal({
        title,
        confirmText: "Salvează",
        body: `
            <div class="form-group">
                <label for="sim-scenario-name">Nume scenariu</label>
                <input type="text" id="sim-scenario-name" class="glass-input" maxlength="${SIM_LIMITS.nameLength}" value="${escapeHTML(initial)}" autocomplete="off">
            </div>`,
        onConfirm: () => {
            const name = field("sim-scenario-name").trim().replace(/\s+/g, " ");
            if (!name) {
                showToast("⚠️ Introdu un nume pentru scenariu.");
                return;
            }
            onSave(name);
            closeActionModal();
            commitSim();
        }
    });
    $("sim-scenario-name")?.select();
}

function nextScenarioName() {
    let n = sim.scenarios.length + 1;
    while (sim.scenarios.some(s => s.name === `Scenariul ${n}`)) n++;
    return `Scenariul ${n}`;
}

const SIM_ACTIONS = {
    "sim-scenario": el => {
        sim.active = el.dataset.id;
        commitSim();
    },
    "sim-toggle-all": () => {
        ui.simAll = !ui.simAll;
        renderSimulator();
        document.querySelector('[data-action="sim-toggle-all"]')?.focus();
    },
    "sim-new": () => {
        if (sim.scenarios.length >= SIM_LIMITS.scenarios) return;
        promptScenarioName("Scenariu nou", nextScenarioName(), name => {
            const sc = { id: uid(), name, hypo: {} };
            sim.scenarios.push(sc);
            sim.active = sc.id;
        });
    },
    "sim-duplicate": () => {
        if (sim.scenarios.length >= SIM_LIMITS.scenarios) return;
        const src = activeScenario();
        promptScenarioName("Duplică scenariul", `${src.name} (copie)`.slice(0, SIM_LIMITS.nameLength), name => {
            const hypo = Object.fromEntries(Object.entries(src.hypo).map(([mat, list]) => [mat, list.map(h => ({ ...h, id: uid() }))]));
            const sc = { id: uid(), name, hypo };
            sim.scenarios.push(sc);
            sim.active = sc.id;
        });
    },
    "sim-rename": () => {
        const sc = activeScenario();
        promptScenarioName("Redenumește scenariul", sc.name, name => { sc.name = name; });
    },
    "sim-clear": () => {
        const sc = activeScenario();
        withUndo(`Ai golit „${sc.name}” (${plural(hypoCount(sc), "notă ipotetică", "note ipotetice")}).`, () => { sc.hypo = {}; });
    },
    "sim-delete": () => {
        if (sim.scenarios.length < 2) return;
        const sc = activeScenario();
        withUndo(`Ai șters scenariul „${sc.name}”.`, () => {
            sim.scenarios = sim.scenarios.filter(s => s.id !== sc.id);
            sim.active = sim.scenarios[0].id;
        });
    },
    "sim-add": el => {
        if (!state.subjects[sim.selected]) return;
        addHypo(sim.selected, { val: Number(el.dataset.val), type: sim.addType });
        commitSim();
    },
    "sim-remove": el => {
        removeHypo(el.dataset.id);
        commitSim();
    },
    "sim-clear-subject": () => {
        delete activeScenario().hypo[sim.selected];
        commitSim();
    },
    "sim-pick-subject": el => {
        sim.selected = el.dataset.mat;
        commitSim();
        $("sim-subject-card")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
};

function bindSimulatorEvents() {
    $("sim-root")?.addEventListener("change", event => {
        const el = event.target;

        if (el.id === "sim-subject") {
            sim.selected = el.value;
        } else if (el.id === "sim-add-type") {
            sim.addType = GRADE_TYPES.includes(el.value) ? el.value : "Test";
            saveState();
            return;
        } else if (el.dataset.slotVal !== undefined) {
            setSlot(el.dataset.slotVal, el.value === "" ? null : parseStrictInteger(el.value, 1, 10));
        } else {
            return;
        }
        commitSim();
    });
}

/* ==================== EVENIMENTE (delegare) ==================== */
// Toate butoanele folosesc data-action în loc de onclick inline,
// așa că numele cu apostrof sau ghilimele nu mai pot strica nimic.
const ACTIONS = {
    "nav": el => switchTab(el.dataset.tab),
    "add-grade": el => openAddGradeModal(el.dataset.mat || null),
    "add-subject": () => promptAddMaterie(),
    "add-event": el => openEventModal({ date: el.dataset.date, subject: el.dataset.mat, type: el.dataset.type }),
    "quick-test": () => {
        switchTab("tab-calendar");
        openEventModal({ type: "Test" });
    },
    "show-date": el => showDateInCalendar(el.dataset.date),
    "cal-nav": el => calNavigate(Number(el.dataset.offset)),
    "cal-today": () => {
        ui.cal.date = getLocalDateKey();
        renderCalendar();
    },
    "cal-view": el => {
        ui.cal.view = el.dataset.view === "month" ? "month" : "week";
        renderCalendar();
    },
    "cal-goto": el => calGoto(el.dataset.date),
    "event-open": el => openEventModal({ id: el.dataset.id, date: el.dataset.date }),
    "event-done": el => toggleEventDone(el.dataset.id, el.dataset.date),
    "event-grade": el => openGradeForEvent(el.dataset.id, el.dataset.date),
    "event-delete": el => promptDeleteEvent(el.dataset.id, el.dataset.date),
    "event-delete-one": el => deleteOccurrence(el.dataset.id, el.dataset.date),
    "event-delete-all": el => deleteSeries(el.dataset.id),
    "ev-use-date": el => {
        if ($("ev-date")) $("ev-date").value = el.dataset.date;
        syncEventForm();
    },
    "timetable": () => openTimetableModal(),
    "tt-remove": el => {
        const list = ui.ttDraft?.[el.dataset.day];
        if (!list) return;
        list.splice(Number(el.dataset.index), 1);
        rerenderTimetableEditor(el.dataset.day);
    },
    "cat-select": el => selectCatalogSubject(el.dataset.mat),
    "grade-pick": el => {
        const input = $("modal-grade-val");
        if (!input) return;
        input.value = el.dataset.val;
        document.querySelectorAll(".grade-pick-btn").forEach(b => b.setAttribute("aria-pressed", String(b === el)));
    },
    "grade-date": el => {
        const input = $("modal-grade-date");
        if (input) input.value = addDays(getLocalDateKey(), -Number(el.dataset.days || 0));
    },
    "cat-step": el => stepCatalog(Number(el.dataset.dir) === -1 ? -1 : 1),
    "cat-group": el => {
        const key = el.dataset.group;
        ui.catalog.collapsed[key] = el.getAttribute("aria-expanded") === "true";
        renderCatalogList();
        $("cat-list").querySelector(`[data-action="cat-group"][data-group="${key}"]`)?.focus();
    },
    "cat-back": () => {
        ui.catalog.showDetail = false;
        renderCatalog();
        document.querySelector("#cat-list .cat-row.selected")?.focus();
    },
    "cat-filter": el => {
        ui.catalog.filter = CATALOG_FILTERS[el.dataset.filter] ? el.dataset.filter : "all";
        renderCatalogFilters(catalogEntries());
        renderCatalogList();
    },
    "cat-clear-filters": () => {
        ui.catalog.filter = "all";
        ui.catalog.query = "";
        renderCatalog();
    },
    "open-subject": el => openSubjectInCatalog(el.dataset.mat),
    "home-day": el => {
        ui.home.day = el.dataset.day === "next" ? "next" : "today";
        renderDashboard();
        document.querySelector(`#azi-day [data-action="home-day"][data-day="${ui.home.day}"]`)?.focus();
    },
    "home-risk": () => {
        ui.catalog.filter = "risk";
        ui.catalog.query = "";
        ui.catalog.showDetail = false;
        switchTab("tab-catalog");
    },
    "stats-print": () => openReportPanel(),
    "stats-insights-more": () => {
        ui.statsAllInsights = !ui.statsAllInsights;
        renderStatsInsights(statsEntries());
        $("stats-insights").querySelector('[data-action="stats-insights-more"]')?.focus();
    },
    "stats-period": el => setStatsPeriod(el.dataset.period),
    "stats-jump": el => $(el.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    "open-in-sim": el => openSubjectInSimulator(el.dataset.mat),
    "edit-subject": el => openEditSubjectModal(el.dataset.mat),
    "purtare-edit": el => openPurtareModal(el.dataset.key),
    "purtare-reset": el => {
        const m = metrics.purtare.modules.find(x => x.key === el.dataset.key);
        if (m && m.val !== null) setPurtare(m, 10, "");
    },
    "purtare-toggle-gpa": () => {
        state.purtare.excludeFromGPA = !state.purtare.excludeFromGPA;
        addActivity(state.purtare.excludeFromGPA ? "Purtarea a fost exclusă din media generală." : "Purtarea a fost inclusă din nou în media generală.");
        refresh();
    },
    "purtare-settings": () => {
        switchTab("tab-setari");
        $("modules-card")?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    "edit-grade": el => openEditGradeModal(el.dataset.mat, Number(el.dataset.index)),
    "toggle-priority": el => togglePriority(el.dataset.mat),
    "toggle-exclude": el => toggleExclude(el.dataset.mat),
    "delete-grade": el => deleteGrade(el.dataset.mat, Number(el.dataset.index)),
    "delete-subject": el => deleteSubject(el.dataset.mat),
    "reset-menu": () => openResetMenu(),
    "reset-option": el => confirmResetOption(el.dataset.option),
    ...SIM_ACTIONS,
    ...SETUP_ACTIONS,
    "dismiss-alert": el => dismissAlert(el.dataset.id),
    "mark-alerts-read": () => markAllAlertsRead(),
    "alert-open": el => openAlertTarget(el.dataset.id),
    "save-settings": () => saveSettings(),
    "backup-export": () => exportBackup(),
    "backup-import": () => $("backup-file-input")?.click(),
    "backup-undo": () => undoImport(),
    "reset-settings": () => resetSettings(),
    "cmdk": () => openCmdk(),
    "cmdk-close": () => closeCmdk(),
    "quick-add": el => openQuickAdd(el),
    "quick-add-close": () => closeQuickAdd(),
    "qa": el => runQuickAdd(el.dataset.kind),
    "notif-open": () => openNotifPanel(),
    "more-open": () => openMoreMenu(),
    "more-close": () => closeMoreMenu(),
    "more-run": el => {
        closeMoreMenu({ restoreFocus: false });
        if (!canEdit() && !GUEST_OK_MORE.has(el.dataset.kind)) { requireAccount(); return; }
        MORE_ACTIONS[el.dataset.kind]?.();
    },
    "notif-close": () => closeNotifPanel(),
    "modal-cancel": () => closeActionModal(),
    "guest-signin": () => { authUI.reason = ""; openAuth("signin"); },
    "none": () => {},
    ...ACCOUNT_ACTIONS,
    ...TOUR_ACTIONS,
    ...PLAN_ACTIONS,
    ...CAT_MENU_ACTIONS
};

function bindEvents() {
    document.addEventListener("click", event => {
        const el = event.target.closest("[data-action]");
        if (!el) return;
        // Fără cont: doar acțiunile care arată ceva; restul deschid autentificarea (și bifele nu se bifează)
        if (!canEdit() && !GUEST_OK.has(el.dataset.action) && ACTIONS[el.dataset.action]) {
            event.preventDefault();
            requireAccount();
            return;
        }
        ACTIONS[el.dataset.action]?.(el, event);
    });
    document.addEventListener("input", event => {
        if (event.target.id === "set-name" || event.target.id === "set-buddy") renderBuddyPreview();
        if (event.target.id === "modal-grade-val") {
            document.querySelectorAll(".grade-pick-btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.val === event.target.value.trim())));
        }
    });
    // Setările se salvează singure, imediat ce schimbi ceva (nu mai trebuie apăsat „Salvează”).
    document.addEventListener("change", event => {
        const el = event.target;
        if (!el.closest?.("#tab-setari") || !el.matches("input, select") || el.type === "file") return;
        if (!(el.id in SETTINGS_FIELDS) && !el.closest("#set-modules") && el.id !== "set-module-preset") return;
        if (!canEdit()) { loadSettingsIntoUI(); requireAccount(); return; }
        saveSettings({ quiet: true });
    });

    document.addEventListener("keydown", event => {
        const overlay = $("action-modal");

        if (event.key === "Escape") {
            if (!overlay.hidden) closeActionModal();
            return;
        }

        trapModalFocus(event);

        // Enter într-un câmp din dialog = confirmare.
        if (event.key === "Enter" && !overlay.hidden && event.target.matches("#action-modal-body input")) {
            event.preventDefault();
            const confirmBtn = $("action-modal-confirm");
            if (!confirmBtn.hidden) confirmBtn.click();
        }
    });

    // Click pe fundalul dialogului îl închide.
    $("action-modal").addEventListener("mousedown", event => {
        if (event.target.id === "action-modal") closeActionModal();
    });

    bindShellEvents();
    bindSimulatorEvents();
    bindBackupEvents();
    bindCatalogEvents();
    bindCalendarEvents();
    bindPurtareEvents();
    $("stats-sort")?.addEventListener("change", event => {
        ui.statsSort = STATS_SORTS[event.target.value] ? event.target.value : "attention";
        const range = periodRange();
        const subs = periodSubjects(range);
        renderStatsSubjects(statsEntries(subs, range ? calculateMetrics(subs) : metrics), { range });
    });
    // Ctrl+P / Print din browser: același raport curat, nu pagina aplicației.
    window.addEventListener("beforeprint", buildPrintReport);

    // Tema „Sistem” urmărește schimbările sistemului de operare.
    darkQuery.addEventListener?.("change", () => {
        if (state.settings.appearance.theme !== "system") return;
        applyAppearanceSettings();
        renderActiveTab({ keepSettingsForm: true });
    });

    // O nouă zi poate aduce alerte/teste noi; recalculăm când utilizatorul revine în tab.
    let lastDay = getLocalDateKey();
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && getLocalDateKey() !== lastDay) {
            lastDay = getLocalDateKey();
            refresh();
        }
    });
}

/* ==================== PORNIRE ==================== */
function init() {
    loadState();
    applyAppearanceSettings();
    bindEvents();
    initAppBar();
    bindStatsNav();
    initCustomSelects();
    bindHoverTips();

    if (!localStorage.getItem(KEYS.firstRun)) {
        try {
            localStorage.setItem(KEYS.firstRun, "true");
        } catch (_) { /* ignorăm */ }
    }

    refresh();
    applyCursorSetting();
    bindSetupEvents();
    bindAuthEvents();
    bindCatMenu();
    bindCatalogNav();
    bindPhoneHelpers();
    bindSheetDrag();
    bindIsland();
    initBuddyLook();
    initCloud();
    // Cu conturi, configurarea vine după alegerea de pe ecranul de autentificare.
    if (!cloud.configured && shouldOfferSetup()) openSetup(0);
}


/* ==================== CURSOR CUSTOM ==================== */
/*
 * Cercul se mișcă după un model fizic resort–masă–amortizor:
 * are viteză proprie, deci „zboară” spre cursor pe o traiectorie,
 * duce inerția prin curbe, depășește puțin ținta și revine.
 * Punctul central rămâne lipit de pointer, ca click-ul să fie precis.
 */
const CURSOR_PHYSICS = {
    stiffness: 210,      // cât de tare trage resortul spre pointer (mai mare = mai rapid)
    damping: 17,         // frânare (mai mic = mai multă oscilație; ~29 = fără depășire)
    mass: 1,             // „greutatea” cercului (mai mare = mai leneș, mai multă inerție)
    stretch: 0.00011,    // cât se alungește în direcția mișcării, per px/s
    maxStretch: 0.32     // alungire maximă (32%)
};

/*
 * Cursorul (Setări → Aspect), doar cu mouse:
 *   off   – cursorul sistemului
 *   pen   – „Pix”: cursoare SVG în culoarea cernelii, desenate de sistem ⇒ zero întârziere, zero JavaScript la mișcare
 *   on    – cercul animat (fizică de arc)
 *   chalk – „Jucăuș”: pixul + o urmă care se estompează și steluțe la clic (canvas; bucla se oprește când nu se mișcă nimic)
 * Cu „reduce motion”, modurile animate devin „Pix”.
 */
const CURSOR_MODES = ["off", "pen", "on", "chalk"];
let cursorReady = false;
let chalkReady = false;

function applyCursorSetting() {
    const fine = Boolean(window.matchMedia?.("(pointer: fine)").matches);
    const calm = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    let mode = fine ? state.settings.appearance.cursor : "off";
    if (calm && (mode === "on" || mode === "chalk")) mode = "pen";

    if (mode === "on" && !cursorReady) {
        cursorReady = true;
        initCustomCursor();
    }
    if (mode === "chalk" && !chalkReady) {
        chalkReady = true;
        initChalkCursor();
    }
    if (mode === "pen" || mode === "chalk") setPenCursors();
    document.body.classList.toggle("custom-cursor-active", mode === "on");
    document.body.classList.toggle("cursor-pen", mode === "pen" || mode === "chalk");
    document.body.classList.toggle("cursor-chalk", mode === "chalk");
    document.body.dataset.cursor = mode;
}

/** Cursoarele „Pix”, generate în culoarea cernelii curente (se refac la schimbarea temei sau a culorii). */
function setPenCursors() {
    const dark = document.body.classList.contains("dark-mode");
    const ink = (ACCENTS[state.settings.appearance.accent] || ACCENTS.violet)[dark ? "dark" : "light"];
    const edge = dark ? "#14201B" : "#FFFFFF";
    const svg = body => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>${body}</svg>`)}")`;
    // săgeată cu vârf ascuțit (contur contrastant, ca să se vadă pe orice fundal)
    const arrow = svg(`<path d='M4 3v18.5l4.9-4.6 3.3 7.2 3.2-1.4-3.2-7h6.9z' fill='${ink}' stroke='${edge}' stroke-width='1.6' stroke-linejoin='round'/>`);
    // peniță de stilou, vârful în colțul din stânga-sus (punctul activ)
    const nib = svg(`<path d='M3 3l10 3.2 9.2 9.2-6.8 6.8L6.2 13z' fill='${ink}' stroke='${edge}' stroke-width='1.6' stroke-linejoin='round'/>`
        + `<path d='M3 3l6.4 6.4' stroke='${edge}' stroke-width='1.4' stroke-linecap='round'/><circle cx='10.6' cy='10.6' r='1.7' fill='${edge}'/>`
        + `<path d='M18.8 18.8l2.6 2.6' stroke='${edge}' stroke-width='3.4' stroke-linecap='round'/>`);
    const root = document.documentElement.style;
    root.setProperty("--cur-default", `${arrow} 4 3, auto`);
    root.setProperty("--cur-pointer", `${nib} 3 3, pointer`);
}

/** „Jucăuș”: urmă de cretă/cerneală + o mică explozie de steluțe la fiecare clic. */
function initChalkCursor() {
    const canvas = $("cursor-canvas");
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const TRAIL_MS = 320;
    const trail = [];
    const sparks = [];
    let frame = null;
    let last = 0;
    let dpr = 1;

    const resize = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(innerWidth * dpr);
        canvas.height = Math.round(innerHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const active = () => document.body.classList.contains("cursor-chalk");
    const colors = () => {
        const dark = document.body.classList.contains("dark-mode");
        const css = getComputedStyle(document.body);
        const ink = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || "#2347C5";
        return {
            dark,
            trail: dark ? "rgba(238, 241, 234, 0.85)" : ink,
            sparks: [ink, css.getPropertyValue("--ok").trim(), css.getPropertyValue("--warn").trim(), css.getPropertyValue("--risk").trim(), dark ? "#F6D365" : "#C58A12"]
        };
    };

    const star = (x, y, r, rot) => {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = rot + (i * Math.PI) / 4;
            const rr = i % 2 ? r * 0.42 : r;
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
    };

    const draw = now => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        const c = colors();

        while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = c.trail;
        for (let i = 1; i < trail.length; i++) {
            const life = 1 - (now - trail[i].t) / TRAIL_MS;
            ctx.globalAlpha = Math.max(0, life) * (c.dark ? 0.7 : 0.6);
            ctx.lineWidth = 1.5 + life * 6;
            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.stroke();
            // praf de cretă pe tablă
            if (c.dark && trail[i].dust) {
                ctx.fillStyle = c.trail;
                ctx.fillRect(trail[i].x + trail[i].dust[0], trail[i].y + trail[i].dust[1], 1.4, 1.4);
            }
        }

        for (let i = sparks.length - 1; i >= 0; i--) {
            const p = sparks[i];
            p.life -= dt / p.ttl;
            if (p.life <= 0) { sparks.splice(i, 1); continue; }
            p.vy += 520 * dt;         // gravitație ușoară
            p.vx *= 1 - 1.8 * dt;     // frecare
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.spin * dt;
            ctx.globalAlpha = Math.min(1, p.life * 1.6);
            ctx.fillStyle = p.color;
            star(p.x, p.y, p.size * (0.6 + p.life * 0.4), p.rot);
        }
        ctx.globalAlpha = 1;

        frame = trail.length > 1 || sparks.length ? requestAnimationFrame(draw) : null;
        if (!frame) ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); // la final, pânza rămâne curată
    };

    const wake = () => {
        if (frame !== null) return;
        last = performance.now();
        frame = requestAnimationFrame(draw);
    };

    document.addEventListener("mousemove", event => {
        if (!active()) return;
        const dark = document.body.classList.contains("dark-mode");
        trail.push({ x: event.clientX, y: event.clientY, t: performance.now(), dust: dark && Math.random() < 0.35 ? [(Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7] : null });
        if (trail.length > 60) trail.shift();
        wake();
    }, { passive: true });

    document.addEventListener("mousedown", event => {
        if (!active() || event.button !== 0) return;
        const palette = colors().sparks.filter(Boolean);
        const n = 12;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
            const v = 140 + Math.random() * 170;
            sparks.push({
                x: event.clientX, y: event.clientY,
                vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90,
                size: 5 + Math.random() * 4, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 10,
                life: 1, ttl: 0.55 + Math.random() * 0.3,
                color: palette[i % palette.length]
            });
        }
        if (sparks.length > 120) sparks.splice(0, sparks.length - 120);
        wake();
    });

    document.documentElement.addEventListener("mouseleave", () => { trail.length = 0; });
}

function initCustomCursor() {
    // Doar pentru mouse; dezactivat la „reduce motion” (efectul e pur decorativ).
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ring = $("custom-cursor");
    const dot = $("custom-cursor-dot");
    if (!ring || !dot) return;

    document.body.classList.add("custom-cursor-active");

    const INTERACTIVE = "button, a, select, label, [data-action], summary, .cs-opt, [data-tip-value], [data-tip-lines]";
    const TEXT_FIELDS = "input:not([type='checkbox']):not([type='range']):not([type='radio']), textarea";
    const { stiffness, damping, mass, stretch, maxStretch } = CURSOR_PHYSICS;
    const MAX_STEP = 1 / 120; // pași mici = simulare stabilă și la FPS scăzut

    const target = { x: -100, y: -100 };
    const pos = { x: -100, y: -100 };
    const vel = { x: 0, y: 0 };
    let angle = 0;
    let frame = null;
    let lastTime = 0;
    let started = false;

    const step = dt => {
        // F = -k·x - c·v ; a = F / m  (Euler semi-implicit)
        const ax = (stiffness * (target.x - pos.x) - damping * vel.x) / mass;
        const ay = (stiffness * (target.y - pos.y) - damping * vel.y) / mass;
        vel.x += ax * dt;
        vel.y += ay * dt;
        pos.x += vel.x * dt;
        pos.y += vel.y * dt;
    };

    const tick = now => {
        // dt real, plafonat (după un tab inactiv nu vrem un „salt” uriaș)
        let dt = Math.min((now - lastTime) / 1000, 1 / 20);
        lastTime = now;
        while (dt > 0) {
            const h = Math.min(dt, MAX_STEP);
            step(h);
            dt -= h;
        }

        const speed = Math.hypot(vel.x, vel.y);
        const s = Math.min(speed * stretch, maxStretch);
        // Unghiul se actualizează doar când există mișcare clară, ca să nu „tremure” la oprire.
        if (speed > 40) angle = Math.atan2(vel.y, vel.x);

        ring.style.transform =
            `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${angle}rad) scale(${1 + s}, ${1 - s * 0.55})`;

        const settled = speed < 2 && Math.abs(target.x - pos.x) < 0.15 && Math.abs(target.y - pos.y) < 0.15;
        if (settled) {
            pos.x = target.x;
            pos.y = target.y;
            vel.x = vel.y = 0;
            ring.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
            frame = null; // bucla se oprește complet când cercul s-a așezat
        } else {
            frame = requestAnimationFrame(tick);
        }
    };

    const wake = () => {
        if (frame !== null) return;
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
    };

    document.addEventListener("mousemove", event => {
        target.x = event.clientX;
        target.y = event.clientY;

        if (!started) {
            // prima apariție: cercul pornește direct de pe pointer, fără „zbor” din colț
            started = true;
            pos.x = target.x;
            pos.y = target.y;
        }

        // Punctul urmează instantaneu.
        dot.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
        document.body.classList.add("cursor-visible");
        wake();
    }, { passive: true });

    document.documentElement.addEventListener("mouseleave", () => document.body.classList.remove("cursor-visible"));
    document.addEventListener("mousedown", () => document.body.classList.add("cursor-click"));
    document.addEventListener("mouseup", () => document.body.classList.remove("cursor-click"));

    document.addEventListener("mouseover", event => {
        const onText = Boolean(event.target.closest(TEXT_FIELDS));
        document.body.classList.toggle("cursor-text", onText);
        document.body.classList.toggle("cursor-hover", !onText && Boolean(event.target.closest(INTERACTIVE)));
    }, { passive: true });
}

/* ==================== START ==================== */
// La final, ca toate constantele de mai sus să fie deja definite.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}