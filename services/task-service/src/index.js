const express = require('express'), cors = require('cors'), jwt = require('jsonwebtoken'), mongoose = require('mongoose');
const app = express(); app.use(express.json()); app.use(cors());
const { JWT_SECRET, MONGO_URL, ANALYTICS_URL, INTERNAL_KEY, PORT = 8080 } = process.env;

const Task = mongoose.model('Task', new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['todo', 'in_progress', 'review', 'done'], default: 'todo' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  dueDate: Date,
  labels: [String],
  assignee: { id: Number, name: String },
  subtasks: [{ title: String, done: { type: Boolean, default: false } }],
  comments: [{ authorName: String, text: String, createdAt: { type: Date, default: Date.now } }],
  createdBy: { id: Number, name: String },
}, { timestamps: true }));

const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Non authentifié' }); }
};
// Événement asynchrone vers analytics-service (fire & forget)
const emit = (type, task, user, meta = {}) => {
  if (!ANALYTICS_URL) return;
  fetch(`${ANALYTICS_URL}/internal/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body: JSON.stringify({ type, taskId: String(task._id), title: task.title, userId: user.id, userName: user.name, meta }),
  }).catch(e => console.warn('analytics indisponible:', e.message));
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

app.get('/healthz', (_, res) => res.json({ ok: true }));
app.get('/readyz', (_, res) => mongoose.connection.readyState === 1 ? res.json({ ready: true }) : res.status(503).json({ ready: false }));

app.get('/api/tasks/stats', auth, async (_, res) => {
  const [byStatus, byPriority, overdue, total] = await Promise.all([
    Task.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.aggregate([{ $group: { _id: '$priority', n: { $sum: 1 } } }]),
    Task.countDocuments({ status: { $ne: 'done' }, dueDate: { $lt: new Date() } }),
    Task.countDocuments(),
  ]);
  const toMap = a => Object.fromEntries(a.map(x => [x._id, x.n]));
  res.json({ total, overdue, byStatus: toMap(byStatus), byPriority: toMap(byPriority) });
});
app.get('/api/tasks', auth, async (req, res) => {
  const { status, priority, label, assignee, q } = req.query, f = {};
  if (status) f.status = String(status);
  if (priority) f.priority = String(priority);
  if (label) f.labels = String(label);
  if (assignee) f['assignee.id'] = Number(assignee);
  if (q) { const r = new RegExp(esc(String(q)), 'i'); f.$or = [{ title: r }, { description: r }]; }
  res.json(await Task.find(f).sort({ updatedAt: -1 }).limit(500));
});
app.post('/api/tasks', auth, async (req, res) => {
  try {
    const { comments, createdBy, ...data } = req.body;
    const t = await Task.create({ ...data, createdBy: { id: req.user.id, name: req.user.name } });
    emit('task.created', t, req.user); res.status(201).json(t);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/tasks/:id', auth, async (req, res) => {
  try {
    const t = await Task.findById(req.params.id); if (!t) return res.sendStatus(404);
    const { comments, createdBy, _id, ...data } = req.body;
    const wasDone = t.status === 'done';
    Object.assign(t, data); await t.save();
    emit(!wasDone && t.status === 'done' ? 'task.completed' : 'task.updated', t, req.user); res.json(t);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/tasks/:id/status', auth, async (req, res) => {
  const t = await Task.findById(req.params.id); if (!t) return res.sendStatus(404);
  const from = t.status; t.status = req.body.status;
  try { await t.save(); } catch (e) { return res.status(400).json({ error: e.message }); }
  emit(t.status === 'done' && from !== 'done' ? 'task.completed' : 'task.moved', t, req.user, { from, to: t.status }); res.json(t);
});
app.post('/api/tasks/:id/comments', auth, async (req, res) => {
  const t = await Task.findById(req.params.id); if (!t) return res.sendStatus(404);
  t.comments.push({ authorName: req.user.name, text: req.body.text }); await t.save();
  emit('task.commented', t, req.user); res.status(201).json(t);
});
app.delete('/api/tasks/:id', auth, async (req, res) => {
  const t = await Task.findByIdAndDelete(req.params.id); if (!t) return res.sendStatus(404);
  emit('task.deleted', t, req.user); res.sendStatus(204);
});

mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 60000 })
  .then(() => app.listen(PORT, () => console.log('task-service sur', PORT)))
  .catch(e => { console.error(e); process.exit(1); });
process.on('SIGTERM', () => process.exit(0));
