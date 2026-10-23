// Report queries. Agents only see invoices they prepared, brought the client for, or worked on.
const { db, today } = require('./db');
const { listAccounts, dateOr, invoiceScope } = require('./logic');

const VAT_MANDATORY = 37500000; // AED 375,000 in fils
const VAT_VOLUNTARY = 18750000; // AED 187,500 in fils

const scopeFor = invoiceScope;
const PAID = '(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id)';

function monthStart(d) { return d.slice(0, 8) + '01'; }
function addDays(d, n) {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function yearAgo(d) {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCFullYear(dt.getUTCFullYear() - 1);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function salesSummary(user, from, to) {
  const s = db.prepare(`
    SELECT COUNT(*) AS invoices, COALESCE(SUM(total),0) AS total, COALESCE(SUM(govt_total),0) AS govt,
           COALESCE(SUM(service_total - discount),0) AS profit
    FROM invoices i WHERE i.status = 'issued' AND i.date BETWEEN ? AND ? ${scopeFor(user)}`).get(from, to);
  s.collected = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) AS c FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.date BETWEEN ? AND ? ${scopeFor(user)}`).get(from, to).c;
  return s;
}

function receivablesTotal(user) {
  return db.prepare(`
    SELECT COALESCE(SUM(i.total - COALESCE(p.paid,0)),0) AS due
    FROM invoices i LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
    WHERE i.status = 'issued' ${scopeFor(user)}`).get().due;
}

function vatTracker() {
  const t = today();
  const from = yearAgo(t);
  const taxable = db.prepare(`SELECT COALESCE(SUM(service_total - discount),0) s FROM invoices WHERE status='issued' AND date BETWEEN ? AND ?`).get(from, t).s;
  const months = db.prepare(`
    SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(service_total - discount),0) AS taxable, COALESCE(SUM(govt_total),0) AS govt
    FROM invoices WHERE status='issued' AND date BETWEEN ? AND ? GROUP BY month ORDER BY month`).all(monthStart(from), t);
  return { from, to: t, taxable, mandatory: VAT_MANDATORY, voluntary: VAT_VOLUNTARY, months };
}

function dashboard(user) {
  const t = today();
  const m = monthStart(t);
  const out = {
    today: salesSummary(user, t, t),
    month: salesSummary(user, m, t),
    receivables: receivablesTotal(user),
    wallets: user.role === 'owner' ? listAccounts() : [],
    recent: db.prepare(`
      SELECT i.id, i.number, i.date, i.status, i.total, c.name AS customer_name, u.name AS agent_name,
             COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id),0) AS paid
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.agent_id
      WHERE 1=1 ${scopeFor(user)} ORDER BY i.id DESC LIMIT 8`).all(),
  };
  if (user.role !== 'owner') {
    out.me = agentBalances(user.id)[0];
    out.myShareMonth = db.prepare(`SELECT COALESCE(SUM(s.amount),0) v FROM invoice_shares s JOIN invoices i ON i.id = s.invoice_id
      WHERE i.status = 'issued' AND s.user_id = ? AND i.date BETWEEN ? AND ?`).get(user.id, m, t).v;
  } else {
    out.shares = salesByShare(user, m, t).rows;
    const agents = agentBalances().filter((a) => a.role !== 'owner');
    out.agentsOwe = agents.reduce((sum, a) => sum + Math.max(0, a.balance), 0);
    out.companyOwes = agents.reduce((sum, a) => sum + Math.max(0, -a.balance), 0);
    out.vat = vatTracker();
    out.expensesMonth = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date BETWEEN ? AND ?').get(m, t).s;
  }
  return out;
}

function salesByAgent(user, from, to) {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.role,
           COUNT(i.id) AS invoices,
           COALESCE(SUM(i.govt_total),0) AS govt,
           COALESCE(SUM(i.service_total),0) AS service,
           COALESCE(SUM(i.discount),0) AS discount,
           COALESCE(SUM(i.vat_amount),0) AS vat,
           COALESCE(SUM(i.total),0) AS total,
           COALESCE(SUM(i.service_total - i.discount),0) AS profit,
           COALESCE(SUM(p.paid),0) AS paid
    FROM users u
    JOIN invoices i ON i.agent_id = u.id AND i.status = 'issued' AND i.date BETWEEN ? AND ?
    LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
    WHERE 1=1 ${user.role === 'agent' ? ` AND u.id = ${Number(user.id)}` : ''}
    GROUP BY u.id ORDER BY profit DESC`).all(from, to);
  rows.forEach((r) => { r.due = r.total - r.paid; });
  return { from, to, rows };
}

function salesByService(user, from, to) {
  const rows = db.prepare(`
    SELECT it.name, COALESCE(s.category, 'Other') AS category, SUM(it.qty) AS qty,
           SUM(it.govt_fee * it.qty) AS govt, SUM(it.service_fee * it.qty) AS service,
           SUM((it.govt_fee + it.service_fee) * it.qty) AS total
    FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id LEFT JOIN services s ON s.id = it.service_id
    WHERE i.status = 'issued' AND i.date BETWEEN ? AND ? ${scopeFor(user)}
    GROUP BY it.name ORDER BY service DESC`).all(from, to);
  return { from, to, rows };
}

function salesByDay(user, from, to) {
  const rows = db.prepare(`
    SELECT i.date, COUNT(*) AS invoices, SUM(i.govt_total) AS govt, SUM(i.service_total - i.discount) AS profit, SUM(i.total) AS total
    FROM invoices i WHERE i.status = 'issued' AND i.date BETWEEN ? AND ? ${scopeFor(user)}
    GROUP BY i.date ORDER BY i.date DESC`).all(from, to);
  return { from, to, rows };
}

function profitAndLoss(from, to) {
  const sales = db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(service_total),0) service, COALESCE(SUM(discount),0) discount,
           COALESCE(SUM(govt_total),0) govt, COALESCE(SUM(vat_amount),0) vat, COALESCE(SUM(total),0) total
    FROM invoices WHERE status='issued' AND date BETWEEN ? AND ?`).get(from, to);
  const govtPaid = -db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM account_txns WHERE kind IN ('govt_fee','govt_refund') AND date BETWEEN ? AND ?`).get(from, to).s;
  const expenses = db.prepare(`SELECT category, SUM(amount) amount, COUNT(*) n FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`).all(from, to);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const revenue = sales.service - sales.discount;
  // Shares paid to agents are a cost to the company; the owner's own shares stay with the business.
  const commissions = db.prepare(`
    SELECT COALESCE(SUM(s.amount),0) v FROM invoice_shares s JOIN invoices i ON i.id = s.invoice_id JOIN users u ON u.id = s.user_id
    WHERE i.status = 'issued' AND u.role != 'owner' AND i.date BETWEEN ? AND ?`).get(from, to).v;
  const companyIncome = revenue - commissions;
  return { from, to, sales, revenue, commissions, companyIncome, govtPaid, expenses, expenseTotal, net: companyIncome - expenseTotal };
}

function receivables(user) {
  const t = today();
  const rows = db.prepare(`
    SELECT i.id, i.number, i.date, i.total, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, u.name AS agent_name,
           COALESCE(p.paid,0) AS paid, i.total - COALESCE(p.paid,0) AS due,
           CAST(julianday(?) - julianday(i.date) AS INTEGER) AS age
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.agent_id
    LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
    WHERE i.status='issued' AND i.total - COALESCE(p.paid,0) > 0 ${scopeFor(user)}
    ORDER BY i.date`).all(t);
  const buckets = { b0: 0, b30: 0, b60: 0, b90: 0 };
  for (const r of rows) {
    if (r.age <= 30) buckets.b0 += r.due; else if (r.age <= 60) buckets.b30 += r.due; else if (r.age <= 90) buckets.b60 += r.due; else buckets.b90 += r.due;
  }
  return { rows, buckets, total: rows.reduce((s, r) => s + r.due, 0) };
}

function daybook(date) {
  const d = dateOr(date);
  const txns = db.prepare(`
    SELECT t.*, a.name AS account_name, a.type AS account_type, u.name AS user_name
    FROM account_txns t JOIN accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.created_by
    WHERE t.date = ? ORDER BY t.id`).all(d);
  const accounts = db.prepare(`
    SELECT a.id, a.name, a.type,
           COALESCE(SUM(CASE WHEN t.date < ? THEN t.amount END),0) AS opening,
           COALESCE(SUM(CASE WHEN t.date = ? AND t.amount > 0 THEN t.amount END),0) AS money_in,
           COALESCE(SUM(CASE WHEN t.date = ? AND t.amount < 0 THEN t.amount END),0) AS money_out
    FROM accounts a LEFT JOIN account_txns t ON t.account_id = a.id
    WHERE a.active = 1 GROUP BY a.id ORDER BY a.type, a.name`).all(d, d, d);
  accounts.forEach((a) => { a.closing = a.opening + a.money_in + a.money_out; });
  const collections = db.prepare(`
    SELECT u.name AS agent_name, p.method, CASE WHEN p.held_by IS NULL THEN a.name ELSE 'Kept by agent' END AS dest, COUNT(*) n, SUM(p.amount) amount
    FROM payments p LEFT JOIN users u ON u.id = COALESCE(p.held_by, p.received_by) LEFT JOIN accounts a ON a.id = p.account_id
    WHERE p.date = ? GROUP BY u.id, p.method, dest ORDER BY u.name`).all(d);
  return { date: d, txns, accounts, collections };
}

function statement(accountId, from, to) {
  const opening = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM account_txns WHERE account_id = ? AND date < ?').get(accountId, from).s;
  const rows = db.prepare(`
    SELECT t.*, u.name AS user_name FROM account_txns t LEFT JOIN users u ON u.id = t.created_by
    WHERE t.account_id = ? AND t.date BETWEEN ? AND ? ORDER BY t.date, t.id`).all(accountId, from, to);
  let bal = opening;
  for (const r of rows) { bal += r.amount; r.balance = bal; }
  const money_in = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const money_out = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  return { from, to, opening, closing: bal, money_in, money_out, rows };
}

// Profit share per person (and the company) for issued invoices in the period.
function salesByShare(user, from, to) {
  const rows = db.prepare(`
    SELECT s.user_id AS id, COALESCE(u.name, 'Company (owner account)') AS name, u.role, u.agent_type,
           COUNT(DISTINCT CASE WHEN s.role = 'source' THEN s.invoice_id END) AS brought,
           COUNT(DISTINCT CASE WHEN s.role = 'worker' THEN s.item_id END) AS jobs,
           COALESCE(SUM(CASE WHEN s.role = 'source' THEN s.amount END),0) AS as_source,
           COALESCE(SUM(CASE WHEN s.role = 'worker' THEN s.amount END),0) AS as_worker,
           COALESCE(SUM(CASE WHEN s.role = 'company' THEN s.amount END),0) AS as_company,
           COALESCE(SUM(s.amount),0) AS total
    FROM invoice_shares s JOIN invoices i ON i.id = s.invoice_id LEFT JOIN users u ON u.id = s.user_id
    WHERE i.status = 'issued' AND i.date BETWEEN ? AND ? ${user.role === 'owner' ? '' : `AND s.user_id = ${Number(user.id)}`}
    GROUP BY s.user_id ORDER BY s.user_id IS NOT NULL, total DESC`).all(from, to);
  return { from, to, rows };
}

// What each person owes the company (positive) or is owed (negative):
//   cash they collected and kept − their profit shares on fully paid invoices − what they already settled.
function agentBalances(userId = null) {
  const users = db.prepare(`SELECT id, name, role, agent_type, active FROM users ${userId ? 'WHERE id = ?' : ''} ORDER BY role DESC, active DESC, name`)
    .all(...(userId ? [userId] : []));
  const byUser = (sql) => new Map(db.prepare(sql).all().map((r) => [r.uid, r]));
  const collected = byUser('SELECT held_by AS uid, SUM(amount) AS v FROM payments WHERE held_by IS NOT NULL GROUP BY held_by');
  const shares = byUser(`
    SELECT s.user_id AS uid,
           SUM(CASE WHEN COALESCE(p.paid,0) >= i.total THEN s.amount ELSE 0 END) AS earned,
           SUM(CASE WHEN COALESCE(p.paid,0) <  i.total THEN s.amount ELSE 0 END) AS pending
    FROM invoice_shares s JOIN invoices i ON i.id = s.invoice_id AND i.status = 'issued' LEFT JOIN ${PAID} p ON p.invoice_id = i.id
    WHERE s.user_id IS NOT NULL GROUP BY s.user_id`);
  const settled = byUser('SELECT user_id AS uid, SUM(amount) AS v FROM settlements GROUP BY user_id');
  const govt = byUser(`SELECT it.worker_id AS uid, SUM(it.govt_fee * it.qty) AS v FROM invoice_items it
    JOIN invoices i ON i.id = it.invoice_id AND i.status = 'issued' GROUP BY it.worker_id`);
  return users.map((u) => {
    const c = collected.get(u.id)?.v || 0, e = shares.get(u.id)?.earned || 0, s = settled.get(u.id)?.v || 0;
    return { ...u, collected: c, earned: e, pending: shares.get(u.id)?.pending || 0, settled: s, govt_used: govt.get(u.id)?.v || 0, balance: c - e - s };
  });
}

const KIND_ORDER = { collection: 0, share: 1, settlement: 2 };

// Running statement for one person: + increases what they owe the company, − reduces it.
function agentStatement(userId, from, to) {
  const events = [
    ...db.prepare(`SELECT p.date, p.id, 'collection' AS kind, p.amount, p.method, i.id AS invoice_id, i.number
      FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.held_by = ?`).all(userId),
    ...db.prepare(`SELECT i.date, i.id, 'share' AS kind, -SUM(s.amount) AS amount, GROUP_CONCAT(DISTINCT s.role) AS roles, i.id AS invoice_id, i.number
      FROM invoice_shares s JOIN invoices i ON i.id = s.invoice_id AND i.status = 'issued' LEFT JOIN ${PAID} p ON p.invoice_id = i.id
      WHERE s.user_id = ? AND COALESCE(p.paid,0) >= i.total GROUP BY i.id`).all(userId),
    ...db.prepare(`SELECT st.date, st.id, 'settlement' AS kind, -st.amount AS amount, st.note, a.name AS account_name
      FROM settlements st JOIN accounts a ON a.id = st.account_id WHERE st.user_id = ?`).all(userId),
  ].sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id);
  let opening = 0;
  const rows = [];
  for (const e of events) {
    if (e.date < from) opening += e.amount;
    else if (e.date <= to) rows.push(e);
  }
  let bal = opening;
  for (const r of rows) { bal += r.amount; r.balance = bal; }
  const pending = db.prepare(`
    SELECT i.id, i.number, i.date, i.total, COALESCE(p.paid,0) AS paid, SUM(s.amount) AS amount
    FROM invoice_shares s JOIN invoices i ON i.id = s.invoice_id AND i.status = 'issued' LEFT JOIN ${PAID} p ON p.invoice_id = i.id
    WHERE s.user_id = ? AND COALESCE(p.paid,0) < i.total GROUP BY i.id ORDER BY i.date`).all(userId);
  const wallet = db.prepare(`
    SELECT i.date, i.id AS invoice_id, i.number, it.name, it.description, it.qty * it.govt_fee AS amount, a.name AS account_name
    FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id AND i.status = 'issued' JOIN accounts a ON a.id = it.account_id
    WHERE it.worker_id = ? AND it.govt_fee > 0 AND i.date BETWEEN ? AND ? ORDER BY i.date, i.id`).all(userId, from, to);
  const walletTotals = {};
  for (const w of wallet) walletTotals[w.account_name] = (walletTotals[w.account_name] || 0) + w.amount;
  return { from, to, opening, closing: bal, rows, pending, wallet, walletTotals, summary: agentBalances(userId)[0] };
}

module.exports = {
  dashboard, salesByAgent, salesByShare, agentBalances, agentStatement, salesByService, salesByDay, profitAndLoss, receivables, daybook, statement, vatTracker,
  monthStart, addDays,
};
