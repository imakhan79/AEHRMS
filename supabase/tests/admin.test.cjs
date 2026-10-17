// Administration: workflow rules, notification rules, settings, user management, report subscriptions. ROLLED BACK.
// usage: npm run test:admin
const { Client } = require("pg");

const ids = {
  admin: "00000000-0000-4000-ad00-000000000001",
  hr: "00000000-0000-4000-ad00-000000000002",
  fin: "00000000-0000-4000-ad00-000000000003",
  mgr: "00000000-0000-4000-ad00-000000000004",
  emp: "00000000-0000-4000-ad00-000000000005",
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  — " + extra : ""}`);
};

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
  const owner = async (sql, p) => {
    const back = current;
    await q("reset role");
    const r = await q(sql, p);
    if (back) await as(back);
    return r;
  };
  const notes = async (who) => (await owner(`select title, link from notifications where user_id=$1`, [ids[who]])).rows;

  try {
    await q("begin");
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`, [id, `${k}@adm-test.local`]);
    }
    const dept = (await q(`select id from departments where code='ADM'`)).rows[0].id;
    const mk = async (code, who, mgr) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, department_id, manager_id, status, joining_date)
                values ($1,$2,'Test',$3,$4,$5,'confirmed','2021-01-01') returning id`, [code, who, `${who}@adm-test.local`, dept, mgr])).rows[0].id;
    await mk("AD-001", "admin", null);
    await mk("AD-002", "hr", null);
    await mk("AD-003", "fin", null);
    const eMgr = await mk("AD-004", "mgr", null);
    const eEmp = await mk("AD-005", "emp", eMgr);
    await q(`insert into user_roles (user_id, role) values ($1,'system_admin'),($2,'hr_admin'),($3,'finance')`, [ids.admin, ids.hr, ids.fin]);
    const al = (await q(`select id from leave_types where code='AL'`)).rows[0].id;
    const year = new Date().getFullYear() + 1;
    await q(`insert into leave_balances (employee_id, leave_type_id, year, allocated) values ($1,$2,$3,30)`, [eEmp, al, year]);
    // Mondays in January next year (working days with no holidays seeded that far out).
    const monday = (week) => {
      const d = new Date(Date.UTC(year, 0, 1));
      while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCDate(d.getUTCDate() + 7 * week);
      return d.toISOString().slice(0, 10);
    };
    const plus = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

    // ---------- Settings & rule tables: admin-only writes ----------
    await as("hr");
    let t = await tryq(`update system_settings set company_name='Hacked'`);
    ok("HR can't change system settings", !!t.e || t.r.rowCount === 0);
    t = await tryq(`update workflow_rules set manager_approval='never' where workflow='leave'`);
    ok("HR can't change workflow rules", !!t.e || t.r.rowCount === 0);
    t = await tryq(`update notification_rules set enabled=false where module='leave'`);
    ok("HR can't change notification rules", !!t.e || t.r.rowCount === 0);
    let r = await q(`select company_name from system_settings`);
    ok("everyone can read the company settings", r.rows.length === 1);
    await as("admin");
    r = await q(`update system_settings set company_name='AE Global (test)', ntn='1234567-8' returning updated_by`);
    ok("admin updates company info; updated_by stamped", r.rows[0]?.updated_by === ids.admin);
    t = await tryq(`update workflow_rules set manager_approval='above' where workflow='expense'`);
    ok("'above' needs a threshold", !!t.e);
    t = await tryq(`update workflow_rules set hr_above_days=3 where workflow='expense'`);
    ok("HR-days threshold only applies to leave", !!t.e);

    // ---------- Workflow rules: leave ----------
    await as("emp");
    let lv = (await q(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$3,'x') returning id, stage`, [eEmp, al, monday(0)])).rows[0];
    ok("default: leave starts at the manager", lv.stage === "manager");
    await q(`update leave_requests set status='cancelled' where id=$1`, [lv.id]);
    await as("admin");
    await q(`update workflow_rules set manager_approval='never' where workflow='leave'`);
    await as("emp");
    lv = (await q(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$3,'x') returning id, stage`, [eEmp, al, monday(1)])).rows[0];
    ok("manager step off: leave goes straight to HR", lv.stage === "hr");
    ok("HR is notified instead of the manager", (await notes("hr")).some((x) => x.link?.startsWith("/leave")));
    await q(`update leave_requests set status='cancelled' where id=$1`, [lv.id]);
    await as("admin");
    await q(`update workflow_rules set manager_approval='always', hr_above_days=3 where workflow='leave'`);
    await as("emp");
    const short = (await q(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$3,'x') returning id`, [eEmp, al, monday(2)])).rows[0].id;
    const long = (await q(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$4,'x') returning id`, [eEmp, al, monday(3), plus(monday(3), 4)])).rows[0].id;
    await as("mgr");
    await q(`update leave_requests set status='approved' where id in ($1,$2)`, [short, long]);
    r = await q(`select id, status, stage, days from leave_requests where id in ($1,$2)`, [short, long]);
    const S = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    ok("1-day leave: manager approval is final", S[short].status === "approved" && S[short].stage === "done");
    ok("5-day leave (> 3): goes on to HR", S[long].status === "pending" && S[long].stage === "hr", JSON.stringify(S[long]));

    // ---------- Workflow rules: expense, travel, loan thresholds ----------
    await as("admin");
    await q(`update workflow_rules set manager_approval='above', manager_threshold=10000 where workflow in ('expense','travel','loan')`);
    await as("emp");
    const cat = (await q(`select id from expense_categories where code='PERDIEM'`)).rows[0].id;
    const mkClaim = async (amount) => {
      const id = (await q(`insert into expense_claims (employee_id, title) values ($1,'t') returning id`, [eEmp])).rows[0].id;
      // DA is capped at 6,000 per item, so larger claims are split across days.
      for (let left = amount, d = 1; left > 0; left -= 5000, d++) {
        await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,current_date-$3::int,'DA',$4)`, [id, cat, d, Math.min(5000, left)]);
      }
      await q(`select public.exp_submit($1)`, [id]);
      return (await q(`select stage from expense_claims where id=$1`, [id])).rows[0].stage;
    };
    ok("expense ≤ 10,000 skips the manager → Finance", (await mkClaim(5000)) === "finance");
    ok("expense > 10,000 goes to the manager", (await mkClaim(12000)) === "manager");
    r = await q(`insert into travel_requests (employee_id, purpose, destination, start_date, end_date, estimated_cost) values ($1,'x','Multan', current_date+10, current_date+11, 8000) returning stage`, [eEmp]);
    ok("small travel request skips the manager", r.rows[0].stage === "finance");
    r = await q(`insert into loan_applications (employee_id, amount, installments, purpose) values ($1,50000,5,'x') returning stage`, [eEmp]);
    ok("loan above threshold goes to the manager", r.rows[0].stage === "manager");

    // ---------- Notification rules ----------
    await as("admin");
    await q(`update notification_rules set enabled=false where module='expenses'`);
    const before = (await notes("fin")).length;
    await as("emp");
    await mkClaim(4000);
    ok("expense notifications switched off: Finance gets nothing", (await notes("fin")).length === before);
    await as("admin");
    await q(`update notification_rules set enabled=true where module='expenses'`);
    await as("emp");
    await mkClaim(3000);
    ok("switched back on: Finance is notified", (await notes("fin")).length === before + 1);

    // ---------- User management ----------
    await as("hr");
    t = await tryq(`select * from admin_list_users()`);
    ok("only a System Admin can list accounts", !!t.e);
    t = await tryq(`select admin_set_user_disabled($1, true)`, [ids.emp]);
    ok("HR can't disable accounts", !!t.e);
    await as("admin");
    r = await q(`select * from admin_list_users() where email like '%@adm-test.local'`);
    const me = r.rows.find((x) => x.user_id === ids.admin);
    ok("admin lists accounts with linked employee and roles", r.rows.length === 5 && me?.employee_code === "AD-001" && me.roles.includes("system_admin"));
    t = await tryq(`select admin_set_user_disabled($1, true)`, [ids.admin]);
    ok("admin can't disable their own account", !!t.e);
    await q(`select admin_set_user_disabled($1, true)`, [ids.emp]);
    r = await q(`select disabled from admin_list_users() where user_id=$1`, [ids.emp]);
    ok("account disabled", r.rows[0].disabled === true);
    r = await owner(`select banned_until from auth.users where id=$1`, [ids.emp]);
    ok("sign-in blocked via banned_until", r.rows[0].banned_until !== null);
    r = await owner(`select count(*)::int n from audit_logs where table_name='auth.users' and record_id=$1`, [ids.emp]);
    ok("disable is written to the audit log", r.rows[0].n === 1);
    await q(`select admin_set_user_disabled($1, false)`, [ids.emp]);
    r = await q(`select disabled from admin_list_users() where user_id=$1`, [ids.emp]);
    ok("account re-enabled", r.rows[0].disabled === false);

    // ---------- Report subscriptions ----------
    await as("emp");
    t = await tryq(`insert into report_subscriptions (report, frequency) values ('finance','daily')`);
    ok("employee can't subscribe to the finance digest", !!t.e);
    await as("fin");
    t = await tryq(`insert into report_subscriptions (report, frequency) values ('workforce','daily')`);
    ok("Finance can't subscribe to the workforce digest", !!t.e);
    await q(`insert into report_subscriptions (report, frequency) values ('finance','daily'),('payroll','monthly')`);
    await as("hr");
    r = await q(`select id from report_subscriptions`);
    ok("subscriptions are private to their owner", r.rows.length === 0);
    await q(`insert into report_subscriptions (report, frequency) values ('workforce','daily')`);
    await q("reset role");
    current = null;
    // HR loses the role before delivery: skipped, but still marked as processed.
    await q(`delete from user_roles where user_id=$1`, [ids.hr]);
    await q(`select private.deliver_report_digests()`);
    const finNotes = (await notes("fin")).filter((x) => x.link?.startsWith("/analytics"));
    ok("daily finance digest delivered in-app", finNotes.some((x) => x.title === "Daily Finance report"));
    ok("monthly digest not due today unless it's the 1st", new Date().getDate() === 1 || !finNotes.some((x) => x.title.includes("Payroll")));
    ok("digest withheld once the role is gone", !(await notes("hr")).some((x) => x.link?.startsWith("/analytics")));
    const again = (await q(`select private.deliver_report_digests() n`)).rows[0].n;
    ok("not sent twice on the same day", again === 0);
  } catch (e) {
    fail++;
    console.error("ERROR", e.message);
  } finally {
    await q("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
