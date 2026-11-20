const express = require('express'), cors = require('cors'), jwt = require('jsonwebtoken'), { Pool } = require('pg');
const app = express(); app.use(express.json()); app.use(cors());
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { JWT_SECRET, INTERNAL_KEY, PORT = 8080 } = process.env;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function init() {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS events(
        id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, task_id TEXT, title TEXT,
        user_id INT, user_name TEXT, meta JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now())`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC)');
      return;
    } catch (e) { console.log('PostgreSQL pas prêt:', e.message); await sleep(2000); }
  }
  process.exit(1);
}
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Non authentifié' }); }
};

app.get('/healthz', (_, res) => res.json({ ok: true }));
app.get('/readyz', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ ready: true }); } catch { res.status(503).json({ ready: false }); }
});
// Endpoint interne : appelé uniquement par task-service (jamais exposé par nginx)
app.post('/internal/events', async (req, res) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) return res.sendStatus(403);
  const { type, taskId, title, userId, userName, meta } = req.body;
  await pool.query('INSERT INTO events(type,task_id,title,user_id,user_name,meta) VALUES($1,$2,$3,$4,$5,$6)', [type, taskId, title, userId, userName, meta || {}]);
  res.sendStatus(202);
});
app.get('/api/analytics/activity', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM events ORDER BY created_at DESC LIMIT $1', [Math.min(Number(req.query.limit) || 30, 200)]);
  res.json(rows);
});
app.get('/api/analytics/summary', auth, async (_, res) => {
  const [daily, top, totals] = await Promise.all([
    pool.query(`SELECT to_char(d,'YYYY-MM-DD') AS day,
        COALESCE(SUM((e.type='task.created')::int),0)::int AS created,
        COALESCE(SUM((e.type='task.completed')::int),0)::int AS completed
      FROM generate_series(current_date-6,current_date,'1 day') d
      LEFT JOIN events e ON e.created_at::date=d::date GROUP BY d ORDER BY d`),
    pool.query(`SELECT user_name, COUNT(*)::int AS actions, (COUNT(*) FILTER (WHERE type='task.completed'))::int AS completed
      FROM events GROUP BY user_name ORDER BY actions DESC LIMIT 5`),
    pool.query('SELECT COUNT(*)::int AS events FROM events'),
  ]);
  res.json({ daily: daily.rows, topContributors: top.rows, totalEvents: totals.rows[0].events });
});
init().then(() => app.listen(PORT, () => console.log('analytics-service sur', PORT)));
process.on('SIGTERM', () => process.exit(0));
