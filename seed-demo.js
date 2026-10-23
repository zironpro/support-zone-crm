// Fills an EMPTY database with ~2 months of demo data so you can try the CRM.
//   npm run seed:demo
// Demo logins (change or delete these users before real use):
//   owner / owner123   (Owner)
//   sara  / agent123   (Sales agent)
//   rahul / agent123   (Sales agent)
//   kamal / agent123   (Commission agent)
process.env.TZ = process.env.TZ || 'Asia/Dubai';
const { db, setSettings, today } = require('./db');
const L = require('./logic');
const R = require('./reports');

if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.error('Database already has users — demo seed only runs on an empty database.\nDelete data/crm.db first if you want to start over.');
  process.exit(1);
}

let seed = 20261023;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const AED = (n) => Math.round(n * 100);

setSettings({
  company_name: 'Support Zone',
  company_name_ar: '',
  address: 'Office 12, Example Building, Abu Dhabi, UAE',
  phone: '+971 2 000 0000',
  email: 'info@example.ae',
  invoice_footer: 'Government fees are non-refundable once the application is submitted. Thank you for your business.',
});

const mkUser = (name, username, password, role, agentType = 'sales') => {
  const id = Number(db.prepare('INSERT INTO users (name, username, password_hash, role, agent_type) VALUES (?,?,?,?,?)').run(name, username, L.hashPassword(password), role, agentType).lastInsertRowid);
  return { id, name, role };
};
const owner = mkUser('Owner', 'owner', 'owner123', 'owner');
const sara = mkUser('Sara Ahmed', 'sara', 'agent123', 'agent');
const rahul = mkUser('Rahul Menon', 'rahul', 'agent123', 'agent');
const kamal = mkUser('Kamal Hassan', 'kamal', 'agent123', 'agent', 'commission');
const staff = [sara, rahul];
const allAgents = [sara, rahul, kamal];

const start = addDays(today(), -60);
const acc = (name, type, opening, extra = {}) => L.saveAccount({ name, type, opening_balance: AED(opening), date: start, ...extra }, owner);
const cash = acc('Cash Drawer', 'cash', 2000);
const bank = acc('Main Bank Account', 'bank', 250000);
const card1 = acc('Corporate Credit Card ••4512', 'card', 0, { credit_limit: AED(60000), low_alert: AED(5000) });
const card2 = acc('Debit Card ••8830', 'card', 0, { credit_limit: AED(0), low_alert: AED(2000) });
const wallet = acc('Govt e-Wallet (prepaid)', 'wallet', 15000, { low_alert: AED(3000) });
// Debit card is funded from the bank, so treat it as prepaid
L.createTransfer({ from_account_id: bank, to_account_id: card2, amount: AED(20000), date: start, note: 'Initial funding' }, owner);

// Sample price list — fees are examples only, update them to current government rates.
const services = [
  ['Emirates ID – Renewal (1 year)', 'Emirates ID', 303, 30, wallet],
  ['Emirates ID – New application', 'Emirates ID', 370, 40, wallet],
  ['Entry Permit – Employment', 'Visa', 1150, 150, card1],
  ['Residence Visa – Stamping', 'Visa', 650, 100, card1],
  ['Residence Visa – Renewal', 'Visa', 900, 120, card1],
  ['Visa Cancellation', 'Visa', 150, 80, card2],
  ['Family Visa – Sponsorship', 'Visa', 2400, 350, card1],
  ['Medical Fitness Test – Typing', 'Medical', 320, 30, card2],
  ['Work Permit / Labour Contract', 'Labour (MOHRE)', 250, 60, card2],
  ['Trade Licence – Renewal', 'Business setup', 6500, 750, card1],
  ['Trade Licence – New (Mainland)', 'Business setup', 12500, 2500, card1],
  ['Tenancy Contract (Tawtheeq)', 'Municipality', 220, 50, card2],
  ['Legal Translation (per page)', 'Translation', 0, 120, null],
  ['Arabic Typing – Letter / Application', 'Typing', 0, 25, null],
  ['Document Attestation – MOFA', 'Attestation', 150, 75, wallet],
];
const svcIds = services.map(([name, category, g, s, a]) => ({
  id: Number(db.prepare('INSERT INTO services (name, category, govt_fee, service_fee, account_id) VALUES (?,?,?,?,?)').run(name, category, AED(g), AED(s), a).lastInsertRowid),
  name, govt_fee: AED(g), service_fee: AED(s), account_id: a,
}));
const photocopy = Number(db.prepare(`INSERT INTO services (name, category, service_fee, share_rule) VALUES ('Photocopy / Xerox (per page)', 'Photocopy', ?, 'company')`).run(AED(1)).lastInsertRowid);
const misc = Number(db.prepare(`INSERT INTO services (name, category, service_fee) VALUES ('Miscellaneous work', 'Miscellaneous', 0)`).run().lastInsertRowid);
const weights = [9, 4, 3, 3, 3, 2, 1, 6, 4, 1, 1, 2, 3, 5, 2];
const weightedSvc = () => { let r = rand() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return svcIds[i]; } return svcIds[0]; };

db.prepare(`INSERT INTO customers (name, notes, shared) VALUES ('Walk-in Customer','Default customer for counter sales', 1)`).run();
const first = ['Mohammed', 'Ahmed', 'Fatima', 'Aisha', 'Omar', 'Khalid', 'Priya', 'Arun', 'Maria', 'Jose', 'Hassan', 'Noura', 'Imran', 'Sanjay', 'Layla', 'Yusuf', 'Ravi', 'Mariam', 'Ali', 'Grace'];
const last = ['Khan', 'Al Hashimi', 'Nair', 'Santos', 'Rahman', 'Pillai', 'Haddad', 'Fernandes', 'Qureshi', 'Mathew', 'Saleh', 'Iqbal', 'Reyes', 'Kumar', 'Mansour'];
const companies = [null, null, null, 'Green Palm Trading LLC', 'Bright Star Contracting', 'Falcon Technical Services', 'Desert Rose Cafeteria', 'Blue Wave Cleaning Services'];
const customers = [1];
for (let i = 0; i < 45; i++) {
  const name = `${pick(first)} ${pick(last)}`;
  const phone = `05${pick(['0', '2', '5', '6', '8'])} ${String(Math.floor(rand() * 900) + 100)} ${String(Math.floor(rand() * 9000) + 1000)}`;
  const eid = rand() < 0.7 ? `784-19${Math.floor(rand() * 40 + 60)}-${String(Math.floor(rand() * 9000000) + 1000000)}-${Math.floor(rand() * 10)}` : null;
  const r = rand();
  const broughtBy = r < 0.25 ? kamal.id : r < 0.35 ? sara.id : r < 0.45 ? rahul.id : null; // the rest came in by themselves
  const addedBy = broughtBy || pick([owner, sara, rahul]).id; // only this person (and who brought them) can see the customer
  customers.push(Number(db.prepare('INSERT INTO customers (name, phone, emirates_id, company, agent_id, created_by) VALUES (?,?,?,?,?,?)').run(name, phone, eid, pick(companies), broughtBy, addedBy).lastInsertRowid));
}

let count = 0;
for (let day = 0; day <= 60; day++) {
  const date = addDays(start, day);
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  if (dow === 0) continue; // closed Sundays

  if (dow === 1 || dow === 4) { // twice-weekly: agents settle, bank the cash, pay off the credit card, refill wallets
    for (const a of R.agentBalances().filter((x) => x.role !== 'owner')) {
      if (a.balance > AED(200)) {
        // Agents top up the e-wallet first, then hand the rest over in cash.
        const amount = Math.round(a.balance * 0.9 / 100) * 100;
        const toWallet = Math.min(amount, Math.max(0, Math.round((AED(15000) - L.accountBalance(wallet)) / 100) * 100));
        if (toWallet > 0) L.createSettlement({ user_id: a.id, amount: toWallet, direction: 'in', account_id: wallet, date, note: 'Topped up e-wallet' }, owner);
        if (amount > toWallet) L.createSettlement({ user_id: a.id, amount: amount - toWallet, direction: 'in', account_id: cash, date, note: 'Cash handed over' }, owner);
      } else if (a.balance < -AED(300) && dow === 4) {
        L.createSettlement({ user_id: a.id, amount: -a.balance, direction: 'out', account_id: bank, date, note: 'Share paid out' }, owner);
      }
    }
    const cashBal = L.accountBalance(cash);
    if (cashBal > AED(3000)) L.createTransfer({ from_account_id: cash, to_account_id: bank, amount: cashBal - AED(3000), date, note: 'Cash deposit' }, owner);
    const used = -L.accountBalance(card1);
    if (used > 0) L.createTransfer({ from_account_id: bank, to_account_id: card1, amount: used, date, note: 'Card payment' }, owner);
    const top = (id, target) => { const b = L.accountBalance(id); if (b < target) L.createTransfer({ from_account_id: bank, to_account_id: id, amount: target - b, date, note: 'Top-up' }, owner); };
    top(wallet, AED(15000));
    top(card2, AED(12000));
  }

  const n = 3 + Math.floor(rand() * 7);
  for (let k = 0; k < n; k++) {
    // Agents can only bill their own customers (or walk-ins); the owner can bill anyone.
    const agent = rand() < 0.15 ? owner : rand() < 0.2 ? kamal : pick(staff);
    const own = agent === owner ? customers : db.prepare('SELECT id FROM customers WHERE created_by = ? OR agent_id = ?').all(agent.id, agent.id).map((c) => c.id);
    const customer_id = rand() < 0.25 || !own.length ? 1 : pick(own);
    const clientOf = db.prepare('SELECT agent_id FROM customers WHERE id = ?').get(customer_id).agent_id;
    const source_id = clientOf || (agent !== owner && rand() < 0.08 ? agent.id : null);
    const lines = 1 + (rand() < 0.3 ? 1 : 0) + (rand() < 0.1 ? 1 : 0);
    const items = [];
    for (let j = 0; j < lines; j++) {
      const s = weightedSvc();
      const worker_id = rand() < 0.2 ? pick(allAgents).id : agent.id; // sometimes another agent does the work
      items.push({ service_id: s.id, name: s.name, qty: s.govt_fee ? 1 : 1 + Math.floor(rand() * 3), govt_fee: s.govt_fee, service_fee: s.service_fee, account_id: s.account_id, worker_id, description: `${pick(first)} ${pick(last)}`, ref_no: s.govt_fee ? String(Math.floor(rand() * 9e8) + 1e8) : null });
    }
    if (rand() < 0.25) items.push({ service_id: photocopy, name: 'Photocopy / Xerox (per page)', qty: 2 + Math.floor(rand() * 9), service_fee: AED(1), worker_id: agent.id });
    if (rand() < 0.06) items.push({ service_id: misc, name: 'Miscellaneous work', description: pick(['Form filling', 'Scanning & email', 'Online appointment booking']), qty: 1, service_fee: AED(20 + Math.floor(rand() * 4) * 10), worker_id: agent.id });
    const svcTotal = items.reduce((t, it) => t + it.service_fee * it.qty, 0);
    const discount = rand() < 0.08 ? Math.min(svcTotal, AED(10 * (1 + Math.floor(rand() * 3)))) : 0;
    const total = items.reduce((t, it) => t + (it.govt_fee + it.service_fee) * it.qty, 0) - discount;
    const r = rand();
    const method = rand() < 0.6 ? 'cash' : rand() < 0.7 ? 'card' : 'bank';
    const payAmount = r < 0.85 ? total : r < 0.95 ? Math.round(total / 2 / 100) * 100 : 0;
    // Agents keep the cash they collect; card and transfer payments go to the company bank.
    const into = method !== 'cash' ? bank : agent === owner ? cash : 'held';
    const payment = payAmount > 0 ? { amount: payAmount, method, account_id: into, date } : null;
    try {
      const id = L.saveInvoice({ customer_id, date, items, discount, source_id, issue: true, payment }, agent);
      count++;
      if (rand() < 0.012) L.voidInvoice(id, owner, { reason: 'Application rejected — customer cancelled', refund_wallets: true, refund_payments: true, date });
    } catch (e) {
      console.warn('skipped invoice:', e.message);
    }
  }
}

// Collect some of the older partial / unpaid balances
const unpaid = db.prepare(`SELECT i.id, i.date, i.total - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id),0) due FROM invoices i WHERE status='issued' AND date < ?`).all(addDays(today(), -20));
for (const u of unpaid) if (u.due > 0 && rand() < 0.6) L.recordPayment(u.id, { amount: u.due, method: 'cash', account_id: cash, date: addDays(u.date, 5) }, owner);

// Expenses
for (let m = 0; m < 3; m++) {
  const base = addDays(today(), -60 + m * 30);
  const d1 = base.slice(0, 8) + '01';
  if (d1 >= start && d1 <= today()) {
    L.saveExpense({ date: d1, category: 'Rent', description: 'Office rent', amount: AED(6500), account_id: bank }, owner);
  }
  const d25 = base.slice(0, 8) + '25';
  if (d25 >= start && d25 <= today()) {
    L.saveExpense({ date: d25, category: 'Salaries', description: 'Staff salaries', amount: AED(9000), account_id: bank }, owner);
    L.saveExpense({ date: d25, category: 'Utilities (ADDC / water)', description: 'Electricity & water', amount: AED(640), account_id: bank }, owner);
    L.saveExpense({ date: d25, category: 'Internet & phone', description: 'Internet + landline', amount: AED(420), account_id: bank }, owner);
  }
}
for (let i = 0; i < 10; i++) {
  L.saveExpense({ date: addDays(start, Math.floor(rand() * 60)), category: pick(['Printing & stationery', 'Office supplies', 'Transport', 'Miscellaneous']), description: pick(['Printer toner', 'A4 paper', 'Taxi to ministry', 'Water & tea', 'Courier']), amount: AED(20 + Math.floor(rand() * 180)), account_id: cash }, owner);
}

console.log(`Demo data ready: ${count} invoices, ${customers.length} customers, ${services.length} services.`);
console.log('Logins are listed at the top of seed-demo.js.');
