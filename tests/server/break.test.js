// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
const path = require("path"), fs = require("fs"), os = require("os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-br-"));
process.env.DB_PATH = path.join(tmp, "t.db");
delete process.env.SHIFT_HOURS; delete process.env.BREAK_MINUTES;
const s = require(path.join(PROJECT_ROOT, "src/shifts"));
const H = 3600e3, M = 60e3, t0 = 1e12;
const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);
const m = (x) => Math.round(x / M);

// 1) Break de 30 justos: puede terminar a las 8 h de reloj
s.startShift("a", "A", t0); s.startBreak("a", t0 + 2 * H); s.endBreak("a", t0 + 2 * H + 30 * M);
let r = s.endShift("a", t0 + 8 * H);
ok("break de 30 min: termina a las 8 h exactas de reloj", r.ok && m(r.workedMs) === 480, `trabajado ${m(r.workedMs)} min`);

// 2) Break de 20: también a las 8 h
s.startShift("b", "B", t0); s.startBreak("b", t0 + H); s.endBreak("b", t0 + H + 20 * M);
ok("break de 20 min: a las 8 h ya puede terminar", s.endShift("b", t0 + 8 * H).ok);

// 3) Sin break: a las 8 h
s.startShift("c", "C", t0);
ok("sin break: a las 7 h 59 aún no", s.endShift("c", t0 + 8 * H - M).reason === "too_early");
ok("sin break: a las 8 h sí", s.endShift("c", t0 + 8 * H).ok);

// 4) Break de 45: se pasa 15, debe recuperar 15
s.startShift("d", "D", t0); s.startBreak("d", t0 + 3 * H); s.endBreak("d", t0 + 3 * H + 45 * M);
r = s.endShift("d", t0 + 8 * H);
ok("break de 45 min: a las 8 h NO puede (le faltan los 15 de exceso)", !r.ok && r.reason === "too_early" && m(r.st.remainingMs) === 15, `faltan ${m(r.st.remainingMs)} min`);
r = s.endShift("d", t0 + 8 * H + 15 * M);
ok("break de 45 min: a las 8 h 15 sí", r.ok && m(r.breakOverMs) === 15);

// 5) Durante el break el trabajado sigue corriendo hasta los 30
s.startShift("e", "E", t0); s.startBreak("e", t0 + H);
const st20 = s.statusOf("e", t0 + H + 20 * M);
ok("a los 20 min de break, el trabajado sigue sumando", m(st20.workedMs) === 80, `${m(st20.workedMs)} min`);
const st40 = s.statusOf("e", t0 + H + 40 * M);
ok("a los 40 min de break, se descuentan solo los 10 de exceso", m(st40.workedMs) === 90 && m(st40.breakOverMs) === 10, `${m(st40.workedMs)} min trabajados`);

console.log(out.join("\n"));
const f = out.filter((x) => x.startsWith("FALLA")).length;
console.log(`\n${out.length - f}/${out.length} pruebas de la regla del break pasan`);
process.exit(f ? 1 : 0);
