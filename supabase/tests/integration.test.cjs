// Cross-module integration: attendance → leave → loans → payroll → GL → expenses → AR → reports → notifications.
// One employee-month end to end, all ROLLED BACK. usage: npm run test:integration
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-f000-000000000001",
  fin1: "00000000-0000-4000-f000-000000000002",
  fin2: "00000000-0000-4000-f000-000000000003",
  mgr: "00000000-0000-4000-f000-000000000004",
  emp: "00000000-0000-4000-f000-000000000005",
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
  const admin = async () => { await q("reset role"); await q(`select set_config('request.jwt.claims', '', true)`); };

  try {
    await q("begin");
    // A clean past month in an open period: Aug 2026 (TY2027).
    await q(`delete from loan_repayments where payslip_id in (select p.id from payslips p join payroll_runs r on r.id=p.payroll_run_id where r.tax_year=2027)`);
    await q(`delete from payroll_runs where tax_year = 2027`);
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`, [id, `${k}@int-test.local`]);
    }
    const dept = (await q(`select id from departments where code='OPS'`)).rows[0].id;
    const cc = (await q(`insert into cost_centers (code, name) values ('CC-INT','Integration CC') returning id`)).rows[0].id;
    await q(`update departments set cost_center_id=$1 where id=$2`, [cc, dept]);
    const mk = async (code, who, mgr, bio) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, manager_id, status, joining_date, biometric_user_id)
                values ($1,$2,'Test',$3,'male',$4,$5,'confirmed','2020-01-01',$6) returning id`, [code, who, `${who}@int-test.local`, dept, mgr, bio])).rows[0].id;
    await mk("IN-001", "hr", null, null);
    await mk("IN-002", "fin1", null, null);
    await mk("IN-003", "fin2", null, null);
    const eMgr = await mk("IN-004", "mgr", null, null);
    const eEmp = await mk("IN-005", "emp", eMgr, "INT-5005");
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin'),($2,'finance'),($3,'finance')`, [ids.hr, ids.fin1, ids.fin2]);
    const std = (await q(`select id from salary_structures where code='STD'`)).rows[0].id;
    await q(`insert into employee_salaries (employee_id, effective_from, structure_id, basic_salary) values ($1,'2026-01-01',$2,100000)`, [eEmp, std]);
    const ul = (await q(`select id from leave_types where code='UL'`)).rows[0].id;
    await q(`insert into leave_balances (employee_id, leave_type_id, year, allocated) values ($1,$2,2026,30)`, [eEmp, ul]);

    // 1) Attendance via the biometric ingestion RPC (as the device would call it, anonymous).
    await q(`insert into biometric_devices (code, name, api_key_hash) values ('INT-DEV','Integration device', encode(extensions.digest('int-key','sha256'),'hex'))`);
    await q("set local role anon");
    const events = [];
    for (const d of ["2026-08-03", "2026-08-04", "2026-08-06"]) events.push({ user_id: "INT-5005", timestamp: `${d}T08:58:00+05:00` }, { user_id: "INT-5005", timestamp: `${d}T17:40:00+05:00` });
    const ing = (await q(`select public.ingest_biometric_events('INT-DEV','int-key',$1::jsonb) r`, [JSON.stringify(events)])).rows[0].r;
    ok("1. biometric device posts 6 punches", ing.accepted === 6, JSON.stringify(ing));
    await admin();
    await q(`select private.recompute_attendance($1,'2026-08-05')`, [eEmp]); // no punches → absent
    let r = await q(`select work_date::text d, status from attendance where employee_id=$1 and work_date between '2026-08-03' and '2026-08-06' order by 1`, [eEmp]);
    ok("   attendance computed: 3 present + Aug 5 absent", r.rows.map((x) => x.status).join(",") === "present,present,absent,present", r.rows.map((x) => `${x.d}:${x.status}`).join(" "));

    // 2) Unpaid leave 10–11 Aug, approved by the manager → attendance shows leave.
    await as("emp");
    const lr = (await q(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,'2026-08-10','2026-08-11','Personal') returning id`, [eEmp, ul])).rows[0].id;
    await as("mgr");
    await q(`update leave_requests set status='approved' where id=$1`, [lr]);
    await as("hr");
    r = await q(`select status from leave_requests where id=$1`, [lr]);
    if (r.rows[0].status === "pending") await q(`update leave_requests set status='approved' where id=$1`, [lr]); // UL needs HR
    r = await q(`select status from leave_requests where id=$1`, [lr]);
    ok("2. unpaid leave approved (manager → HR)", r.rows[0].status === "approved");

    // 3) Loan application → manager → finance → loan + disbursement JE.
    await as("emp");
    const app = (await q(`insert into loan_applications (employee_id, amount, installments, purpose) values ($1,50000,5,'Family') returning id`, [eEmp])).rows[0].id;
    await as("mgr");
    await q(`select public.loan_app_decide($1,true,null)`, [app]);
    await as("fin1");
    await q(`select public.loan_app_decide($1,true,null,'2026-08-01')`, [app]);
    const loan = (await q(`select l.id, l.balance, l.journal_entry_id from loan_applications a join loans l on l.id=a.loan_id where a.id=$1`, [app])).rows[0];
    ok("3. loan created and disbursement posted", n(loan.balance) === 50000 && loan.journal_entry_id);

    // 4) Payroll Aug 2026: absent 1 + unpaid leave 2 = 3 unpaid days; loan installment 10,000.
    await as("hr");
    const run = (await q(`select public.payroll_create_run('2026-08-01') id`)).rows[0].id;
    await q(`select public.payroll_process_run($1)`, [run]);
    const slip = (await q(`select * from payslips where payroll_run_id=$1 and employee_id=$2`, [run, eEmp])).rows[0];
    ok("4. payroll: 3 unpaid days (1 absent + 2 unpaid leave) → 28 of 31 payable", n(slip.unpaid_days) === 3 && n(slip.payable_days) === 28, `${slip.unpaid_days} / ${slip.payable_days}`);
    ok("   basic prorated 100,000 × 28/31 = 90,323", n(slip.basic_salary) === 90323, slip.basic_salary);
    ok("   loan installment 10,000 deducted", n(slip.loan_deduction) === 10000);
    await q(`select public.payroll_transition($1,'review')`, [run]);
    await as("fin1");
    await q(`select public.payroll_transition($1,'approved')`, [run]);
    await q(`select public.payroll_transition($1,'posted')`, [run]);
    const pje = (await q(`select journal_entry_id from payroll_runs where id=$1`, [run])).rows[0].journal_entry_id;
    r = await q(`select count(*)::int n from journal_entry_lines where journal_entry_id=$1 and cost_center_id=$2`, [pje, cc]);
    ok("   payroll JE charges salary to the department's cost center", r.rows[0].n >= 1);
    r = await q(`select balance from loans where id=$1`, [loan.id]);
    ok("   loan balance 50,000 → 40,000 after posting", n(r.rows[0].balance) === 40000);

    // 5) Expense claim → manager → finance → GL → paid.
    const cat = (await q(`select id from expense_categories where code='PERDIEM'`)).rows[0].id;
    await as("emp");
    const claim = (await q(`insert into expense_claims (employee_id, title) values ($1,'Field DA') returning id`, [eEmp])).rows[0].id;
    await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,'2026-10-01','DA',5000)`, [claim, cat]);
    await q(`select public.exp_submit($1)`, [claim]);
    await as("mgr");
    await q(`select public.exp_decide($1,true,null)`, [claim]);
    await as("fin2");
    await q(`select public.exp_decide($1,true,null)`, [claim]);
    const bank = (await q(`select b.id from bank_accounts b join chart_of_accounts a on a.id=b.gl_account_id where a.code='1120'`)).rows[0].id;
    await q(`select public.exp_pay($1,$2)`, [claim, bank]);
    r = await q(`select status from expense_claims where id=$1`, [claim]);
    ok("5. expense claim approved, posted and reimbursed", r.rows[0].status === "paid");

    // 6) AR: invoice + receipt.
    await as("fin1");
    const cust = (await q(`insert into customers (code, name) values ('C-INT','Integration client') returning id`)).rows[0].id;
    const inv = (await q(`insert into invoices (customer_id, invoice_date, due_date) values ($1,'2026-08-10','2026-08-28') returning id`, [cust])).rows[0].id;
    await q(`insert invoice_lines (invoice_id, account_id, amount, cost_center_id) select $1, id, 400000, $2 from chart_of_accounts where code='4120'`.replace("insert invoice_lines", "insert into invoice_lines"), [inv, cc]);
    await q(`select public.fin_post_invoice($1)`, [inv]);
    const rec = (await q(`insert into customer_receipts (customer_id, receipt_date, bank_account_id, amount) values ($1,'2026-08-20',$2,400000) returning id`, [cust, bank])).rows[0].id;
    await q(`insert into receipt_allocations (receipt_id, invoice_id, amount) values ($1,$2,400000)`, [rec, inv]);
    await q(`select public.fin_post_receipt($1)`, [rec]);
    ok("6. invoice posted and fully received", true);

    // 7) Reports tie out.
    r = await q(`select sum(debit) dr, sum(credit) cr from trial_balance('2026-08-31')`);
    ok("7. trial balance balanced after all modules", n(r.rows[0].dr) === n(r.rows[0].cr), `${r.rows[0].dr} = ${r.rows[0].cr}`);
    r = await q(`select account_type, sum(amount) s from fin_profit_and_loss('2026-08-01','2026-08-31',$1) group by 1`, [cc]);
    const pl = Object.fromEntries(r.rows.map((x) => [x.account_type, n(x.s)]));
    ok("   P&L for the cost center: revenue 400,000 and payroll expense present", pl.revenue === 400000 && pl.expense > 0, JSON.stringify(pl));
    r = await q(`select section, sum(balance) s from fin_balance_sheet('2026-08-31') group by 1`);
    const bs = Object.fromEntries(r.rows.map((x) => [x.section, n(x.s)]));
    ok("   balance sheet balances", Math.abs(bs.asset - bs.liability - bs.equity) < 0.01, JSON.stringify(bs));
    r = await q(`select * from attendance_monthly_summary('2026-08-01') where employee_id=$1`, [eEmp]);
    ok("   attendance summary: 3 present, 1 absent, 2 leave", r.rows[0]?.present === 3 && r.rows[0]?.absent === 1 && r.rows[0]?.on_leave === 2, JSON.stringify(r.rows[0]));

    // 8) Notifications reached the right people.
    await admin();
    r = await q(`select u.email, count(*)::int n from notifications x join auth.users u on u.id=x.user_id where u.email like '%@int-test.local' group by 1 order by 1`);
    const notes = Object.fromEntries(r.rows.map((x) => [x.email.split("@")[0], x.n]));
    ok("8. notifications: manager, finance and employee all notified", notes.mgr > 0 && notes.fin1 > 0 && notes.emp > 0, JSON.stringify(notes));
    r = await q(`select count(*)::int n from notifications x join auth.users u on u.id=x.user_id where u.email='emp@int-test.local' and x.title='Your payslip is ready'`);
    ok("   employee told their payslip is ready", r.rows[0].n === 1);
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
