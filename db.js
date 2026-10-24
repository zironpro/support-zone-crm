// SQLite storage. All money is stored as integer fils (1 AED = 100 fils).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'crm.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const PAYMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id),
  date        TEXT NOT NULL,
  amount      INTEGER NOT NULL,                  -- negative = refund
  method      TEXT NOT NULL CHECK (method IN ('cash','card','bank','cheque','other')),
  account_id  INTEGER REFERENCES accounts(id),   -- company account the money went into, or
  held_by     INTEGER REFERENCES users(id),      -- the agent who collected the cash and kept it
  reference   TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`;

// Every money movement. amount is signed: + money in, - money out.
const ACCOUNT_TXNS_TABLE = `
CREATE TABLE IF NOT EXISTS account_txns (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('opening','topup','transfer','govt_fee','govt_refund','receipt','refund','expense','adjustment','settlement','payout')),
  amount     INTEGER NOT NULL,
  ref_type   TEXT,
  ref_id     INTEGER,
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

const TABLES = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','agent')),
  agent_type    TEXT NOT NULL DEFAULT 'sales',   -- profit share rules: 'commission', 'sales' or 'salaried' (owners too)
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  emirates_id   TEXT,
  company       TEXT,
  trade_license TEXT,
  notes         TEXT,
  agent_id      INTEGER REFERENCES users(id),     -- agent who brought this client (NULL = walk-in)
  shared        INTEGER NOT NULL DEFAULT 0,       -- 1 = every agent can see it (e.g. the walk-in customer)
  created_by    INTEGER REFERENCES users(id),     -- agents only see customers they added or brought in
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Money accounts: cash drawer, bank, and the wallets / cards used to pay government fees.
CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('cash','bank','wallet','card')),
  credit_limit INTEGER NOT NULL DEFAULT 0,   -- cards: how far the balance may go below zero
  low_alert    INTEGER NOT NULL DEFAULT 0,   -- warn when available balance drops below this
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

${ACCOUNT_TXNS_TABLE}

CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY,
  from_account_id INTEGER REFERENCES accounts(id),   -- NULL = money from outside (owner / capital)
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount          INTEGER NOT NULL,
  date            TEXT NOT NULL,
  note            TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  govt_fee    INTEGER NOT NULL DEFAULT 0,
  service_fee INTEGER NOT NULL DEFAULT 0,
  account_id  INTEGER REFERENCES accounts(id),   -- default wallet / card for the government fee
  share_rule  TEXT NOT NULL DEFAULT 'standard',  -- 'standard' = shared with agents, 'company' = 100% company
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY,
  number        TEXT UNIQUE,                     -- assigned when issued
  date          TEXT NOT NULL,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  agent_id      INTEGER NOT NULL REFERENCES users(id),   -- prepared by
  source_id     INTEGER REFERENCES users(id),            -- client brought by (NULL = walk-in)
  status        TEXT NOT NULL CHECK (status IN ('draft','issued','void')),
  govt_total    INTEGER NOT NULL DEFAULT 0,
  service_total INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  vat_rate      REAL NOT NULL DEFAULT 0,
  vat_amount    INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  verify_token  TEXT NOT NULL UNIQUE,
  void_reason   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          INTEGER PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id),
  name        TEXT NOT NULL,
  description TEXT,
  ref_no      TEXT,
  qty         INTEGER NOT NULL DEFAULT 1,
  govt_fee    INTEGER NOT NULL DEFAULT 0,        -- per unit
  service_fee INTEGER NOT NULL DEFAULT 0,        -- per unit
  account_id  INTEGER REFERENCES accounts(id),   -- wallet / card that paid the government fee
  worker_id   INTEGER REFERENCES users(id),      -- who did the work
  share_rule  TEXT NOT NULL DEFAULT 'standard',
  sort        INTEGER NOT NULL DEFAULT 0
);

-- How each issued invoice line's profit is split. user_id NULL = company.
CREATE TABLE IF NOT EXISTS invoice_shares (
  id         INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id    INTEGER REFERENCES invoice_items(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('company','source','worker')),
  amount     INTEGER NOT NULL
);

${PAYMENTS_TABLE}

-- Money between an agent and the company. + = agent paid the company, - = company paid the agent.
CREATE TABLE IF NOT EXISTS settlements (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  date       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  amount      INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_txn_account ON account_txns(account_id, date);
CREATE INDEX IF NOT EXISTS idx_txn_ref ON account_txns(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_inv_agent ON invoices(agent_id, date);
CREATE INDEX IF NOT EXISTS idx_inv_source ON invoices(source_id);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_item_worker ON invoice_items(worker_id);
CREATE INDEX IF NOT EXISTS idx_share_user ON invoice_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_share_invoice ON invoice_shares(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_pay_held ON payments(held_by);
CREATE INDEX IF NOT EXISTS idx_settle_user ON settlements(user_id);
`;

// Brings a database created by an older version up to the current schema.
function migrate() {
  const tableSql = (name) => db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)?.sql;
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const addColumn = (table, col, def) => { if (tableSql(table) && !columns(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };

  // Tables whose constraints changed are rebuilt: rename the old one, create the new one, copy rows across.
  const rebuild = [];
  const oldPayments = tableSql('payments');
  if (oldPayments && !oldPayments.includes('held_by')) rebuild.push(['payments', 'id, invoice_id, date, amount, method, account_id, reference, received_by, created_at']);
  const oldTxns = tableSql('account_txns');
  if (oldTxns && !oldTxns.includes("'settlement'")) rebuild.push(['account_txns', 'id, account_id, date, kind, amount, ref_type, ref_id, note, created_by, created_at']);

  db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  try {
    for (const [t] of rebuild) {
      db.exec(`DROP INDEX IF EXISTS ${t === 'payments' ? 'idx_pay_invoice; DROP INDEX IF EXISTS idx_pay_date' : 'idx_txn_account; DROP INDEX IF EXISTS idx_txn_ref'}`);
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}_old`);
    }
    db.exec(TABLES);
    addColumn('users', 'agent_type', `TEXT NOT NULL DEFAULT 'sales'`);
    addColumn('customers', 'agent_id', 'INTEGER REFERENCES users(id)');
    if (!columns('customers').includes('shared')) {
      addColumn('customers', 'shared', 'INTEGER NOT NULL DEFAULT 0');
      db.exec(`UPDATE customers SET shared = 1 WHERE name = 'Walk-in Customer'`);
    }
    addColumn('services', 'share_rule', `TEXT NOT NULL DEFAULT 'standard'`);
    addColumn('invoices', 'source_id', 'INTEGER REFERENCES users(id)');
    addColumn('invoice_items', 'worker_id', 'INTEGER REFERENCES users(id)');
    addColumn('invoice_items', 'share_rule', `TEXT NOT NULL DEFAULT 'standard'`);
    for (const [t, cols] of rebuild) {
      db.exec(`INSERT INTO ${t} (${cols}) SELECT ${cols} FROM ${t}_old; DROP TABLE ${t}_old;`);
    }
    db.exec(INDEXES);
    // v1: the owner now earns a personal share like an agent (commission agent rules by default).
    if (db.prepare('PRAGMA user_version').get().user_version < 1) {
      db.exec(`UPDATE users SET agent_type = 'commission' WHERE role = 'owner'; PRAGMA user_version = 1;`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrate();

const DEFAULT_SETTINGS = {
  company_name: 'My Business Services Center',
  company_name_ar: '',
  address: 'Abu Dhabi, United Arab Emirates',
  phone: '',
  email: '',
  website: '',
  logo: '',
  invoice_prefix: 'INV-',
  invoice_seq: '0',
  invoice_footer: 'Government fees are non-refundable once paid. Thank you for your business.',
  public_url: '',
  vat_enabled: '0',
  vat_rate: '5',
  trn: '',
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value ?? '';
  return s;
}

function setSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) stmt.run(k, v == null ? '' : String(v));
}

// Runs fn inside a transaction (not re-entrant).
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Today's date in the business timezone, as YYYY-MM-DD.
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
}

function aed(fils) {
  return (Number(fils || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { db, tx, getSettings, setSettings, today, aed, DB_PATH };
