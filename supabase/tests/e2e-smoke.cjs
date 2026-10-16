// E2E smoke test: temp users → real sign-in → fetch every page with the session cookie → cleanup.
// usage: node e2e.js <DATABASE_URL> <SUPABASE_URL> <ANON_KEY> <APP_BASE_URL> <PROJECT_DIR>
const { Client } = require("pg");
const [dbUrl, supaUrl, anonKey, base, projectDir] = process.argv.slice(2);
const { createServerClient } = require(`${projectDir}/node_modules/@supabase/ssr`);

const ADMIN = { id: "e2e00000-0000-4000-a000-0000000000a1", email: "e2e-admin@aehrms.test", code: "E2E-ADM" };
const REPORT = { id: "e2e00000-0000-4000-a000-0000000000a2", email: "e2e-report@aehrms.test", code: "E2E-REP" };
const PASSWORD = `E2e!${Math.random().toString(36).slice(2)}Aa9`;

async function cleanup(db) {
  await db.query(`delete from leave_requests where employee_id in (select id from employees where employee_code like 'E2E-%')`);
  await db.query(`delete from leave_balances where employee_id in (select id from employees where employee_code like 'E2E-%')`);
  await db.query(`update employees set manager_id = null where employee_code like 'E2E-%'`);
  const { rows } = await db.query(`delete from employees where employee_code like 'E2E-%' returning id`);
  await db.query(`delete from auth.users where id = any($1)`, [[ADMIN.id, REPORT.id]]); // cascades roles + identities
  // Remove the audit entries this test generated (pre-production test data only).
  await db.query(
    `delete from audit_logs where changed_by = any($1) or record_id = any($2)
       or new_data->>'employee_id' = any($2) or old_data->>'employee_id' = any($2)
       or new_data->>'user_id' = any($3) or old_data->>'user_id' = any($3)`,
    [[ADMIN.id, REPORT.id], rows.map((r) => r.id), [ADMIN.id, REPORT.id]],
  );
}

(async () => {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let failures = 0;
  try {
    await cleanup(db);
    for (const u of [ADMIN, REPORT]) {
      await db.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change_token_new, email_change)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
           extensions.crypt($3, extensions.gen_salt('bf')), now(),
           '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`,
        [u.id, u.email, PASSWORD],
      );
      await db.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values ($1::text, $2::uuid, jsonb_build_object('sub', $1::text, 'email', $3::text), 'email', now(), now(), now())`,
        [u.id, u.id, u.email],
      );
    }
    const dept = (await db.query(`select id from departments where code='HR'`)).rows[0].id;
    const admin = (await db.query(
      `insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, status)
       values ($1,'Etoe','Admin',$2,'male',$3,'active') returning id, user_id`, [ADMIN.code, ADMIN.email, dept])).rows[0];
    const report = (await db.query(
      `insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, manager_id, status)
       values ($1,'Etoe','Report',$2,'female',$3,$4,'active') returning id, user_id`, [REPORT.code, REPORT.email, dept, admin.id])).rows[0];
    console.log(admin.user_id === ADMIN.id ? "PASS  admin login auto-linked" : "FAIL  admin not linked");
    await db.query(`insert into user_roles (user_id, role) values ($1,'system_admin'),($1,'hr_admin')`, [ADMIN.id]);
    const al = (await db.query(`select id from leave_types where code='AL'`)).rows[0].id;
    const yr = new Date().getFullYear() + 1;
    await db.query(`insert into leave_balances (employee_id, leave_type_id, year, allocated) values ($1,$3,$4,14),($2,$3,$4,14)`, [admin.id, report.id, al, yr]);
    // Pending request from the report so the approvals queue renders (as postgres: no JWT).
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: REPORT.id, role: "authenticated" })]);
    await db.query(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$4,'E2E test')`,
      [report.id, al, `${yr}-02-08`, `${yr}-02-09`]);
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: REPORT.id, role: "authenticated" })]);
    // Field punch far from office → pending, shows in the approvals queue.
    await db.query(`insert into attendance_punches (employee_id, punch_type, source, latitude, longitude) values ($1,'in','mobile',33.6844,73.0479)`, [report.id]);
    await db.query("commit");
    await db.query(`select set_config('request.jwt.claims', '', false)`);

    // Real sign-in through Supabase Auth, cookies captured exactly as @supabase/ssr writes them.
    const jar = new Map();
    const supabase = createServerClient(supaUrl, anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const { error } = await supabase.auth.signInWithPassword({ email: ADMIN.email, password: PASSWORD });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
    const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

    const pages = [
      ["/dashboard", ["Welcome, Etoe", "Awaiting your decision", "Active headcount"]],
      ["/employees", ["E2E-ADM", "E2E-REP", "New employee"]],
      ["/employees/new", ["Employee code", "Create employee"]],
      [`/employees/${report.id}`, ["Etoe Report", "CNIC, bank &amp; statutory", "Leave balances", "Personnel file"]],
      ["/organization", ["Organogram", "Human Resources", "Lahore Head Office", "Add unit"]],
      ["/leave", ["Awaiting your decision", "E2E test", "Apply for leave", "Upcoming holidays"]],
      ["/profile", ["My profile", "Contact details", "Emergency contacts"]],
      ["/admin/roles", ["Users &amp; roles", "System Admin", "Assign a role"]],
      ["/admin/audit", ["Audit log", "employees"]],
      ["/attendance", ["Check in", "Request a correction", "My attendance"]],
      ["/attendance/approvals", ["Field attendance to verify (1)", "Etoe Report"]],
      ["/attendance/reports", ["Daily attendance", "Monthly summary", "E2E-REP"]],
      ["/attendance/setup", ["General (09:00–17:00)", "Register device", "Manual punch"]],
      [`/attendance/export?kind=summary&month=${new Date().toISOString().slice(0, 7)}`, ['"Code"', "E2E-ADM"]],
      ["/payroll", ["Payroll runs", "New payroll run"]],
      ["/payroll/setup", ["Income tax slabs", "TY2027", "Statutory rates"]],
      ["/payroll/fnf", ["Full &amp; final settlements"]],
      ["/finance/ledger", ["Trial balance", "Recent journal entries"]],
      ["/payslips", ["My payslips"]],
      ["/finance", ["Cash at bank", "Accounts payable"]],
      ["/finance/payables", ["Bills", "New bill"]],
      ["/finance/receivables", ["Invoices", "New invoice"]],
      ["/finance/journals", ["New manual journal"]],
      ["/finance/bank", ["Statement lines", "Import statement"]],
      ["/finance/reports?r=pl", ["Total revenue", "Net profit"]],
      ["/finance/reports?r=bs", ["Total assets", "Liabilities + equity"]],
      ["/finance/reports?r=cf", ["Net change in cash"]],
      ["/finance/reports?r=ap", ["Not due"]],
      ["/finance/budgets", ["New budget"]],
      ["/finance/accounts", ["Chart of accounts", "Add account"]],
      ["/finance/settings", ["Fiscal periods", "Taxes"]],
      ["/notifications", ["Notifications"]],
      ["/expenses", ["My expense claims", "Request travel"]],
      ["/expenses/approvals", ["Expense claims", "Travel requests"]],
      ["/loans", ["My applications", "Apply"]],
      ["/helpdesk", ["Raise a ticket"]],
      ["/helpdesk?view=all", ["Resolved within SLA"]],
    ];
    for (const [table, path] of [["bills", "/finance/payables/bills/"], ["invoices", "/finance/receivables/invoices/"], ["vendor_payments", "/finance/payables/payments/"], ["journal_entries", "/finance/journals/"], ["budgets", "/finance/budgets/"]]) {
      const row = (await db.query(`select id from ${table} order by created_at desc limit 1`)).rows[0];
      if (row) pages.push([path + row.id, ["Back"].filter(() => !path.includes("journals") && !path.includes("budgets"))]);
    }
    const vendor = (await db.query(`select id from vendors limit 1`)).rows[0];
    if (vendor) pages.push([`/finance/payables/pay/${vendor.id}`, ["Settle now"]]);
    pages.push([`/finance/reports/export?r=bs&from=2026-07-01&to=${new Date().toISOString().slice(0, 10)}`, ['"Balance (PKR)"']]);
    const latestRun = (await db.query(`select id from payroll_runs order by period_month desc limit 1`)).rows[0];
    const anySlip = (await db.query(`select id from payslips order by created_at desc limit 1`)).rows[0];
    if (latestRun) {
      pages.push([`/payroll/runs/${latestRun.id}`, ["Payslips", "Actions"]]);
      pages.push([`/payroll/runs/${latestRun.id}/export?kind=register`, ['"Net pay"']]);
    }
    if (anySlip) pages.push([`/payroll/payslips/${anySlip.id}`, ["Net pay", "Earnings", "Deductions"]]);

    // Check in through the same client path the browser uses (RLS + triggers apply).
    const { data: punch, error: pErr } = await supabase
      .from("attendance_punches")
      .insert({ employee_id: admin.id, punch_type: "in", source: "web", client_event_id: crypto.randomUUID() })
      .select("verification, work_date")
      .single();
    const punchOk = !pErr && punch?.verification === "pending"; // HO has no coordinates yet → manager verifies
    if (!punchOk) failures++;
    console.log(`${punchOk ? "PASS" : "FAIL"}  web check-in via supabase-js → ${pErr?.message ?? punch?.verification}`);
    const bio = await fetch(base + "/api/attendance/biometric", {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-code": "NOPE", "x-device-key": "bad" },
      body: JSON.stringify({ events: [] }),
    });
    if (bio.status !== 401) failures++;
    console.log(`${bio.status === 401 ? "PASS" : "FAIL"}  biometric endpoint rejects unknown device → ${bio.status}`);
    for (const [path, expects] of pages) {
      const res = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
      const html = await res.text();
      const missing = expects.filter((s) => !html.includes(s));
      const ok = res.status === 200 && missing.length === 0;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${res.status} ${path}${missing.length ? `  missing: ${missing.join(" | ")}` : ""}`);
    }
    const anon = await fetch(base + "/dashboard", { redirect: "manual" });
    const redirOk = anon.status >= 300 && anon.status < 400 && (anon.headers.get("location") ?? "").includes("/login");
    if (!redirOk) failures++;
    console.log(`${redirOk ? "PASS" : "FAIL"}  signed-out /dashboard → ${anon.status} ${anon.headers.get("location")}`);
  } catch (e) {
    failures++;
    console.log("ERROR", e.message);
  } finally {
    await cleanup(db);
    const left = (await db.query(`select count(*)::int n from employees where employee_code like 'E2E-%'`)).rows[0].n;
    console.log(`cleanup: ${left === 0 ? "all E2E data removed" : `${left} rows left!`}`);
    await db.end();
    console.log(failures ? `\n${failures} failure(s)` : "\nall E2E checks passed");
    process.exit(failures ? 1 : 0);
  }
})();
