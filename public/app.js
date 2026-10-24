'use strict';
// Typing Center CRM — single-page UI. Money from the API is in fils (1 AED = 100 fils).

const S = { me: null, settings: {}, today: '', nav: 0 };

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (f) => (Number(f || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fixed = (f) => (Number(f || 0) / 100).toFixed(2);
const toFils = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const isOwner = () => S.me?.role === 'owner';
const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== '' && v != null && v !== false) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};
const stale = (ctx) => ctx.nav !== S.nav;
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-crm': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && path !== '/login') { S.me = null; LoginView(); throw new Error('Please log in'); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = type;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2600);
}

const ICON_PATHS = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  inv: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  cust: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  svc: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  wallet: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M16 15h2"/>',
  exp: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  rep: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  users: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  agents: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[k]}</svg>`;

function statusBadge(inv) {
  if (inv.status === 'draft') return '<span class="badge b-draft">Draft</span>';
  if (inv.status === 'void') return '<span class="badge b-void">Void</span>';
  if (inv.total - inv.paid <= 0) return '<span class="badge b-paid">Paid</span>';
  if (inv.paid > 0) return '<span class="badge b-partial">Partial</span>';
  return '<span class="badge b-unpaid">Unpaid</span>';
}
const TYPE_LABEL = { cash: 'Cash', bank: 'Bank', wallet: 'e-Wallet', card: 'Card' };
const METHOD_LABEL = { cash: 'Cash', card: 'Card (POS)', bank: 'Bank transfer', cheque: 'Cheque', other: 'Other' };
const KIND_LABEL = { opening: 'Opening', topup: 'Top-up', transfer: 'Transfer out', govt_fee: 'Govt fee', govt_refund: 'Govt refund', receipt: 'Receipt', refund: 'Refund', expense: 'Expense', adjustment: 'Adjustment', settlement: 'From agent', payout: 'Paid to agent' };
const EXPENSE_CATEGORIES = ['Rent', 'Salaries', 'Commission', 'Utilities (ADDC / water)', 'Internet & phone', 'Office supplies', 'Printing & stationery', 'Transport', 'Marketing', 'Bank charges', 'Company licence & govt', 'Maintenance', 'Miscellaneous'];
const ROLE_LABEL = (u) => (u.role === 'owner' ? 'Owner' : { commission: 'Commission agent', salaried: 'Salaried staff' }[u.agent_type] || 'Sales agent');
const SHARE_ROLE = { company: 'company', source: 'brought client', worker: 'did the work' };
const RULE_LABEL = { standard: 'Shared', company: 'Company 100%' };
const SHARE_TYPE_LABEL = { commission: 'Commission agent rules', sales: 'Sales agent rules', salaried: 'No share (salaried)' };
// Same as EARNS in logic.js: which parts each kind of user earns; the rest goes to the company.
const EARNS = { commission: { source: true, worker: true }, sales: { source: true, worker: false }, salaried: { source: false, worker: false } };
const earnsFor = (users) => (id, role) => {
  const u = users.find((x) => x.id === id);
  return !!u && !!EARNS[u.agent_type]?.[role];
};

// Same split as the server (computeShares in logic.js), for the live preview on the invoice form.
function splitShares(items, discount, sourceId, earns = () => true) {
  const lines = items.map((it) => it.service_fee * it.qty);
  const total = lines.reduce((a, b) => a + b, 0);
  const disc = lines.map((l) => (total ? Math.floor((discount * l) / total) : 0));
  const leftover = discount - disc.reduce((a, b) => a + b, 0);
  if (leftover) disc[lines.indexOf(Math.max(...lines))] += leftover;
  const rows = [];
  items.forEach((it, i) => {
    const net = lines[i] - disc[i];
    if (net <= 0) return;
    if (it.share_rule === 'company') {
      rows.push({ user_id: null, role: 'company', amount: net });
    } else if (!sourceId) {
      const w = Math.round(net / 2);
      rows.push({ user_id: it.worker_id, role: 'worker', amount: w }, { user_id: null, role: 'company', amount: net - w });
    } else {
      const t = Math.round(net / 3);
      rows.push({ user_id: sourceId, role: 'source', amount: t }, { user_id: it.worker_id, role: 'worker', amount: t }, { user_id: null, role: 'company', amount: net - 2 * t });
    }
  });
  return rows.map((r) => (r.user_id && !earns(r.user_id, r.role) ? { user_id: null, role: 'company', amount: r.amount } : r));
}
// One row per person (company first) with the roles they earned from.
function groupShares(rows, nameOf) {
  const m = new Map();
  for (const r of rows) {
    const k = r.user_id ?? 0;
    if (!m.has(k)) m.set(k, { user_id: r.user_id ?? null, name: r.user_id ? nameOf(r.user_id) : 'Company', roles: new Set(), amount: 0 });
    const g = m.get(k);
    if (r.amount) g.roles.add(r.role);
    g.amount += r.amount;
  }
  return [...m.values()].sort((a, b) => (a.user_id === null ? -1 : b.user_id === null ? 1 : b.amount - a.amount));
}
function sharesTable(groups) {
  groups = groups.filter((g) => g.amount || g.user_id === null); // people who earn nothing on this invoice
  if (!groups.length) return '<span class="muted small">No profit to share</span>';
  return `<table class="sum">${groups.map((g) => `<tr><td>${esc(g.name)}${g.user_id ? `<div class="hint">${[...g.roles].map((r) => SHARE_ROLE[r]).join(' + ')}</div>` : ''}</td><td>${money(g.amount)}</td></tr>`).join('')}</table>`;
}
const userOptions = (users, { none = null, keep = null } = {}) => [
  ...(none ? [['', none]] : []),
  ...users.filter((u) => u.active !== 0 || u.id === keep).map((u) => [u.id, u.name]),
];
const balanceText = (b) => (b > 0 ? `Owes company AED ${money(b)}` : b < 0 ? `Company owes AED ${money(-b)}` : 'Settled');

// ---------- form helpers ----------
function field(label, name, { type = 'text', value = '', required = false, placeholder = '', hint = '', cls = '', attrs = '' } = {}) {
  return `<label class="f ${cls}">${label}<input type="${type}" name="${name}" value="${esc(value ?? '')}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
}
function moneyField(label, name, fils, opts = {}) {
  return field(label, name, { ...opts, type: 'number', value: fils == null ? '' : fixed(fils), attrs: `step="0.01" ${opts.allowNegative ? '' : 'min="0"'} inputmode="decimal" class="money" ${opts.attrs || ''}` });
}
function selectField(label, name, options, selected, { cls = '', hint = '', attrs = '' } = {}) {
  return `<label class="f ${cls}">${label}<select name="${name}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

function modal({ title, body, submit = 'Save', wide = false, danger = false, onSubmit }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate>
    <div class="hd"><h3>${esc(title)}</h3><button type="button" data-close aria-label="Close">×</button></div>
    <div class="bd"><div class="err hidden"></div>${body}</div>
    <div class="ft"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button></div>
  </form>`;
  document.body.appendChild(bg);
  const form = $('form', bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.err', form);
    const missing = [...form.elements].find((el) => el.required && !String(el.value).trim());
    if (missing) { err.textContent = 'Please fill in the required fields'; err.classList.remove('hidden'); missing.focus(); return; }
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    try {
      await onSubmit(formData(form), form);
      close();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
  setTimeout(() => $('input:not([type=hidden]),select,textarea', form)?.focus(), 30);
  return { form, close };
}

function confirmBox(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({ title, body: `<p style="margin:0">${text}</p>`, submit: okLabel, danger: true, onSubmit: async () => { ok = true; } });
    new MutationObserver((_, obs) => { if (!document.body.contains(m.form)) { obs.disconnect(); resolve(ok); } }).observe(document.body, { childList: true });
  });
}

function exportCSV(table, name) {
  const rows = $$('tr', table).map((tr) => [...tr.children].filter((c) => !c.classList.contains('no-csv'))
    .map((c) => `"${c.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${S.today}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function quickRanges() {
  const [y, m, d] = S.today.split('-').map(Number);
  const iso = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  return [
    ['Today', S.today, S.today],
    ['Yesterday', iso(y, m, d - 1), iso(y, m, d - 1)],
    ['This month', iso(y, m, 1), S.today],
    ['Last month', iso(y, m - 1, 1), iso(y, m, 0)],
    ['This year', `${y}-01-01`, S.today],
  ];
}
const monthStart = () => S.today.slice(0, 8) + '01';

function rangeInputs(from, to) {
  return `${field('From', 'from', { type: 'date', value: from })}${field('To', 'to', { type: 'date', value: to })}
    <div class="row" style="gap:4px">${quickRanges().map(([l, f, t]) => `<button type="button" class="btn sm" data-range="${f}|${t}">${l}</button>`).join('')}</div>`;
}
// Filter forms write their values into the URL so back / refresh keep them.
function bindFilters(form, base) {
  const go = () => { location.hash = base + qs(formData(form)); };
  form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
  form.addEventListener('change', (e) => { if (e.target.name !== 'q') go(); });
  $$('[data-range]', form).forEach((b) => b.addEventListener('click', () => {
    const [f, t] = b.dataset.range.split('|');
    form.elements.from.value = f;
    form.elements.to.value = t;
    go();
  }));
}

// ---------- boot / auth ----------
async function boot() {
  const st = await fetch('/api/setup-status').then((r) => r.json());
  if (st.needsSetup) return SetupView();
  try {
    const me = await api('/me');
    S.me = me.user; S.settings = me.settings; S.today = me.today;
  } catch { return; }
  renderShell();
  router();
}

function authFrame(inner) {
  $('#app').innerHTML = `<div class="auth"><div class="card"><img src="/brand/logo.png" alt="Support Zone" class="auth-logo">${inner}</div></div>`;
}

function LoginView() {
  authFrame(`<h1>Sign in</h1><p class="muted" style="margin:0">Billing, wallets &amp; accounts for your service center</p>
    <form id="login"><div class="err hidden"></div>
      ${field('Username', 'username', { required: true, attrs: 'autocomplete="username" autocapitalize="off"' })}
      ${field('Password', 'password', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
      <button class="btn primary" type="submit">Sign in</button></form>`);
  const f = $('#login');
  f.elements.username.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/login', { method: 'POST', body: formData(f) });
      if (!location.hash || location.hash === '#/login') location.hash = '#/';
      boot();
    } catch (ex) { const el = $('.err', f); el.textContent = ex.message; el.classList.remove('hidden'); }
  });
}

function SetupView() {
  authFrame(`<h1>Welcome — first-time setup</h1><p class="muted" style="margin:0">Create the owner account. You can add sales agents afterwards.</p>
    <form id="setup"><div class="err hidden"></div>
      ${field('Business name', 'company_name', { required: true, placeholder: 'e.g. Al Noor Typing & Business Services' })}
      ${field('Your name', 'name', { required: true })}
      ${field('Username', 'username', { required: true, attrs: 'autocapitalize="off"' })}
      ${field('Password', 'password', { type: 'password', required: true, hint: 'At least 6 characters', attrs: 'autocomplete="new-password"' })}
      <button class="btn primary" type="submit">Create owner account</button></form>`);
  const f = $('#setup');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/setup', { method: 'POST', body: formData(f) });
      location.hash = '#/wallets';
      boot();
    } catch (ex) { const el = $('.err', f); el.textContent = ex.message; el.classList.remove('hidden'); }
  });
}

// ---------- shell & router ----------
function renderShell() {
  const nav = [
    ['#/', 'dash', 'Dashboard'],
    ['#/invoices', 'inv', 'Invoices'],
    ['#/customers', 'cust', isOwner() ? 'Customers' : 'My customers'],
    ['#/services', 'svc', 'Services & fees'],
    isOwner() ? ['#/wallets', 'wallet', 'Wallets & accounts'] : ['#/me', 'wallet', 'My account'],
    isOwner() && ['#/agents', 'agents', 'Agent accounts'],
    isOwner() && ['#/expenses', 'exp', 'Expenses'],
    ['#/reports', 'rep', 'Reports'],
    isOwner() && 'Admin',
    isOwner() && ['#/users', 'users', 'Users & agents'],
    isOwner() && ['#/settings', 'set', 'Settings'],
  ].filter(Boolean);
  $('#app').innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><img src="/brand/logo.png" alt="Support Zone"><span>${esc(S.settings.company_name)}</span></div>
      <nav>${nav.map((n) => (typeof n === 'string' ? `<div class="sec">${n}</div>` : `<a href="${n[0]}" data-nav="${n[0]}">${icon(n[1])}<span>${n[2]}</span></a>`)).join('')}</nav>
      <div class="me"><div><b>${esc(S.me.name)}</b><a href="#/account">${ROLE_LABEL(S.me)} · Password</a></div><button id="logout">Log out</button></div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="row" style="flex-wrap:nowrap"><button class="btn sm menu-btn" id="menu-btn" aria-label="Menu">${icon('menu')}</button><h1 id="title"></h1></div>
        <div class="row"><span id="top-actions" class="row"></span><a class="btn primary" href="#/invoices/new">${icon('plus')}<span class="hide-sm">New invoice</span></a></div>
      </div>
      <div class="content" id="view"></div>
    </div>
  </div>`;
  $('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }); S.me = null; location.hash = '#/'; LoginView(); });
  $('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#side').classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.side')) $('#side')?.classList.remove('open'); });
}

function setTitle(title, actions = '') {
  $('#title').textContent = title;
  $('#top-actions').innerHTML = actions;
  document.title = `${title} — ${S.settings.company_name || 'CRM'}`;
}

const ROUTES = [
  ['/', Dashboard], ['/invoices', Invoices], ['/invoices/new', InvoiceEditor], ['/invoices/:id/edit', InvoiceEditor], ['/invoices/:id', InvoiceView],
  ['/customers', Customers], ['/customers/:id', CustomerView], ['/services', Services], ['/wallets', Wallets], ['/wallets/:id', WalletStatement],
  ['/expenses', Expenses], ['/reports', Reports], ['/users', Users], ['/settings', Settings], ['/account', MyAccount],
  ['/agents', Agents], ['/agents/:id', AgentStatement], ['/me', AgentStatement],
];

function matchRoute(path) {
  const parts = path.split('/').filter(Boolean);
  for (const [pattern, view] of ROUTES) {
    const pp = pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(':') ? (params[p.slice(1)] = parts[i], true) : p === parts[i]))) return { view, params };
  }
  return null;
}

async function router() {
  if (!S.me) return;
  const h = location.hash.slice(1) || '/';
  const [path, q] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(q || ''));
  const m = matchRoute(path === '/login' ? '/' : path);
  const ctx = { nav: ++S.nav };
  $('#side')?.classList.remove('open');
  $$('[data-nav]').forEach((a) => {
    const target = a.dataset.nav.slice(1);
    a.classList.toggle('active', target === '/' ? path === '/' : path.startsWith(target));
  });
  const view = $('#view');
  view.innerHTML = '<div class="empty">Loading…</div>';
  window.scrollTo(0, 0);
  if (!m) { setTitle('Not found'); view.innerHTML = '<div class="empty">Page not found</div>'; return; }
  try {
    await m.view(m.params, query, ctx);
  } catch (ex) {
    if (stale(ctx)) return;
    setTitle('Error');
    view.innerHTML = `<div class="err">${esc(ex.message)}</div>`;
  }
}
window.addEventListener('hashchange', router);

// ---------- shared data helpers ----------
const accountOptions = (accounts, { none = null, types = null, showAvail = false } = {}) => {
  const list = accounts.filter((a) => a.active !== 0 && (!types || types.includes(a.type)));
  return [...(none ? [['', none]] : []), ...list.map((a) => [a.id, `${a.name}${showAvail && a.available != null ? ` — avail ${money(a.available)}` : ''}`])];
};
const defaultMoneyAccount = (accounts, method) => {
  const want = method === 'cash' ? 'cash' : 'bank';
  return (accounts.find((a) => a.type === want) || accounts.find((a) => a.type === 'cash' || a.type === 'bank'))?.id;
};

// Where a customer payment goes: a company cash/bank account, or it stays with the agent who collected it.
function receiveOptions(accounts, users, selected) {
  const recv = accounts.filter((a) => ['cash', 'bank'].includes(a.type) && a.active !== 0);
  const opt = (v, l) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  const company = `<optgroup label="Company account">${recv.map((a) => opt(a.id, a.name)).join('')}</optgroup>`;
  if (!isOwner()) return opt('held', 'Kept by me (cash with me)') + company;
  const agents = users.filter((u) => u.role !== 'owner' && u.active !== 0);
  return company + (agents.length ? `<optgroup label="Agent keeps the cash">${agents.map((u) => opt(`held:${u.id}`, `Kept by ${u.name}`)).join('')}</optgroup>` : '');
}
// Agents keep the cash they collect by default; salaried staff put it in the company cash drawer.
const defaultReceive = (accounts, method) => (!isOwner() && S.me.agent_type !== 'salaried' && method === 'cash' ? 'held' : defaultMoneyAccount(accounts, method));

function paymentFields(accounts, users, { amount, date = S.today } = {}) {
  return `<div class="form-grid">
    ${moneyField('Amount received (AED) *', 'amount', amount, { required: true })}
    ${field('Date', 'date', { type: 'date', value: date })}
    ${selectField('Method', 'method', Object.entries(METHOD_LABEL), 'cash', { attrs: 'data-method' })}
    <label class="f">Received into<select name="account_id" data-recv>${receiveOptions(accounts, users, defaultReceive(accounts, 'cash'))}</select></label>
    ${field('Reference', 'reference', { cls: 'full', placeholder: 'Card slip / transfer ref / cheque no. (optional)' })}
  </div>`;
}
function bindPaymentMethod(form, accounts) {
  $('[data-method]', form)?.addEventListener('change', (e) => { const v = defaultReceive(accounts, e.target.value); if (v) $('[data-recv]', form).value = v; });
}

function customerModal(c, onSaved, prefill = {}, users = []) {
  const v = c || prefill;
  modal({
    title: c ? 'Edit customer' : 'New customer',
    wide: true,
    body: `<div class="form-grid">
      ${field('Full name *', 'name', { value: v.name, required: true })}
      ${field('Mobile', 'phone', { value: v.phone, placeholder: '05X XXX XXXX', attrs: 'inputmode="tel"' })}
      ${field('Email', 'email', { type: 'email', value: v.email })}
      ${field('Emirates ID', 'emirates_id', { value: v.emirates_id, placeholder: '784-XXXX-XXXXXXX-X' })}
      ${field('Company', 'company', { value: v.company })}
      ${field('Trade licence no.', 'trade_license', { value: v.trade_license })}
      ${selectField('Client brought by', 'agent_id', userOptions(users, { none: 'Walk-in / nobody', keep: v.agent_id }), v.agent_id ?? '', { cls: 'full', hint: 'Filled in automatically as “Client brought by” on this client’s invoices' })}
      <label class="f full">Notes<textarea name="notes">${esc(v.notes || '')}</textarea></label>
      ${isOwner() ? `<label class="f check full"><input type="checkbox" name="shared" ${v.shared ? 'checked' : ''}> Shared with all agents <span class="hint">— otherwise only the agent who added the customer (and the agent who brought them) can see it</span></label>` : ''}
    </div>`,
    onSubmit: async (d) => {
      const r = c ? await api('/customers/' + c.id, { method: 'PUT', body: d }) : await api('/customers', { method: 'POST', body: d });
      toast('Customer saved');
      onSaved?.(c ? { ...c, ...d, agent_id: Number(d.agent_id) || null } : r);
    },
  });
}

// ---------- dashboard ----------
async function Dashboard(params, query, ctx) {
  setTitle(isOwner() ? 'Dashboard' : `Welcome, ${S.me.name}`);
  const d = await api('/reports/dashboard');
  if (stale(ctx)) return;
  const stat = (k, v, s = '', cls = '') => `<div class="card stat ${cls}"><div class="k">${k}</div><div class="v"><small>AED</small>${money(v)}</div><div class="s">${s}</div></div>`;

  const today = `<div class="grid g4">
    ${stat("Today's sales", d.today.total, `${d.today.invoices} invoice${d.today.invoices === 1 ? '' : 's'} · govt fees ${money(d.today.govt)}`)}
    ${stat("Today's profit", d.today.profit, 'Service charges after discount', 'accent')}
    ${stat('Collected today', d.today.collected, 'Cash, card & transfers')}
    ${stat('Outstanding', d.receivables, 'Unpaid customer balances')}
  </div>`;

  if (!isOwner()) {
    const b = d.me.balance;
    $('#view').innerHTML = `<div class="stack">${today}
      <div class="grid g4">
        ${stat('Sales this month', d.month.total, `${d.month.invoices} invoices I worked on`)}
        ${stat('My share this month', d.myShareMonth, 'Brought client + did the work', 'accent')}
        ${stat('Share waiting for payment', d.me.pending, 'Paid to you once the customer pays in full')}
        ${b > 0 ? stat('I owe the company', b, '<a href="#/me">Pay back / top up a wallet</a>') : b < 0 ? stat('Company owes me', -b, '<a href="#/me">See my account</a>') : stat('My account', 0, 'Settled')}
      </div>
      <div class="grid g2">
        <div class="card"><div class="hd"><h3>My account (all time)</h3><a class="small" href="#/me">Statement</a></div><div class="bd"><table class="sum">
          <tr><td>Cash I collected and kept</td><td>${money(d.me.collected)}</td></tr>
          <tr><td>My profit share (paid invoices)</td><td>-${money(d.me.earned)}</td></tr>
          <tr><td>Paid to company / wallet top-ups</td><td>-${money(d.me.settled)}</td></tr>
          <tr class="grand"><td>${b >= 0 ? 'I owe the company' : 'Company owes me'}</td><td>AED ${money(Math.abs(b))}</td></tr>
          <tr><td class="muted">Govt fees used from company wallets for my jobs</td><td class="muted">${money(d.me.govt_used)}</td></tr>
        </table></div></div>
        ${recentCard(d.recent)}
      </div>
    </div>`;
    $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
    return;
  }

  const fee = d.wallets.filter((w) => ['wallet', 'card'].includes(w.type));
  const cashBank = d.wallets.filter((w) => ['cash', 'bank'].includes(w.type));
  const walletRow = (w) => `<tr class="click" data-go="#/wallets/${w.id}">
    <td><b>${esc(w.name)}</b> <span class="badge b-type">${TYPE_LABEL[w.type]}</span> ${w.low ? '<span class="badge b-low">Low</span>' : ''}</td>
    <td class="num ${w.available < 0 ? 'muted' : ''}">${money(w.available)}</td></tr>`;
  const agentShares = d.shares.filter((s) => s.id).reduce((sum, s) => sum + s.total, 0); // agents and the owner personally
  const pct = Math.min(100, (d.vat.taxable / d.vat.mandatory) * 100);
  const over = d.vat.taxable >= d.vat.mandatory;
  const vol = d.vat.taxable >= d.vat.voluntary;
  const vatCard = `<div class="card"><div class="hd"><h3>VAT registration tracker</h3><a href="#/reports?tab=vat" class="small">Details</a></div><div class="bd stack" style="gap:10px">
    <div class="row between"><span>Taxable service income, last 12 months</span><b>AED ${money(d.vat.taxable)}</b></div>
    <div class="progress ${pct >= 80 ? 'hot' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="row between small muted"><span>0</span><span>Voluntary 187,500</span><span>Mandatory 375,000</span></div>
    <div class="${over ? 'err' : vol ? 'warn' : 'note'}">${over
      ? 'You have crossed the AED 375,000 mandatory threshold — VAT registration is required. Register with the FTA, then turn on VAT in Settings.'
      : vol ? `Eligible for voluntary VAT registration. AED ${money(d.vat.mandatory - d.vat.taxable)} left before registration becomes mandatory.`
        : `AED ${money(d.vat.mandatory - d.vat.taxable)} left before VAT registration becomes mandatory.`}</div>
  </div></div>`;

  $('#view').innerHTML = `<div class="stack">${today}
    <div class="grid g4">
      ${stat('Sales this month', d.month.total, `${d.month.invoices} invoices`)}
      ${stat('Service profit this month', d.month.profit, 'Service charges after discount')}
      ${stat('Personal shares this month', agentShares, 'Agents + owner · <a href="#/reports">Profit share report</a>')}
      ${stat('Company net this month', d.month.profit - agentShares - d.expensesMonth, `After agents' shares and AED ${money(d.expensesMonth)} expenses`)}
    </div>
    <div class="grid g2">
      <div class="card"><div class="hd"><h3>Govt fee wallets &amp; cards</h3><a class="small" href="#/wallets">Top up / manage</a></div>
        <div class="bd flush">${fee.length ? `<table class="t"><thead><tr><th>Wallet / card</th><th class="num">Available (AED)</th></tr></thead><tbody>${fee.map(walletRow).join('')}</tbody></table>` : '<div class="empty">No wallets yet. <a href="#/wallets">Add your cards &amp; e-wallets</a></div>'}
        ${cashBank.length ? `<table class="t"><thead><tr><th>Cash &amp; bank</th><th class="num">Balance (AED)</th></tr></thead><tbody>${cashBank.map(walletRow).join('')}</tbody></table>` : ''}</div></div>
      <div class="card"><div class="hd"><h3>Profit share — this month</h3><a class="small" href="#/agents">Agent accounts</a></div><div class="bd flush">
        ${d.shares.length ? `<table class="t"><thead><tr><th>Person</th><th class="num">Clients brought</th><th class="num">Jobs done</th><th class="num">Share</th></tr></thead><tbody>
          ${d.shares.map((a) => `<tr ${a.id ? `class="click" data-go="#/agents/${a.id}"` : ''}><td><b>${esc(a.name)}</b></td><td class="num">${a.id ? a.brought : ''}</td><td class="num">${a.id ? a.jobs : ''}</td><td class="num"><b>${money(a.total)}</b></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No sales this month yet</div>'}
        <div class="bd small row between" style="border-top:1px solid var(--line)"><span>Agents hold for company: <b style="color:var(--red)">AED ${money(d.agentsOwe)}</b></span><span>Company owes (agents &amp; owner): <b>AED ${money(d.companyOwes)}</b></span></div>
      </div></div>
    </div>
    <div class="grid g2">${recentCard(d.recent)}${vatCard}</div>
  </div>`;
  $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
}

function recentCard(rows) {
  return `<div class="card"><div class="hd"><h3>Recent invoices</h3><a class="small" href="#/invoices">View all</a></div><div class="bd flush">
    ${rows.length ? `<table class="t"><tbody>${rows.map((r) => `<tr class="click" data-go="#/invoices/${r.id}">
      <td><b>${esc(r.number || 'Draft')}</b><div class="sub">${esc(r.customer_name)}</div></td>
      <td class="sub">${fmtDate(r.date)}<div>${esc(r.agent_name)}</div></td>
      <td class="num"><b>${money(r.total)}</b><div>${statusBadge(r)}</div></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No invoices yet. <a href="#/invoices/new">Create the first one</a></div>'}</div></div>`;
}

// ---------- invoices list ----------
async function Invoices(params, query, ctx) {
  setTitle('Invoices', '<button class="btn" id="csv">Export CSV</button>');
  const from = query.from ?? '', to = query.to ?? '';
  const [rows, users] = await Promise.all([
    api('/invoices' + qs({ ...query })),
    isOwner() ? api('/users') : Promise.resolve([]),
  ]);
  if (stale(ctx)) return;
  const sum = (k) => rows.filter((r) => r.status === 'issued').reduce((s, r) => s + r[k], 0);
  const profit = rows.filter((r) => r.status === 'issued').reduce((s, r) => s + r.service_total - r.discount, 0);
  $('#view').innerHTML = `
    <form class="filters" id="flt">
      ${field('Search', 'q', { value: query.q, placeholder: 'Invoice no., customer, phone, applicant, ref…', cls: 'grow' })}
      ${selectField('Status', 'status', [['', 'All'], ['issued', 'Issued'], ['unpaid', 'Unpaid / partial'], ['draft', 'Drafts'], ['void', 'Void']], query.status)}
      ${isOwner() ? selectField('Agent', 'agent_id', [['', 'All agents'], ...users.map((u) => [u.id, u.name])], query.agent_id) : ''}
      ${rangeInputs(from, to)}
      ${query.customer_id ? `<input type="hidden" name="customer_id" value="${esc(query.customer_id)}">` : ''}
    </form>
    <div class="card"><div class="bd flush table-wrap">
      ${rows.length ? `<table class="t" id="tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Agent</th><th class="num">Govt fees</th><th class="num">Profit</th><th class="num">Total</th><th class="num">Due</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="click" data-go="#/invoices/${r.id}">
        <td><b>${esc(r.number || 'Draft #' + r.id)}</b></td><td class="nowrap">${fmtDate(r.date)}</td>
        <td>${esc(r.customer_name)}<div class="sub">${esc(r.customer_phone || '')}</div></td><td>${esc(r.agent_name)}</td>
        <td class="num">${money(r.govt_total)}</td><td class="num">${money(r.service_total - r.discount)}</td>
        <td class="num"><b>${money(r.total)}</b></td><td class="num">${r.due > 0 ? `<span style="color:var(--red)">${money(r.due)}</span>` : '—'}</td><td>${statusBadge(r)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">${rows.length} invoice(s)${rows.length >= 300 ? ' — showing latest 300, narrow the dates to see more' : ''} · totals exclude drafts &amp; void</td>
        <td class="num">${money(sum('govt_total'))}</td><td class="num">${money(profit)}</td><td class="num">${money(sum('total'))}</td><td class="num">${money(sum('due'))}</td><td></td></tr></tfoot></table>`
      : '<div class="empty">No invoices match these filters</div>'}
    </div></div>`;
  bindFilters($('#flt'), '#/invoices');
  $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
  $('#csv').addEventListener('click', () => $('#tbl') && exportCSV($('#tbl'), 'invoices'));
}

// ---------- invoice editor ----------
async function InvoiceEditor(params, query, ctx) {
  const editing = !!params.id;
  setTitle(editing ? 'Edit invoice' : 'New invoice');
  const [services, accounts, users, inv] = await Promise.all([
    api('/services'), api('/accounts'), api('/users'),
    editing ? api('/invoices/' + params.id) : Promise.resolve(null),
  ]);
  if (stale(ctx)) return;
  if (inv?.status === 'void') { $('#view').innerHTML = '<div class="err">This invoice is void and cannot be edited.</div>'; return; }
  const isIssued = inv?.status === 'issued';
  if (isIssued) setTitle(`Edit ${inv.number}`);

  const svcByName = new Map(services.map((s) => [s.name.trim().toLowerCase(), s]));
  const feeAccounts = accounts.filter((a) => ['wallet', 'card'].includes(a.type));
  const recvAccounts = accounts.filter((a) => ['cash', 'bank'].includes(a.type));
  const nameOf = (id) => users.find((u) => u.id === id)?.name || 'Agent';
  const st = {
    customer: inv ? { id: inv.customer_id, name: inv.customer_name, phone: inv.customer_phone } : null,
    agent_id: inv?.agent_id || S.me.id,
    source_id: inv?.source_id || '',
    sourceTouched: !!inv,
    items: inv ? inv.items.map((it) => ({
      service_id: it.service_id, name: it.name, description: it.description || '', ref_no: it.ref_no || '', qty: it.qty,
      govt_fee: it.govt_fee, service_fee: it.service_fee, account_id: it.account_id, worker_id: it.worker_id || inv.agent_id, share_rule: it.share_rule || 'standard',
    })) : [],
    discount: inv?.discount || 0,
    payTouched: false,
  };
  const blank = () => ({ service_id: null, name: '', description: '', ref_no: '', qty: 1, govt_fee: 0, service_fee: 0, account_id: feeAccounts[0]?.id || null, worker_id: st.agent_id, share_rule: 'standard' });
  if (!inv) st.items.push(blank());
  if (!inv && query.customer) {
    try {
      const c = await api('/customers/' + query.customer);
      st.customer = { id: c.id, name: c.name, phone: c.phone };
      st.source_id = c.agent_id || '';
    } catch { /* ignore */ }
  }
  // When editing an issued invoice, its own deductions are given back before checking wallet funds.
  const alreadyDeducted = new Map();
  if (isIssued) for (const it of inv.items) if (it.account_id) alreadyDeducted.set(it.account_id, (alreadyDeducted.get(it.account_id) || 0) + it.govt_fee * it.qty);
  const vatRate = isIssued ? inv.vat_rate : S.settings.vat_enabled === '1' ? Number(S.settings.vat_rate) || 0 : 0;

  const opts = (list, selected) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const walletSelect = (selected) => `<option value="">— not needed —</option>
    ${feeAccounts.length ? `<optgroup label="Govt fee wallets / cards">${feeAccounts.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}${a.available != null ? ` (${money(a.available + (alreadyDeducted.get(a.id) || 0))})` : ''}</option>`).join('')}</optgroup>` : ''}
    ${recvAccounts.length ? `<optgroup label="Cash / bank">${recvAccounts.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}`;

  const rowHtml = (it, i) => `<div class="item-row" data-i="${i}">
    <div class="l1">
      <span class="idx">${i + 1}</span>
      <input data-k="name" list="svc-list" value="${esc(it.name)}" placeholder="Type to search services…" autocomplete="off">
      <input data-k="description" value="${esc(it.description)}" placeholder="Applicant name / details">
      <input data-k="ref_no" value="${esc(it.ref_no)}" placeholder="Application / ref no.">
      <input data-k="qty" type="number" min="1" step="1" value="${it.qty}" class="money" title="Quantity">
      <button type="button" class="x" data-remove title="Remove line">×</button>
    </div>
    <div class="l2">
      <span></span>
      <label class="mini">Govt fee<input data-k="govt_fee" type="number" min="0" step="0.01" value="${fixed(it.govt_fee)}" class="money" inputmode="decimal"></label>
      <label class="mini">Govt fee paid from<select data-k="account_id">${walletSelect(it.account_id)}</select></label>
      <label class="mini">Service fee<input data-k="service_fee" type="number" min="0" step="0.01" value="${fixed(it.service_fee)}" class="money" inputmode="decimal"></label>
      <label class="mini">Done by<select data-k="worker_id">${opts(userOptions(users, { keep: it.worker_id }), it.worker_id)}</select></label>
      <label class="mini">Profit<select data-k="share_rule" ${isOwner() ? '' : 'disabled title="Set by the owner on the service"'}>${opts(Object.entries(RULE_LABEL), it.share_rule)}</select></label>
      <div class="line-total"><span class="mini">Customer pays</span><b data-total>${money((it.govt_fee + it.service_fee) * it.qty)}</b></div>
      <span></span>
    </div>
  </div>`;

  $('#view').innerHTML = `
    <datalist id="svc-list">${services.map((s) => `<option value="${esc(s.name)}" label="${esc(`${s.category ? s.category + ' · ' : ''}AED ${money(s.govt_fee + s.service_fee)}`)}"></option>`).join('')}</datalist>
    ${isIssued ? '<div class="warn" style="margin-bottom:14px">You are editing an issued invoice. Wallet deductions and profit shares will be re-posted to match your changes.</div>' : ''}
    ${!feeAccounts.length ? `<div class="warn" style="margin-bottom:14px">No govt-fee wallets or cards set up yet. ${isOwner() ? '<a href="#/wallets">Add them under Wallets &amp; accounts</a>.' : 'Ask the owner to add them.'}</div>` : ''}
    <div class="inv-layout">
      <div class="stack">
        <div class="card"><div class="bd"><div class="form-grid">
          <div class="full"><label class="f" style="margin-bottom:5px">Customer *</label><div id="cust"></div></div>
          <label class="f">Invoice date<input type="date" id="inv-date" value="${esc(inv?.date || S.today)}"></label>
          ${isOwner() ? `<label class="f">Prepared by<select id="inv-agent">${opts(userOptions(users, { keep: st.agent_id }), st.agent_id)}</select></label>`
            : `<label class="f">Prepared by<input disabled value="${esc(S.me.name)}"></label>`}
          <label class="f full">Client brought by<select id="inv-source">${opts(userOptions(users, { none: 'Walk-in — nobody brought this client', keep: st.source_id }), st.source_id)}</select><span class="hint" id="source-hint"></span></label>
        </div></div></div>
        <div class="card">
          <div class="hd"><h3>Services</h3><span class="hint">Govt fee is paid from the chosen wallet/card. Service fee is the profit that gets shared.</span></div>
          <div class="items-scroll"><div>
            <div class="items-head" style="padding-top:12px"><span>#</span><span>Service</span><span>Applicant / details</span><span>Ref no.</span><span class="num">Qty</span><span></span></div>
            <div id="items"></div>
          </div></div>
          <div class="bd" style="border-top:1px solid var(--line)"><button type="button" class="btn" id="add-item">${icon('plus')} Add service</button></div>
        </div>
        <div class="card"><div class="bd"><label class="f">Notes <span class="hint">Printed on the customer invoice</span><textarea id="inv-notes">${esc(inv?.notes || '')}</textarea></label></div></div>
      </div>
      <div class="inv-side stack">
        <div class="card"><div class="hd"><h3>Summary</h3></div><div class="bd">
          <table class="sum">
            <tr><td>Government fees</td><td id="s-govt"></td></tr>
            <tr><td>Service charges</td><td id="s-svc"></td></tr>
            <tr><td>Discount <span class="hint">(on service charges)</span></td><td style="width:110px"><input id="inv-discount" type="number" min="0" step="0.01" class="money" value="${fixed(st.discount)}"></td></tr>
            ${vatRate > 0 ? `<tr><td>VAT ${vatRate}% <span class="hint">(service charges only)</span></td><td id="s-vat"></td></tr>` : ''}
            <tr class="grand"><td>Customer pays</td><td id="s-total"></td></tr>
            <tr class="profit"><td>Profit to share</td><td id="s-profit"></td></tr>
          </table>
          <div style="margin-top:12px"><div class="mini-h">Profit sharing</div><div id="share-preview"></div></div>
          <div id="wallet-check" style="margin-top:10px"></div>
          <p class="hint" style="margin:10px 0 0">The customer invoice shows one amount per service (govt fee + service charge combined).</p>
        </div></div>
        ${!isIssued ? `<div class="card"><div class="hd"><h3>Payment received now</h3></div><div class="bd"><div class="form-grid" id="pay">
          ${moneyField('Amount (AED)', 'amount', null, { attrs: 'id="pay-amount"' })}
          ${selectField('Method', 'method', Object.entries(METHOD_LABEL), 'cash', { attrs: 'id="pay-method"' })}
          <label class="f full">Received into<select id="pay-account">${receiveOptions(recvAccounts, users, defaultReceive(recvAccounts, 'cash'))}</select></label>
          ${field('Reference', 'reference', { attrs: 'id="pay-ref"', placeholder: 'Optional', cls: 'full' })}
        </div><p class="hint" style="margin:8px 0 0">Set 0 if the customer will pay later.</p></div></div>` : ''}
        <div class="card"><div class="bd stack" style="gap:8px">
          <div class="err hidden" id="inv-err"></div>
          ${isIssued ? '<button class="btn primary" id="btn-issue">Save changes</button>'
            : `<button class="btn primary" id="btn-issue">Issue invoice</button><button class="btn" id="btn-draft">Save as draft</button>`}
          <a class="btn" href="${editing ? '#/invoices/' + inv.id : '#/invoices'}">Cancel</a>
        </div></div>
      </div>
    </div>`;

  const itemsEl = $('#items');
  const renderItems = () => { itemsEl.innerHTML = st.items.map(rowHtml).join(''); };
  const sourceHint = () => {
    $('#source-hint').textContent = st.source_id
      ? 'Who brought the client gets ⅓ (owner, sales & commission agents). Who did the work gets ⅓ only if the owner or a commission agent. The rest goes to the company.'
      : 'Walk-in: the owner or a commission agent who does the work gets 50%. Otherwise all profit goes to the company.';
  };

  function recalc() {
    const govt = st.items.reduce((s, it) => s + it.govt_fee * it.qty, 0);
    const svc = st.items.reduce((s, it) => s + it.service_fee * it.qty, 0);
    const discount = Math.min(Math.max(0, st.discount), svc);
    const vat = Math.round(((svc - discount) * vatRate) / 100);
    const total = govt + svc - discount + vat;
    $('#s-govt').textContent = money(govt);
    $('#s-svc').textContent = money(svc);
    if ($('#s-vat')) $('#s-vat').textContent = money(vat);
    $('#s-total').textContent = 'AED ' + money(total);
    $('#s-profit').textContent = money(svc - discount);
    $('#share-preview').innerHTML = sharesTable(groupShares(splitShares(st.items, discount, Number(st.source_id) || null, earnsFor(users)), nameOf));
    const need = new Map();
    for (const it of st.items) if (it.account_id && it.govt_fee > 0) need.set(it.account_id, (need.get(it.account_id) || 0) + it.govt_fee * it.qty);
    $('#wallet-check').innerHTML = [...need].map(([id, amt]) => {
      const a = accounts.find((x) => x.id === id);
      if (!a) return '';
      const avail = a.available == null ? null : a.available + (alreadyDeducted.get(id) || 0);
      const bad = avail != null && amt > avail;
      return `<div class="wallet-check ${bad ? 'bad' : ''}"><span>${esc(a.name)}</span><span>needs <b>${money(amt)}</b>${avail != null ? ` · avail ${money(avail)}` : ''}</span></div>`;
    }).join('');
    if (!st.payTouched && $('#pay-amount')) $('#pay-amount').value = fixed(total);
    return total;
  }

  function applyService(row, it, svc) {
    it.service_id = svc.id;
    it.govt_fee = svc.govt_fee;
    it.service_fee = svc.service_fee;
    it.account_id = svc.account_id || (svc.govt_fee ? it.account_id : null);
    it.share_rule = svc.share_rule || 'standard';
    $('[data-k=govt_fee]', row).value = fixed(it.govt_fee);
    $('[data-k=service_fee]', row).value = fixed(it.service_fee);
    $('[data-k=account_id]', row).value = it.account_id ?? '';
    $('[data-k=share_rule]', row).value = it.share_rule;
  }

  itemsEl.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    const row = e.target.closest('.item-row');
    if (!k || !row) return;
    const it = st.items[Number(row.dataset.i)];
    const v = e.target.value;
    if (k === 'govt_fee' || k === 'service_fee') it[k] = Math.max(0, toFils(v));
    else if (k === 'qty') it.qty = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'account_id' || k === 'worker_id') it[k] = Number(v) || null;
    else it[k] = v;
    if (k === 'name') {
      const svc = svcByName.get(v.trim().toLowerCase());
      if (svc && it.service_id !== svc.id) applyService(row, it, svc);
      else if (!svc) it.service_id = null;
    }
    $('[data-total]', row).textContent = money((it.govt_fee + it.service_fee) * it.qty);
    recalc();
  });
  itemsEl.addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove]')) return;
    st.items.splice(Number(e.target.closest('.item-row').dataset.i), 1);
    if (!st.items.length) st.items.push(blank());
    renderItems();
    recalc();
  });
  $('#add-item').addEventListener('click', () => {
    st.items.push(blank());
    renderItems();
    recalc();
    $$('[data-k=name]', itemsEl).pop().focus();
  });
  $('#inv-discount').addEventListener('input', (e) => { st.discount = toFils(e.target.value); recalc(); });
  $('#inv-source').addEventListener('change', (e) => { st.source_id = e.target.value; st.sourceTouched = true; sourceHint(); recalc(); });
  // Lines done by the previous preparer move to the new one.
  $('#inv-agent')?.addEventListener('change', (e) => {
    const old = st.agent_id;
    st.agent_id = Number(e.target.value);
    st.items.forEach((it) => { if (it.worker_id === old) it.worker_id = st.agent_id; });
    renderItems();
    recalc();
  });
  $('#pay-amount')?.addEventListener('input', () => { st.payTouched = true; });
  $('#pay-method')?.addEventListener('change', (e) => { const v = defaultReceive(recvAccounts, e.target.value); if (v) $('#pay-account').value = v; });

  // Customer picker
  function renderCustomer() {
    const el = $('#cust');
    if (st.customer) {
      el.innerHTML = `<div class="chip"><div><b>${esc(st.customer.name)}</b> <span class="muted">${esc(st.customer.phone || '')}</span></div><button type="button" class="btn sm" id="cust-change">Change</button></div>`;
      $('#cust-change').addEventListener('click', () => { st.customer = null; renderCustomer(); $('#cust-q').focus(); });
      return;
    }
    el.innerHTML = `<div class="row" style="flex-wrap:nowrap"><div class="combo" style="flex:1"><input id="cust-q" placeholder="Search name, mobile, Emirates ID or company…" autocomplete="off"><div class="dd hidden"></div></div>
      <button type="button" class="btn" id="cust-walkin">Walk-in</button><button type="button" class="btn" id="cust-new">+ New</button></div>`;
    const input = $('#cust-q'), dd = $('.dd', el);
    let results = [], on = -1;
    const pick = (c) => {
      st.customer = { id: c.id, name: c.name, phone: c.phone };
      if (!st.sourceTouched) { st.source_id = c.agent_id || ''; $('#inv-source').value = st.source_id; sourceHint(); recalc(); }
      renderCustomer();
    };
    const newCust = () => {
      const q = input.value.trim();
      customerModal(null, pick, /^[\d+\s-]{5,}$/.test(q) ? { phone: q } : { name: q }, users);
    };
    const draw = () => {
      dd.innerHTML = results.map((c, i) => `<div data-i="${i}" class="${i === on ? 'on' : ''}"><b>${esc(c.name)}</b> <span class="muted small">${esc([c.phone, c.company, c.emirates_id, c.agent_name && `client of ${c.agent_name}`].filter(Boolean).join(' · '))}</span></div>`).join('')
        + `<div data-new="1" class="${on === results.length ? 'on' : ''}">+ Add new customer${input.value.trim() ? ` “${esc(input.value.trim())}”` : ''}</div>`;
      dd.classList.remove('hidden');
    };
    const search = debounce(async () => {
      results = await api('/customers' + qs({ q: input.value.trim(), limit: 8 }));
      on = results.length ? 0 : -1;
      draw();
    });
    input.addEventListener('input', search);
    input.addEventListener('focus', search);
    input.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 180));
    input.addEventListener('keydown', (e) => {
      if (dd.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { on = Math.min(results.length, on + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter') { e.preventDefault(); if (on >= 0 && on < results.length) pick(results[on]); else newCust(); }
    });
    dd.addEventListener('mousedown', (e) => {
      const d = e.target.closest('div[data-i],div[data-new]');
      if (!d) return;
      e.preventDefault();
      if (d.dataset.new) newCust(); else pick(results[Number(d.dataset.i)]);
    });
    $('#cust-new').addEventListener('click', newCust);
    $('#cust-walkin').addEventListener('click', async () => {
      const r = await api('/customers' + qs({ q: 'Walk-in Customer', limit: 1 }));
      if (r[0]) pick(r[0]); else toast('No walk-in customer found', 'error');
    });
  }

  async function save(issue) {
    const err = $('#inv-err');
    err.classList.add('hidden');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (!st.customer) return fail('Choose a customer first');
    const items = st.items.filter((it) => it.name.trim() || it.govt_fee || it.service_fee);
    if (!items.length) return fail('Add at least one service');
    const body = {
      customer_id: st.customer.id, date: $('#inv-date').value, agent_id: st.agent_id, source_id: st.source_id || null,
      discount: st.discount, notes: $('#inv-notes').value, items, issue,
    };
    if (issue && !isIssued) {
      const amount = toFils($('#pay-amount').value);
      if (amount > 0) body.payment = { amount, method: $('#pay-method').value, account_id: $('#pay-account').value, reference: $('#pay-ref').value };
    }
    $$('#btn-issue,#btn-draft').forEach((b) => { b.disabled = true; });
    try {
      const r = editing ? await api('/invoices/' + inv.id, { method: 'PUT', body }) : await api('/invoices', { method: 'POST', body });
      toast(issue ? (isIssued ? 'Invoice updated' : 'Invoice issued') : 'Draft saved');
      location.hash = `#/invoices/${r.id}`;
    } catch (ex) { fail(ex.message); } finally { $$('#btn-issue,#btn-draft').forEach((b) => { b.disabled = false; }); }
  }
  $('#btn-issue').addEventListener('click', () => save(true));
  $('#btn-draft')?.addEventListener('click', () => save(false));

  renderItems();
  renderCustomer();
  sourceHint();
  recalc();
  if (!st.customer) $('#cust-q')?.focus();
}

// ---------- invoice view ----------
async function InvoiceView(params, query, ctx) {
  const [inv, accounts, users] = await Promise.all([api('/invoices/' + params.id), api('/accounts'), api('/users')]);
  if (stale(ctx)) return;
  const issued = inv.status === 'issued';
  const canEdit = inv.status === 'draft' || (issued && isOwner());
  setTitle(inv.number || `Draft invoice #${inv.id}`, `
    <a class="btn" target="_blank" href="/print/invoice/${inv.id}">${icon('print')}<span class="hide-sm">Print A4</span></a>
    <a class="btn" target="_blank" href="/print/invoice/${inv.id}?format=thermal"><span>80mm receipt</span></a>`);
  const shareGroups = groupShares(inv.shares, (id) => inv.shares.find((s) => s.user_id === id)?.name || 'Agent');
  $('#view').innerHTML = `
    <div class="row" style="margin-bottom:14px">
      ${statusBadge(inv)}
      ${inv.status === 'void' ? `<span class="muted">Voided: ${esc(inv.void_reason || '')}</span>` : ''}
      <span class="spacer"></span>
      ${issued && inv.due > 0 ? '<button class="btn primary" id="pay">Record payment</button>' : ''}
      ${inv.status === 'draft' ? '<button class="btn primary" id="issue">Issue invoice</button>' : ''}
      ${canEdit ? `<a class="btn" href="#/invoices/${inv.id}/edit">Edit</a>` : ''}
      ${inv.status === 'draft' ? '<button class="btn danger" id="del">Delete draft</button>' : ''}
      ${issued && isOwner() ? '<button class="btn danger" id="void">Void</button>' : ''}
    </div>
    <div class="inv-layout">
      <div class="stack">
        <div class="card"><div class="bd grid g4">
          <div><div class="muted small">Customer</div>${inv.can_see_customer ? `<a href="#/customers/${inv.customer_id}"><b>${esc(inv.customer_name)}</b></a>` : `<b>${esc(inv.customer_name)}</b>`}<div class="small muted">${esc([inv.customer_phone, inv.customer_company, inv.customer_eid].filter(Boolean).join(' · '))}</div></div>
          <div><div class="muted small">Date</div><b>${fmtDate(inv.date)}</b></div>
          <div><div class="muted small">Prepared by</div><b>${esc(inv.agent_name)}</b></div>
          <div><div class="muted small">Client brought by</div><b>${esc(inv.source_name || 'Walk-in')}</b></div>
        </div></div>
        <div class="card"><div class="hd"><h3>Services — internal breakdown</h3><span class="hint">Customer copy shows only the combined amount</span></div><div class="bd flush table-wrap">
          <table class="t"><thead><tr><th>#</th><th>Service</th><th>Applicant / ref</th><th class="num">Qty</th><th class="num">Govt fee</th><th>Paid from</th><th class="num">Service fee</th><th>Done by</th><th class="num">Customer pays</th></tr></thead>
          <tbody>${inv.items.map((it, i) => `<tr><td>${i + 1}</td><td><b>${esc(it.name)}</b>${it.share_rule === 'company' ? ' <span class="badge b-type">Company 100%</span>' : ''}</td><td>${esc(it.description || '')}<div class="sub">${esc(it.ref_no || '')}</div></td>
            <td class="num">${it.qty}</td><td class="num">${money(it.govt_fee * it.qty)}</td><td class="sub">${esc(it.account_name || '—')}</td>
            <td class="num">${money(it.service_fee * it.qty)}</td><td>${esc(it.worker_name || '')}</td><td class="num"><b>${money((it.govt_fee + it.service_fee) * it.qty)}</b></td></tr>`).join('')}</tbody></table>
        </div></div>
        ${inv.notes ? `<div class="card"><div class="bd"><div class="muted small">Notes</div>${esc(inv.notes)}</div></div>` : ''}
      </div>
      <div class="inv-side stack">
        <div class="card"><div class="hd"><h3>Summary</h3></div><div class="bd"><table class="sum">
          <tr><td>Government fees</td><td>${money(inv.govt_total)}</td></tr>
          <tr><td>Service charges</td><td>${money(inv.service_total)}</td></tr>
          ${inv.discount ? `<tr><td>Discount</td><td>-${money(inv.discount)}</td></tr>` : ''}
          ${inv.vat_rate > 0 ? `<tr><td>VAT ${inv.vat_rate}%</td><td>${money(inv.vat_amount)}</td></tr>` : ''}
          <tr class="grand"><td>Total</td><td>AED ${money(inv.total)}</td></tr>
          ${issued ? `<tr><td>Paid</td><td>${money(inv.paid)}</td></tr><tr><td><b>Balance due</b></td><td style="color:${inv.due > 0 ? 'var(--red)' : 'inherit'}">${money(inv.due)}</td></tr>` : ''}
          <tr class="profit"><td>Profit</td><td>${money(inv.profit)}</td></tr>
        </table></div></div>
        <div class="card"><div class="hd"><h3>Profit sharing</h3>${issued && inv.due > 0 ? '<span class="hint">Paid out once fully paid</span>' : ''}</div><div class="bd">
          ${issued ? sharesTable(shareGroups) : `<span class="muted small">${inv.status === 'draft' ? 'Shared when the invoice is issued' : 'Void — no shares'}</span>`}
        </div></div>
        <div class="card"><div class="hd"><h3>Payments</h3></div><div class="bd flush">
          ${inv.payments.length ? `<table class="t"><tbody>${inv.payments.map((p) => `<tr><td>${fmtDate(p.date)}<div class="sub">${METHOD_LABEL[p.method]} → ${p.held_by ? `kept by ${esc(p.held_by_name)}` : esc(p.account_name)}${p.reference ? ' · ' + esc(p.reference) : ''}<br>by ${esc(p.received_by_name || '')}</div></td>
            <td class="num"><b style="color:${p.amount < 0 ? 'var(--red)' : 'inherit'}">${money(p.amount)}</b>${isOwner() ? `<div><button class="btn link small" data-delpay="${p.id}">Remove</button></div>` : ''}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">No payments yet</div>'}
        </div></div>
      </div>
    </div>`;

  $('#pay')?.addEventListener('click', () => {
    const m = modal({
      title: `Record payment — ${inv.number}`,
      body: `<div class="note">Balance due: <b>AED ${money(inv.due)}</b></div>${paymentFields(accounts, users, { amount: inv.due })}`,
      onSubmit: async (d) => {
        await api(`/invoices/${inv.id}/payments`, { method: 'POST', body: { ...d, amount: toFils(d.amount) } });
        toast('Payment recorded');
        router();
      },
    });
    bindPaymentMethod(m.form, accounts);
  });
  $('#issue')?.addEventListener('click', () => {
    const m = modal({
      title: 'Issue invoice',
      submit: 'Issue invoice',
      body: `<div class="note">Issuing assigns an invoice number, deducts the government fees from the selected wallets/cards and splits the profit. Total: <b>AED ${money(inv.total)}</b></div>
        <p class="hint" style="margin:0">Payment received now (set 0 if paying later):</p>${paymentFields(accounts, users, { amount: inv.total })}`,
      onSubmit: async (d) => {
        const amount = toFils(d.amount);
        await api(`/invoices/${inv.id}/issue`, { method: 'POST', body: { payment: amount > 0 ? { ...d, amount } : null } });
        toast('Invoice issued');
        router();
      },
    });
    m.form.elements.amount.required = false;
    bindPaymentMethod(m.form, accounts);
  });
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete draft', 'Delete this draft invoice? This cannot be undone.', 'Delete'))) return;
    await api('/invoices/' + inv.id, { method: 'DELETE' });
    toast('Draft deleted');
    location.hash = '#/invoices';
  });
  $('#void')?.addEventListener('click', () => modal({
    title: `Void ${inv.number}`,
    submit: 'Void invoice',
    danger: true,
    body: `${field('Reason *', 'reason', { required: true, placeholder: 'e.g. Application rejected, customer cancelled' })}
      <label class="f check"><input type="checkbox" name="refund_wallets" checked> Return government fees to the wallets/cards</label>
      <p class="hint" style="margin:-6px 0 0 24px">Untick if the fee was already used and the government will not refund it.</p>
      <label class="f check"><input type="checkbox" name="refund_payments" ${inv.paid > 0 ? 'checked' : ''}> Refund the AED ${money(inv.paid)} paid back to the customer</label>
      <p class="hint" style="margin:-6px 0 0 24px">Profit shares on this invoice are cancelled.</p>`,
    onSubmit: async (d) => {
      await api(`/invoices/${inv.id}/void`, { method: 'POST', body: d });
      toast('Invoice voided');
      router();
    },
  }));
  $$('[data-delpay]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Remove payment', 'Remove this payment? The money will be taken out of the account (or agent) it was recorded against.', 'Remove'))) return;
    await api('/payments/' + b.dataset.delpay, { method: 'DELETE' });
    toast('Payment removed');
    router();
  }));
}

// ---------- customers ----------
async function Customers(params, query, ctx) {
  setTitle(isOwner() ? 'Customers' : 'My customers', '<button class="btn" id="add-cust">+ New customer</button>');
  const [rows, users] = await Promise.all([api('/customers' + qs({ q: query.q, limit: 500 })), api('/users')]);
  if (stale(ctx)) return;
  $('#view').innerHTML = `
    ${isOwner() ? '' : '<div class="note" style="margin-bottom:14px">These are the customers you added or brought in, plus shared ones like Walk-in. Other agents cannot see your customers, and you cannot see theirs.</div>'}
    <form class="filters" id="flt">${field('Search', 'q', { value: query.q, placeholder: 'Name, mobile, Emirates ID, company, email…', cls: 'grow' })}<button class="btn">Search</button></form>
    <div class="card"><div class="bd flush table-wrap">${rows.length ? `<table class="t" id="tbl"><thead><tr><th>Customer</th><th>Mobile</th><th>Emirates ID</th><th>Client of</th>${isOwner() ? '<th>Added by</th>' : ''}<th class="num">Invoices</th><th class="num">Balance due</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="click" data-go="#/customers/${c.id}"><td><b>${esc(c.name)}</b> ${c.shared ? '<span class="badge b-owner">Shared</span>' : ''}<div class="sub">${esc(c.company || '')}</div></td><td>${esc(c.phone || '')}</td><td>${esc(c.emirates_id || '')}</td>
        <td>${c.agent_name ? esc(c.agent_name) : '<span class="muted">Walk-in</span>'}</td>${isOwner() ? `<td class="sub">${esc(c.created_by_name || '')}</td>` : ''}
        <td class="num">${c.invoices}</td><td class="num">${c.balance > 0 ? `<b style="color:var(--red)">${money(c.balance)}</b>` : '—'}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No customers found</div>'}</div></div>`;
  bindFilters($('#flt'), '#/customers');
  $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
  $('#add-cust').addEventListener('click', () => customerModal(null, (c) => { location.hash = '#/customers/' + c.id; }, {}, users));
}

async function CustomerView(params, query, ctx) {
  const [c, users] = await Promise.all([api('/customers/' + params.id), api('/users')]);
  if (stale(ctx)) return;
  setTitle(c.name, `<button class="btn" id="edit">Edit</button><a class="btn" href="#/invoices/new?customer=${c.id}">New invoice for customer</a>`);
  const info = [['Mobile', c.phone], ['Email', c.email], ['Emirates ID', c.emirates_id], ['Company', c.company], ['Trade licence', c.trade_license], ['Client of', c.agent_name || 'Walk-in'],
    ['Added by', isOwner() && c.created_by_name], ['Visible to', isOwner() && (c.shared ? 'All agents' : 'Only the agent who added / brought them')]].filter(([, v]) => v);
  $('#view').innerHTML = `<div class="stack">
    <div class="grid g3">
      <div class="card stat"><div class="k">Total billed</div><div class="v"><small>AED</small>${money(c.totals.billed)}</div><div class="s">${c.totals.n} issued invoices</div></div>
      <div class="card stat"><div class="k">Balance due</div><div class="v" style="color:${c.balance > 0 ? 'var(--red)' : 'inherit'}"><small>AED</small>${money(c.balance)}</div></div>
      <div class="card"><div class="bd">${info.map(([k, v]) => `<div class="row between"><span class="muted">${k}</span><b>${esc(v)}</b></div>`).join('')}
        ${c.notes ? `<div class="small muted" style="margin-top:8px">${esc(c.notes)}</div>` : ''}</div></div>
    </div>
    <div class="card"><div class="hd"><h3>Invoices</h3></div><div class="bd flush table-wrap">${c.invoices.length ? `<table class="t"><thead><tr><th>Invoice</th><th>Date</th><th>Prepared by</th><th class="num">Total</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>
      ${c.invoices.map((i) => `<tr class="click" data-go="#/invoices/${i.id}"><td><b>${esc(i.number || 'Draft #' + i.id)}</b></td><td>${fmtDate(i.date)}</td><td>${esc(i.agent_name)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.paid)}</td><td>${statusBadge(i)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No invoices yet</div>'}</div></div>
  </div>`;
  $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
  $('#edit').addEventListener('click', () => customerModal(c, () => router(), {}, users));
}

// ---------- services ----------
async function Services(params, query, ctx) {
  setTitle('Services & fees', isOwner() ? '<button class="btn" id="add-svc">+ Add service</button>' : '');
  const [rows, accounts] = await Promise.all([api('/services' + (isOwner() ? '?all=1' : '')), api('/accounts')]);
  if (stale(ctx)) return;
  const groups = {};
  for (const s of rows) (groups[s.category || 'Other'] ||= []).push(s);
  $('#view').innerHTML = `<div class="note" style="margin-bottom:14px">Government fees change from time to time — keep them up to date here. Agents can still adjust fees on each invoice.
      <b>Profit</b>: “Shared” splits the service fee between the company and the agents; “Company 100%” (e.g. photocopy) keeps it all for the company.</div>
    <div class="card"><div class="bd flush table-wrap">${rows.length ? `<table class="t"><thead><tr><th>Service</th><th class="num">Govt fee</th><th class="num">Service fee</th><th class="num">Customer pays</th><th>Profit</th><th>Default wallet / card</th>${isOwner() ? '<th class="no-csv"></th>' : ''}</tr></thead>
    ${Object.entries(groups).map(([g, list]) => `<tbody><tr><td colspan="7" style="background:#f6f8fa;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)">${esc(g)}</td></tr>
      ${list.map((s) => `<tr style="${s.active ? '' : 'opacity:.5'}"><td><b>${esc(s.name)}</b>${s.active ? '' : ' <span class="badge b-draft">Inactive</span>'}</td><td class="num">${money(s.govt_fee)}</td><td class="num">${money(s.service_fee)}</td>
        <td class="num"><b>${money(s.govt_fee + s.service_fee)}</b></td><td>${s.share_rule === 'company' ? '<span class="badge b-owner">Company 100%</span>' : '<span class="badge b-agent">Shared</span>'}</td>
        <td class="sub">${esc(s.account_name || '—')}</td>${isOwner() ? `<td class="num"><button class="btn sm" data-edit="${s.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody>`).join('')}
    </table>` : `<div class="empty">No services yet.${isOwner() ? ' Add your price list so agents can bill quickly.' : ''}</div>`}</div></div>`;
  const cats = [...new Set(['Miscellaneous', 'Photocopy', ...rows.map((r) => r.category).filter(Boolean)])];
  const svcModal = (s) => modal({
    title: s ? 'Edit service' : 'Add service',
    body: `<datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist><div class="form-grid">
      ${field('Service name *', 'name', { value: s?.name, required: true, cls: 'full', placeholder: 'e.g. Emirates ID – Renewal (1 year)' })}
      ${field('Category', 'category', { value: s?.category, attrs: 'list="cat-list"', placeholder: 'e.g. Emirates ID, Visa, Miscellaneous' })}
      ${selectField('Default wallet / card for govt fee', 'account_id', accountOptions(accounts, { none: '— none —', types: ['wallet', 'card', 'bank', 'cash'] }), s?.account_id)}
      ${moneyField('Government fee (AED)', 'govt_fee', s?.govt_fee ?? 0)}
      ${moneyField('Service fee (AED)', 'service_fee', s?.service_fee ?? 0)}
      ${selectField('Profit', 'share_rule', [['standard', 'Shared — company, who brought the client, who did the work'], ['company', 'Company 100% — e.g. photocopy machine']], s?.share_rule || 'standard', { cls: 'full' })}
      ${s ? `<label class="f check full"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active (show in invoice service list)</label>` : ''}
    </div>`,
    onSubmit: async (d) => {
      const body = { ...d, govt_fee: toFils(d.govt_fee), service_fee: toFils(d.service_fee), active: s ? d.active : true };
      await api('/services' + (s ? '/' + s.id : ''), { method: s ? 'PUT' : 'POST', body });
      toast('Service saved');
      router();
    },
  });
  $('#add-svc')?.addEventListener('click', () => svcModal(null));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => svcModal(rows.find((r) => r.id === Number(b.dataset.edit)))));
}

// ---------- wallets & accounts ----------
async function Wallets(params, query, ctx) {
  if (!isOwner()) { location.hash = '#/me'; return; }
  setTitle(isOwner() ? 'Wallets & accounts' : 'Wallet balances', isOwner() ? '<button class="btn" id="add-acc">+ Add wallet / account</button>' : '');
  const accounts = await api('/accounts' + (isOwner() ? '?all=1' : ''));
  if (stale(ctx)) return;
  const card = (a) => {
    const isCard = a.type === 'card' && a.credit_limit > 0; // a card with no limit behaves like a prepaid debit card
    const pct = isCard ? Math.max(0, Math.min(100, (a.available / a.credit_limit) * 100)) : null;
    return `<div class="card wallet ${a.low ? 'low' : ''}" style="${a.active ? '' : 'opacity:.55'}">
      <div class="top"><div><div class="name">${esc(a.name)}</div><span class="badge b-type">${TYPE_LABEL[a.type]}</span> ${a.low ? '<span class="badge b-low">Low balance</span>' : ''} ${a.active ? '' : '<span class="badge b-draft">Inactive</span>'}</div></div>
      <div><div class="muted small">${isCard ? 'Available to spend' : 'Balance'}</div><div class="bal ${a.available < 0 ? 'neg' : ''}">AED ${money(isCard ? a.available : a.balance)}</div></div>
      ${isCard ? `<div class="meter"><i style="width:${pct ?? 0}%"></i></div><div class="small muted">Limit ${money(a.credit_limit)} · used ${money(Math.max(0, -a.balance))}</div>` : ''}
      ${a.low_alert ? `<div class="small muted">Alert below AED ${money(a.low_alert)}</div>` : ''}
      ${isOwner() ? `<div class="acts"><button class="btn sm primary" data-top="${a.id}">${isCard ? 'Pay card / top up' : 'Top up'}</button><a class="btn sm" href="#/wallets/${a.id}">Statement</a><button class="btn sm" data-adj="${a.id}">Adjust</button><button class="btn sm" data-edit="${a.id}">Edit</button></div>` : ''}
    </div>`;
  };
  const fee = accounts.filter((a) => ['wallet', 'card'].includes(a.type));
  const cb = accounts.filter((a) => ['cash', 'bank'].includes(a.type));
  $('#view').innerHTML = `<div class="stack">
    <div class="note">Government fees on each invoice are deducted from the wallet or card the agent selects. Top up prepaid wallets (or record card payments) here. The service fee is your profit.</div>
    <h3>Government fee wallets &amp; cards</h3>
    ${fee.length ? `<div class="grid g3">${fee.map(card).join('')}</div>` : `<div class="card"><div class="empty">No wallets or cards yet.${isOwner() ? ' Add each card or e-wallet you use to pay government fees.' : ''}</div></div>`}
    ${isOwner() ? `<h3>Cash &amp; bank</h3>${cb.length ? `<div class="grid g3">${cb.map(card).join('')}</div>` : '<div class="card"><div class="empty">No cash or bank accounts</div></div>'}` : ''}
  </div>`;
  if (!isOwner()) return;

  const accModal = (a) => modal({
    title: a ? `Edit ${a.name}` : 'Add wallet / account',
    body: `<div class="form-grid">
      ${field('Name *', 'name', { value: a?.name, required: true, cls: 'full', placeholder: 'e.g. ADCB Credit Card ••1234, eDirham wallet, Cash drawer' })}
      ${selectField('Type', 'type', [['card', 'Credit / debit card'], ['wallet', 'Prepaid e-wallet'], ['bank', 'Bank account'], ['cash', 'Cash']], a?.type || 'card', { attrs: 'id="acc-type"' })}
      ${a ? '' : moneyField('Opening balance (AED)', 'opening_balance', 0, { allowNegative: true, hint: 'Current balance today. For a card, enter the amount already used as negative.' })}
      <div id="limit-wrap">${moneyField('Credit limit (AED)', 'credit_limit', a?.credit_limit ?? 0, { hint: 'Cards only — how much can be spent' })}</div>
      ${moneyField('Low balance alert (AED)', 'low_alert', a?.low_alert ?? 0, { hint: 'Warn when available drops below this (0 = off)' })}
      <label class="f full">Notes<textarea name="notes">${esc(a?.notes || '')}</textarea></label>
      ${a ? `<label class="f check full"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Active</label>` : ''}
    </div>`,
    onSubmit: async (d) => {
      const body = { ...d, credit_limit: toFils(d.credit_limit), low_alert: toFils(d.low_alert), opening_balance: toFils(d.opening_balance), active: a ? d.active : true };
      await api('/accounts' + (a ? '/' + a.id : ''), { method: a ? 'PUT' : 'POST', body });
      toast('Saved');
      router();
    },
  });
  const syncLimit = () => { const t = $('#acc-type'); if (t) $('#limit-wrap').classList.toggle('hidden', t.value !== 'card'); };
  $('#add-acc').addEventListener('click', () => { accModal(null); syncLimit(); $('#acc-type').addEventListener('change', syncLimit); });
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => { accModal(accounts.find((a) => a.id === Number(b.dataset.edit))); syncLimit(); $('#acc-type').addEventListener('change', syncLimit); }));
  $$('[data-top]').forEach((b) => b.addEventListener('click', () => topupModal(accounts, Number(b.dataset.top))));
  $$('[data-adj]').forEach((b) => b.addEventListener('click', () => {
    const a = accounts.find((x) => x.id === Number(b.dataset.adj));
    modal({
      title: `Adjust ${a.name}`,
      body: `<div class="note">Use this to correct the balance to match the bank / portal (e.g. bank charges, cashback). Use a negative amount to reduce.</div>
        <div class="form-grid">${moneyField('Amount (AED) *', 'amount', null, { required: true, allowNegative: true })}${field('Date', 'date', { type: 'date', value: S.today })}
        ${field('Reason *', 'note', { required: true, cls: 'full', placeholder: 'e.g. Card annual fee, portal cashback' })}</div>`,
      onSubmit: async (d) => {
        await api('/adjustments', { method: 'POST', body: { ...d, account_id: a.id, amount: toFils(d.amount) } });
        toast('Adjustment saved');
        router();
      },
    });
  }));
}

function topupModal(accounts, toId) {
  const to = accounts.find((a) => a.id === toId);
  modal({
    title: to.type === 'card' ? `Pay / top up ${to.name}` : `Top up ${to.name}`,
    body: `<div class="form-grid">
      ${selectField('Money comes from', 'from_account_id', [['', 'Owner / outside funds'], ...accounts.filter((a) => a.id !== toId && a.active).map((a) => [a.id, `${a.name} (${money(a.available)})`])], accounts.find((a) => a.type === 'bank' && a.active)?.id || '', { cls: 'full' })}
      ${moneyField('Amount (AED) *', 'amount', null, { required: true })}
      ${field('Date', 'date', { type: 'date', value: S.today })}
      ${field('Note', 'note', { cls: 'full', placeholder: 'Optional — e.g. bank ref' })}
    </div>`,
    submit: 'Save top-up',
    onSubmit: async (d) => {
      await api('/transfers', { method: 'POST', body: { ...d, to_account_id: toId, amount: toFils(d.amount) } });
      toast('Top-up saved');
      router();
    },
  });
}

async function WalletStatement(params, query, ctx) {
  const from = query.from || monthStart(), to = query.to || S.today;
  const [d, accounts] = await Promise.all([api(`/accounts/${params.id}/statement` + qs({ from, to })), api('/accounts?all=1')]);
  if (stale(ctx)) return;
  setTitle(`${d.account.name} — statement`, `<button class="btn" id="csv">Export CSV</button><button class="btn primary" id="top">Top up</button>`);
  $('#view').innerHTML = `
    <form class="filters" id="flt">${rangeInputs(from, to)}</form>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Opening</div><div class="v"><small>AED</small>${money(d.opening)}</div></div>
      <div class="card stat"><div class="k">Money in</div><div class="v" style="color:var(--green)"><small>AED</small>${money(d.money_in)}</div></div>
      <div class="card stat"><div class="k">Money out</div><div class="v" style="color:var(--red)"><small>AED</small>${money(-d.money_out)}</div></div>
      <div class="card stat"><div class="k">Closing</div><div class="v"><small>AED</small>${money(d.closing)}</div><div class="s">Current balance ${money(d.account.balance)}</div></div>
    </div>
    <div class="card"><div class="bd flush table-wrap">${d.rows.length ? `<table class="t" id="tbl"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th>By</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th><th class="no-csv"></th></tr></thead><tbody>
      <tr><td>${fmtDate(from)}</td><td colspan="5" class="muted">Opening balance</td><td class="num">${money(d.opening)}</td><td class="no-csv"></td></tr>
      ${d.rows.map((r) => `<tr><td class="nowrap">${fmtDate(r.date)}</td><td><span class="badge b-type">${KIND_LABEL[r.kind] || r.kind}</span></td>
        <td>${r.ref_type === 'invoice' ? `<a href="#/invoices/${r.ref_id}">${esc(r.note || '')}</a>` : esc(r.note || '')}</td><td class="sub">${esc(r.user_name || '')}</td>
        <td class="num" style="color:var(--green)">${r.amount > 0 ? money(r.amount) : ''}</td><td class="num" style="color:var(--red)">${r.amount < 0 ? money(-r.amount) : ''}</td>
        <td class="num"><b>${money(r.balance)}</b></td>
        <td class="no-csv">${r.ref_type === 'transfer' ? `<button class="btn link small" data-undo="${r.ref_id}">Undo</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No transactions in this period</div>'}</div></div>`;
  bindFilters($('#flt'), `#/wallets/${params.id}`);
  $('#csv').addEventListener('click', () => $('#tbl') && exportCSV($('#tbl'), d.account.name.replace(/\W+/g, '-')));
  $('#top').addEventListener('click', () => topupModal(accounts, d.account.id));
  $$('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Undo top-up / transfer', 'This removes the transfer from both accounts.', 'Undo transfer'))) return;
    await api('/transfers/' + b.dataset.undo, { method: 'DELETE' });
    toast('Transfer removed');
    router();
  }));
}

// ---------- agent accounts ----------
// Agents keep the cash they collect. Balance = cash kept − their profit share (fully paid invoices) − what they already paid in.
async function Agents(params, query, ctx) {
  setTitle('Agent accounts');
  const [rows, accounts] = await Promise.all([api('/agents'), api('/accounts')]);
  if (stale(ctx)) return;
  const agents = rows.filter((a) => a.active || a.balance || a.pending); // the owner too: their personal share is separate from the company's
  const owe = agents.reduce((s, a) => s + Math.max(0, a.balance), 0);
  const owed = agents.reduce((s, a) => s + Math.max(0, -a.balance), 0);
  $('#view').innerHTML = `<div class="stack">
    <div class="note">Agents keep the cash they collect. What they owe = <b>cash kept − their profit share − what they already paid in</b>.
      When an agent hands over cash or tops up a company wallet, use <b>Receive</b> and pick the cash drawer / wallet the money went into. Use <b>Pay agent</b> when the company pays out their share — for your own row, that is taking your personal share out of the company.</div>
    <div class="grid g3">
      <div class="card stat"><div class="k">Agents hold for company</div><div class="v" style="color:var(--red)"><small>AED</small>${money(owe)}</div><div class="s">To hand over or top up wallets</div></div>
      <div class="card stat"><div class="k">Company owes (agents &amp; owner)</div><div class="v"><small>AED</small>${money(owed)}</div><div class="s">Shares not yet paid out</div></div>
      <div class="card stat"><div class="k">Shares waiting for payment</div><div class="v"><small>AED</small>${money(agents.reduce((s, a) => s + a.pending, 0))}</div><div class="s">Customers have not fully paid</div></div>
    </div>
    <div class="card"><div class="bd flush table-wrap">${agents.length ? `<table class="t" id="tbl"><thead><tr><th>Agent</th><th class="num">Cash kept</th><th class="num">Share earned</th><th class="num">Paid in (net)</th><th class="num">Govt fees used</th><th class="num">Balance</th><th class="no-csv"></th></tr></thead><tbody>
      ${agents.map((a) => `<tr><td><a href="#/agents/${a.id}"><b>${esc(a.name)}</b></a><div class="sub">${ROLE_LABEL(a)}${a.active ? '' : ' · disabled'}${a.pending ? ` · ${money(a.pending)} share pending` : ''}</div></td>
        <td class="num">${money(a.collected)}</td><td class="num">${money(a.earned)}</td><td class="num">${money(a.settled)}</td><td class="num muted">${money(a.govt_used)}</td>
        <td class="num"><b style="color:${a.balance > 0 ? 'var(--red)' : a.balance < 0 ? 'var(--green)' : 'inherit'}">${balanceText(a.balance)}</b></td>
        <td class="num no-csv nowrap"><button class="btn sm primary" data-in="${a.id}">Receive</button> <button class="btn sm" data-out="${a.id}">Pay agent</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No agents yet. <a href="#/users">Add sales or commission agents</a></div>'}</div></div>
  </div>`;
  $$('[data-in]').forEach((b) => b.addEventListener('click', () => settleModal(rows.find((a) => a.id === Number(b.dataset.in)), 'in', accounts)));
  $$('[data-out]').forEach((b) => b.addEventListener('click', () => settleModal(rows.find((a) => a.id === Number(b.dataset.out)), 'out', accounts)));
}

function settleModal(agent, direction, accounts) {
  const isIn = direction === 'in';
  const suggested = isIn ? Math.max(0, agent.balance) : Math.max(0, -agent.balance);
  const list = accounts.filter((a) => a.active !== 0);
  modal({
    title: isIn ? `Receive from ${agent.name}` : `Pay ${agent.name}`,
    submit: isIn ? 'Save payment in' : 'Save payout',
    body: `<div class="note">${balanceText(agent.balance)}</div><div class="form-grid">
      ${moneyField('Amount (AED) *', 'amount', suggested || null, { required: true })}
      ${field('Date', 'date', { type: 'date', value: S.today })}
      ${selectField(isIn ? 'Money went into' : 'Paid from', 'account_id', list.map((a) => [a.id, `${a.name} (${TYPE_LABEL[a.type]})`]), list.find((a) => a.type === 'cash')?.id, { cls: 'full', hint: isIn ? 'Pick the wallet / card if the agent topped it up directly, or the cash drawer / bank if they handed over money.' : '' })}
      ${field('Note', 'note', { cls: 'full', placeholder: isIn ? 'e.g. Topped up e-wallet, receipt no.' : 'e.g. Commission for October' })}
    </div>`,
    onSubmit: async (d) => {
      await api('/settlements', { method: 'POST', body: { ...d, user_id: agent.id, direction, amount: toFils(d.amount) } });
      toast('Saved');
      router();
    },
  });
}

// One person's account: cash kept, shares, payments in/out, and the govt fees their jobs used from company wallets.
async function AgentStatement(params, query, ctx) {
  const uid = params.id ? Number(params.id) : S.me.id;
  const self = uid === S.me.id;
  const from = query.from || monthStart(), to = query.to || S.today;
  const [d, accounts] = await Promise.all([api(`/agents/${uid}/statement` + qs({ from, to })), isOwner() ? api('/accounts') : Promise.resolve([])]);
  if (stale(ctx)) return;
  const s = d.summary;
  setTitle(self && !isOwner() ? 'My account' : `${d.user.name} — account`, `<button class="btn" id="csv">Export CSV</button>
    ${isOwner() ? '<button class="btn primary" id="in">Receive</button><button class="btn" id="out">Pay agent</button>' : ''}`);
  const detail = (r) => {
    const inv = r.invoice_id ? `<a href="#/invoices/${r.invoice_id}">${esc(r.number)}</a>` : '';
    if (r.kind === 'collection') return `${r.amount < 0 ? 'Refund given' : 'Cash collected'} (${METHOD_LABEL[r.method]}) — ${inv}`;
    if (r.kind === 'share') return `Profit share (${r.roles.split(',').map((x) => SHARE_ROLE[x]).join(' + ')}) — ${inv}`;
    return `${r.amount < 0 ? 'Paid to company' : 'Paid by company'} → ${esc(r.account_name)}${r.note ? ` · ${esc(r.note)}` : ''}`;
  };
  const walletTotals = Object.entries(d.walletTotals);
  $('#view').innerHTML = `<div class="stack">
    <div class="grid g4">
      <div class="card stat"><div class="k">Cash kept (all time)</div><div class="v"><small>AED</small>${money(s.collected)}</div><div class="s">Collected from customers</div></div>
      <div class="card stat"><div class="k">Profit share earned</div><div class="v" style="color:var(--green)"><small>AED</small>${money(s.earned)}</div><div class="s">${s.pending ? `+ ${money(s.pending)} waiting for customer payment` : 'On fully paid invoices'}</div></div>
      <div class="card stat"><div class="k">Paid to company (net)</div><div class="v"><small>AED</small>${money(s.settled)}</div><div class="s">Cash handed over &amp; wallet top-ups</div></div>
      <div class="card stat ${s.balance > 0 ? '' : 'accent'}"><div class="k">${s.balance > 0 ? (self ? 'I owe the company' : 'Owes the company') : s.balance < 0 ? (self ? 'Company owes me' : 'Company owes') : 'Balance'}</div>
        <div class="v" style="${s.balance > 0 ? 'color:var(--red)' : ''}"><small>AED</small>${money(Math.abs(s.balance))}</div><div class="s">${s.balance > 0 ? 'Hand over cash or top up a company wallet' : s.balance < 0 ? 'Share to be paid out' : 'Settled'}</div></div>
    </div>
    <form class="filters" id="flt" style="margin:0">${rangeInputs(from, to)}</form>
    <div class="inv-layout">
      <div class="card"><div class="hd"><h3>Statement</h3><span class="hint">+ adds to what is owed to the company, − reduces it</span></div><div class="bd flush table-wrap">
        <table class="t" id="tbl"><thead><tr><th>Date</th><th>Details</th><th class="num">+ Owes</th><th class="num">− Reduces</th><th class="num">Balance</th>${isOwner() ? '<th class="no-csv"></th>' : ''}</tr></thead><tbody>
          <tr><td>${fmtDate(from)}</td><td class="muted">Opening balance</td><td></td><td></td><td class="num">${money(d.opening)}</td>${isOwner() ? '<td class="no-csv"></td>' : ''}</tr>
          ${d.rows.map((r) => `<tr><td class="nowrap">${fmtDate(r.date)}</td><td>${detail(r)}</td>
            <td class="num" style="color:var(--red)">${r.amount > 0 ? money(r.amount) : ''}</td><td class="num" style="color:var(--green)">${r.amount < 0 ? money(-r.amount) : ''}</td>
            <td class="num"><b>${money(r.balance)}</b></td>${isOwner() ? `<td class="no-csv">${r.kind === 'settlement' ? `<button class="btn link small" data-undo="${r.id}">Undo</button>` : ''}</td>` : ''}</tr>`).join('')}
        </tbody><tfoot><tr><td colspan="4">Closing balance (${balanceText(d.closing)})</td><td class="num">${money(d.closing)}</td>${isOwner() ? '<td class="no-csv"></td>' : ''}</tr></tfoot></table>
      </div></div>
      <div class="inv-side stack">
        <div class="card"><div class="hd"><h3>Govt fees used for ${self ? 'my' : 'their'} jobs</h3></div><div class="bd">
          ${walletTotals.length ? `<table class="sum">${walletTotals.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${money(v)}</td></tr>`).join('')}<tr class="grand"><td>Total</td><td>${money(walletTotals.reduce((a, [, v]) => a + v, 0))}</td></tr></table>
            <p class="hint" style="margin:8px 0 0">Deducted from company wallets in this period. The customer's payment covers it — that cash is part of what is owed back.</p>`
            : '<span class="muted small">No wallet deductions in this period</span>'}
        </div></div>
        ${d.pending.length ? `<div class="card"><div class="hd"><h3>Share waiting for payment</h3></div><div class="bd flush"><table class="t"><tbody>
          ${d.pending.map((p) => `<tr class="click" data-go="#/invoices/${p.id}"><td><b>${esc(p.number)}</b><div class="sub">${fmtDate(p.date)} · paid ${money(p.paid)} of ${money(p.total)}</div></td><td class="num">${money(p.amount)}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      </div>
    </div>
    ${d.wallet.length ? `<div class="card"><div class="hd"><h3>Wallet deductions — detail</h3></div><div class="bd flush table-wrap"><table class="t"><thead><tr><th>Date</th><th>Invoice</th><th>Service</th><th>Wallet / card</th><th class="num">Govt fee</th></tr></thead><tbody>
      ${d.wallet.map((w) => `<tr class="click" data-go="#/invoices/${w.invoice_id}"><td class="nowrap">${fmtDate(w.date)}</td><td>${esc(w.number)}</td><td>${esc(w.name)}<div class="sub">${esc(w.description || '')}</div></td><td class="sub">${esc(w.account_name)}</td><td class="num">${money(w.amount)}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
  </div>`;
  bindFilters($('#flt'), self && !params.id ? '#/me' : `#/agents/${uid}`);
  $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
  $('#csv').addEventListener('click', () => exportCSV($('#tbl'), `account-${d.user.name.replace(/\W+/g, '-')}`));
  const agent = { ...d.user, balance: s.balance };
  $('#in')?.addEventListener('click', () => settleModal(agent, 'in', accounts));
  $('#out')?.addEventListener('click', () => settleModal(agent, 'out', accounts));
  $$('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Undo payment', 'Remove this agent payment? It is also taken out of the account it went into.', 'Undo'))) return;
    await api('/settlements/' + b.dataset.undo, { method: 'DELETE' });
    toast('Removed');
    router();
  }));
}

// ---------- expenses ----------
async function Expenses(params, query, ctx) {
  setTitle('Expenses', '<button class="btn" id="csv">Export CSV</button><button class="btn primary" id="add-exp">+ Add expense</button>');
  const from = query.from || monthStart(), to = query.to || S.today;
  const [rows, accounts] = await Promise.all([api('/expenses' + qs({ from, to })), api('/accounts')]);
  if (stale(ctx)) return;
  const byCat = {};
  for (const e of rows) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const total = rows.reduce((s, e) => s + e.amount, 0);
  $('#view').innerHTML = `
    <form class="filters" id="flt">${rangeInputs(from, to)}</form>
    <div class="inv-layout">
      <div class="card"><div class="bd flush table-wrap">${rows.length ? `<table class="t" id="tbl"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid from</th><th class="num">Amount</th><th class="no-csv"></th></tr></thead><tbody>
        ${rows.map((e) => `<tr><td class="nowrap">${fmtDate(e.date)}</td><td><b>${esc(e.category)}</b></td><td>${esc(e.description || '')}<div class="sub">by ${esc(e.user_name || '')}</div></td><td class="sub">${esc(e.account_name)}</td>
          <td class="num"><b>${money(e.amount)}</b></td><td class="num no-csv nowrap"><button class="btn sm" data-edit="${e.id}">Edit</button> <button class="btn sm danger" data-del="${e.id}">Delete</button></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">${rows.length} expense(s)</td><td class="num">${money(total)}</td><td class="no-csv"></td></tr></tfoot></table>` : '<div class="empty">No expenses in this period</div>'}</div></div>
      <div class="card inv-side"><div class="hd"><h3>By category</h3></div><div class="bd">${Object.keys(byCat).length ? `<table class="sum">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${esc(c)}</td><td>${money(v)}</td></tr>`).join('')}<tr class="grand"><td>Total</td><td>${money(total)}</td></tr></table>` : '<span class="muted">Nothing yet</span>'}</div></div>
    </div>`;
  bindFilters($('#flt'), '#/expenses');
  const expModal = (e) => modal({
    title: e ? 'Edit expense' : 'Add expense',
    body: `<datalist id="exp-cats">${EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist><div class="form-grid">
      ${field('Date', 'date', { type: 'date', value: e?.date || S.today })}
      ${field('Category *', 'category', { value: e?.category, required: true, attrs: 'list="exp-cats"', placeholder: 'Rent, Salaries…' })}
      ${moneyField('Amount (AED) *', 'amount', e?.amount ?? null, { required: true })}
      ${selectField('Paid from', 'account_id', accountOptions(accounts), e?.account_id || defaultMoneyAccount(accounts, 'cash'))}
      ${field('Description', 'description', { value: e?.description, cls: 'full' })}
    </div>`,
    onSubmit: async (d) => {
      await api('/expenses' + (e ? '/' + e.id : ''), { method: e ? 'PUT' : 'POST', body: { ...d, amount: toFils(d.amount) } });
      toast('Expense saved');
      router();
    },
  });
  $('#add-exp').addEventListener('click', () => expModal(null));
  $('#csv').addEventListener('click', () => $('#tbl') && exportCSV($('#tbl'), 'expenses'));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => expModal(rows.find((r) => r.id === Number(b.dataset.edit)))));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Delete expense', 'Delete this expense? The amount goes back to the account it was paid from.', 'Delete'))) return;
    await api('/expenses/' + b.dataset.del, { method: 'DELETE' });
    toast('Expense deleted');
    router();
  }));
}

// ---------- reports ----------
async function Reports(params, query, ctx) {
  const tabs = [['sales', 'Sales & agents'], ['receivables', 'Receivables'], ...(isOwner() ? [['pnl', 'Profit & loss'], ['daybook', 'Day book'], ['vat', 'VAT tracker']] : [])];
  const tab = tabs.find((t) => t[0] === query.tab)?.[0] || 'sales';
  setTitle('Reports', '<button class="btn" id="csv">Export CSV</button>');
  const head = `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/reports?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const from = query.from || monthStart(), to = query.to || S.today;
  const view = $('#view');
  const bindRows = () => $$('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));

  if (tab === 'sales') {
    const by = query.by || 'share';
    const d = await api('/reports/sales' + qs({ from, to, by }));
    if (stale(ctx)) return;
    const tot = (k) => d.rows.reduce((s, r) => s + (r[k] || 0), 0);
    let table = '';
    if (by === 'share') {
      table = `<table class="t" id="tbl"><thead><tr><th>Person</th><th class="num">Clients brought</th><th class="num">Jobs done</th><th class="num">Share as brought</th><th class="num">Share as worker</th><th class="num">Company share</th><th class="num">Total share</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr ${r.id && isOwner() ? `class="click" data-go="#/agents/${r.id}"` : ''}><td><b>${esc(r.name)}</b> ${r.id ? `<span class="badge b-${r.role}">${ROLE_LABEL(r)}</span>` : ''}</td>
          <td class="num">${r.id ? r.brought : ''}</td><td class="num">${r.id ? r.jobs : ''}</td><td class="num">${r.id ? money(r.as_source) : ''}</td><td class="num">${r.id ? money(r.as_worker) : ''}</td>
          <td class="num">${r.id ? '' : money(r.as_company)}</td><td class="num"><b>${money(r.total)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total profit shared</td><td class="num">${tot('brought')}</td><td class="num">${tot('jobs')}</td><td class="num">${money(tot('as_source'))}</td><td class="num">${money(tot('as_worker'))}</td><td class="num">${money(tot('as_company'))}</td><td class="num">${money(tot('total'))}</td></tr></tfoot></table>`;
    } else if (by === 'agent') {
      table = `<table class="t" id="tbl"><thead><tr><th>Prepared by</th><th class="num">Invoices</th><th class="num">Govt fees</th><th class="num">Service fees</th><th class="num">Discount</th><th class="num">Profit</th><th class="num">Total sales</th><th class="num">Collected</th><th class="num">Outstanding</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr class="click" data-go="#/invoices${qs({ agent_id: isOwner() ? r.id : '', from, to, status: 'issued' })}"><td><b>${esc(r.name)}</b> <span class="badge b-${r.role}">${r.role}</span></td><td class="num">${r.invoices}</td><td class="num">${money(r.govt)}</td><td class="num">${money(r.service)}</td><td class="num">${money(r.discount)}</td>
          <td class="num"><b>${money(r.profit)}</b></td><td class="num">${money(r.total)}</td><td class="num">${money(r.paid)}</td><td class="num">${r.due > 0 ? `<span style="color:var(--red)">${money(r.due)}</span>` : '—'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${tot('invoices')}</td><td class="num">${money(tot('govt'))}</td><td class="num">${money(tot('service'))}</td><td class="num">${money(tot('discount'))}</td><td class="num">${money(tot('profit'))}</td><td class="num">${money(tot('total'))}</td><td class="num">${money(tot('paid'))}</td><td class="num">${money(tot('due'))}</td></tr></tfoot></table>`;
    } else if (by === 'service') {
      table = `<table class="t" id="tbl"><thead><tr><th>Service</th><th>Category</th><th class="num">Qty</th><th class="num">Govt fees</th><th class="num">Service fees</th><th class="num">Billed</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td class="sub">${esc(r.category)}</td><td class="num">${r.qty}</td><td class="num">${money(r.govt)}</td><td class="num"><b>${money(r.service)}</b></td><td class="num">${money(r.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total <span class="hint">(before invoice discounts)</span></td><td class="num">${tot('qty')}</td><td class="num">${money(tot('govt'))}</td><td class="num">${money(tot('service'))}</td><td class="num">${money(tot('total'))}</td></tr></tfoot></table>`;
    } else {
      table = `<table class="t" id="tbl"><thead><tr><th>Date</th><th class="num">Invoices</th><th class="num">Govt fees</th><th class="num">Profit</th><th class="num">Total sales</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr class="click" data-go="#/invoices${qs({ from: r.date, to: r.date })}"><td>${fmtDate(r.date)}</td><td class="num">${r.invoices}</td><td class="num">${money(r.govt)}</td><td class="num"><b>${money(r.profit)}</b></td><td class="num">${money(r.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${tot('invoices')}</td><td class="num">${money(tot('govt'))}</td><td class="num">${money(tot('profit'))}</td><td class="num">${money(tot('total'))}</td></tr></tfoot></table>`;
    }
    view.innerHTML = `${head}<form class="filters" id="flt"><input type="hidden" name="tab" value="sales">
      ${selectField('Show', 'by', [['share', 'Profit share by person'], ['agent', 'Invoices prepared by'], ['service', 'By service'], ['day', 'By day']], by)}${rangeInputs(from, to)}</form>
      <div class="card"><div class="bd flush table-wrap">${d.rows.length ? table : '<div class="empty">No issued invoices in this period</div>'}</div></div>
      <p class="hint">Profit = service fees minus discounts. Who brought the client gets ⅓ (owner, sales &amp; commission agents); who did the work gets ⅓ only if the owner or a commission agent (½ on walk-ins); salaried staff earn nothing; everything else is the company's own profit. Company-only services are 100% company. Jobs done by people who earn nothing still count in “Jobs done”.</p>`;
    bindFilters($('#flt'), '#/reports');
  }

  if (tab === 'receivables') {
    const d = await api('/reports/receivables');
    if (stale(ctx)) return;
    view.innerHTML = `${head}<div class="grid g4" style="margin-bottom:16px">
        <div class="card stat"><div class="k">0–30 days</div><div class="v"><small>AED</small>${money(d.buckets.b0)}</div></div>
        <div class="card stat"><div class="k">31–60 days</div><div class="v"><small>AED</small>${money(d.buckets.b30)}</div></div>
        <div class="card stat"><div class="k">61–90 days</div><div class="v"><small>AED</small>${money(d.buckets.b60)}</div></div>
        <div class="card stat"><div class="k">Over 90 days</div><div class="v" style="color:var(--red)"><small>AED</small>${money(d.buckets.b90)}</div></div>
      </div>
      <div class="card"><div class="bd flush table-wrap">${d.rows.length ? `<table class="t" id="tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Agent</th><th class="num">Age</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr class="click" data-go="#/invoices/${r.id}"><td><b>${esc(r.number)}</b></td><td>${fmtDate(r.date)}</td><td>${esc(r.customer_name)}<div class="sub">${esc(r.customer_phone || '')}</div></td><td>${esc(r.agent_name)}</td><td class="num">${r.age}d</td><td class="num">${money(r.total)}</td><td class="num">${money(r.paid)}</td><td class="num"><b style="color:var(--red)">${money(r.due)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="7">Total outstanding</td><td class="num">${money(d.total)}</td></tr></tfoot></table>` : '<div class="empty">No outstanding balances 🎉</div>'}</div></div>`;
  }

  if (tab === 'pnl') {
    const d = await api('/reports/pnl' + qs({ from, to }));
    if (stale(ctx)) return;
    view.innerHTML = `${head}<form class="filters" id="flt"><input type="hidden" name="tab" value="pnl">${rangeInputs(from, to)}</form>
      <div class="grid g2">
        <div class="card"><div class="hd"><h3>Profit &amp; loss</h3><span class="muted small">${fmtDate(from)} – ${fmtDate(to)}</span></div><div class="bd"><table class="sum" id="tbl">
          <tr><td><b>Income</b></td><td></td></tr>
          <tr><td>Service charges (${d.sales.n} invoices)</td><td>${money(d.sales.service)}</td></tr>
          <tr><td>Less: discounts</td><td>-${money(d.sales.discount)}</td></tr>
          <tr><td><b>Net service income</b></td><td><b>${money(d.revenue)}</b></td></tr>
          <tr><td>Less: personal shares (agents &amp; owner)</td><td>-${money(d.commissions)}</td></tr>
          <tr><td><b>Company's own income</b></td><td><b>${money(d.companyIncome)}</b></td></tr>
          <tr><td style="padding-top:14px"><b>Expenses</b></td><td></td></tr>
          ${d.expenses.map((e) => `<tr><td>${esc(e.category)}</td><td>-${money(e.amount)}</td></tr>`).join('') || '<tr><td class="muted">No expenses</td><td>0.00</td></tr>'}
          <tr><td><b>Total expenses</b></td><td><b>-${money(d.expenseTotal)}</b></td></tr>
          <tr class="grand"><td>Net profit</td><td style="color:${d.net < 0 ? 'var(--red)' : 'var(--green)'}">AED ${money(d.net)}</td></tr>
        </table></div></div>
        <div class="card"><div class="hd"><h3>Government fees (pass-through)</h3></div><div class="bd"><table class="sum">
          <tr><td>Govt fees billed to customers</td><td>${money(d.sales.govt)}</td></tr>
          <tr><td>Govt fees paid from wallets / cards</td><td>${money(d.govtPaid)}</td></tr>
          <tr><td><b>Difference</b></td><td><b>${money(d.sales.govt - d.govtPaid)}</b></td></tr>
          ${d.sales.vat ? `<tr><td>VAT collected (payable to FTA)</td><td>${money(d.sales.vat)}</td></tr>` : ''}
          <tr><td>Total billed to customers</td><td>${money(d.sales.total)}</td></tr>
        </table><p class="hint">Government fees are collected from customers and paid to the government, so they are not counted as income or expense. A difference usually means a fee was refunded or an invoice was voided.</p></div></div>
      </div>`;
    bindFilters($('#flt'), '#/reports');
  }

  if (tab === 'daybook') {
    const date = query.date || S.today;
    const d = await api('/reports/daybook' + qs({ date }));
    if (stale(ctx)) return;
    view.innerHTML = `${head}<form class="filters" id="flt"><input type="hidden" name="tab" value="daybook">${field('Date', 'date', { type: 'date', value: date })}</form>
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card"><div class="hd"><h3>Account balances — ${fmtDate(date)}</h3></div><div class="bd flush table-wrap"><table class="t"><thead><tr><th>Account</th><th class="num">Opening</th><th class="num">In</th><th class="num">Out</th><th class="num">Closing</th></tr></thead><tbody>
          ${d.accounts.map((a) => `<tr><td><b>${esc(a.name)}</b> <span class="badge b-type">${TYPE_LABEL[a.type]}</span></td><td class="num">${money(a.opening)}</td><td class="num" style="color:var(--green)">${money(a.money_in)}</td><td class="num" style="color:var(--red)">${money(-a.money_out)}</td><td class="num"><b>${money(a.closing)}</b></td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="card"><div class="hd"><h3>Collections by agent</h3><span class="hint">For cash handover</span></div><div class="bd flush">${d.collections.length ? `<table class="t"><thead><tr><th>Agent</th><th>Method</th><th>Into</th><th class="num">Count</th><th class="num">Amount</th></tr></thead><tbody>
          ${d.collections.map((c) => `<tr><td><b>${esc(c.agent_name || '')}</b></td><td>${METHOD_LABEL[c.method]}</td><td class="sub">${esc(c.dest || '')}</td><td class="num">${c.n}</td><td class="num"><b>${money(c.amount)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No collections</div>'}</div></div>
      </div>
      <div class="card"><div class="hd"><h3>All money movements</h3></div><div class="bd flush table-wrap">${d.txns.length ? `<table class="t" id="tbl"><thead><tr><th>Account</th><th>Type</th><th>Details</th><th>By</th><th class="num">In</th><th class="num">Out</th></tr></thead><tbody>
        ${d.txns.map((t) => `<tr><td>${esc(t.account_name)}</td><td><span class="badge b-type">${KIND_LABEL[t.kind] || t.kind}</span></td><td>${t.ref_type === 'invoice' ? `<a href="#/invoices/${t.ref_id}">${esc(t.note || '')}</a>` : esc(t.note || '')}</td><td class="sub">${esc(t.user_name || '')}</td>
          <td class="num" style="color:var(--green)">${t.amount > 0 ? money(t.amount) : ''}</td><td class="num" style="color:var(--red)">${t.amount < 0 ? money(-t.amount) : ''}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No transactions on this day</div>'}</div></div>`;
    bindFilters($('#flt'), '#/reports');
  }

  if (tab === 'vat') {
    const d = await api('/reports/vat');
    if (stale(ctx)) return;
    const pct = Math.min(100, (d.taxable / d.mandatory) * 100);
    const max = Math.max(1, ...d.months.map((m) => m.taxable));
    view.innerHTML = `${head}<div class="grid g2">
      <div class="card"><div class="hd"><h3>Registration threshold</h3><span class="muted small">${fmtDate(d.from)} – ${fmtDate(d.to)}</span></div><div class="bd stack" style="gap:12px">
        <div class="row between"><span>Taxable supplies (rolling 12 months)</span><b style="font-size:20px">AED ${money(d.taxable)}</b></div>
        <div class="progress ${pct >= 80 ? 'hot' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="row between small muted"><span>${pct.toFixed(1)}% of mandatory threshold</span><span>AED ${money(d.mandatory)}</span></div>
        <table class="sum">
          <tr><td>Voluntary registration threshold</td><td>${money(d.voluntary)}</td></tr>
          <tr><td>Mandatory registration threshold</td><td>${money(d.mandatory)}</td></tr>
          <tr><td>Remaining before mandatory</td><td>${money(Math.max(0, d.mandatory - d.taxable))}</td></tr>
        </table>
        <div class="note">Counted here: <b>service charges minus discounts</b> on issued invoices. Government fees paid on behalf of customers are usually treated as disbursements (outside VAT scope) — confirm this treatment with your tax consultant.<br><br>When registered: add your TRN and turn on VAT in <a href="#/settings">Settings</a>. New invoices will become Tax Invoices with 5% VAT on service charges only.</div>
      </div></div>
      <div class="card"><div class="hd"><h3>Monthly taxable supplies</h3></div><div class="bd">
        ${d.months.length ? `<div class="bars">${d.months.map((m) => `<div class="b" title="${m.month}: AED ${money(m.taxable)}"><i style="height:${((m.taxable / max) * 100).toFixed(1)}%"></i><span>${m.month.slice(5)}/${m.month.slice(2, 4)}</span></div>`).join('')}</div>
        <table class="t" id="tbl" style="margin-top:12px"><thead><tr><th>Month</th><th class="num">Service income</th><th class="num">Govt fees</th></tr></thead><tbody>${d.months.map((m) => `<tr><td>${m.month}</td><td class="num">${money(m.taxable)}</td><td class="num">${money(m.govt)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">No sales yet</div>'}
      </div></div></div>`;
  }

  bindRows();
  $('#csv').addEventListener('click', () => $('#tbl') ? exportCSV($('#tbl'), 'report-' + tab) : toast('Nothing to export'));
}

// ---------- users ----------
async function Users(params, query, ctx) {
  setTitle('Users & agents', '<button class="btn primary" id="add-user">+ Add user</button>');
  const rows = await api('/users');
  if (stale(ctx)) return;
  $('#view').innerHTML = `<div class="note" style="margin-bottom:14px"><b>Owner</b>: full access to wallets, agent accounts, expenses, reports and settings. The owner also earns a personal share like an agent (set by “Profit share”), kept separate from the company's profit.
    <b>Sales agent</b> and <b>Commission agent</b>: create customers &amp; invoices, record payments, and see only the invoices they prepared, brought the client for, or worked on — plus their own account.
    <b>Salaried staff</b> work the same way but earn no profit share — their part goes to the company, and cash they collect goes to the cash drawer by default.
    Profit share: <b>commission agents</b> earn ⅓ for bringing a client and ⅓ for doing the work (½ on walk-ins); <b>sales agents</b> earn ⅓ only for bringing a client.</div>
    <div class="card"><div class="bd flush table-wrap"><table class="t"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Profit share</th><th>Mobile</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((u) => `<tr style="${u.active ? '' : 'opacity:.55'}"><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td><span class="badge b-${u.role}">${ROLE_LABEL(u)}</span></td><td class="sub">${SHARE_TYPE_LABEL[u.agent_type] || ''}</td><td>${esc(u.phone || '')}</td>
      <td>${u.active ? 'Active' : 'Disabled'}</td><td class="num nowrap"><a class="btn sm" href="#/agents/${u.id}">Account</a> <button class="btn sm" data-edit="${u.id}">Edit</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  const userModal = (u) => modal({
    title: u ? `Edit ${u.name}` : 'Add user',
    body: `<div class="form-grid">
      ${field('Full name *', 'name', { value: u?.name, required: true })}
      ${u ? `<label class="f">Username<input disabled value="${esc(u.username)}"></label>` : field('Username *', 'username', { required: true, attrs: 'autocapitalize="off"' })}
      ${selectField('Access', 'role', [['agent', 'Agent / staff — own customers & invoices only'], ['owner', 'Owner — full access']], u?.role || 'agent', { cls: 'full' })}
      ${selectField('Profit share', 'agent_type', [['sales', 'Sales agent — ⅓ for bringing clients'], ['commission', 'Commission agent — ⅓ for bringing + ⅓ for the work'], ['salaried', 'Salaried staff — no profit share']], u?.agent_type || 'sales', { cls: 'full', hint: 'Owners earn a personal share too — usually “Commission agent”.' })}
      ${field('Mobile', 'phone', { value: u?.phone })}
      ${field(u ? 'New password' : 'Password *', 'password', { type: 'password', required: !u, hint: u ? 'Leave blank to keep the current password' : 'At least 6 characters', attrs: 'autocomplete="new-password"', cls: 'full' })}
      ${u ? `<label class="f check full"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active (can log in)</label>` : ''}
    </div>`,
    onSubmit: async (d) => {
      await api('/users' + (u ? '/' + u.id : ''), { method: u ? 'PUT' : 'POST', body: d });
      toast('User saved');
      router();
    },
  });
  $('#add-user').addEventListener('click', () => userModal(null));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => userModal(rows.find((r) => r.id === Number(b.dataset.edit)))));
}

// ---------- settings ----------
async function Settings(params, query, ctx) {
  setTitle('Settings');
  const s = await api('/settings');
  if (stale(ctx)) return;
  $('#view').innerHTML = `<form id="set" class="stack" style="max-width:860px">
    <div class="card"><div class="hd"><h3>Business details (printed on invoices)</h3></div><div class="bd form-grid">
      ${field('Business name *', 'company_name', { value: s.company_name, required: true })}
      ${field('Business name (Arabic)', 'company_name_ar', { value: s.company_name_ar, attrs: 'dir="rtl"' })}
      ${field('Address', 'address', { value: s.address, cls: 'full' })}
      ${field('Phone', 'phone', { value: s.phone })}
      ${field('Email', 'email', { value: s.email })}
      ${field('Website', 'website', { value: s.website })}
      <div class="f"><label class="f">Logo<input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
        <input type="hidden" name="logo" value="${esc(s.logo)}"><div class="row" style="margin-top:6px"><img id="logo-prev" src="${esc(s.logo || '/brand/logo.png')}" style="max-height:48px"><button type="button" class="btn sm ${s.logo ? '' : 'hidden'}" id="logo-rm">Use Support Zone logo</button></div>
        <span class="hint">Printed on invoices. Leave empty to use the Support Zone logo.</span></div>
    </div></div>
    <div class="card"><div class="hd"><h3>Invoices</h3></div><div class="bd form-grid">
      ${field('Invoice number prefix', 'invoice_prefix', { value: s.invoice_prefix, hint: 'e.g. INV- gives INV-2026-00001' })}
      ${field('Public website address (for QR codes)', 'public_url', { value: s.public_url, placeholder: 'https://crm.yourdomain.ae', hint: 'The QR on each invoice links to this address + /verify/… Leave blank to use the current address.' })}
      <label class="f full">Invoice footer / terms<textarea name="invoice_footer">${esc(s.invoice_footer)}</textarea></label>
    </div></div>
    <div class="card"><div class="hd"><h3>Profit sharing</h3></div><div class="bd"><table class="sum">
      <tr><td><b>Commission agent</b> brought the client</td><td>⅓ to them</td></tr>
      <tr><td><b>Commission agent</b> did the work</td><td>⅓ to them (½ on a walk-in)</td></tr>
      <tr><td><b>Sales agent</b> brought the client</td><td>⅓ to them</td></tr>
      <tr><td><b>Sales agent</b> did the work</td><td>nothing — goes to company</td></tr>
      <tr><td><b>Owner</b> brought the client / did the work</td><td>⅓ / ⅓ to the owner personally (½ on a walk-in) — set in Users</td></tr>
      <tr><td><b>Salaried staff</b>, brought or did the work</td><td>nothing — goes to company</td></tr>
      <tr><td>Everything not paid to a person</td><td>company</td></tr>
      <tr><td>Company-only services (e.g. photocopy)</td><td>100% company</td></tr>
    </table><p class="hint" style="margin:8px 0 0">Shares are worked out on the service fee after discount. Mark a service as “Company 100%” under Services &amp; fees.</p></div></div>
    <div class="card"><div class="hd"><h3>VAT</h3></div><div class="bd form-grid">
      <div class="full ${s.vat_enabled === '1' ? 'note' : 'warn'}">${s.vat_enabled === '1' ? 'VAT is ON. New invoices are Tax Invoices with VAT on service charges.' : 'VAT is OFF (not registered). Invoices are printed as plain “Invoice” with no VAT and no TRN.'}</div>
      <label class="f check full"><input type="checkbox" id="vat-on" ${s.vat_enabled === '1' ? 'checked' : ''}> Business is VAT registered — charge VAT on service charges</label>
      <input type="hidden" name="vat_enabled" value="${s.vat_enabled === '1' ? '1' : '0'}">
      ${field('TRN (Tax Registration Number)', 'trn', { value: s.trn, placeholder: '15 digits' })}
      ${field('VAT rate %', 'vat_rate', { type: 'number', value: s.vat_rate, attrs: 'step="0.01" min="0"' })}
      <p class="hint full" style="margin:0">Only switch on after the FTA issues your TRN. Existing invoices keep the VAT setting they were issued with.</p>
    </div></div>
    <div class="err hidden" id="set-err"></div>
    <div><button class="btn primary">Save settings</button></div>
    <div class="card"><div class="hd"><h3>Backup</h3></div><div class="bd row between">
      <span class="muted">Download a full copy of all customers, invoices, wallets and expenses. Keep one off this computer at least weekly.</span>
      <a class="btn" href="/api/backup">Download backup</a>
    </div></div>
  </form>`;
  const f = $('#set');
  $('#vat-on').addEventListener('change', (e) => { f.elements.vat_enabled.value = e.target.checked ? '1' : '0'; });
  $('#logo-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 400 * 1024) { toast('Logo must be under 400 KB', 'error'); e.target.value = ''; return; }
    const r = new FileReader();
    r.onload = () => { f.elements.logo.value = r.result; $('#logo-prev').src = r.result; $('#logo-prev').style.display = ''; $('#logo-rm').classList.remove('hidden'); };
    r.readAsDataURL(file);
  });
  $('#logo-rm').addEventListener('click', () => { f.elements.logo.value = ''; $('#logo-prev').src = '/brand/logo.png'; $('#logo-rm').classList.add('hidden'); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    delete d['']; // the file input
    try {
      S.settings = await api('/settings', { method: 'PUT', body: d });
      toast('Settings saved');
      $('.side .brand span').textContent = S.settings.company_name;
      router();
    } catch (ex) { $('#set-err').textContent = ex.message; $('#set-err').classList.remove('hidden'); }
  });
}

async function MyAccount() {
  setTitle('My account');
  $('#view').innerHTML = `<div class="card" style="max-width:460px"><div class="hd"><h3>Change password</h3></div><form class="bd stack" id="pw" style="gap:12px">
    <div class="err hidden"></div>
    ${field('Current password', 'current', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
    ${field('New password', 'password', { type: 'password', required: true, hint: 'At least 6 characters', attrs: 'autocomplete="new-password"' })}
    <div><button class="btn primary">Update password</button></div></form></div>`;
  const f = $('#pw');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/me/password', { method: 'POST', body: formData(f) }); toast('Password updated'); f.reset(); } catch (ex) { const el = $('.err', f); el.textContent = ex.message; el.classList.remove('hidden'); }
  });
}

boot();
