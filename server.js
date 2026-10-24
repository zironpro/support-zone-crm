process.env.TZ = process.env.TZ || 'Asia/Dubai';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { db, tx, getSettings, setSettings, today } = require('./db');
const L = require('./logic');
const R = require('./reports');
const { renderInvoice, renderVerify } = require('./print');

const PORT = Number(process.env.PORT) || 3000;
L.backfillShares();
const SESSION_DAYS = 7;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ---------- sessions ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 86400;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
}

app.use((req, res, next) => {
  const sid = parseCookies(req).sid;
  if (sid) {
    const row = db.prepare(`SELECT u.id, u.name, u.username, u.role, u.agent_type, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(sid);
    if (row && row.active && row.expires_at > Date.now()) {
      req.user = { id: row.id, name: row.name, username: row.username, role: row.role, agent_type: row.agent_type };
      req.sid = sid;
    }
  }
  next();
});

// Mutating API calls must come from our own UI (blocks cross-site form posts).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('x-crm') !== '1') return res.status(403).json({ error: 'Bad request origin' });
  next();
});

const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') out.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch(next);
    else if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) { next(err); }
};
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please log in' }));
const owner = (req, res, next) => (req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Owner access only' }));
const id = (req) => {
  const n = L.int(req.params.id);
  if (!n) throw L.bad('Invalid id');
  return n;
};
const range = (q) => {
  const to = L.dateOr(q.to);
  return { from: L.dateOr(q.from, R.monthStart(to)), to };
};

// Used by the Docker / Dokploy health check.
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// ---------- setup & auth ----------
const needsSetup = () => db.prepare('SELECT COUNT(*) n FROM users').get().n === 0;

app.get('/api/setup-status', wrap(() => ({ needsSetup: needsSetup() })));

app.post('/api/setup', wrap((req, res) => {
  if (!needsSetup()) throw L.bad('Setup already completed');
  const b = req.body || {};
  const name = L.str(b.name, 100), username = L.str(b.username, 50);
  if (!name || !username) throw L.bad('Name and username are required');
  L.validatePassword(b.password);
  const userId = tx(() => {
    if (L.str(b.company_name)) setSettings({ company_name: L.str(b.company_name, 150) });
    const r = db.prepare(`INSERT INTO users (name, username, password_hash, role, agent_type) VALUES (?,?,?,'owner','commission')`).run(name, username, L.hashPassword(b.password));
    db.prepare(`INSERT INTO accounts (name, type) VALUES ('Cash Drawer','cash')`).run();
    db.prepare(`INSERT INTO customers (name, notes, shared) VALUES ('Walk-in Customer','Default customer for counter sales', 1)`).run();
    return Number(r.lastInsertRowid);
  });
  startSession(req, res, userId);
  return { ok: true };
}));

app.post('/api/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !u.active || !L.checkPassword(password, u.password_hash)) throw new L.HttpError(401, 'Wrong username or password');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  startSession(req, res, u.id);
  return { ok: true };
}));

app.post('/api/logout', wrap((req, res) => {
  if (req.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
}));

app.get('/api/me', auth, wrap((req) => ({ user: req.user, settings: publicSettings(), today: today() })));

app.post('/api/me/password', auth, wrap((req) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!L.checkPassword(req.body.current, u.password_hash)) throw L.bad('Current password is wrong');
  L.validatePassword(req.body.password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(L.hashPassword(req.body.password), u.id);
  return { ok: true };
}));

// ---------- settings ----------
function publicSettings() {
  const s = getSettings();
  delete s.invoice_seq;
  return s;
}
const SETTING_KEYS = ['company_name', 'company_name_ar', 'address', 'phone', 'email', 'website', 'logo', 'invoice_prefix', 'invoice_footer', 'public_url', 'vat_enabled', 'vat_rate', 'trn'];

app.get('/api/settings', auth, wrap(() => publicSettings()));
app.put('/api/settings', auth, owner, wrap((req) => {
  const b = req.body || {};
  const out = {};
  for (const k of SETTING_KEYS) if (k in b) out[k] = k === 'logo' ? String(b[k] || '').slice(0, 700000) : L.str(b[k], 1000) ?? '';
  if (out.logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(out.logo)) throw L.bad('Logo must be a PNG, JPG, WEBP or SVG image');
  if ('vat_enabled' in out) out.vat_enabled = out.vat_enabled === '1' ? '1' : '0';
  if (out.vat_enabled === '1' && !L.str(out.trn ?? getSettings().trn)) throw L.bad('Enter your TRN before enabling VAT');
  setSettings(out);
  return publicSettings();
}));

// ---------- users ----------
// role = access (owner sees everything, agent sees their own work); agent_type = profit share rules.
function roleFrom(b) {
  const role = b.role === 'owner' ? 'owner' : 'agent';
  const types = ['commission', 'sales', 'salaried'];
  const agent_type = types.includes(b.agent_type) ? b.agent_type : types.includes(b.role) ? b.role : role === 'owner' ? 'commission' : 'sales';
  return { role, agent_type };
}
app.get('/api/users', auth, wrap((req) => {
  const cols = req.user.role === 'owner' ? 'id, name, username, role, agent_type, phone, active, created_at' : 'id, name, role, agent_type';
  return db.prepare(`SELECT ${cols} FROM users ${req.user.role === 'owner' ? '' : 'WHERE active = 1'} ORDER BY active DESC, role DESC, name`).all();
}));

app.post('/api/users', auth, owner, wrap((req) => {
  const b = req.body || {};
  const name = L.str(b.name, 100), username = L.str(b.username, 50);
  if (!name || !username) throw L.bad('Name and username are required');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw L.bad('That username is taken');
  L.validatePassword(b.password);
  const { role, agent_type } = roleFrom(b);
  const r = db.prepare('INSERT INTO users (name, username, password_hash, role, agent_type, phone) VALUES (?,?,?,?,?,?)').run(name, username, L.hashPassword(b.password), role, agent_type, L.str(b.phone, 30));
  return { id: Number(r.lastInsertRowid) };
}));

app.put('/api/users/:id', auth, owner, wrap((req) => {
  const uid = id(req);
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) throw L.notFound('User');
  const { role, agent_type } = roleFrom(b);
  const active = b.active === false || b.active === 0 || b.active === '0' ? 0 : 1;
  if (u.role === 'owner' && (role !== 'owner' || !active)) {
    const owners = db.prepare(`SELECT COUNT(*) n FROM users WHERE role = 'owner' AND active = 1`).get().n;
    if (owners <= 1) throw L.bad('There must be at least one active owner');
  }
  const name = L.str(b.name, 100) || u.name;
  db.prepare('UPDATE users SET name = ?, role = ?, agent_type = ?, active = ?, phone = ? WHERE id = ?').run(name, role, agent_type, active, L.str(b.phone, 30), uid);
  if (b.password) {
    L.validatePassword(b.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(L.hashPassword(b.password), uid);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  return { ok: true };
}));

// ---------- customers ----------
function customerBody(b, user, existing = null) {
  const name = L.str(b.name, 150);
  if (!name) throw L.bad('Customer name is required');
  const agentId = L.int(b.agent_id) || null;
  if (agentId && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(agentId)) throw L.bad('Choose a valid agent');
  const phone = L.str(b.phone, 30), eid = L.str(b.emirates_id, 30);
  if (user.role !== 'owner' && hiddenDuplicate(user, phone, eid, existing?.id)) {
    throw L.bad('This mobile number or Emirates ID is already registered as another agent’s customer. Ask the owner to assign the customer to you.');
  }
  const shared = user.role === 'owner' ? (b.shared === true || b.shared === 1 || b.shared === '1' ? 1 : 0) : existing?.shared ?? 0;
  return [name, phone, L.str(b.email, 120), eid, L.str(b.company, 150), L.str(b.trade_license, 60), L.str(b.notes, 1000), agentId, shared];
}
// A customer with the same mobile (last 9 digits) or Emirates ID that this agent is not allowed to see.
function hiddenDuplicate(user, phone, eid, selfId) {
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const p = digits(phone).slice(-9), e = digits(eid);
  if (p.length < 7 && e.length < 10) return null;
  return db.prepare('SELECT id, phone, emirates_id, shared, created_by, agent_id FROM customers WHERE phone IS NOT NULL OR emirates_id IS NOT NULL').all()
    .find((c) => c.id !== selfId && !L.canSeeCustomer(user, c)
      && ((p.length >= 7 && digits(c.phone).slice(-9) === p) || (e.length >= 10 && digits(c.emirates_id) === e)));
}
// Agents' totals only count invoices they are on, so shared customers (walk-in) don't reveal other agents' sales.
const customerTotals = (user) => {
  const scope = L.invoiceScope(user, 'i');
  return `(SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'issued'${scope}) AS invoices,
    (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'issued'${scope}) -
    (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = c.id AND i.status = 'issued'${scope}) AS balance`;
};

app.get('/api/customers', auth, wrap((req) => {
  const q = `%${L.str(req.query.q, 100) || ''}%`;
  const limit = Math.min(500, L.int(req.query.limit) || 200);
  return db.prepare(`
    SELECT c.*, ag.name AS agent_name, cb.name AS created_by_name, ${customerTotals(req.user)}
    FROM customers c LEFT JOIN users ag ON ag.id = c.agent_id LEFT JOIN users cb ON cb.id = c.created_by
    WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.emirates_id LIKE ? OR c.company LIKE ? OR c.email LIKE ?) ${L.customerScope(req.user)}
    ORDER BY c.shared DESC, c.id DESC LIMIT ?`).all(q, q, q, q, q, limit);
}));

app.get('/api/customers/:id', auth, wrap((req) => {
  const cid = id(req);
  const c = db.prepare(`SELECT c.*, ag.name AS agent_name, cb.name AS created_by_name, ${customerTotals(req.user)}
    FROM customers c LEFT JOIN users ag ON ag.id = c.agent_id LEFT JOIN users cb ON cb.id = c.created_by WHERE c.id = ?`).get(cid);
  if (!c) throw L.notFound('Customer');
  if (!L.canSeeCustomer(req.user, c)) throw new L.HttpError(403, 'This customer belongs to another agent');
  const scope = L.invoiceScope(req.user);
  c.invoices = db.prepare(`
    SELECT i.id, i.number, i.date, i.status, i.total, u.name AS agent_name, COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id),0) AS paid
    FROM invoices i JOIN users u ON u.id = i.agent_id WHERE i.customer_id = ? ${scope} ORDER BY i.date DESC, i.id DESC`).all(cid);
  c.totals = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) billed FROM invoices i WHERE i.customer_id = ? AND i.status = 'issued' ${scope}`).get(cid);
  return c;
}));

app.post('/api/customers', auth, wrap((req) => {
  const r = db.prepare('INSERT INTO customers (name, phone, email, emirates_id, company, trade_license, notes, agent_id, shared, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(...customerBody(req.body || {}, req.user), req.user.id);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(r.lastInsertRowid));
}));

app.put('/api/customers/:id', auth, wrap((req) => {
  const cid = id(req);
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
  if (!existing) throw L.notFound('Customer');
  if (req.user.role !== 'owner' && existing.created_by !== req.user.id && existing.agent_id !== req.user.id) throw new L.HttpError(403, 'Only the owner can edit this customer');
  db.prepare('UPDATE customers SET name=?, phone=?, email=?, emirates_id=?, company=?, trade_license=?, notes=?, agent_id=?, shared=? WHERE id=?').run(...customerBody(req.body || {}, req.user, existing), cid);
  return { ok: true };
}));

// ---------- services ----------
app.get('/api/services', auth, wrap((req) => db.prepare(`
  SELECT s.*, a.name AS account_name FROM services s LEFT JOIN accounts a ON a.id = s.account_id
  ${req.query.all ? '' : 'WHERE s.active = 1'} ORDER BY s.active DESC, s.category, s.name`).all()));

function serviceBody(b) {
  const name = L.str(b.name, 150);
  if (!name) throw L.bad('Service name is required');
  const govt = L.fils(b.govt_fee), svc = L.fils(b.service_fee);
  if (govt < 0 || svc < 0) throw L.bad('Fees cannot be negative');
  const rule = b.share_rule === 'company' ? 'company' : 'standard';
  return [name, L.str(b.category, 80), govt, svc, L.int(b.account_id) || null, rule, b.active === false || b.active === 0 ? 0 : 1];
}
app.post('/api/services', auth, owner, wrap((req) => {
  const r = db.prepare('INSERT INTO services (name, category, govt_fee, service_fee, account_id, share_rule, active) VALUES (?,?,?,?,?,?,?)').run(...serviceBody(req.body || {}));
  return { id: Number(r.lastInsertRowid) };
}));
app.put('/api/services/:id', auth, owner, wrap((req) => {
  db.prepare('UPDATE services SET name=?, category=?, govt_fee=?, service_fee=?, account_id=?, share_rule=?, active=? WHERE id=?').run(...serviceBody(req.body || {}), id(req));
  return { ok: true };
}));

// ---------- accounts / wallets ----------
app.get('/api/accounts', auth, wrap((req) => {
  if (req.user.role === 'owner') return L.listAccounts({ includeInactive: !!req.query.all });
  // Agents need the names to pick wallets and record payments, but not the company's balances.
  return L.listAccounts().map((a) => ({ id: a.id, name: a.name, type: a.type, active: a.active }));
}));
app.post('/api/accounts', auth, owner, wrap((req) => ({ id: L.saveAccount(req.body || {}, req.user) })));
app.put('/api/accounts/:id', auth, owner, wrap((req) => ({ id: L.saveAccount(req.body || {}, req.user, id(req)) })));
app.get('/api/accounts/:id/statement', auth, owner, wrap((req) => {
  const acc = L.getAccount(id(req));
  const { from, to } = range(req.query);
  return { account: { ...acc, balance: L.accountBalance(acc.id) }, ...R.statement(acc.id, from, to) };
}));
app.post('/api/transfers', auth, owner, wrap((req) => ({ id: L.createTransfer(req.body || {}, req.user) })));
app.delete('/api/transfers/:id', auth, owner, wrap((req) => { L.deleteTransfer(id(req)); return { ok: true }; }));
app.post('/api/adjustments', auth, owner, wrap((req) => { L.createAdjustment(req.body || {}, req.user); return { ok: true }; }));

// ---------- invoices ----------
app.get('/api/invoices', auth, wrap((req) => {
  const q = req.query;
  const where = ['1=1'];
  const params = [];
  if (L.isDate(q.from)) { where.push('i.date >= ?'); params.push(q.from); }
  if (L.isDate(q.to)) { where.push('i.date <= ?'); params.push(q.to); }
  if (req.user.role !== 'owner') where.push(L.invoiceScope(req.user).replace(/^ AND /, ''));
  const agent = req.user.role === 'owner' ? L.int(q.agent_id) : null;
  if (agent) { where.push('(i.agent_id = ? OR i.source_id = ? OR EXISTS (SELECT 1 FROM invoice_items w WHERE w.invoice_id = i.id AND w.worker_id = ?))'); params.push(agent, agent, agent); }
  if (L.int(q.customer_id)) { where.push('i.customer_id = ?'); params.push(L.int(q.customer_id)); }
  if (['draft', 'issued', 'void'].includes(q.status)) { where.push('i.status = ?'); params.push(q.status); }
  if (q.status === 'unpaid') where.push(`i.status = 'issued'`);
  const s = L.str(q.q, 100);
  if (s) { where.push('(i.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id AND (it.description LIKE ? OR it.ref_no LIKE ?)))'); params.push(...Array(5).fill(`%${s}%`)); }
  const limit = Math.min(2000, L.int(q.limit) || 300);
  let rows = db.prepare(`
    SELECT i.id, i.number, i.date, i.status, i.govt_total, i.service_total, i.discount, i.vat_amount, i.total, i.agent_id,
           c.name AS customer_name, c.phone AS customer_phone, u.name AS agent_name, src.name AS source_name,
           COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id),0) AS paid
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.agent_id LEFT JOIN users src ON src.id = i.source_id
    WHERE ${where.join(' AND ')} ORDER BY i.date DESC, i.id DESC LIMIT ?`).all(...params, limit);
  rows.forEach((r) => { r.due = r.status === 'issued' ? r.total - r.paid : 0; });
  if (q.status === 'unpaid') rows = rows.filter((r) => r.due > 0);
  return rows;
}));

app.get('/api/invoices/:id', auth, wrap((req) => {
  const inv = L.getInvoice(id(req));
  if (!L.canAccessInvoice(req.user, inv)) throw L.forbidden();
  inv.can_see_customer = L.canSeeCustomer(req.user, db.prepare('SELECT shared, created_by, agent_id FROM customers WHERE id = ?').get(inv.customer_id));
  return inv;
}));
app.post('/api/invoices', auth, wrap((req) => ({ id: L.saveInvoice(req.body || {}, req.user) })));
app.put('/api/invoices/:id', auth, wrap((req) => ({ id: L.saveInvoice(req.body || {}, req.user, id(req)) })));
app.post('/api/invoices/:id/issue', auth, wrap((req) => ({ id: L.issueInvoice(id(req), req.user, req.body?.payment) })));
app.post('/api/invoices/:id/void', auth, wrap((req) => { L.voidInvoice(id(req), req.user, req.body || {}); return { ok: true }; }));
app.delete('/api/invoices/:id', auth, wrap((req) => { L.deleteDraft(id(req), req.user); return { ok: true }; }));
app.post('/api/invoices/:id/payments', auth, wrap((req) => ({ id: tx(() => L.recordPayment(id(req), req.body || {}, req.user)) })));
app.delete('/api/payments/:id', auth, owner, wrap((req) => { L.deletePayment(id(req), req.user); return { ok: true }; }));

// ---------- agent accounts ----------
app.get('/api/agents', auth, owner, wrap(() => R.agentBalances()));
app.get('/api/agents/:id/statement', auth, wrap((req) => {
  const uid = id(req);
  if (req.user.role !== 'owner' && uid !== req.user.id) throw L.forbidden();
  const u = db.prepare('SELECT id, name, role, agent_type FROM users WHERE id = ?').get(uid);
  if (!u) throw L.notFound('User');
  const { from, to } = range(req.query);
  return { user: u, ...R.agentStatement(uid, from, to) };
}));
app.get('/api/settlements', auth, owner, wrap((req) => db.prepare(`
  SELECT s.*, a.name AS account_name FROM settlements s JOIN accounts a ON a.id = s.account_id
  WHERE s.user_id = ? ORDER BY s.date DESC, s.id DESC`).all(L.int(req.query.user_id))));
app.post('/api/settlements', auth, owner, wrap((req) => ({ id: L.createSettlement(req.body || {}, req.user) })));
app.delete('/api/settlements/:id', auth, owner, wrap((req) => { L.deleteSettlement(id(req)); return { ok: true }; }));

// ---------- expenses ----------
app.get('/api/expenses', auth, owner, wrap((req) => {
  const { from, to } = range(req.query);
  return db.prepare(`
    SELECT e.*, a.name AS account_name, u.name AS user_name FROM expenses e
    JOIN accounts a ON a.id = e.account_id LEFT JOIN users u ON u.id = e.created_by
    WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`).all(from, to);
}));
app.post('/api/expenses', auth, owner, wrap((req) => ({ id: L.saveExpense(req.body || {}, req.user) })));
app.put('/api/expenses/:id', auth, owner, wrap((req) => ({ id: L.saveExpense(req.body || {}, req.user, id(req)) })));
app.delete('/api/expenses/:id', auth, owner, wrap((req) => { L.deleteExpense(id(req)); return { ok: true }; }));

// ---------- reports ----------
app.get('/api/reports/dashboard', auth, wrap((req) => R.dashboard(req.user)));
app.get('/api/reports/sales', auth, wrap((req) => {
  const { from, to } = range(req.query);
  const by = req.query.by;
  if (by === 'service') return R.salesByService(req.user, from, to);
  if (by === 'day') return R.salesByDay(req.user, from, to);
  if (by === 'agent') return R.salesByAgent(req.user, from, to);
  return R.salesByShare(req.user, from, to);
}));
app.get('/api/reports/pnl', auth, owner, wrap((req) => { const { from, to } = range(req.query); return R.profitAndLoss(from, to); }));
app.get('/api/reports/receivables', auth, wrap((req) => R.receivables(req.user)));
app.get('/api/reports/daybook', auth, owner, wrap((req) => R.daybook(req.query.date)));
app.get('/api/reports/vat', auth, owner, wrap(() => R.vatTracker()));

// Full database copy for safekeeping (owner only).
app.get('/api/backup', auth, owner, (req, res, next) => {
  const file = path.join(os.tmpdir(), `crm-backup-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file, `crm-backup-${today()}.db`, () => fs.unlink(file, () => {}));
  } catch (err) { next(err); }
});

// ---------- print & public verification ----------
function baseUrl(req) {
  const s = getSettings();
  return (s.public_url || process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

app.get('/print/invoice/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/#/login');
    const inv = L.getInvoice(id(req));
    if (!L.canAccessInvoice(req.user, inv)) throw L.forbidden();
    const html = await renderInvoice(inv, getSettings(), { format: req.query.format === 'thermal' ? 'thermal' : 'a4', verifyUrl: `${baseUrl(req)}/verify/${inv.verify_token}` });
    res.type('html').send(html);
  } catch (err) { next(err); }
});

app.get('/verify/:token', (req, res) => {
  const inv = db.prepare(`
    SELECT i.number, i.date, i.status, i.total, c.name AS customer_name,
           COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id),0) AS paid
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.verify_token = ? AND i.status != 'draft'`).get(String(req.params.token));
  res.status(inv ? 200 : 404).type('html').send(renderVerify(inv, getSettings()));
});

// ---------- static UI ----------
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  const message = status === 500 ? 'Something went wrong. Please try again.' : err.message;
  if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

if (require.main === module) {
  const server = app.listen(PORT, () => console.log(`Support Zone CRM running at http://localhost:${PORT}`));
  // On redeploy the container gets SIGTERM: finish open requests and close the database cleanly.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => {
      try { db.close(); } catch { /* already closed */ }
      process.exit(0);
    }, 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
