// Payroll + GL tests. Everything runs in one transaction that is ROLLED BACK.
// usage: npm run test:payroll   (reads DATABASE_URL from .env.local)
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-c000-000000000001",
  fin: "00000000-0000-4000-c000-000000000002",
  emp: "00000000-0000-4000-c000-000000000003",
  emp2: "00000000-0000-4000-c000-000000000004",
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  — " + extra : ""}`);
};
const n = (v) => Number(v);

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

  try {
    await q("begin");
    // The test uses Oct–Dec 2026; clear any (demo) runs there — rolled back at the end.
    await q(`delete from loan_repayments where payslip_id in (select p.id from payslips p join payroll_runs r on r.id = p.payroll_run_id where r.period_month between '2026-07-01' and '2027-06-01')`);
    await q(`delete from payroll_runs where period_month between '2026-07-01' and '2027-06-01'`);
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`,
        [id, `${k}@pay-test.local`]);
    }
    const dept = (await q(`select id from departments where code='FIN'`)).rows[0].id;
    const mk = async (code, who, joined = "2020-01-01") =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, status, joining_date)
                values ($1,$2,'Test',$3,'male',$4,'confirmed',$5) returning id`, [code, who, `${who}@pay-test.local`, dept, joined])).rows[0].id;
    const eHr = await mk("PY-001", "hr");
    const eFin = await mk("PY-002", "fin");
    const eEmp = await mk("PY-003", "emp");
    const eEmp2 = await mk("PY-004", "emp2");
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin'),($2,'finance')`, [ids.hr, ids.fin]);
    const std = (await q(`select id from salary_structures where code='STD'`)).rows[0].id;

    // --- HR sets salaries and a loan ---
    await as("hr");
    let t = await tryq(`insert into employee_salaries (employee_id, effective_from, structure_id, basic_salary) values ($1,'2026-01-01',$2,100000),($3,'2026-01-01',$2,62000)`, [eEmp, std, eEmp2]);
    ok("HR sets salaries", !t.e, t.e?.message);
    t = await tryq(`insert into loans (employee_id, principal, installment_amount, start_month, purpose) values ($1,30000,5000,'2026-10-01','Emergency') returning id`, [eEmp]);
    if (t.r) t.r = await q(`select id, balance, journal_entry_id from loans where id=$1`, [t.r.rows[0].id]);
    const loan = t.r?.rows[0];
    ok("HR records loan → balance = principal, JE auto-posted", !t.e && n(loan?.balance) === 30000 && loan?.journal_entry_id, t.e?.message);
    t = await tryq(`update loans set balance = 0 where id=$1`, [loan?.id]);
    ok("loan balance can't be edited directly", !!t.e);

    // EMP2: one absent day in Oct 2026 (Wed 14th), for proration
    await asAdmin();
    await q(`insert into attendance (employee_id, work_date, status) values ($1,'2026-10-14','absent')`, [eEmp2]);

    // --- employee can't run payroll or see salaries of others ---
    await as("emp");
    t = await tryq(`select public.payroll_create_run('2026-10-01')`);
    ok("employee cannot create a payroll run", !!t.e);
    let r = await q(`select employee_id from employee_salaries`);
    ok("employee sees only own salary record", r.rows.length === 1 && r.rows[0].employee_id === eEmp, `${r.rows.length} rows`);

    // --- HR creates + processes ---
    await as("hr");
    const run = (await q(`select public.payroll_create_run('2026-10-01') as id`)).rows[0].id;
    t = await tryq(`select public.payroll_create_run('2026-10-01')`);
    ok("only one regular run per month", !!t.e, t.e?.message);
    await q(`select public.payroll_process_run($1)`, [run]);
    const slip = (await q(`select * from payslips where payroll_run_id=$1 and employee_id=$2`, [run, eEmp])).rows[0];
    ok("gross = 100,000 + HRA 45,000 + UTIL 10,000 + MED 10,000 = 165,000", n(slip?.gross_pay) === 165000, slip?.gross_pay);
    ok("taxable excludes medical = 155,000", n(slip?.taxable_income) === 155000, slip?.taxable_income);
    ok("income tax (TY2027 projection, 9 months left) = 3,050", n(slip?.income_tax) === 3050, slip?.income_tax);
    ok("EOBI employee 400 / employer 2,000", n(slip?.eobi_employee) === 400 && n(slip?.eobi_employer) === 2000);
    ok("loan installment 5,000 deducted", n(slip?.loan_deduction) === 5000);
    ok("net = 165,000 − 3,050 − 400 − 5,000 = 156,550", n(slip?.net_pay) === 156550, slip?.net_pay);
    const slip2 = (await q(`select * from payslips where payroll_run_id=$1 and employee_id=$2`, [run, eEmp2])).rows[0];
    ok("1 absent day → 30 payable days, basic 62,000 × 30/31 = 60,000", n(slip2?.payable_days) === 30 && n(slip2?.basic_salary) === 60000, `${slip2?.payable_days} ${slip2?.basic_salary}`);
    r = await q(`select count(*)::int n from payslips where payroll_run_id=$1 and employee_id in ($2,$3)`, [run, eHr, eFin]);
    ok("employees without a salary record are not on the run", r.rows[0].n === 0);

    // --- employee can't see a draft payslip ---
    await as("emp");
    r = await q(`select id from payslips where employee_id=$1`, [eEmp]);
    ok("employee can't see own payslip while run is draft", r.rows.length === 0);
    t = await tryq(`update payroll_runs set status='approved' where id=$1`, [run]);
    ok("payroll run status can't be set directly", !!t.e || t.r.rowCount === 0);

    // --- workflow & separation of duties ---
    await as("hr");
    await q(`select public.payroll_transition($1,'review')`, [run]);
    t = await tryq(`select public.payroll_transition($1,'approved')`, [run]);
    ok("HR cannot approve payroll (Finance only)", !!t.e, t.e?.message);
    await as("fin");
    t = await tryq(`select public.payroll_process_run($1)`, [run]);
    ok("run under review cannot be reprocessed", !!t.e);
    t = await tryq(`select public.payroll_transition($1,'approved')`, [run]);
    ok("Finance approves (different person than submitter)", !t.e, t.e?.message);
    await as("emp");
    r = await q(`select net_pay from payslips where employee_id=$1`, [eEmp]);
    ok("employee sees own payslip once approved", r.rows.length === 1);
    r = await q(`select id from payslips where employee_id=$1`, [eEmp2]);
    ok("employee can't see a colleague's payslip", r.rows.length === 0);

    await as("fin");
    t = await tryq(`select public.payroll_transition($1,'posted')`, [run]);
    ok("Finance posts to GL", !t.e, t.e?.message);
    const je = (await q(`select journal_entry_id from payroll_runs where id=$1`, [run])).rows[0].journal_entry_id;
    r = await q(`select sum(debit) dr, sum(credit) cr from journal_entry_lines where journal_entry_id=$1`, [je]);
    ok("payroll JE balanced", n(r.rows[0].dr) === n(r.rows[0].cr) && n(r.rows[0].dr) > 0, `${r.rows[0].dr} = ${r.rows[0].cr}`);
    r = await q(`select a.code, l.debit, l.credit from journal_entry_lines l join chart_of_accounts a on a.id=l.account_id where l.journal_entry_id=$1`, [je]);
    const line = (code) => r.rows.filter((x) => x.code === code).reduce((s, x) => s + n(x.debit) - n(x.credit), 0);
    const tot = (await q(
      `select sum(eobi_employer) er, sum(eobi_employee + eobi_employer) eobi, sum(loan_deduction) loans, sum(net_pay) net
         from payslips where payroll_run_id=$1`, [run])).rows[0];
    ok("Dr EOBI employer expense = run's employer EOBI", line("5130") === n(tot.er), `${line("5130")} vs ${tot.er}`);
    ok("Cr EOBI payable = employee + employer EOBI", line("2130") === -n(tot.eobi), `${line("2130")} vs ${tot.eobi}`);
    ok("Cr Loans & Advances = loan recoveries (incl. test employee's 5,000)", line("1310") === -n(tot.loans) && n(tot.loans) >= 5000, line("1310"));
    ok("Cr Salaries payable = total net pay", line("2110") === -n(tot.net), line("2110"));
    r = await q(`select balance, status from loans where id=$1`, [loan?.id]);
    ok("loan balance reduced to 25,000", n(r.rows[0].balance) === 25000);
    t = await tryq(`update journal_entries set description='x' where id=$1`, [je]);
    ok("posted JE cannot be edited (no direct write grant)", !!t.e);
    await asAdmin();
    t = await tryq(`update journal_entries set description='x' where id=$1`, [je]);
    ok("posted JE immutable even for the DB owner", !!t.e, t.e?.message);
    t = await tryq(`delete from journal_entry_lines where journal_entry_id=$1`, [je]);
    ok("posted JE lines cannot be deleted", !!t.e);

    await as("fin");
    t = await tryq(`select public.payroll_transition($1,'paid')`, [run]);
    ok("Finance marks paid → disbursement JE", !t.e, t.e?.message);
    r = await q(`select sum(debit) dr, sum(credit) cr from trial_balance('2026-12-31')`);
    ok("trial balance: total debits = total credits", n(r.rows[0].dr) === n(r.rows[0].cr), `${r.rows[0].dr} / ${r.rows[0].cr}`);
    r = await q(`select balance from trial_balance('2026-12-31') where code='2110'`);
    ok("salaries payable cleared to 0 after payment", n(r.rows[0].balance) === 0, r.rows[0].balance);

    // Parallel run can't be approved
    const prun = (await q(`select public.payroll_create_run('2026-10-01', true) as id`)).rows[0].id;
    await q(`select public.payroll_process_run($1)`, [prun]);
    await as("hr");
    await q(`select public.payroll_transition($1,'review')`, [prun]);
    await as("fin");
    t = await tryq(`select public.payroll_transition($1,'approved')`, [prun]);
    ok("parallel (validation) run cannot be approved", !!t.e, t.e?.message);

    // YTD guard: a later month calculated before the earlier one was posted can't be submitted.
    await as("hr");
    const dec = (await q(`select public.payroll_create_run('2026-12-01') as id`)).rows[0].id;
    await q(`select public.payroll_process_run($1)`, [dec]);
    const nov0 = (await q(`select public.payroll_create_run('2026-11-01') as id`)).rows[0].id;
    await q(`select public.payroll_process_run($1)`, [nov0]);
    t = await tryq(`select public.payroll_transition($1,'review')`, [dec]);
    ok("can't submit December while November is unposted", !!t.e, t.e?.message);
    await asAdmin();
    await q(`delete from payroll_runs where id in ($1,$2)`, [dec, nov0]);

    // Next month: YTD-aware tax stays 3,050 (same income)
    await as("hr");
    const run2 = (await q(`select public.payroll_create_run('2026-11-01') as id`)).rows[0].id;
    await q(`select public.payroll_process_run($1)`, [run2]);
    r = await q(`select income_tax, loan_deduction from payslips where payroll_run_id=$1 and employee_id=$2`, [run2, eEmp]);
    ok("November tax uses YTD: (27,450 − 3,050) / 8 = 3,050", n(r.rows[0].income_tax) === 3050, r.rows[0].income_tax);

    // --- F&F ---
    await asAdmin();
    await q(`update employees set exit_date='2026-11-30', status='notice' where id=$1`, [eEmp]);
    const al = (await q(`select id from leave_types where code='AL'`)).rows[0].id;
    await q(`insert into leave_balances (employee_id, leave_type_id, year, allocated) values ($1,$2,2026,14)`, [eEmp, al]);
    await as("hr");
    const sug = (await q(`select public.fnf_suggest($1) s`, [eEmp])).rows[0].s;
    ok("F&F suggestion: 14 leave days × 100,000/30 = 46,667; loan 25,000", n(sug.leave_encashment) === 46667 && n(sug.loan_balance) === 25000, JSON.stringify(sug));
    const f = (await q(`insert into fnf_settlements (employee_id, exit_date, basic_salary, leave_days_encashed, leave_encashment, loan_recovery)
                        values ($1,'2026-11-30',100000,14,46667,25000) returning id, net_amount`, [eEmp])).rows[0];
    ok("F&F net = 46,667 − 25,000 = 21,667", n(f.net_amount) === 21667);
    t = await tryq(`update fnf_settlements set status='approved' where id=$1`, [f.id]);
    ok("F&F can't be approved by direct update", !!t.e);
    await as("fin");
    t = await tryq(`select public.fnf_approve($1)`, [f.id]);
    ok("Finance approves F&F → JE posted", !t.e, t.e?.message);
    r = await q(`select balance, status from loans where id=$1`, [loan?.id]);
    ok("F&F closes the loan", n(r.rows[0].balance) === 0 && r.rows[0].status === "closed", JSON.stringify(r.rows[0]));
    r = await q(`select sum(debit) dr, sum(credit) cr from trial_balance('2026-12-31')`);
    ok("trial balance still balanced after F&F", n(r.rows[0].dr) === n(r.rows[0].cr));
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
