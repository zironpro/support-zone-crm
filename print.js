// Customer-facing invoice (A4 and 80mm thermal) and the public QR verification page.
// The customer copy shows one combined amount per service (government fee + service charge).
const QRCode = require('qrcode');
const { aed } = require('./db');

const BRAND_LOGO = '/brand/logo.png'; // used when no logo is uploaded in Settings
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + words(n % 100) : '');
  for (const [size, label] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
    if (n >= size) return words(Math.floor(n / size)) + ' ' + label + (n % size ? ' ' + words(n % size) : '');
  }
  return '';
}
function amountInWords(fils) {
  const abs = Math.abs(fils);
  const dirhams = Math.floor(abs / 100), f = abs % 100;
  let s = `UAE Dirhams ${dirhams ? words(dirhams) : 'Zero'}`;
  if (f) s += ` and ${words(f)} Fils`;
  return s + ' Only';
}

function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function payStatus(inv) {
  if (inv.status === 'void') return { label: 'VOID', cls: 'void' };
  if (inv.status === 'draft') return { label: 'DRAFT', cls: 'draft' };
  if (inv.paid >= inv.total) return { label: 'PAID', cls: 'paid' };
  if (inv.paid > 0) return { label: 'PARTIALLY PAID', cls: 'partial' };
  return { label: 'UNPAID', cls: 'unpaid' };
}

async function renderInvoice(inv, s, { format, verifyUrl }) {
  const qr = await QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const taxInvoice = inv.vat_rate > 0;
  const title = taxInvoice ? 'TAX INVOICE' : 'INVOICE';
  const titleAr = taxInvoice ? 'فاتورة ضريبية' : 'فاتورة';
  const st = payStatus(inv);
  const subtotal = inv.govt_total + inv.service_total;
  const lines = inv.items.map((it) => ({
    name: it.name,
    sub: [it.description, it.ref_no ? `Ref: ${it.ref_no}` : ''].filter(Boolean).join(' · '),
    qty: it.qty,
    rate: it.govt_fee + it.service_fee,
    amount: (it.govt_fee + it.service_fee) * it.qty,
  }));
  const totals = [];
  if (taxInvoice) {
    totals.push(['Government fees (paid on your behalf)', 'رسوم حكومية', aed(inv.govt_total)]);
    totals.push(['Service charges', 'رسوم الخدمة', aed(inv.service_total)]);
    if (inv.discount) totals.push(['Discount', 'خصم', '-' + aed(inv.discount)]);
    totals.push([`VAT ${inv.vat_rate}% on service charges`, 'ضريبة القيمة المضافة', aed(inv.vat_amount)]);
  } else {
    totals.push(['Subtotal', 'المجموع الفرعي', aed(subtotal)]);
    if (inv.discount) totals.push(['Discount', 'خصم', '-' + aed(inv.discount)]);
  }
  const data = { inv, s, qr, title, titleAr, st, lines, totals, verifyUrl };
  return format === 'thermal' ? thermal(data) : a4(data);
}

function toolbar(inv, format) {
  const other = format === 'thermal' ? ['a4', 'A4 invoice'] : ['thermal', '80mm receipt'];
  return `<div class="toolbar no-print">
    <button onclick="window.print()">Print</button>
    <a href="/print/invoice/${inv.id}?format=${other[0]}">Switch to ${other[1]}</a>
    <a href="/#/invoices/${inv.id}">Back to invoice</a>
  </div>`;
}

const BASE_CSS = `
  *{box-sizing:border-box} body{margin:0;background:#e9edf1;color:#111;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .ar{font-family:"Geeza Pro","Noto Naskh Arabic","Segoe UI",Tahoma,sans-serif;direction:rtl}
  .toolbar{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:center;padding:10px;background:#1e1e1e;z-index:5}
  .toolbar button,.toolbar a{font:600 14px system-ui;color:#fff;background:linear-gradient(135deg,#2ea9d8,#2271bc);border:0;border-radius:6px;padding:8px 14px;text-decoration:none;cursor:pointer}
  .toolbar a{background:transparent;border:1px solid #ffffff55}
  .stamp{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font:800 110px system-ui;color:#c0392b22;letter-spacing:8px;pointer-events:none}
  @media print{body{background:#fff}.no-print{display:none!important}}
`;

function a4({ inv, s, qr, title, titleAr, st, lines, totals, verifyUrl }) {
  const contact = [s.phone && `Tel: ${esc(s.phone)}`, s.email && esc(s.email), s.website && esc(s.website)].filter(Boolean).join(' · ');
  const customer = [
    inv.customer_company && `<div>${esc(inv.customer_company)}</div>`,
    inv.customer_phone && `<div>Tel: ${esc(inv.customer_phone)}</div>`,
    inv.customer_eid && `<div>Emirates ID: ${esc(inv.customer_eid)}</div>`,
    inv.customer_tl && `<div>Trade License: ${esc(inv.customer_tl)}</div>`,
  ].filter(Boolean).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(inv.number || 'Draft invoice')} — ${esc(s.company_name)}</title>
<style>${BASE_CSS}
  @page{size:A4;margin:12mm}
  .page{position:relative;width:210mm;min-height:297mm;margin:20px auto;background:#fff;padding:14mm 14mm 12mm;box-shadow:0 2px 16px #0002;display:flex;flex-direction:column}
  @media print{.page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:0}}
  header{display:flex;justify-content:space-between;gap:20px;padding-bottom:14px;border-bottom:3px solid #2389c9;border-image:linear-gradient(90deg,#2ea9d8,#2271bc) 1}
  .brand{display:flex;gap:14px;align-items:flex-start}
  .brand img{max-height:70px;max-width:150px;object-fit:contain}
  .brand h1{margin:0;font-size:21px;color:#1e1e1e}
  .brand .ar{font-size:16px;color:#1e1e1e;text-align:left}
  .muted{color:#555;font-size:12px;line-height:1.5}
  .title{text-align:right}
  .title h2{margin:0;font-size:26px;letter-spacing:3px;color:#2389c9}
  .title .ar{font-size:20px;text-align:right;direction:rtl;color:#2389c9}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:18px 0}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#2389c9;font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between}
  .label .ar{text-transform:none;letter-spacing:0;font-weight:600}
  .cust-name{font-weight:700;font-size:15px}
  .kv{width:100%;border-collapse:collapse;font-size:13px}
  .kv td{padding:3px 0}.kv td:last-child{text-align:right;font-weight:600}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:1px}
  .paid{background:#dff5ea;color:#0b7a43}.partial{background:#fff2d6;color:#a05a00}.unpaid{background:#fde4e1;color:#b42318}.void,.draft{background:#eee;color:#555}
  table.items{width:100%;border-collapse:collapse;font-size:13px;margin-top:4px}
  table.items th{background:#1e1e1e;color:#fff;text-align:left;padding:8px 10px;font-weight:600;font-size:12px}
  table.items th small{display:block;font-weight:400;opacity:.8;font-family:"Geeza Pro","Noto Naskh Arabic",Tahoma,sans-serif}
  table.items td{padding:9px 10px;border-bottom:1px solid #e4e7eb;vertical-align:top}
  table.items .num{text-align:right;white-space:nowrap}
  table.items .sub{color:#666;font-size:11.5px;margin-top:2px}
  .bottom{display:grid;grid-template-columns:1fr 300px;gap:24px;margin-top:16px}
  .words{font-size:12.5px;font-style:italic;color:#333;margin-bottom:14px}
  .qr{display:flex;gap:12px;align-items:center}
  .qr svg{width:92px;height:92px}
  .qr .muted{font-size:11px;max-width:200px;word-break:break-all}
  table.totals{width:100%;border-collapse:collapse;font-size:13px}
  table.totals td{padding:6px 0}
  table.totals td:last-child{text-align:right;font-weight:600;white-space:nowrap}
  table.totals .ar{font-size:11px;color:#777;display:block;text-align:left}
  table.totals tr.grand td{border-top:2px solid #1e1e1e;font-size:17px;font-weight:800;color:#1e1e1e;padding-top:10px}
  table.totals tr.due td{color:#b42318}
  .notes{margin-top:16px;font-size:12px;color:#444;white-space:pre-wrap}
  footer{margin-top:auto;padding-top:18px;border-top:1px solid #e4e7eb;font-size:11.5px;color:#555;text-align:center;line-height:1.6}
</style></head><body>
${toolbar(inv, 'a4')}
<div class="page">
  ${inv.status !== 'issued' ? `<div class="stamp">${st.label}</div>` : ''}
  <header>
    <div class="brand">
      <img src="${esc(s.logo || BRAND_LOGO)}" alt="">
      <div>
        <h1>${esc(s.company_name)}</h1>
        ${s.company_name_ar ? `<div class="ar">${esc(s.company_name_ar)}</div>` : ''}
        <div class="muted">${esc(s.address)}${contact ? '<br>' + contact : ''}${inv.vat_rate > 0 && s.trn ? `<br><b>TRN: ${esc(s.trn)}</b>` : ''}</div>
      </div>
    </div>
    <div class="title"><h2>${title}</h2><div class="ar">${titleAr}</div></div>
  </header>

  <div class="meta">
    <div>
      <div class="label"><span>Bill to</span><span class="ar">العميل</span></div>
      <div class="cust-name">${esc(inv.customer_name)}</div>
      <div class="muted">${customer}</div>
    </div>
    <div>
      <table class="kv">
        <tr><td>Invoice No. <span class="ar muted">رقم الفاتورة</span></td><td>${esc(inv.number || 'DRAFT')}</td></tr>
        <tr><td>Date <span class="ar muted">التاريخ</span></td><td>${fmtDate(inv.date)}</td></tr>
        <tr><td>Served by</td><td>${esc(inv.agent_name)}</td></tr>
        <tr><td>Status</td><td><span class="badge ${st.cls}">${st.label}</span></td></tr>
      </table>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th style="width:36px">#</th>
      <th>Service / Description<small>الخدمة</small></th>
      <th class="num" style="width:56px">Qty<small>الكمية</small></th>
      <th class="num" style="width:110px">Rate (AED)<small>السعر</small></th>
      <th class="num" style="width:120px">Amount (AED)<small>المبلغ</small></th>
    </tr></thead>
    <tbody>
      ${lines.map((l, i) => `<tr>
        <td>${i + 1}</td>
        <td><div>${esc(l.name)}</div>${l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ''}</td>
        <td class="num">${l.qty}</td>
        <td class="num">${aed(l.rate)}</td>
        <td class="num">${aed(l.amount)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="bottom">
    <div>
      <div class="words">${esc(amountInWords(inv.total))}</div>
      <div class="qr">${qr}<div class="muted"><b style="color:#111">Scan to verify this invoice</b><br>${esc(verifyUrl)}</div></div>
    </div>
    <table class="totals">
      ${totals.map(([en, ar, v]) => `<tr><td>${esc(en)}<span class="ar">${ar}</span></td><td>${v}</td></tr>`).join('')}
      <tr class="grand"><td>Total (AED)<span class="ar">الإجمالي</span></td><td>${aed(inv.total)}</td></tr>
      ${inv.status === 'issued' ? `<tr><td>Paid<span class="ar">المدفوع</span></td><td>${aed(inv.paid)}</td></tr>
      <tr class="${inv.due > 0 ? 'due' : ''}"><td>Balance due<span class="ar">المبلغ المتبقي</span></td><td>${aed(inv.due)}</td></tr>` : ''}
    </table>
  </div>
  ${inv.notes ? `<div class="notes"><b>Notes:</b> ${esc(inv.notes)}</div>` : ''}

  <footer>
    ${s.invoice_footer ? esc(s.invoice_footer) + '<br>' : ''}
    This is a computer-generated invoice and does not require a signature. <span class="ar">شكراً لتعاملكم معنا</span>
  </footer>
</div>
</body></html>`;
}

function thermal({ inv, s, qr, title, titleAr, st, lines, totals }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(inv.number || 'Draft')} — receipt</title>
<style>${BASE_CSS}
  @page{size:80mm auto;margin:3mm}
  .rcpt{position:relative;width:76mm;margin:20px auto;background:#fff;padding:5mm 4mm;font-size:12px;box-shadow:0 2px 12px #0002}
  @media print{.rcpt{margin:0;box-shadow:none;width:auto;padding:0}}
  .c{text-align:center}.b{font-weight:700}
  .rcpt img{max-width:40mm;max-height:18mm;display:block;margin:0 auto 4px}
  hr{border:0;border-top:1px dashed #000;margin:6px 0}
  .row{display:flex;justify-content:space-between;gap:8px}
  .item{margin:4px 0}.item .sub{font-size:10.5px;color:#333}
  .grand{font-size:15px;font-weight:800}
  .qr svg{width:32mm;height:32mm;display:block;margin:6px auto 2px}
  .stamp{font-size:44px}
</style></head><body>
${toolbar(inv, 'thermal')}
<div class="rcpt">
  ${inv.status !== 'issued' ? `<div class="stamp">${st.label}</div>` : ''}
  <img src="${esc(s.logo || BRAND_LOGO)}" alt="">
  <div class="c b" style="font-size:14px">${esc(s.company_name)}</div>
  ${s.company_name_ar ? `<div class="c ar" style="direction:rtl">${esc(s.company_name_ar)}</div>` : ''}
  <div class="c">${esc(s.address)}${s.phone ? '<br>Tel: ' + esc(s.phone) : ''}${inv.vat_rate > 0 && s.trn ? '<br>TRN: ' + esc(s.trn) : ''}</div>
  <hr><div class="c b">${title} · <span class="ar">${titleAr}</span></div><hr>
  <div class="row"><span>No.</span><span class="b">${esc(inv.number || 'DRAFT')}</span></div>
  <div class="row"><span>Date</span><span>${fmtDate(inv.date)}</span></div>
  <div class="row"><span>Customer</span><span>${esc(inv.customer_name)}</span></div>
  ${inv.customer_phone ? `<div class="row"><span>Phone</span><span>${esc(inv.customer_phone)}</span></div>` : ''}
  <div class="row"><span>Served by</span><span>${esc(inv.agent_name)}</span></div>
  <hr>
  ${lines.map((l) => `<div class="item"><div class="row"><span>${esc(l.name)}</span><span class="b">${aed(l.amount)}</span></div>
    ${l.qty > 1 ? `<div class="sub">${l.qty} × ${aed(l.rate)}</div>` : ''}${l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ''}</div>`).join('')}
  <hr>
  ${totals.map(([en, , v]) => `<div class="row"><span>${esc(en)}</span><span>${v}</span></div>`).join('')}
  <div class="row grand"><span>TOTAL AED</span><span>${aed(inv.total)}</span></div>
  ${inv.status === 'issued' ? `<div class="row"><span>Paid</span><span>${aed(inv.paid)}</span></div><div class="row b"><span>Balance</span><span>${aed(inv.due)}</span></div>` : ''}
  <hr>
  <div class="qr">${qr}</div>
  <div class="c" style="font-size:10.5px">Scan to verify · ${st.label}</div>
  ${s.invoice_footer ? `<hr><div class="c" style="font-size:10.5px">${esc(s.invoice_footer)}</div>` : ''}
  <div class="c ar" style="margin-top:4px">شكراً لتعاملكم معنا</div>
</div>
</body></html>`;
}

function maskName(name) {
  return String(name || '').split(/\s+/).map((w, i) => (i === 0 ? w : w.charAt(0) + '*'.repeat(Math.max(2, w.length - 1)))).join(' ');
}

function renderVerify(inv, s) {
  const body = inv
    ? (() => {
      const st = payStatus({ ...inv, paid: inv.paid });
      const ok = inv.status === 'issued';
      return `<div class="icon ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '!'}</div>
        <h1>${ok ? 'Genuine invoice' : 'This invoice was cancelled'}</h1>
        <p class="sub">Issued by ${esc(s.company_name)}</p>
        <dl>
          <dt>Invoice No.</dt><dd>${esc(inv.number)}</dd>
          <dt>Date</dt><dd>${fmtDate(inv.date)}</dd>
          <dt>Customer</dt><dd>${esc(maskName(inv.customer_name))}</dd>
          <dt>Total</dt><dd>AED ${aed(inv.total)}</dd>
          <dt>Status</dt><dd><span class="badge ${st.cls}">${st.label}</span></dd>
        </dl>`;
    })()
    : `<div class="icon bad">?</div><h1>Invoice not found</h1><p class="sub">This QR code does not match any invoice issued by ${esc(s.company_name)}.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice verification — ${esc(s.company_name)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2f5;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;padding:16px}
  .card{background:#fff;border-radius:14px;box-shadow:0 4px 24px #0001;padding:28px;max-width:400px;width:100%;text-align:center}
  .icon{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;margin:0 auto 10px;font-size:28px;font-weight:800;color:#fff}
  .ok{background:#2389c9}.bad{background:#b42318}
  h1{font-size:20px;margin:6px 0 2px}.sub{color:#666;margin:0 0 18px;font-size:14px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;text-align:left;margin:0;font-size:14px}
  dt{color:#666}dd{margin:0;font-weight:600;text-align:right}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:1px}
  .paid{background:#dff5ea;color:#0b7a43}.partial{background:#fff2d6;color:#a05a00}.unpaid{background:#fde4e1;color:#b42318}.void,.draft{background:#eee;color:#555}
</style></head><body><div class="card"><img src="${esc(s.logo || BRAND_LOGO)}" alt="" style="height:56px;margin-bottom:14px">${body}</div></body></html>`;
}

module.exports = { renderInvoice, renderVerify, amountInWords };
