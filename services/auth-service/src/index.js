const express = require('express'), cors = require('cors'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), { Pool } = require('pg');
const app = express(); app.use(express.json()); app.use(cors());
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = process.env.JWT_SECRET, PORT = process.env.PORT || 8080;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sign = u => jwt.sign({ id: u.id, name: u.name, email: u.email }, SECRET, { expiresIn: '12h' });

async function init() {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS users(
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
      return;
    } catch (e) { console.log('PostgreSQL pas prêt:', e.message); await sleep(2000); }
  }
  process.exit(1);
}
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Non authentifié' }); }
};

app.get('/healthz', (_, res) => res.json({ ok: true }));
app.get('/readyz', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ ready: true }); } catch { res.status(503).json({ ready: false }); }
});
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Champs invalides (mot de passe ≥ 6 caractères)' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email', [name, email.toLowerCase(), hash]);
    res.status(201).json({ token: sign(rows[0]), user: rows[0] });
  } catch (e) { res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'Email déjà utilisé' : 'Erreur serveur' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [(email || '').toLowerCase()]);
  if (!rows[0] || !(await bcrypt.compare(password || '', rows[0].password_hash))) return res.status(401).json({ error: 'Identifiants invalides' });
  const u = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
  res.json({ token: sign(u), user: u });
});
app.get('/api/auth/me', auth, (req, res) => res.json(req.user));
app.get('/api/auth/users', auth, async (_, res) => {
  const { rows } = await pool.query('SELECT id,name,email FROM users ORDER BY name'); res.json(rows);
});
init().then(() => app.listen(PORT, () => console.log('auth-service sur', PORT)));
process.on('SIGTERM', () => process.exit(0));
