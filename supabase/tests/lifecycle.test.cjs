// Assets, benefits, exit & clearance. ROLLED BACK. usage: npm run test:lifecycle
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-a200-000000000001",
  fin: "00000000-0000-4000-a200-000000000002",
  mgr: "00000000-0000-4000-a200-000000000003",
  emp: "00000000-0000-4000-a200-000000000004",
  new: "00000000-0000-4000-a200-000000000005",
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
  const tryq = async (sql, p) => {
    await q("savepoint s");
    try { const r = await q(sql, p); await q("release savepoint s"); return { r }; }
    catch (e) { await q("rollback to savepoint s"); return { e }; }
  };

  try {
    await q("begin");
    await q(`delete from loan_repayments where payslip_id in (select p.id from payslips p join payroll_runs r on r.id=p.payroll_run_id where r.period_month='2026-08-01')`);
    await q(`delete from payroll_runs where period_month='2026-08-01'`);
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`, [id, `${k}@lc-test.local`]);
    }
    const dept = (await q(`select id from departments where code='ADM'`)).rows[0].id;
    const mk = async (code, who, mgr, joined) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, department_id, manager_id, status, joining_date)
                values ($1,$2,'Test',$3,$4,$5,'confirmed',$6) returning id`, [code, who, `${who}@lc-test.local`, dept, mgr, joined])).rows[0].id;
    await mk("LC-001", "hr", null, "2020-01-01");
    await mk("LC-002", "fin", null, "2020-01-01");
    const eMgr = await mk("LC-003", "mgr", null, "2020-01-01");
    const eEmp = await mk("LC-004", "emp", eMgr, "2022-01-01");
    const eNew = await mk("LC-005", "new", eMgr, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin'),($2,'finance')`, [ids.hr, ids.fin]);

    // ---------- Assets ----------
    await as("hr");
    const lap = (await q(`insert into assets (asset_tag, name, category, serial_number) values ('LC-LAP-1','Dell Latitude 5440','laptop','SN123') returning id`)).rows[0].id;
    await q(`select public.asset_issue($1,$2,'For field work')`, [lap, eEmp]);
    let t = await tryq(`select public.asset_issue($1,$2,null)`, [lap, eNew]);
    ok("can't issue an asset that's already assigned", !!t.e, t.e?.message);
    await as("emp");
    let r = await q(`select a.name from assets a`);
    ok("employee sees their own asset", r.rows.length === 1 && r.rows[0].name.includes("Dell"));
    t = await tryq(`select public.asset_issue($1,$2,null)`, [lap, eEmp]);
    ok("employee can't issue assets", !!t.e);
    const asg = (await q(`select id from asset_assignments where asset_id=$1`, [lap])).rows[0].id;
    await q(`select public.asset_acknowledge($1)`, [asg]);
    r = await q(`select acknowledged_at from asset_assignments where id=$1`, [asg]);
    ok("employee acknowledges receipt", !!r.rows[0].acknowledged_at);
    await as("new");
    r = await q(`select id from assets`);
    ok("other employees can't see the asset", r.rows.length === 0);
    await as("hr");
    await q(`select public.asset_transfer($1,$2,'Handover')`, [lap, eNew]);
    r = await q(`select employee_id from asset_assignments where asset_id=$1 and returned_on is null`, [lap]);
    ok("transfer closes the old assignment and issues to the new holder", r.rows[0]?.employee_id === eNew);
    await q(`select public.asset_return($1,'damaged','Screen cracked')`, [lap]);
    r = await q(`select status, condition from assets where id=$1`, [lap]);
    ok("damaged return → maintenance", r.rows[0].status === "maintenance" && r.rows[0].condition === "damaged");

    // ---------- Benefits ----------
    const ghi = (await q(`select id from benefit_plans where code='GHI'`)).rows[0].id;
    const pick = (await q(`select id from benefit_plans where code='PICK'`)).rows[0].id;
    await as("new");
    t = await tryq(`insert into benefit_enrollments (plan_id, employee_id) values ($1,$2)`, [ghi, eNew]);
    ok("health plan needs 3 months' tenure", !!t.e, t.e?.message);
    await as("emp");
    const dep = (await q(`select 1`)).rows; // employees can't add dependents; HR does
    await q("reset role");
    const d1 = (await q(`insert into employee_dependents (employee_id, name, relationship) values ($1,'Spouse Test','spouse') returning id`, [eEmp])).rows[0].id;
    const dOther = (await q(`insert into employee_dependents (employee_id, name, relationship) values ($1,'Not mine','son') returning id`, [eNew])).rows[0].id;
    await as("emp");
    t = await tryq(`insert into benefit_enrollments (plan_id, employee_id, dependent_ids) values ($1,$2,$3)`, [ghi, eEmp, [dOther]]);
    ok("can't enrol someone else's dependent", !!t.e, t.e?.message);
    t = await tryq(`insert into benefit_enrollments (plan_id, employee_id, dependent_ids, start_date) values ($1,$2,$3,'2026-08-01')`, [ghi, eEmp, [d1]]);
    ok("eligible employee enrols with own dependent", !t.e, t.e?.message);
    await as("new");
    t = await tryq(`insert into benefit_enrollments (plan_id, employee_id, start_date) values ($1,$2,'2026-08-01')`, [pick, eNew]);
    await as("emp");
    ok("transport plan has no tenure rule — new joiner can enrol", !t.e, t.e?.message);
    t = await tryq(`insert into benefit_enrollments (plan_id, employee_id) values ($1,$2)`, [pick, eNew]);
    ok("employee can't enrol another employee", !!t.e);
    // Payroll deducts the contribution.
    await q("reset role");
    await q(`insert into employee_salaries (employee_id, effective_from, basic_salary) values ($1,'2026-01-01',80000)`, [eEmp]);
    await as("hr");
    const run = (await q(`select public.payroll_create_run('2026-08-01') id`)).rows[0].id;
    await q(`select public.payroll_process_run($1)`, [run]);
    r = await q(`select pl.amount from payslip_lines pl join payslips p on p.id=pl.payslip_id where p.payroll_run_id=$1 and p.employee_id=$2 and pl.code='BENEFIT'`, [run, eEmp]);
    ok("payroll deducts health plan contribution (1,500)", n(r.rows[0]?.amount) === 1500, r.rows[0]?.amount);

    // ---------- Exit ----------
    await as("hr");
    const kb = (await q(`insert into assets (asset_tag, name, category) values ('LC-PH-1','iPhone 14','phone') returning id`)).rows[0].id;
    await q(`select public.asset_issue($1,$2,null)`, [kb, eEmp]);
    await as("emp");
    t = await tryq(`select public.exit_submit($1,'termination',current_date + 30,'x')`, [eEmp]);
    ok("employee can only submit a resignation", !!t.e);
    const sep = (await q(`select public.exit_submit($1,'resignation',current_date + 30,'Relocating to Karachi') id`, [eEmp])).rows[0].id;
    t = await tryq(`select public.exit_submit($1,'resignation',current_date + 40,'again')`, [eEmp]);
    ok("only one open separation per employee", !!t.e, t.e?.message);
    t = await tryq(`select public.exit_decide($1,true,null)`, [sep]);
    ok("employee can't approve own resignation", !!t.e);
    await as("mgr");
    await q(`select public.exit_decide($1,true,'Best of luck')`, [sep]);
    r = await q(`select status, exit_date from employees where id=$1`, [eEmp]);
    ok("approval puts employee on notice with exit date", r.rows[0].status === "notice" && !!r.rows[0].exit_date);
    r = await q(`select area, status from clearance_items where separation_id=$1 order by sort_order`, [sep]);
    ok("5 clearance items created; assets pending (phone still issued)", r.rows.length === 5 && r.rows.find((x) => x.area === "assets")?.status === "pending", JSON.stringify(r.rows));
    const item = Object.fromEntries((await q(`select area, id from clearance_items where separation_id=$1`, [sep])).rows.map((x) => [x.area, x.id]));
    await q(`select public.exit_clear($1,'Handed over')`, [item.department]);
    t = await tryq(`select public.exit_clear($1,null)`, [item.finance]);
    ok("manager can't clear Finance", !!t.e);
    await as("hr");
    t = await tryq(`select public.exit_clear($1,null)`, [item.assets]);
    ok("assets can't be cleared while a phone is issued", !!t.e, t.e?.message);
    await q(`select public.asset_return($1,'good',null)`, [kb]);
    r = await q(`select status from clearance_items where id=$1`, [item.assets]);
    ok("returning the last asset auto-clears the assets item", r.rows[0].status === "cleared");
    t = await tryq(`select public.exit_complete($1,null)`, [sep]);
    ok("can't complete exit with pending clearance", !!t.e, t.e?.message);
    await as("fin");
    await q(`select public.exit_clear($1,'No dues')`, [item.finance]);
    await as("hr");
    await q(`select public.exit_clear($1,null)`, [item.it]);
    await q(`select public.exit_clear($1,null)`, [item.hr]);
    await q(`select public.exit_complete($1,'Relocation; would rejoin')`, [sep]);
    r = await q(`select status from employees where id=$1`, [eEmp]);
    ok("completed exit marks employee exited", r.rows[0].status === "exited");
    r = await q(`select status from benefit_enrollments where employee_id=$1`, [eEmp]);
    ok("benefits cancelled on exit", r.rows.every((x) => x.status === "cancelled"));
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
