# Support Zone CRM

![Support Zone](public/brand/logo.png)

Billing, wallets, bookkeeping and sales-agent reports for a UAE government-transaction /
typing / business-setup center. Built for a business that is **not VAT registered yet**, with VAT
ready to switch on later.

## What it does

| Need | How it works |
|---|---|
| Owner, sales agents, commission agents | **Owner** sees everything. **Sales agents** and **commission agents** create customers and invoices, take payments, and see only the invoices they prepared, brought the client for, or worked on — plus their own account. |
| Profit sharing | Each invoice records **who brought the client** and, per service line, **who did the work**. The service-fee profit is split ⅓ company, ⅓ who brought the client, ⅓ who did the work (same person gets ⅔). **Walk-in** clients: 50% who did the work, 50% company. **Company-only** services such as the photocopy / Xerox machine: 100% company. A "Miscellaneous work" service covers odd jobs. |
| Agents keep the cash | When an agent collects cash it can stay with them ("Kept by me"). Their **account** shows: cash kept − their profit share − what they already paid in = what they owe the company. They pay it back by handing over cash or **topping up a company wallet**; the owner records that under **Agent accounts → Receive**. The company pays out shares with **Pay agent**. |
| Private customers | Agents only see customers **they added** or **brought in**, plus customers the owner marks **Shared** (the Walk-in customer is shared). If an agent tries to add a mobile number or Emirates ID that already belongs to another agent's customer, it is blocked and they are told to ask the owner. The owner sees every customer, who added it, and can share it or reassign it with "Client brought by". On shared customers, agents only see totals from their own invoices. |
| Shared wallets | Everyone uses the same company wallets/cards. Agents don't see the company balances — only the govt-fee deductions for jobs they did. |
| Invoice with govt fee + service fee | Each line has a **Govt fee** (e.g. Emirates ID 303.00) and a **Service fee** (e.g. 30.00). Pick a service from the price list and both fill in automatically; agents can change them. |
| Customer sees one total | The printed invoice shows **one amount per service** (303 + 30 = 333.00) and the grand total. The govt/service split, wallets and profit stay internal. |
| Govt fees paid from different cards | Every line picks the **wallet / card** that paid the govt fee. Issuing the invoice deducts it from that wallet. If the wallet doesn't have enough, the invoice is blocked with a "top up first" message. |
| Wallet top-up & limits | Prepaid e-wallets (top-up), credit cards (credit limit, "pay card"), debit cards, bank, cash drawer. Low-balance alerts, transfers, adjustments and a full statement per wallet. |
| Margin goes to profit | Profit = service fees − discounts. Govt fees are pass-through and never counted as income. The P&L takes agents' shares off to show the company's own income. |
| QR code on invoice | Every invoice has a QR code that opens a public **verification page** (invoice no., date, total, paid status; customer name partly hidden). |
| Billing & bookkeeping | Payments (cash, card, transfer, cheque; partial payments), receivables with aging, expenses by category, profit & loss, day book (opening / in / out / closing per account) and collections per agent for cash handover. |
| Sales-person reports | Profit share by person (clients brought, jobs done, share as brought / as worker, company share), invoices prepared by each agent, by service and by day. CSV export on every report. |
| VAT not registered | Invoices print as plain **"Invoice / فاتورة"** with no VAT and no TRN. A **VAT tracker** watches taxable income over the last 12 months against the AED 187,500 voluntary and AED 375,000 mandatory thresholds. When registered, add the TRN and switch VAT on: new invoices become **Tax Invoices** with 5% VAT on service charges only. |

Also included: A4 invoice and 80mm thermal receipt (English + Arabic labels, amount in words),
drafts, void with optional wallet/payment refund, walk-in customer, customer statements, and a
one-click database backup for the owner.

## Run it

Needs **Node.js 22.13 or newer** (uses the built-in SQLite, so there is no database server to install).

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000. The first visit asks you to create the owner account.

### Try it with demo data

On an empty database, this fills in about two months of sample invoices, wallets, agents and expenses:

```bash
npm run seed:demo
```

Demo logins are listed at the top of `seed-demo.js`. The demo service fees are examples only.

To start fresh, stop the server and delete the `data/` folder.

## Profit sharing rules

| Situation | Company | Brought the client | Did the work |
|---|---|---|---|
| Client brought by an agent | ⅓ | ⅓ | ⅓ |
| Same agent brought the client and did the work | ⅓ | ⅔ (one person) | |
| Walk-in (nobody brought the client) | 50% | — | 50% |
| Company-only service (e.g. photocopy) | 100% | — | — |

- Shares are worked out on the service fee after any discount; rounding leftovers go to the company.
- A share is **earned** once the customer has paid the invoice in full; until then it shows as "waiting for payment".
- Mark a service "Company 100%" under **Services & fees → Profit**. Only the owner can change this on an invoice line.
- Set "Client brought by" on a customer once and it fills in automatically on their invoices.

## First-time setup (real business)

1. **Settings** — business name (English + Arabic), address, phone, logo, invoice prefix, footer terms.
2. **Wallets & accounts** — add every card and e-wallet used to pay government fees, with today's
   balance (for credit cards: credit limit, and money already used as a negative opening balance).
   Add the bank account. A Cash Drawer is created automatically.
3. **Services & fees** — enter your price list: govt fee, service fee and the default wallet for each service.
4. **Users & agents** — create a login for each sales agent and commission agent.
5. **Customers** — for clients that belong to an agent, set "Client brought by".

## Daily use

- **New invoice** → pick customer (or Walk-in) → check "Client brought by" → type the service → set "Done by" if someone else does the work → enter payment ("Kept by me" if the agent keeps the cash) → **Issue invoice** → print A4 or 80mm.
- **My account** (agents) shows cash kept, profit share, what they owe and the wallet deductions for their jobs.
- **Agent accounts** (owner) → **Receive** when an agent hands over cash or tops up a wallet; **Pay agent** to pay out shares.
- **Record payment** on an invoice when the customer pays later.
- **Wallets** → top up / pay card when the balance is low (dashboard shows alerts).
- **Reports → Day book** at closing time to count the cash drawer and see each agent's collections (and which were kept by the agent).

## Deploying for the client

Run it on a small VPS or an office PC that stays on:

- Put it behind HTTPS (e.g. Caddy or Nginx) and set `PORT` if needed.
- Set **Settings → Public website address** to the real URL so the invoice QR codes work for customers.
- The database is one file: `data/crm.db` (change the path with `DB_PATH`). Use **Settings → Download backup**
  regularly and keep copies off the machine.
- Keep it running with a process manager such as `pm2` or a systemd service.

## Deploy on Dokploy

The repo includes a `Dockerfile`, so Dokploy can build it directly.

1. In Dokploy, open your project → **Create Service → Application** (name it `support-zone-crm`).
2. **Provider**: GitHub (if the Dokploy GitHub App can see the `zironpro` org) → repository `support-zone-crm`, branch `main`.
   Or use the **Git** provider with `git@github.com:zironpro/support-zone-crm.git` and an SSH key from Dokploy
   (Settings → SSH Keys) added on GitHub as a read-only deploy key.
3. **Build Type**: `Dockerfile` (path `Dockerfile`).
4. **Advanced → Volumes**: add a **Volume mount**, name `support-zone-crm-data`, mount path **`/app/data`**.
   This is where the database lives — without it every redeploy starts with an empty CRM.
5. **Environment**: `PUBLIC_URL=https://your-crm-domain` (used in the invoice QR codes). `PORT`, `DB_PATH` and `TZ` are set in the image.
6. **Domains**: add your domain, container port **3000**, HTTPS on with Let's Encrypt. Point the domain's DNS A record at the Dokploy server.
7. **Deploy**, open the domain and create the owner account on the first-time setup screen.

Notes:
- Run **one** instance only (the database is a single SQLite file).
- The container reports health at `/healthz`.
- Take regular backups from **Settings → Download backup** (or Dokploy volume backups if you have S3 set up).

## Branding

The app uses the Support Zone logo (`public/brand/logo.png`) and colours: sky blue `#2ea9d8` → deep blue `#2271bc` gradient, with near-black `#1e1e1e`.
The colours are set at the top of `public/styles.css` and in `print.js`. A logo uploaded in **Settings** replaces the default logo on printed invoices.

## Project layout

```
server.js      HTTP API, login sessions, print & QR verification routes
logic.js       Business rules: invoices, wallet deductions, payments, transfers, expenses
reports.js     Dashboard, sales by agent/service/day, P&L, receivables, day book, VAT tracker
print.js       Customer invoice (A4 + 80mm thermal) and public verification page
db.js          SQLite schema and settings (all money stored as integer fils)
seed-demo.js   Demo data
public/        Web app (no build step)
```

## Notes

- Upgrading from the first version: the database is upgraded automatically on start. Old invoices are treated as walk-ins done by the person who prepared them.

- Tax treatment: the VAT tracker counts service charges only, treating government fees paid on the
  customer's behalf as disbursements. Confirm this with the client's tax consultant before relying on it.
- Owners can edit issued invoices; wallet deductions are re-posted to match. Agents can only edit drafts.
- Passwords are hashed (scrypt); sessions are HTTP-only cookies.
