// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
const os = require("os");
const fs = require("fs");
const nodePath = require("path");
process.env.DB_PATH = nodePath.join(os.tmpdir(), `essenza-roles-${process.pid}.db`);
const { PermissionFlagsBits: P, PermissionsBitField } = require(PROJECT_ROOT + "/node_modules/discord.js");
const { isManager } = require(PROJECT_ROOT + "/src/discord");
const mk = (perms, roles) => ({ memberPermissions: new PermissionsBitField(perms), member: { roles: { cache: new Map(roles.map((n, i) => [i, { name: n }])) } } });
const R = ["💬 𝗖𝗛𝗔𝗧𝗧𝗜𝗡𝗚", "💬 𝗖𝗵𝗮𝘁𝘁𝗲𝗿"];
const cases = [
  ["chatter con Gestionar servidor (permiso ampliado por el servidor)", mk([P.ManageGuild], [R[1]]), false],
  ["rol CHATTING con Gestionar servidor", mk([P.ManageGuild], [R[0], "Shift 2"]), false],
  ["chatter sin ningún permiso", mk([], [R[1]]), false],
  ["manager normal con Gestionar servidor", mk([P.ManageGuild], ["Team Leader"]), true],
  ["Trial Chatter con Gestionar servidor (no está bloqueado)", mk([P.ManageGuild], ["Trial Chatter"]), true],
  ["administrador que además tiene el rol Chatter", mk([P.Administrator, P.ManageGuild], [R[1]]), true],
  ["sin permiso y sin rol bloqueado", mk([], ["Team Leader"]), false],
  ["sin lista de roles disponible", { memberPermissions: new PermissionsBitField([P.ManageGuild]), member: {} }, true],
];
let bad = 0;
for (const [n, i, esp] of cases) { const r = isManager(i); if (r !== esp) bad++; console.log((r === esp ? "PASA " : "FALLA") + "  " + n + " -> " + (r ? "puede" : "bloqueado")); }
console.log(bad ? bad + " fallan" : "todas las pruebas pasan");
const total = cases.length;
console.log(`\n${total - bad}/${total} pruebas de roles de Discord pasan`);
for (const ext of ["", "-wal", "-shm"]) { try { fs.rmSync(process.env.DB_PATH + ext); } catch {} }
process.exit(bad ? 1 : 0);
