// Expenses, travel, loan applications, helpdesk, notifications. ROLLED BACK.
// usage: npm run test:workflows
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-e000-000000000001",
  fin: "00000000-0000-4000-e000-000000000002",
  mgr: "00000000-0000-4000-e000-000000000003",
  emp: "00000000-0000-4000-e000-000000000004",
  out: "00000000-0000-4000-e000-000000000005",
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
  let current = null;
  const as = async (who) => {
    current = who;
    await q("reset role");
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[who], role: "authenticated" })]);
    await q("set local role authenticated");
  };
  const tryq = async (sql, p) => {
    await q("savepoint s");
    try { const r = await q(sql, p); await q("release savepoint s"); return { r }; }
    catch (e) { await q("rollback to savepoint s"); return { e }; }
  };
  // Count as the DB owner (RLS hides others' notifications), then restore the session user.
  const unread = async (who) => {
    const back = current;
    await q("reset role");
    const nn = (await q(`select count(*)::int n from notifications where user_id=$1`, [ids[who]])).rows[0].n;
    if (back) await as(back);
    return nn;
  };

  try {
    await q("begin");
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`, [id, `${k}@wf-test.local`]);
    }
    const dept = (await q(`select id from departments where code='OPS'`)).rows[0].id;
    const mk = async (code, who, mgr) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, department_id, manager_id, status)
                values ($1,$2,'Test',$3,$4,$5,'active') returning id`, [code, who, `${who}@wf-test.local`, dept, mgr])).rows[0].id;
    await mk("WF-001", "hr", null);
    await mk("WF-002", "fin", null);
    const eMgr = await mk("WF-003", "mgr", null);
    const eEmp = await mk("WF-004", "emp", eMgr);
    await mk("WF-005", "out", null);
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin'),($2,'finance')`, [ids.hr, ids.fin]);
    const bank = (await q(`select id from bank_accounts order by name limit 1`)).rows[0].id;
    const cat = Object.fromEntries((await q(`select code, id from expense_categories`)).rows.map((r) => [r.code, r.id]));

    // ---------- Travel request with advance ----------
    await as("emp");
    const tr = (await q(`insert into travel_requests (employee_id, purpose, destination, start_date, end_date, estimated_cost, advance_requested)
                         values ($1,'Site visit','Karachi', current_date - 5, current_date - 3, 60000, 30000) returning id, stage`, [eEmp])).rows[0];
    ok("travel request → manager stage", tr.stage === "manager");
    ok("manager notified of travel request", (await unread("mgr")) >= 1);
    let t = await tryq(`select public.travel_decide($1, true, null)`, [tr.id]);
    ok("employee can't approve own travel", !!t.e);
    await as("mgr");
    let r = await q(`select public.travel_decide($1, true, 'ok') s`, [tr.id]);
    ok("manager approves → still pending (advance needs Finance)", r.rows[0].s === "pending");
    await as("fin");
    t = await tryq(`select public.travel_decide($1, true, null, null)`, [tr.id]);
    ok("advance needs a bank account", !!t.e);
    r = await q(`select public.travel_decide($1, true, null, $2) s`, [tr.id, bank]);
    const trRow = (await q(`select status, advance_paid, advance_entry_id from travel_requests where id=$1`, [tr.id])).rows[0];
    ok("Finance pays advance: approved, 30,000 paid, JE posted", trRow.status === "approved" && n(trRow.advance_paid) === 30000 && trRow.advance_entry_id);

    // ---------- Expense claim ----------
    await as("emp");
    const claim = (await q(`insert into expense_claims (employee_id, travel_request_id, title) values ($1,$2,'Karachi site visit') returning id`, [eEmp, tr.id])).rows[0].id;
    t = await tryq(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,current_date-4,'Dinner',30000)`, [claim, cat.MEALS]);
    ok("per-item limit enforced (meals max 25,000)", !!t.e, t.e?.message);
    await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount, receipt_path) values ($1,$2,current_date-5,'Flight LHE-KHI',28000,$3)`, [claim, cat.TRAVEL, `${eEmp}/${claim}/ticket.pdf`]);
    await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,current_date-5,'DA day 1',6000),($1,$2,current_date-4,'DA day 2',6000)`, [claim, cat.PERDIEM]);
    const hotel = (await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,current_date-4,'Hotel',18000) returning id`, [claim, cat.HOTEL])).rows[0].id;
    t = await tryq(`select public.exp_submit($1)`, [claim]);
    ok("submit blocked: hotel needs a receipt", !!t.e, t.e?.message);
    await q(`delete from expense_items where id=$1`, [hotel]);
    await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount, receipt_path) values ($1,$2,current_date-4,'Hotel',18000,$3)`, [claim, cat.HOTEL, `${ids.out}/x.pdf`]);
    r = await q(`select receipt_path from expense_items where description='Hotel' and claim_id=$1`, [claim]);
    ok("receipt path outside own folder is dropped", r.rows[0].receipt_path === null);
    await q(`delete from expense_items where claim_id=$1 and description='Hotel'`, [claim]);
    await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount, receipt_path) values ($1,$2,current_date-4,'Hotel',18000,$3)`, [claim, cat.HOTEL, `${eEmp}/${claim}/hotel.jpg`]);
    await q(`select public.exp_submit($1)`, [claim]);
    r = await q(`select status, stage, total, advance_adjusted, net_payable from expense_claims where id=$1`, [claim]);
    ok("submitted: total 58,000, advance 30,000 adjusted, net 28,000", r.rows[0].status === "submitted" && n(r.rows[0].total) === 58000 && n(r.rows[0].advance_adjusted) === 30000 && n(r.rows[0].net_payable) === 28000, JSON.stringify(r.rows[0]));
    t = await tryq(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,current_date-1,'Late add',100)`, [claim, cat.PERDIEM]);
    ok("submitted claim can't be changed", !!t.e);
    t = await tryq(`update expense_claims set status='approved' where id=$1`, [claim]);
    ok("employee can't set claim status", !!t.e || t.r.rowCount === 0);

    await as("out");
    t = await tryq(`select public.exp_decide($1, true, null)`, [claim]);
    ok("unrelated employee can't approve", !!t.e);
    r = await q(`select id from expense_claims where id=$1`, [claim]);
    ok("unrelated employee can't see the claim", r.rows.length === 0);
    await as("mgr");
    await q(`select public.exp_decide($1, true, 'Fine')`, [claim]);
    await as("hr");
    t = await tryq(`select public.exp_decide($1, true, null)`, [claim]);
    ok("finance stage: HR can't verify", !!t.e);
    await as("fin");
    r = await q(`select public.exp_decide($1, true, null) s`, [claim]);
    ok("Finance approves → approved (awaiting reimbursement)", r.rows[0].s === "approved");
    const je = (await q(`select journal_entry_id from expense_claims where id=$1`, [claim])).rows[0].journal_entry_id;
    r = await q(`select a.code, sum(l.debit-l.credit) net from journal_entry_lines l join chart_of_accounts a on a.id=l.account_id where l.journal_entry_id=$1 group by a.code`, [je]);
    const L = Object.fromEntries(r.rows.map((x) => [x.code, n(x.net)]));
    ok("claim JE: Dr travel 28k, DA+hotel 30k; Cr advance 30k, Cr payable 28k", L["5240"] === 28000 && L["5241"] === 30000 && L["1320"] === -30000 && L["2310"] === -28000, JSON.stringify(L));
    r = await q(`select source from journal_entries where id=$1`, [je]);
    ok("claim journal is a system 'expense' entry", r.rows[0].source === "expense", r.rows[0].source);
    t = await tryq(`select public.fin_reverse_journal($1, current_date, 'try')`, [je]);
    ok("expense journal can't be reversed from the Journals screen", !!t.e, t.e?.message);
    r = await q(`select advance_settled from travel_requests where id=$1`, [tr.id]);
    ok("travel advance marked settled", n(r.rows[0].advance_settled) === 30000);
    await q(`select public.exp_pay($1,$2)`, [claim, bank]);
    r = await q(`select status from expense_claims where id=$1`, [claim]);
    ok("reimbursement paid", r.rows[0].status === "paid");
    ok("employee notified along the way", (await unread("emp")) >= 3, await unread("emp"));

    // ---------- Loan application ----------
    await as("emp");
    const app = (await q(`insert into loan_applications (employee_id, amount, installments, purpose) values ($1,60000,6,'Medical') returning id, stage`, [eEmp])).rows[0];
    ok("loan application → manager stage", app.stage === "manager");
    t = await tryq(`insert into loan_applications (employee_id, amount, installments, purpose) values ($1,1000,1,'x')`, [eEmp]);
    ok("only one pending application", !!t.e);
    await as("mgr");
    await q(`select public.loan_app_decide($1, true, null)`, [app.id]);
    await as("fin");
    r = await q(`select public.loan_app_decide($1, true, null, '2027-01-01') s`, [app.id]);
    const loan = (await q(`select l.principal, l.installment_amount, l.balance, l.start_month, l.journal_entry_id from loan_applications a join loans l on l.id=a.loan_id where a.id=$1`, [app.id])).rows[0];
    ok("Finance approval creates loan: 60,000 in 6 × 10,000 from Jan 2027, disbursed", r.rows[0].s === "approved" && n(loan?.installment_amount) === 10000 && n(loan?.balance) === 60000 && loan?.journal_entry_id, JSON.stringify(loan));

    // ---------- Helpdesk ----------
    const pay = (await q(`select id from ticket_categories where name='Payroll & payslips'`)).rows[0].id;
    await as("emp");
    const tk = (await q(`insert into tickets (requester_id, category_id, subject, description, priority) values ($1,$2,'Tax on payslip looks wrong','Please check','high') returning id, status, extract(epoch from response_due_at - created_at)/3600 rh, extract(epoch from resolution_due_at - created_at)/3600 sh`, [eEmp, pay])).rows[0];
    ok("SLA: high priority halves 8h/48h → 4h/24h", Math.round(tk.rh) === 4 && Math.round(tk.sh) === 24, `${tk.rh}/${tk.sh}`);
    t = await tryq(`update tickets set priority='critical' where id=$1`, [tk.id]);
    ok("requester can't change priority", !!t.e);
    t = await tryq(`update tickets set status='resolved' where id=$1`, [tk.id]);
    ok("requester can't resolve", !!t.e);
    await as("out");
    r = await q(`select id from tickets where id=$1`, [tk.id]);
    ok("other employees can't see the ticket", r.rows.length === 0);
    await as("hr");
    await q(`insert into ticket_comments (ticket_id, body, is_internal) values ($1,'Checking with payroll team',true)`, [tk.id]);
    await q(`insert into ticket_comments (ticket_id, body) values ($1,'We are looking into it')`, [tk.id]);
    r = await q(`select status, first_response_at is not null fr from tickets where id=$1`, [tk.id]);
    ok("first public reply → in progress, response time recorded", r.rows[0].status === "in_progress" && r.rows[0].fr);
    await q(`update tickets set assignee_id=$2 where id=$1`, [tk.id, eMgr]);
    await as("mgr");
    await q(`update tickets set status='resolved' where id=$1`, [tk.id]);
    await as("emp");
    r = await q(`select count(*)::int n from ticket_comments where ticket_id=$1`, [tk.id]);
    ok("requester doesn't see internal notes", r.rows[0].n === 1, r.rows[0].n);
    t = await tryq(`update tickets set status='closed', satisfaction=5 where id=$1`, [tk.id]);
    ok("requester closes & rates resolved ticket", !t.e, t.e?.message);

    // ---------- Notifications privacy ----------
    r = await q(`select count(*)::int n from notifications where user_id <> $1`, [ids.emp]);
    ok("users only see their own notifications", r.rows[0].n === 0);
    t = await tryq(`insert into notifications (user_id, title) values ($1,'spoof')`, [ids.mgr]);
    ok("users can't create notifications", !!t.e);
    t = await tryq(`update notifications set read_at = now() where user_id=$1`, [ids.emp]);
    ok("users can mark their notifications read", !t.e && t.r.rowCount > 0);
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
