// RLS + workflow tests. Everything runs in one transaction that is ROLLED BACK.
// usage: npm run test:db   (reads DATABASE_URL from .env.local)
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-a000-000000000001",
  mgr: "00000000-0000-4000-a000-000000000002",
  emp: "00000000-0000-4000-a000-000000000003",
  out: "00000000-0000-4000-a000-000000000004",
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

(async () => {
  const c = new Client({ connectionString: process.argv[2] || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, p) => c.query(sql, p);
  const as = async (who) => {
    await q("reset role");
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[who], role: "authenticated" })]);
    await q("set local role authenticated");
  };
  const asAdmin = () => q("reset role");
  const tryq = async (sql, p) => {
    await q("savepoint s");
    try { const r = await q(sql, p); await q("release savepoint s"); return { r }; }
    catch (e) { await q("rollback to savepoint s"); return { e }; }
  };

  try {
    await q("begin");
    // --- fixtures (as postgres) ---
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`,
        [id, `${k}@test.aeglobal.local`]);
    }
    const dept = (await q(`select id from departments where code='HR'`)).rows[0].id;
    const dept2 = (await q(`select id from departments where code='IT'`)).rows[0].id;
    const mk = async (code, who, mgr, gender, d = dept) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, manager_id, status)
                values ($1, $2, 'Test', $3, $4, $5, $6, 'active') returning id, user_id`,
        [code, who, `${who}@test.aeglobal.local`, gender, d, mgr])).rows[0];
    const eHr = await mk("T-001", "hr", null, "male");
    const eMgr = await mk("T-002", "mgr", null, "male");
    const eEmp = await mk("T-003", "emp", eMgr.id, "male");
    const eOut = await mk("T-004", "out", null, "female", dept2);
    ok("auto-link: employee.user_id set from confirmed auth user", eEmp.user_id === ids.emp);
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin')`, [ids.hr]);
    await q(`insert into employee_private (employee_id, cnic, iban) values ($1, '35202-1234567-1', 'PK36SCBL0000001123456702')`, [eEmp.id]);
    const al = (await q(`select id from leave_types where code='AL'`)).rows[0].id;
    const ml = (await q(`select id from leave_types where code='ML'`)).rows[0].id;
    for (const e of [eEmp, eOut]) await q(`insert into leave_balances (employee_id, leave_type_id, year, allocated) values ($1,$2,2027,14)`, [e.id, al]);

    // --- employee (emp) ---
    await as("emp");
    let r = await q(`select id from employees`);
    ok("employee sees only own employee row", r.rows.length === 1 && r.rows[0].id === eEmp.id, `saw ${r.rows.length}`);
    r = await q(`select cnic from employee_private`);
    ok("employee can read own CNIC", r.rows.length === 1);
    let t = await tryq(`update employees set phone='0300-1234567' where id=$1`, [eEmp.id]);
    ok("employee can update own phone (ESS-02)", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`update employees set department_id=$2 where id=$1`, [eEmp.id, dept2]);
    ok("employee CANNOT change own department", !!t.e, t.e?.message);
    t = await tryq(`update employees set status='exited' where id=$1`, [eEmp.id]);
    ok("employee CANNOT change own status", !!t.e);
    t = await tryq(`update employee_private set iban='PK36SCBL0000009999999999' where employee_id=$1`, [eEmp.id]);
    ok("employee CANNOT change own IBAN", !!t.e || t.r.rowCount === 0);
    t = await tryq(`update employees set phone='x' where id=$1`, [eOut.id]);
    ok("employee CANNOT update another employee", !!t.e || t.r.rowCount === 0);
    t = await tryq(`insert into user_roles (user_id, role) values ($1,'system_admin')`, [ids.emp]);
    ok("employee CANNOT grant self a role", !!t.e);
    t = await tryq(`select * from audit_logs`);
    ok("employee cannot read audit logs", !t.e && t.r.rows.length === 0);
    t = await tryq(`select * from position_salary_bands`);
    ok("employee cannot read salary bands", !t.e && t.r.rows.length === 0);

    // Leave: 2027-03-01 (Mon) .. 03-05 (Fri) = 5 days
    t = await tryq(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,'2027-03-01','2027-03-05','trip') returning id, days, stage, status`, [eEmp.id, al]);
    ok("employee applies for 5 working days", !t.e && Number(t.r.rows[0].days) === 5 && t.r.rows[0].stage === "manager", t.e?.message);
    const lr = t.r?.rows[0]?.id;
    t = await tryq(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1,$2,'2027-03-22','2027-03-26')`, [eEmp.id, al]);
    ok("holiday excluded (23 Mar Pakistan Day) → 4 days", !t.e);
    r = await q(`select days from leave_requests where start_date='2027-03-22'`);
    ok("… days computed = 4", Number(r.rows[0]?.days) === 4, `got ${r.rows[0]?.days}`);
    t = await tryq(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1,$2,'2027-03-03','2027-03-04')`, [eEmp.id, al]);
    ok("overlapping leave rejected", !!t.e, t.e?.message);
    t = await tryq(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1,$2,'2027-06-01','2027-06-10')`, [eEmp.id, al]);
    ok("insufficient balance rejected (5+4 used, 8 more)", !!t.e, t.e?.message);
    t = await tryq(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1,$2,'2027-07-01','2027-07-01')`, [eOut.id, al]);
    ok("employee CANNOT apply on behalf of someone else", !!t.e);
    t = await tryq(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1,$2,'2027-07-01','2027-07-01')`, [eEmp.id, ml]);
    ok("maternity leave blocked for male employee", !!t.e, t.e?.message);
    t = await tryq(`update leave_requests set status='approved' where id=$1`, [lr]);
    ok("employee CANNOT approve own leave", !!t.e, t.e?.message);
    t = await tryq(`update leave_requests set manager_decided_by=$2 where id=$1`, [lr, eMgr.id]);
    r = await q(`select manager_decided_by from leave_requests where id=$1`, [lr]);
    ok("employee CANNOT forge approver field", r.rows[0].manager_decided_by === null);
    r = await q(`select available from leave_balance_summary`);
    ok("balance summary: 14 − 9 pending = 5 available", Number(r.rows[0]?.available) === 5, `got ${r.rows[0]?.available}`);

    // --- outsider (no relationship) ---
    await as("out");
    r = await q(`select id from leave_requests where id=$1`, [lr]);
    ok("unrelated employee cannot see others' leave", r.rows.length === 0);
    t = await tryq(`update leave_requests set status='approved' where id=$1`, [lr]);
    ok("unrelated employee cannot approve", !!t.e || t.r.rowCount === 0);
    r = await q(`select cnic from employee_private`);
    ok("unrelated employee cannot read others' CNIC", r.rows.length === 0);

    // --- manager ---
    await as("mgr");
    r = await q(`select id from employees order by employee_code`);
    ok("manager sees self + direct report only", r.rows.length === 2, `saw ${r.rows.length}`);
    r = await q(`select cnic from employee_private`);
    ok("manager CANNOT read report's CNIC", r.rows.length === 0);
    t = await tryq(`update leave_requests set status='approved', decision_comment='ok' where id=$1 returning status, stage`, [lr]);
    ok("manager approves report's leave", !t.e && t.r.rows[0]?.status === "approved" && t.r.rows[0]?.stage === "done", t.e?.message);
    t = await tryq(`update leave_requests set status='rejected' where id=$1`, [lr]);
    ok("decided leave cannot be re-decided", !!t.e);

    // --- HR ---
    await as("hr");
    r = await q(`select id from employees`);
    ok("HR sees all employees", r.rows.length >= 4);
    r = await q(`select cnic from employee_private`);
    ok("HR reads CNIC", r.rows.length === 1);
    t = await tryq(`update employees set department_id=$2 where id=$1`, [eEmp.id, dept2]);
    ok("HR can change department", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`insert into user_roles (user_id, role) values ($1,'system_admin')`, [ids.hr]);
    ok("HR CANNOT grant roles (System Admin only)", !!t.e);
    t = await tryq(`update leave_requests set status='cancelled' where id=$1 returning status`, [lr]);
    ok("HR can cancel approved leave", !t.e && t.r.rows[0]?.status === "cancelled", t.e?.message);

    // --- audit ---
    await asAdmin();
    r = await q(`select count(*)::int n from audit_logs where table_name='employees' and changed_by=$1`, [ids.emp]);
    ok("audit log captured employee's own update", r.rows[0].n >= 1);
    await as("hr");
    t = await tryq(`delete from audit_logs`);
    ok("audit log cannot be deleted", !!t.e);

    // --- anon ---
    await q("reset role"); await q("set local role anon");
    t = await tryq(`select * from employees`);
    ok("anon has no access to employees", !!t.e);
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
