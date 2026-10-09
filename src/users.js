const crypto = require("crypto");
const db = require("./db");

// Cuentas del panel. Las contraseñas se guardan con scrypt y una sal por usuario,
// así que ni el administrador ni nadie con acceso a la base puede leerlas.

const ROLES = ["admin", "manager"];
const MIN_PASSWORD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const PUBLIC_COLS =
  "id, username, display_name AS displayName, role, active, created_at AS createdAt, last_login_at AS lastLoginAt";

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return { hash, salt };
}

function passwordMatches(password, user) {
  const given = Buffer.from(hashPassword(password, user.password_salt).hash, "hex");
  const real = Buffer.from(user.password_hash, "hex");
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

// Devuelve el mensaje de error, o cadena vacía si el valor sirve.
function checkUsername(username) {
  const u = String(username || "").trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(u)) {
    return "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.";
  }
  return "";
}

function checkPassword(password) {
  const p = String(password || "");
  if (p.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (p.length > 200) return "La contraseña es demasiado larga.";
  return "";
}

function checkRole(role) {
  return ROLES.includes(role) ? "" : "El rol debe ser admin o manager.";
}

function list() {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY role, username`).all();
}

function getById(id) {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id);
}

function getByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim());
}

function count() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

function countActiveAdmins(exceptId = 0) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(exceptId).n;
}

function create({ username, displayName, password, role }) {
  const { hash, salt } = hashPassword(password);
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, password_salt, role)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(String(username).trim(), String(displayName || username).trim(), hash, salt, role);
  return getById(Number(info.lastInsertRowid));
}

function update(id, { displayName, role, active, password }) {
  if (displayName !== undefined) {
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(String(displayName).trim(), id);
  }
  if (role !== undefined) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  if (active !== undefined) db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (password !== undefined) {
    const { hash, salt } = hashPassword(password);
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(hash, salt, id);
  }
  return getById(id);
}

function remove(id) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

function markLogin(id) {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

// Verifica usuario y contraseña. Devuelve el usuario público o null.
function verify(username, password) {
  const user = getByUsername(username);
  if (!user || !user.active) {
    // Se gasta el mismo tiempo que con un usuario real para no delatar cuáles existen.
    hashPassword(String(password || ""), "0".repeat(32));
    return null;
  }
  if (!passwordMatches(String(password || ""), user)) return null;
  markLogin(user.id);
  return getById(user.id);
}

// Comprueba la contraseña de una cuenta concreta, sin tocar la fecha de entrada.
function matches(id, password) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return Boolean(user) && passwordMatches(String(password || ""), user);
}

// Primera puesta en marcha: si no hay ninguna cuenta y existe ADMIN_PASSWORD,
// se crea la cuenta "admin" con esa contraseña para poder entrar.
function bootstrapFromEnv() {
  if (count() > 0) return null;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  if (checkPassword(password)) {
    console.warn(
      `AVISO: no se creó la cuenta inicial porque ADMIN_PASSWORD es demasiado corta (mínimo ${MIN_PASSWORD} caracteres).`
    );
    return null;
  }
  const user = create({ username: "admin", displayName: "Administrador", password, role: "admin" });
  console.log('Cuenta inicial creada: usuario "admin" con la contraseña de ADMIN_PASSWORD. Cámbiala al entrar.');
  return user;
}

module.exports = {
  ROLES,
  MIN_PASSWORD,
  list,
  getById,
  getByUsername,
  count,
  countActiveAdmins,
  create,
  update,
  remove,
  verify,
  matches,
  checkUsername,
  checkPassword,
  checkRole,
  bootstrapFromEnv,
};
