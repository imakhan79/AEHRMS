// Finance tests (AP, AR, journals, periods, bank rec, budgets, reports).
// Everything runs in one transaction that is ROLLED BACK. Uses March–April 2027 to avoid other data.
// usage: npm run test:finance   (reads DATABASE_URL from .env.local)
const { Client } = require("pg");

const ids = {
  fin1: "00000000-0000-4000-d000-000000000001",
  fin2: "00000000-0000-4000-d000-000000000002",
  hr: "00000000-0000-4000-d000-000000000003",
  emp: "00000000-0000-4000-d000-000000000004",
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  — " + extra : ""}`);
};
const n = (v) => Number(v ?? 0);

(async () => {
  const c = new Client({ connectionString: process.argv[2] || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, p) => c.query(sql, p);
  const as = async (who) => {
    await q("reset role");
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[who], role: "authenticated" })]);
    await q("set local role authenticated");
  };
  const asAdmin = async () => {
    await q("reset role");
    await q(`select set_config('request.jwt.claims', '', true)`);
  };
  const tryq = async (sql, p) => {
    await q("savepoint s");
    try { const r = await q(sql, p); await q("release savepoint s"); return { r }; }
    catch (e) { await q("rollback to savepoint s"); return { e }; }
  };
  const acct = async (code) => (await q(`select id from chart_of_accounts where code=$1`, [code])).rows[0].id;
  const jeLines = async (je) => {
    const r = await q(`select a.code, sum(l.debit - l.credit) net from journal_entry_lines l join chart_of_accounts a on a.id=l.account_id where l.journal_entry_id=$1 group by a.code`, [je]);
    return Object.fromEntries(r.rows.map((x) => [x.code, n(x.net)]));
  };

  try {
    await q("begin");
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`,
        [id, `${k}@fin-test.local`]);
    }
    const dept = (await q(`select id from departments where code='FIN'`)).rows[0].id;
    await q(`insert into employees (employee_code, first_name, last_name, work_email, department_id, status) values ('FT-004','emp','Test','emp@fin-test.local',$1,'active')`, [dept]);
    await q(`insert into user_roles (user_id, role) values ($1,'finance'),($2,'finance'),($3,'hr_admin')`, [ids.fin1, ids.fin2, ids.hr]);
    const bank = (await q(`select b.id, b.gl_account_id from bank_accounts b join chart_of_accounts a on a.id=b.gl_account_id where a.code='1120'`)).rows[0];
    const A = {};
    for (const code of ["1120", "1210", "1410", "1420", "2010", "2210", "2220", "4110", "5210", "5270", "5290"]) A[code] = await acct(code);
    const gstIn = (await q(`select id from taxes where code='GST18-IN'`)).rows[0].id;
    const gstOut = (await q(`select id from taxes where code='GST18-OUT'`)).rows[0].id;

    // ---------- Manual journals ----------
    await as("emp");
    let t = await tryq(`insert into journal_entries (entry_date, description) values ('2027-03-05','hack')`);
    ok("employee can't create journals", !!t.e);

    await as("fin1");
    const je = (await q(`insert into journal_entries (entry_date, description) values ('2027-03-05','Accrue misc expense') returning id`)).rows[0].id;
    await q(`insert into journal_entry_lines (journal_entry_id, account_id, debit) values ($1,$2,5000)`, [je, A["5290"]]);
    t = await tryq(`select public.fin_post_manual_journal($1)`, [je]);
    ok("maker can't post own journal", !!t.e, t.e?.message);
    await as("fin2");
    t = await tryq(`select public.fin_post_manual_journal($1)`, [je]);
    ok("unbalanced journal rejected", !!t.e, t.e?.message);
    await as("fin1");
    await q(`insert into journal_entry_lines (journal_entry_id, account_id, credit) values ($1,$2,5000)`, [je, A["2010"]]);
    await as("fin2");
    t = await tryq(`select public.fin_post_manual_journal($1)`, [je]);
    ok("checker posts balanced journal", !t.e, t.e?.message);
    t = await tryq(`insert into journal_entry_lines (journal_entry_id, account_id, debit) values ($1,$2,1)`, [je, A["5290"]]);
    ok("posted journal lines can't be added", !!t.e);
    t = await tryq(`update journal_entries set status='draft' where id=$1`, [je]);
    ok("journal status can't be changed directly", !!t.e || t.r.rowCount === 0);
    const rv = (await q(`select public.fin_reverse_journal($1,'2027-03-06','Booked in error') id`, [je])).rows[0].id;
    let r = await q(`select status, reversed_by_entry from journal_entries where id=$1`, [je]);
    ok("reversal marks original reversed", r.rows[0].status === "reversed" && r.rows[0].reversed_by_entry === rv);
    const rvl = await jeLines(rv);
    ok("reversal swaps debits and credits", rvl["5290"] === -5000 && rvl["2010"] === 5000, JSON.stringify(rvl));

    // ---------- Period lock ----------
    await as("fin1");
    await q(`select public.fin_set_period_status('2027-04-01','closed')`);
    const je2 = (await q(`insert into journal_entries (entry_date, description) values ('2027-04-10','In closed period') returning id`)).rows[0].id;
    await q(`insert into journal_entry_lines (journal_entry_id, account_id, debit) values ($1,$2,100),($1,$3,0.01)`, [je2, A["5290"], A["2010"]]).catch(() => {});
    await q(`delete from journal_entry_lines where journal_entry_id=$1`, [je2]);
    await q(`insert into journal_entry_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,100,0),($1,$3,0,100)`, [je2, A["5290"], A["2010"]]);
    await as("fin2");
    t = await tryq(`select public.fin_post_manual_journal($1)`, [je2]);
    ok("posting into a closed period is blocked", !!t.e, t.e?.message);
    t = await tryq(`select public.fin_set_period_status('2027-04-01','open')`);
    ok("only System Admin can reopen a closed period", !!t.e, t.e?.message);

    // ---------- AP ----------
    await as("fin1");
    const vendor = (await q(`insert into vendors (code, name, ntn) values ('V-TEST','Test Landlord Pvt Ltd','1234567-8') returning id`)).rows[0].id;
    const bill = (await q(`insert into bills (vendor_id, vendor_invoice_no, bill_date, due_date) values ($1,'INV-778','2027-03-01','2027-03-31') returning id`, [vendor])).rows[0].id;
    await q(`insert into bill_lines (bill_id, account_id, amount, description) values ($1,$2,100000,'March rent')`, [bill, A["5210"]]);
    await q(`insert into bill_lines (bill_id, account_id, amount, tax_id, description) values ($1,$2,20000,$3,'Software licence')`, [bill, A["5270"], gstIn]);
    r = await q(`select subtotal, tax_total, total from bills where id=$1`, [bill]);
    ok("bill totals: 120,000 + GST 3,600 = 123,600", n(r.rows[0].total) === 123600 && n(r.rows[0].tax_total) === 3600, JSON.stringify(r.rows[0]));
    const billJe = (await q(`select public.fin_post_bill($1) id`, [bill])).rows[0].id;
    let L = await jeLines(billJe);
    ok("bill JE: Dr rent, Dr IT, Dr input GST, Cr AP", L["5210"] === 100000 && L["5270"] === 20000 && L["1410"] === 3600 && L["2010"] === -123600, JSON.stringify(L));
    t = await tryq(`update bill_lines set amount = 1 where bill_id=$1`, [bill]);
    ok("posted bill lines can't change", !!t.e);
    t = await tryq(`delete from bills where id=$1`, [bill]);
    ok("posted bill can't be deleted", !!t.e);

    const wht = (await q(`insert into taxes (code, name, tax_type, rate_pct, account_id) values ('WHT-T','WHT test 10%','wht_payable',10,$1) returning id`, [A["2220"]])).rows[0].id;
    const pay = (await q(`insert into vendor_payments (vendor_id, payment_date, bank_account_id, amount, wht_tax_id, wht_amount, reference) values ($1,'2027-03-20',$2,123600,$3,12360,'CHQ-1001') returning id, net_paid`, [vendor, bank.id, wht])).rows[0];
    ok("payment net = 123,600 − WHT 12,360 = 111,240", n(pay.net_paid) === 111240);
    t = await tryq(`insert into payment_allocations (payment_id, bill_id, amount) values ($1,$2,200000)`, [pay.id, bill]);
    await as("fin2");
    t = await tryq(`select public.fin_post_vendor_payment($1)`, [pay.id]);
    ok("over-allocation rejected", !!t.e, t.e?.message);
    await as("fin1");
    await q(`delete from payment_allocations where payment_id=$1`, [pay.id]);
    await q(`insert into payment_allocations (payment_id, bill_id, amount) values ($1,$2,123600)`, [pay.id, bill]);
    t = await tryq(`select public.fin_post_vendor_payment($1)`, [pay.id]);
    ok("maker can't release own payment", !!t.e, t.e?.message);
    await as("fin2");
    const payJe = (await q(`select public.fin_post_vendor_payment($1) id`, [pay.id])).rows[0].id;
    L = await jeLines(payJe);
    ok("payment JE: Dr AP 123,600 / Cr bank 111,240 / Cr WHT 12,360", L["2010"] === 123600 && L["1120"] === -111240 && L["2220"] === -12360, JSON.stringify(L));
    r = await q(`select amount_paid from bills where id=$1`, [bill]);
    ok("bill marked fully paid", n(r.rows[0].amount_paid) === 123600);

    // ---------- AR ----------
    await as("fin1");
    const cust = (await q(`insert into customers (code, name) values ('C-TEST','Test Client Ltd') returning id`)).rows[0].id;
    const inv = (await q(`insert into invoices (customer_id, invoice_date, due_date) values ($1,'2027-03-10','2027-03-25') returning id`, [cust])).rows[0].id;
    await q(`insert into invoice_lines (invoice_id, account_id, amount, tax_id, description) values ($1,$2,500000,$3,'Consulting March')`, [inv, A["4110"], gstOut]);
    const invJe = (await q(`select public.fin_post_invoice($1) id`, [inv])).rows[0].id;
    L = await jeLines(invJe);
    ok("invoice JE: Dr AR 590,000 / Cr revenue 500,000 / Cr GST 90,000", L["1210"] === 590000 && L["4110"] === -500000 && L["2210"] === -90000, JSON.stringify(L));
    const inv2 = (await q(`insert into invoices (customer_id, invoice_date, due_date) values ($1,'2027-03-01','2027-03-05') returning id`, [cust])).rows[0].id;
    await q(`insert into invoice_lines (invoice_id, account_id, amount) values ($1,$2,100000)`, [inv2, A["4110"]]);
    await q(`select public.fin_post_invoice($1)`, [inv2]);
    const rec = (await q(`insert into customer_receipts (customer_id, receipt_date, bank_account_id, amount, wht_amount) values ($1,'2027-03-28',$2,590000,20000) returning id`, [cust, bank.id])).rows[0].id;
    await q(`insert into receipt_allocations (receipt_id, invoice_id, amount) values ($1,$2,590000)`, [rec, inv]);
    const recJe = (await q(`select public.fin_post_receipt($1) id`, [rec])).rows[0].id;
    L = await jeLines(recJe);
    ok("receipt JE: Dr bank 570,000 / Dr advance tax 20,000 / Cr AR 590,000", L["1120"] === 570000 && L["1420"] === 20000 && L["1210"] === -590000, JSON.stringify(L));

    // ---------- Aging ----------
    r = await q(`select * from fin_ar_aging('2027-03-31') where customer_id=$1`, [cust]);
    ok("AR aging: 100,000 overdue 26 days in 1–30 bucket", n(r.rows[0]?.d1_30) === 100000 && n(r.rows[0]?.total) === 100000, JSON.stringify(r.rows[0]));
    r = await q(`select * from fin_ap_aging('2027-03-31') where vendor_id=$1`, [vendor]);
    ok("AP aging: paid vendor has nothing outstanding", r.rows.length === 0);
    r = await q(`select * from fin_ap_aging('2027-03-15') where vendor_id=$1`, [vendor]);
    ok("AP aging as of 15 Mar (before payment): 123,600 current", n(r.rows[0]?.current_due) === 123600, JSON.stringify(r.rows[0]));

    // ---------- P&L, balance sheet ----------
    r = await q(`select account_type, sum(amount) s from fin_profit_and_loss('2027-03-01','2027-03-31') group by account_type`);
    const pl = Object.fromEntries(r.rows.map((x) => [x.account_type, n(x.s)]));
    ok("P&L March 2027: revenue 600,000, expenses 120,000 (reversed accrual nets to 0)", pl.revenue === 600000 && pl.expense === 120000, JSON.stringify(pl));
    r = await q(`select section, sum(balance) s from fin_balance_sheet('2027-03-31') group by section`);
    const bs = Object.fromEntries(r.rows.map((x) => [x.section, n(x.s)]));
    ok("balance sheet balances: assets = liabilities + equity", Math.abs(bs.asset - (bs.liability + bs.equity)) < 0.005, JSON.stringify(bs));
    r = await q(`select * from fin_account_ledger($1,'2027-03-01','2027-03-31')`, [bank.gl_account_id]);
    const last = r.rows.at(-1);
    ok("bank ledger running balance = 570,000 − 111,240 = 458,760 (from 0)", n(last.running_balance) - n(r.rows[0].running_balance) === 458760, `${r.rows[0].running_balance} → ${last.running_balance}`);
    r = await q(`select category, sum(inflow) i, sum(outflow) o from fin_cash_flow('2027-03-01','2027-03-31') group by category`);
    const cf = Object.fromEntries(r.rows.map((x) => [x.category, [n(x.i), n(x.o)]]));
    ok("cash flow (operating): in 570,000, out 111,240", cf.operating?.[0] === 570000 && cf.operating?.[1] === 111240, JSON.stringify(cf));

    // ---------- Bank reconciliation ----------
    const opening = (await q(`select coalesce(sum(l.debit-l.credit),0) b from journal_entry_lines l join journal_entries e on e.id=l.journal_entry_id and e.status in ('posted','reversed') where l.account_id=$1 and e.entry_date < '2027-03-01'`, [bank.gl_account_id])).rows[0].b;
    await as("fin1");
    await q(`insert into bank_statement_lines (bank_account_id, txn_date, description, reference, amount) values
             ($1,'2027-03-21','CHQ 1001 cleared','CHQ-1001',-111240),
             ($1,'2027-03-29','IBFT from Test Client','RCPT',570000),
             ($1,'2027-03-31','Bank charges','CHG',-500)`, [bank.id]);
    t = await tryq(`insert into bank_statement_lines (bank_account_id, txn_date, description, reference, amount) values ($1,'2027-03-31','Bank charges','CHG',-500)`, [bank.id]);
    ok("duplicate statement import rejected", !!t.e);
    const matched = (await q(`select public.fin_auto_match($1) n`, [bank.id])).rows[0].n;
    ok("auto-match pairs 2 of 3 statement lines with the ledger", matched === 2, matched);
    // Earlier ledger items never on a statement (e.g. demo data) stay uncleared, so the bank's
    // balance is the cleared opening + this month's statement movements.
    const unclearedBefore = (await q(`select coalesce(sum(amount),0) s from fin_unmatched_book_lines($1,'2027-02-28')`, [bank.id])).rows[0].s;
    const stmtBal = n(opening) - n(unclearedBefore) + 458260;
    r = await q(`select public.fin_reconciliation_summary($1,'2027-03-31',$2) s`, [bank.id, stmtBal]);
    const rs = r.rows[0].s;
    ok("reconciliation: unbooked bank charge −500 explains the gap; difference 0", n(rs.unbooked_bank) === -500 && n(rs.difference) === 0, JSON.stringify(rs));
    t = await tryq(`update bank_statement_lines set matched_line_id = null where bank_account_id=$1`, [bank.id]);
    ok("matching can't be edited directly (functions only)", !!t.e);

    // ---------- Budget ----------
    const bud = (await q(`insert into budgets (fiscal_year, name) values (2027,'Test budget') returning id`)).rows[0].id;
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2026, 6 + m, 1)).toISOString().slice(0, 10);
      await q(`insert into budget_lines (budget_id, account_id, period_start, amount) values ($1,$2,$3,100000)`, [bud, A["5210"], d]);
    }
    t = await tryq(`select public.fin_approve_budget($1)`, [bud]);
    ok("preparer can't approve own budget", !!t.e);
    await as("fin2");
    await q(`select public.fin_approve_budget($1)`, [bud]);
    t = await tryq(`update budget_lines set amount = 1 where budget_id=$1`, [bud]);
    ok("approved budget lines are locked", !!t.e);
    r = await q(`select * from fin_budget_vs_actual($1,'2027-03-01','2027-03-31')`, [bud]);
    ok("budget vs actual (rent, March): budget 100,000 = actual 100,000", n(r.rows[0]?.budget) === 100000 && n(r.rows[0]?.actual) === 100000 && n(r.rows[0]?.variance) === 0, JSON.stringify(r.rows[0]));

    // ---------- Access ----------
    await as("hr");
    r = await q(`select id from bills where id=$1`, [bill]);
    ok("HR can read bills (matrix: Finance R)", r.rows.length === 1);
    t = await tryq(`insert into vendors (code, name) values ('V-HR','x')`);
    ok("HR can't create vendors", !!t.e);
    await as("emp");
    r = await q(`select id from bills`);
    ok("employee can't see bills", r.rows.length === 0);
    t = await tryq(`select * from fin_profit_and_loss('2027-03-01','2027-03-31')`);
    ok("employee P&L returns no amounts", !t.e && t.r.rows.every((x) => n(x.amount) === 0));
    await asAdmin();
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
