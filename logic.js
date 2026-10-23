// Business rules: invoices, wallet postings, payments, transfers, expenses.
const crypto = require('crypto');
const { db, tx, getSettings, setSettings, today, aed } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
const forbidden = () => new HttpError(403, 'You do not have permission to do this');

// ---------- input helpers ----------
const str = (v, max = 500) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
};
const int = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const fils = (v, label = 'Amount') => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) throw bad(`${label} is not a valid number`);
  return Math.round(n);
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dateOr = (v, fallback = today()) => (isDate(v) ? v : fallback);

// ---------- auth ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function checkPassword(pw, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validatePassword(pw) {
  if (!pw || String(pw).length < 6) throw bad('Password must be at least 6 characters');
}

// ---------- accounts / wallets ----------
function accountBalance(accountId, excludeInvoiceId = null) {
  const row = excludeInvoiceId
    ? db.prepare(`SELECT COALESCE(SUM(amount),0) b FROM account_txns WHERE account_id = ? AND NOT (ref_type IS 'invoice' AND ref_id IS ?)`).get(accountId, excludeInvoiceId)
    : db.prepare('SELECT COALESCE(SUM(amount),0) b FROM account_txns WHERE account_id = ?').get(accountId);
  return row.b;
}

function listAccounts({ includeInactive = false, types = null } = {}) {
  const rows = db.prepare(`
    SELECT a.*, COALESCE(SUM(t.amount),0) AS balance
    FROM accounts a LEFT JOIN account_txns t ON t.account_id = a.id
    ${includeInactive ? '' : 'WHERE a.active = 1'}
    GROUP BY a.id ORDER BY a.active DESC, CASE a.type WHEN 'card' THEN 1 WHEN 'wallet' THEN 2 WHEN 'bank' THEN 3 ELSE 4 END, a.name
  `).all();
  return rows
    .filter((a) => !types || types.includes(a.type))
    .map((a) => {
      const available = a.balance + a.credit_limit;
      return { ...a, available, low: a.low_alert > 0 && available < a.low_alert };
    });
}

function addTxn({ account_id, date, kind, amount, ref_type = null, ref_id = null, note = null, user_id = null }) {
  db.prepare(`INSERT INTO account_txns (account_id, date, kind, amount, ref_type, ref_id, note, created_by) VALUES (?,?,?,?,?,?,?,?)`)
    .run(account_id, date, kind, amount, ref_type, ref_id, note, user_id);
}

function getAccount(id) {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!a) throw notFound('Account');
  return a;
}

function saveAccount(body, user, id = null) {
  const name = str(body.name, 120);
  if (!name) throw bad('Account name is required');
  const type = ['cash', 'bank', 'wallet', 'card'].includes(body.type) ? body.type : null;
  if (!type) throw bad('Choose an account type');
  const credit_limit = type === 'card' ? Math.max(0, fils(body.credit_limit, 'Credit limit')) : 0;
  const low_alert = Math.max(0, fils(body.low_alert, 'Low balance alert'));
  const notes = str(body.notes, 500);
  return tx(() => {
    if (id) {
      getAccount(id);
      db.prepare('UPDATE accounts SET name=?, type=?, credit_limit=?, low_alert=?, notes=?, active=? WHERE id=?')
        .run(name, type, credit_limit, low_alert, notes, body.active === false || body.active === 0 ? 0 : 1, id);
      return id;
    }
    const r = db.prepare('INSERT INTO accounts (name, type, credit_limit, low_alert, notes) VALUES (?,?,?,?,?)')
      .run(name, type, credit_limit, low_alert, notes);
    const newId = Number(r.lastInsertRowid);
    const opening = fils(body.opening_balance, 'Opening balance');
    if (opening) addTxn({ account_id: newId, date: dateOr(body.date), kind: 'opening', amount: opening, note: 'Opening balance', user_id: user.id });
    return newId;
  });
}

// Top-up a wallet / pay a card, or move money between accounts.
function createTransfer(body, user) {
  const to = int(body.to_account_id);
  const from = body.from_account_id ? int(body.from_account_id) : null;
  const amount = fils(body.amount);
  if (amount <= 0) throw bad('Amount must be more than zero');
  if (!to) throw bad('Choose the account to top up');
  if (from && from === to) throw bad('From and To accounts must be different');
  const date = dateOr(body.date);
  const note = str(body.note, 300);
  return tx(() => {
    const toAcc = getAccount(to);
    const fromAcc = from ? getAccount(from) : null;
    if (fromAcc) {
      const available = accountBalance(fromAcc.id) + fromAcc.credit_limit;
      if (amount > available) throw bad(`${fromAcc.name} only has AED ${aed(available)} available`);
    }
    const r = db.prepare('INSERT INTO transfers (from_account_id, to_account_id, amount, date, note, created_by) VALUES (?,?,?,?,?,?)')
      .run(from, to, amount, date, note, user.id);
    const tid = Number(r.lastInsertRowid);
    const label = fromAcc ? `Top-up from ${fromAcc.name}` : 'Top-up (owner / external funds)';
    addTxn({ account_id: to, date, kind: 'topup', amount, ref_type: 'transfer', ref_id: tid, note: note ? `${label} — ${note}` : label, user_id: user.id });
    if (fromAcc) addTxn({ account_id: from, date, kind: 'transfer', amount: -amount, ref_type: 'transfer', ref_id: tid, note: note ? `Transfer to ${toAcc.name} — ${note}` : `Transfer to ${toAcc.name}`, user_id: user.id });
    return tid;
  });
}

function deleteTransfer(id) {
  tx(() => {
    db.prepare(`DELETE FROM account_txns WHERE ref_type = 'transfer' AND ref_id = ?`).run(id);
    db.prepare('DELETE FROM transfers WHERE id = ?').run(id);
  });
}

function createAdjustment(body, user) {
  const account_id = int(body.account_id);
  getAccount(account_id);
  const amount = fils(body.amount);
  if (!amount) throw bad('Enter a non-zero amount (negative to reduce)');
  const note = str(body.note, 300);
  if (!note) throw bad('Add a note explaining the adjustment');
  addTxn({ account_id, date: dateOr(body.date), kind: 'adjustment', amount, note, user_id: user.id });
}

// ---------- invoices ----------
function getInvoice(id) {
  const inv = db.prepare(`
    SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.company AS customer_company,
           c.emirates_id AS customer_eid, c.trade_license AS customer_tl, u.name AS agent_name, s.name AS source_name
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.agent_id LEFT JOIN users s ON s.id = i.source_id
    WHERE i.id = ?`).get(id);
  if (!inv) throw notFound('Invoice');
  inv.items = db.prepare(`
    SELECT it.*, a.name AS account_name, w.name AS worker_name FROM invoice_items it
    LEFT JOIN accounts a ON a.id = it.account_id LEFT JOIN users w ON w.id = it.worker_id
    WHERE it.invoice_id = ? ORDER BY it.sort, it.id`).all(id);
  inv.payments = db.prepare(`
    SELECT p.*, a.name AS account_name, u.name AS received_by_name, h.name AS held_by_name FROM payments p
    LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN users u ON u.id = p.received_by LEFT JOIN users h ON h.id = p.held_by
    WHERE p.invoice_id = ? ORDER BY p.date, p.id`).all(id);
  inv.shares = db.prepare(`
    SELECT s.user_id, u.name, s.role, SUM(s.amount) AS amount FROM invoice_shares s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.invoice_id = ? GROUP BY s.user_id, s.role ORDER BY s.user_id IS NOT NULL, u.name, s.role`).all(id);
  inv.paid = inv.payments.reduce((s, p) => s + p.amount, 0);
  inv.due = inv.status === 'issued' ? inv.total - inv.paid : 0;
  inv.profit = inv.service_total - inv.discount;
  return inv;
}

// Agents can open invoices they prepared, brought the client for, or worked on.
function canAccessInvoice(user, inv) {
  if (user.role === 'owner' || inv.agent_id === user.id || inv.source_id === user.id) return true;
  return !!db.prepare('SELECT 1 FROM invoice_items WHERE invoice_id = ? AND worker_id = ?').get(inv.id, user.id);
}

// SQL filter with the same rule, for lists and reports.
function invoiceScope(user, alias = 'i') {
  if (user.role === 'owner') return '';
  const u = Number(user.id);
  return ` AND (${alias}.agent_id = ${u} OR ${alias}.source_id = ${u} OR EXISTS (SELECT 1 FROM invoice_items sx WHERE sx.invoice_id = ${alias}.id AND sx.worker_id = ${u}))`;
}

const userExists = (id) => !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);

// Agents only see customers they added or brought in, plus shared ones such as the walk-in customer.
function canSeeCustomer(user, c) {
  return user.role === 'owner' || c.shared === 1 || c.created_by === user.id || c.agent_id === user.id;
}
function customerScope(user, alias = 'c') {
  if (user.role === 'owner') return '';
  const u = Number(user.id);
  return ` AND (${alias}.shared = 1 OR ${alias}.created_by = ${u} OR ${alias}.agent_id = ${u})`;
}

function parseItems(rawItems, user, defaultWorker) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw bad('Add at least one service to the invoice');
  if (rawItems.length > 100) throw bad('Too many items on one invoice');
  return rawItems.map((it, i) => {
    const name = str(it.name, 200);
    if (!name) throw bad(`Item ${i + 1}: service name is required`);
    const qty = Math.max(1, int(it.qty) || 1);
    const govt_fee = fils(it.govt_fee, 'Government fee');
    const service_fee = fils(it.service_fee, 'Service fee');
    if (govt_fee < 0 || service_fee < 0) throw bad(`Item ${i + 1}: fees cannot be negative`);
    const account_id = it.account_id ? int(it.account_id) : null;
    if (govt_fee > 0 && !account_id) throw bad(`"${name}": choose which wallet / card paid the government fee`);
    const service_id = it.service_id ? int(it.service_id) : null;
    const worker_id = int(it.worker_id) || defaultWorker;
    if (!userExists(worker_id)) throw bad(`"${name}": choose who did the work`);
    // Only the owner may change how a line's profit is shared; otherwise it follows the service setting.
    const serviceRule = service_id ? db.prepare('SELECT share_rule FROM services WHERE id = ?').get(service_id)?.share_rule : null;
    const share_rule = user.role === 'owner' && SHARE_RULES.includes(it.share_rule) ? it.share_rule : serviceRule || 'standard';
    return {
      service_id, name, qty, govt_fee, service_fee, worker_id, share_rule,
      description: str(it.description, 300),
      ref_no: str(it.ref_no, 100),
      account_id: govt_fee > 0 ? account_id : null,
      sort: i,
    };
  });
}
const SHARE_RULES = ['standard', 'company'];

function computeTotals(items, discountIn, vatRate) {
  const govt_total = items.reduce((s, it) => s + it.govt_fee * it.qty, 0);
  const service_total = items.reduce((s, it) => s + it.service_fee * it.qty, 0);
  const discount = Math.min(Math.max(0, fils(discountIn, 'Discount')), service_total); // only service charges can be discounted
  const vat_amount = Math.round(((service_total - discount) * vatRate) / 100); // VAT applies to service charges only
  const total = govt_total + service_total - discount + vat_amount;
  return { govt_total, service_total, discount, vat_amount, total };
}

// Which parts each kind of user earns. A part someone does not earn goes to the company.
//   commission agent: the "brought the client" part and the "did the work" part
//   sales agent:      only the "brought the client" part
//   salaried staff and the owner: nothing (it is all company money)
const EARNS = {
  commission: { source: true, worker: true },
  sales: { source: true, worker: false },
  salaried: { source: false, worker: false },
};
function earnsFn() {
  const users = new Map(db.prepare('SELECT id, role, agent_type FROM users').all().map((u) => [u.id, u]));
  return (userId, role) => {
    const u = users.get(userId);
    return !!u && u.role !== 'owner' && !!EARNS[u.agent_type]?.[role];
  };
}

// Splits each line's profit (service fee after its part of the discount):
//   standard line, client brought by someone: 1/3 company, 1/3 who brought the client, 1/3 who did the work
//   standard line, walk-in (nobody brought the client): 1/2 company, 1/2 who did the work
//   company line (e.g. photocopy): 100% company
// Then any part the person does not earn (see EARNS) moves to the company. They keep a 0 row so
// reports still count the client / job as theirs. Rounding leftovers go to the company.
function computeShares(items, discount, sourceId, earns = () => true) {
  const lines = items.map((it) => it.service_fee * it.qty);
  const serviceTotal = lines.reduce((a, b) => a + b, 0);
  const disc = lines.map((l) => (serviceTotal ? Math.floor((discount * l) / serviceTotal) : 0));
  const leftover = discount - disc.reduce((a, b) => a + b, 0);
  if (leftover) disc[lines.indexOf(Math.max(...lines))] += leftover;
  const rows = [];
  items.forEach((it, i) => {
    const net = lines[i] - disc[i];
    if (net <= 0) return;
    if (it.share_rule === 'company') {
      rows.push({ item: it, user_id: null, role: 'company', amount: net });
    } else if (!sourceId) {
      const w = Math.round(net / 2);
      rows.push({ item: it, user_id: it.worker_id, role: 'worker', amount: w }, { item: it, user_id: null, role: 'company', amount: net - w });
    } else {
      const third = Math.round(net / 3);
      rows.push(
        { item: it, user_id: sourceId, role: 'source', amount: third },
        { item: it, user_id: it.worker_id, role: 'worker', amount: third },
        { item: it, user_id: null, role: 'company', amount: net - 2 * third },
      );
    }
  });
  return rows.flatMap((r) => (r.user_id && !earns(r.user_id, r.role)
    ? [{ ...r, amount: 0 }, { item: r.item, user_id: null, role: 'company', amount: r.amount }]
    : [r]));
}

function postShares(invoiceId, items, discount, sourceId) {
  db.prepare('DELETE FROM invoice_shares WHERE invoice_id = ?').run(invoiceId);
  const stmt = db.prepare('INSERT INTO invoice_shares (invoice_id, item_id, user_id, role, amount) VALUES (?,?,?,?,?)');
  for (const r of computeShares(items, discount, sourceId, earnsFn())) stmt.run(invoiceId, r.item.id, r.user_id, r.role, r.amount);
}

// Make sure each wallet / card has enough available balance for the government fees.
function checkWalletFunds(items, invoiceId, user) {
  const need = new Map();
  for (const it of items) {
    if (it.account_id && it.govt_fee > 0) need.set(it.account_id, (need.get(it.account_id) || 0) + it.govt_fee * it.qty);
  }
  for (const [accId, amount] of need) {
    const acc = getAccount(accId);
    if (!acc.active) throw bad(`${acc.name} is inactive`);
    const available = accountBalance(accId, invoiceId) + acc.credit_limit;
    if (amount > available) {
      throw bad(user.role === 'owner'
        ? `Not enough balance in "${acc.name}": available AED ${aed(available)}, needed AED ${aed(amount)}. Top up the wallet first.`
        : `Not enough balance in "${acc.name}" for AED ${aed(amount)}. Choose another wallet or ask the owner to top it up.`);
    }
  }
}

function postInvoiceWallets(inv, items, userId) {
  db.prepare(`DELETE FROM account_txns WHERE ref_type = 'invoice' AND ref_id = ? AND kind = 'govt_fee'`).run(inv.id);
  for (const it of items) {
    if (!it.account_id || it.govt_fee <= 0) continue;
    const label = [it.name, it.description].filter(Boolean).join(' – ');
    addTxn({
      account_id: it.account_id, date: inv.date, kind: 'govt_fee', amount: -(it.govt_fee * it.qty),
      ref_type: 'invoice', ref_id: inv.id, note: `${inv.number} · ${label}${it.qty > 1 ? ` ×${it.qty}` : ''}`, user_id: userId,
    });
  }
}

function nextInvoiceNumber(date) {
  const s = getSettings();
  const seq = (parseInt(s.invoice_seq, 10) || 0) + 1;
  setSettings({ invoice_seq: seq });
  return `${s.invoice_prefix || ''}${date.slice(0, 4)}-${String(seq).padStart(5, '0')}`;
}

function insertItems(invoiceId, items) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const stmt = db.prepare(`INSERT INTO invoice_items (invoice_id, service_id, name, description, ref_no, qty, govt_fee, service_fee, account_id, worker_id, share_rule, sort)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const it of items) {
    it.id = Number(stmt.run(invoiceId, it.service_id, it.name, it.description, it.ref_no, it.qty, it.govt_fee, it.service_fee, it.account_id, it.worker_id, it.share_rule, it.sort).lastInsertRowid);
  }
}

// Create or update an invoice. body.issue = true issues it (assigns number, deducts wallets, splits profit).
function saveInvoice(body, user, id = null) {
  const customer_id = int(body.customer_id);
  const customer = customer_id && db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) throw bad('Choose a customer');
  const source_id = body.source_id ? int(body.source_id) : null;
  if (source_id && !userExists(source_id)) throw bad('Choose who brought the client');
  const date = dateOr(body.date);
  const notes = str(body.notes, 1000);
  const settings = getSettings();

  return tx(() => {
    let existing = null;
    if (id) {
      existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      if (!existing) throw notFound('Invoice');
      if (!canAccessInvoice(user, existing)) throw forbidden();
      if (existing.status === 'void') throw bad('A void invoice cannot be edited');
      if (existing.status === 'issued' && user.role !== 'owner') throw bad('Only the owner can edit an issued invoice');
    }
    if (!canSeeCustomer(user, customer) && existing?.customer_id !== customer_id) throw bad('Choose one of your own customers');
    const ownerPick = user.role === 'owner' && int(body.agent_id) && userExists(int(body.agent_id)) ? int(body.agent_id) : null;
    const agentId = ownerPick || existing?.agent_id || user.id;
    const items = parseItems(body.items, user, agentId);
    const willIssue = existing?.status === 'issued' || !!body.issue;
    const vatRate = existing?.status === 'issued' ? existing.vat_rate : settings.vat_enabled === '1' ? Number(settings.vat_rate) || 0 : 0;
    const t = computeTotals(items, body.discount, vatRate);

    let invId = id;
    if (existing) {
      db.prepare(`UPDATE invoices SET date=?, customer_id=?, agent_id=?, source_id=?, govt_total=?, service_total=?, discount=?, vat_rate=?, vat_amount=?, total=?, notes=?, updated_at=datetime('now') WHERE id=?`)
        .run(date, customer_id, agentId, source_id, t.govt_total, t.service_total, t.discount, vatRate, t.vat_amount, t.total, notes, id);
    } else {
      const r = db.prepare(`INSERT INTO invoices (date, customer_id, agent_id, source_id, status, govt_total, service_total, discount, vat_rate, vat_amount, total, notes, verify_token)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(date, customer_id, agentId, source_id, 'draft', t.govt_total, t.service_total, t.discount, vatRate, t.vat_amount, t.total, notes, crypto.randomBytes(12).toString('base64url'));
      invId = Number(r.lastInsertRowid);
    }
    insertItems(invId, items);

    if (willIssue) {
      if (existing?.status === 'issued') {
        const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(invId).s;
        if (paid > t.total) throw bad(`New total (AED ${aed(t.total)}) is less than the amount already paid (AED ${aed(paid)})`);
      }
      checkWalletFunds(items, invId, user);
      let number = existing?.number;
      if (!number) {
        number = nextInvoiceNumber(date);
        db.prepare(`UPDATE invoices SET number = ?, status = 'issued', updated_at = datetime('now') WHERE id = ?`).run(number, invId);
      }
      postInvoiceWallets({ id: invId, number, date }, items, user.id);
      postShares(invId, items, t.discount, source_id);
      if (body.payment && fils(body.payment.amount) > 0) recordPayment(invId, body.payment, user);
    }
    return invId;
  });
}

function issueInvoice(id, user, payment) {
  const inv = getInvoice(id);
  if (!canAccessInvoice(user, inv)) throw forbidden();
  if (inv.status !== 'draft') throw bad('Only a draft can be issued');
  return saveInvoice({ ...inv, items: inv.items, issue: true, payment }, user, id);
}

function voidInvoice(id, user, { reason, refund_wallets = true, refund_payments = true, date = null } = {}) {
  if (user.role !== 'owner') throw forbidden();
  const why = str(reason, 300);
  if (!why) throw bad('Enter a reason for voiding');
  tx(() => {
    const inv = getInvoice(id);
    if (inv.status !== 'issued') throw bad('Only issued invoices can be voided');
    const d = dateOr(date);
    if (refund_wallets) {
      const fees = db.prepare(`SELECT account_id, SUM(amount) s FROM account_txns WHERE ref_type='invoice' AND ref_id=? GROUP BY account_id`).all(id);
      for (const f of fees) {
        if (f.s < 0) addTxn({ account_id: f.account_id, date: d, kind: 'govt_refund', amount: -f.s, ref_type: 'invoice', ref_id: id, note: `${inv.number} void — govt fee refunded`, user_id: user.id });
      }
    }
    if (refund_payments) {
      // Refund the same way the money came in: from the company account, or from the agent who kept the cash.
      const groups = db.prepare('SELECT account_id, held_by, method, SUM(amount) s FROM payments WHERE invoice_id = ? GROUP BY account_id, held_by, method').all(id);
      for (const p of groups) {
        if (p.s > 0) recordPayment(id, { amount: -p.s, method: p.method, account_id: p.account_id, held_by: p.held_by, date: d, reference: 'Refund on void' }, user, true);
      }
    }
    db.prepare('DELETE FROM invoice_shares WHERE invoice_id = ?').run(id);
    db.prepare(`UPDATE invoices SET status='void', void_reason=?, updated_at=datetime('now') WHERE id=?`).run(why, id);
  });
}

function deleteDraft(id, user) {
  const inv = getInvoice(id);
  if (!canAccessInvoice(user, inv)) throw forbidden();
  if (inv.status !== 'draft') throw bad('Only drafts can be deleted. Void issued invoices instead.');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
}

// ---------- payments ----------
// Money goes either into a company account (account_id) or stays with the agent who collected it
// (held_by, or account_id written as "held" / "held:<user id>"). Agents settle what they keep later.
function recordPayment(invoiceId, body, user, allowRefund = false) {
  const amount = fils(body.amount);
  if (!amount || (amount < 0 && !allowRefund)) throw bad('Payment amount must be more than zero');
  const method = ['cash', 'card', 'bank', 'cheque', 'other'].includes(body.method) ? body.method : 'cash';
  let heldBy = int(body.held_by) || null;
  let accountId = null;
  const target = String(body.account_id ?? '');
  if (!heldBy && target.startsWith('held')) heldBy = int(target.split(':')[1]) || user.id;
  if (heldBy) {
    if (user.role !== 'owner' && heldBy !== user.id) throw forbidden();
    if (!userExists(heldBy)) throw bad('Choose who kept the cash');
  } else {
    accountId = int(target);
    if (!accountId) throw bad('Choose where the money was received');
    getAccount(accountId);
  }
  const inv = db.prepare(`SELECT i.*, COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id),0) AS paid FROM invoices i WHERE i.id = ?`).get(invoiceId);
  if (!inv) throw notFound('Invoice');
  if (!canAccessInvoice(user, inv)) throw forbidden();
  if (inv.status !== 'issued') throw bad('Payments can only be recorded on issued invoices');
  if (amount > 0 && amount > inv.total - inv.paid) throw bad(`Amount is more than the balance due (AED ${aed(inv.total - inv.paid)})`);
  const date = dateOr(body.date);
  const r = db.prepare('INSERT INTO payments (invoice_id, date, amount, method, account_id, held_by, reference, received_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(invoiceId, date, amount, method, accountId, heldBy, str(body.reference, 120), user.id);
  const pid = Number(r.lastInsertRowid);
  if (accountId) {
    addTxn({
      account_id: accountId, date, kind: amount > 0 ? 'receipt' : 'refund', amount, ref_type: 'payment', ref_id: pid,
      note: `${amount > 0 ? 'Payment' : 'Refund'} ${inv.number} (${method})`, user_id: user.id,
    });
  }
  return pid;
}

function deletePayment(id, user) {
  if (user.role !== 'owner') throw forbidden();
  tx(() => {
    db.prepare(`DELETE FROM account_txns WHERE ref_type = 'payment' AND ref_id = ?`).run(id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
  });
}

// Invoices issued before profit sharing existed: the preparer did the work and the client counts as walk-in.
function backfillShares() {
  db.prepare('UPDATE invoice_items SET worker_id = (SELECT agent_id FROM invoices WHERE invoices.id = invoice_items.invoice_id) WHERE worker_id IS NULL').run();
  const missing = db.prepare(`SELECT id, discount, source_id FROM invoices i WHERE status = 'issued' AND service_total > discount
    AND NOT EXISTS (SELECT 1 FROM invoice_shares s WHERE s.invoice_id = i.id)`).all();
  if (!missing.length) return;
  tx(() => {
    for (const inv of missing) postShares(inv.id, db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id').all(inv.id), inv.discount, inv.source_id);
  });
}

// ---------- agent settlements ----------
// direction 'in': the agent hands over cash or tops up a company wallet; 'out': the company pays the agent their share.
function createSettlement(body, user) {
  const agentId = int(body.user_id);
  const agent = agentId && db.prepare('SELECT id, name FROM users WHERE id = ?').get(agentId);
  if (!agent) throw bad('Choose the agent');
  const amount = fils(body.amount);
  if (amount <= 0) throw bad('Amount must be more than zero');
  const out = body.direction === 'out';
  const acc = getAccount(int(body.account_id));
  const date = dateOr(body.date);
  const note = str(body.note, 300);
  return tx(() => {
    if (out) {
      const available = accountBalance(acc.id) + acc.credit_limit;
      if (amount > available) throw bad(`${acc.name} only has AED ${aed(available)} available`);
    }
    const sid = Number(db.prepare('INSERT INTO settlements (user_id, date, amount, account_id, note, created_by) VALUES (?,?,?,?,?,?)')
      .run(agent.id, date, out ? -amount : amount, acc.id, note, user.id).lastInsertRowid);
    const label = out ? `Paid to ${agent.name}` : `From ${agent.name}`;
    addTxn({ account_id: acc.id, date, kind: out ? 'payout' : 'settlement', amount: out ? -amount : amount, ref_type: 'settlement', ref_id: sid, note: note ? `${label} — ${note}` : label, user_id: user.id });
    return sid;
  });
}

function deleteSettlement(id) {
  tx(() => {
    db.prepare(`DELETE FROM account_txns WHERE ref_type = 'settlement' AND ref_id = ?`).run(id);
    db.prepare('DELETE FROM settlements WHERE id = ?').run(id);
  });
}

// ---------- expenses ----------
function saveExpense(body, user, id = null) {
  const category = str(body.category, 80);
  if (!category) throw bad('Choose a category');
  const amount = fils(body.amount);
  if (amount <= 0) throw bad('Amount must be more than zero');
  const account_id = int(body.account_id);
  const acc = getAccount(account_id);
  const date = dateOr(body.date);
  const description = str(body.description, 300);
  return tx(() => {
    let eid = id;
    if (id) {
      if (!db.prepare('SELECT id FROM expenses WHERE id = ?').get(id)) throw notFound('Expense');
      db.prepare('UPDATE expenses SET date=?, category=?, description=?, amount=?, account_id=? WHERE id=?').run(date, category, description, amount, account_id, id);
      db.prepare(`DELETE FROM account_txns WHERE ref_type = 'expense' AND ref_id = ?`).run(id);
    } else {
      eid = Number(db.prepare('INSERT INTO expenses (date, category, description, amount, account_id, created_by) VALUES (?,?,?,?,?,?)')
        .run(date, category, description, amount, account_id, user.id).lastInsertRowid);
    }
    addTxn({ account_id: acc.id, date, kind: 'expense', amount: -amount, ref_type: 'expense', ref_id: eid, note: [category, description].filter(Boolean).join(': '), user_id: user.id });
    return eid;
  });
}

function deleteExpense(id) {
  tx(() => {
    db.prepare(`DELETE FROM account_txns WHERE ref_type = 'expense' AND ref_id = ?`).run(id);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  });
}

module.exports = {
  HttpError, bad, notFound, forbidden, str, int, fils, isDate, dateOr,
  hashPassword, checkPassword, validatePassword,
  accountBalance, listAccounts, getAccount, saveAccount, createTransfer, deleteTransfer, createAdjustment,
  canSeeCustomer, customerScope, getInvoice, canAccessInvoice, invoiceScope, saveInvoice, issueInvoice, voidInvoice, deleteDraft, computeShares,
  recordPayment, deletePayment, createSettlement, deleteSettlement, backfillShares, saveExpense, deleteExpense,
};
