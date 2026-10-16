// Demo dataset for the one-click demo logins. Everything is fictional and tagged:
// employee codes / position codes start with DEMO-, logins end with @demo.aehrms.app.
//
//   npm run demo:seed     (re)creates the demo data — needs DATABASE_URL and DEMO_PASSWORD
//   npm run demo:remove   deletes all of it (do this before going live with real data)
const { Client } = require("pg");

const DOMAIN = "demo.aehrms.app";
const PERSONAS = {
  admin: { email: `demo.admin@${DOMAIN}`, code: "DEMO-001" },
  manager: { email: `demo.manager@${DOMAIN}`, code: "DEMO-002" },
  employee: { email: `demo.employee@${DOMAIN}`, code: "DEMO-003" },
  finance: { email: `demo.finance@${DOMAIN}`, code: "DEMO-007" },
};
const DEMO_TAG = "DEMO data — removed by npm run demo:remove";

async function remove(db) {
  const emps = (await db.query(`select id::text from employees where employee_code like 'DEMO-%'`)).rows.map((r) => r.id);
  const users = (await db.query(`select id::text from auth.users where email like $1`, [`%@${DOMAIN}`])).rows.map((r) => r.id);

  // Payroll + ledger: demo runs are tagged; their journal entries (and demo loan disbursements)
  // are posted, so the immutability guards are lifted for this cleanup only (table owner).
  const runs = (await db.query(`select id::text, journal_entry_id::text je, payment_entry_id::text pe from payroll_runs where notes = $1`, [DEMO_TAG])).rows;
  const loanJes = (await db.query(`select journal_entry_id::text je, id::text from loans where employee_id::text = any($1)`, [emps])).rows;
  // Finance demo documents belong to DEMO- vendors/customers; collect their journal entries too.
  const finJes = (await db.query(
    `select journal_entry_id::text je from bills where vendor_id in (select id from vendors where code like 'DEMO-%') and journal_entry_id is not null
     union all select journal_entry_id::text from vendor_payments where vendor_id in (select id from vendors where code like 'DEMO-%') and journal_entry_id is not null
     union all select journal_entry_id::text from invoices where customer_id in (select id from customers where code like 'DEMO-%') and journal_entry_id is not null
     union all select journal_entry_id::text from customer_receipts where customer_id in (select id from customers where code like 'DEMO-%') and journal_entry_id is not null`,
  )).rows.map((r) => r.je);
  const jes = [...runs.flatMap((r) => [r.je, r.pe]), ...loanJes.map((l) => l.je), ...finJes].filter(Boolean);
  await db.query("begin");
  try {
    await db.query("alter table journal_entries disable trigger journal_entries_guard");
    await db.query("alter table journal_entry_lines disable trigger journal_lines_guard");
    for (const [tbl, trg] of [["bill_lines", "bill_lines_before"], ["invoice_lines", "invoice_lines_before"], ["payment_allocations", "payment_allocations_guard"], ["receipt_allocations", "receipt_allocations_guard"], ["budget_lines", "budget_lines_guard"]]) {
      await db.query(`alter table ${tbl} disable trigger ${trg}`);
    }
    await db.query(`delete from vendor_payments where vendor_id in (select id from vendors where code like 'DEMO-%')`);
    await db.query(`delete from customer_receipts where customer_id in (select id from customers where code like 'DEMO-%')`);
    await db.query(`delete from bills where vendor_id in (select id from vendors where code like 'DEMO-%')`);
    await db.query(`delete from invoices where customer_id in (select id from customers where code like 'DEMO-%')`);
    await db.query(`delete from vendors where code like 'DEMO-%'`);
    await db.query(`delete from customers where code like 'DEMO-%'`);
    await db.query(`delete from budgets where name like 'DEMO %'`);
    for (const [tbl, trg] of [["bill_lines", "bill_lines_before"], ["invoice_lines", "invoice_lines_before"], ["payment_allocations", "payment_allocations_guard"], ["receipt_allocations", "receipt_allocations_guard"], ["budget_lines", "budget_lines_guard"]]) {
      await db.query(`alter table ${tbl} enable trigger ${trg}`);
    }
    await db.query(`delete from loan_repayments where loan_id::text = any($1)`, [loanJes.map((l) => l.id)]);
    await db.query(`delete from payroll_runs where id::text = any($1)`, [runs.map((r) => r.id)]); // cascades payslips
    await db.query(`delete from fnf_settlements where employee_id::text = any($1)`, [emps]);
    await db.query(`delete from loans where employee_id::text = any($1)`, [emps]);
    await db.query(`delete from journal_entries where id::text = any($1)`, [jes]);
    await db.query("alter table journal_entries enable trigger journal_entries_guard");
    await db.query("alter table journal_entry_lines enable trigger journal_lines_guard");
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  await db.query(`delete from audit_logs where record_id = any($1)`, [[...runs.map((r) => r.id), ...jes, ...loanJes.map((l) => l.id)]]);
  await db.query(`update departments set head_employee_id = null where head_employee_id::text = any($1)`, [emps]);
  await db.query(`update employees set manager_id = null where manager_id::text = any($1)`, [emps]);
  await db.query(`delete from leave_requests where employee_id::text = any($1)`, [emps]);
  await db.query(`delete from employees where id::text = any($1)`, [emps]); // cascades punches, attendance, balances…
  await db.query(`delete from positions where code like 'DEMO-%'`);
  await db.query(`delete from auth.users where id::text = any($1)`, [users]); // cascades roles + identities
  await db.query(
    `delete from audit_logs where changed_by::text = any($2) or record_id = any($1)
       or new_data->>'employee_id' = any($1) or old_data->>'employee_id' = any($1)
       or new_data->>'user_id' = any($2) or old_data->>'user_id' = any($2)
       or (table_name = 'positions' and coalesce(new_data, old_data)->>'code' like 'DEMO-%')`,
    [emps, users],
  );
  return emps.length;
}

/** Past PK working dates (Mon–Fri), most recent first, excluding today. */
function pastWorkdays(n) {
  const out = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" });
  const d = new Date();
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(fmt.format(d));
  }
  return out;
}

async function seed(db, password) {
  await remove(db);
  const one = async (sql, p) => (await db.query(sql, p)).rows[0];
  const id = (table, code) => one(`select id from ${table} where code = $1`, [code]).then((r) => r?.id);

  // Logins
  const userIds = {};
  for (const [key, p] of Object.entries(PERSONAS)) {
    const u = await one(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
         extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"demo":true}',
         now(), now(), '', '', '', '') returning id`,
      [p.email, password],
    );
    await db.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values ($1::text, $2::uuid, jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true), 'email', now(), now(), now())`,
      [u.id, u.id, p.email],
    );
    userIds[key] = u.id;
  }

  const dept = { HR: await id("departments", "HR"), FIN: await id("departments", "FIN"), IT: await id("departments", "IT"), OPS: await id("departments", "OPS"), ADM: await id("departments", "ADM") };
  const loc = { LHR: await id("locations", "LHR-HO"), GRW: await id("locations", "GRW"), ISB: await id("locations", "ISB") };
  const org = (await one(`select id from organizations where org_type = 'company' limit 1`)).id;

  const positions = [
    ["DEMO-HRM", "HR Manager", "M2", dept.HR],
    ["DEMO-ITM", "IT Manager", "M2", dept.IT],
    ["DEMO-SE", "Software Engineer", "E2", dept.IT],
    ["DEMO-SSE", "Senior Software Engineer", "E3", dept.IT],
    ["DEMO-NET", "Network Administrator", "E2", dept.IT],
    ["DEMO-ACC", "Accountant", "E2", dept.FIN],
    ["DEMO-OPS", "Operations Officer", "E1", dept.OPS],
    ["DEMO-ADM", "Admin Officer", "E1", dept.ADM],
  ];
  const pos = {};
  for (const [code, title, grade, d] of positions) {
    pos[code] = (await one(`insert into positions (code, title, grade, department_id) values ($1,$2,$3,$4) returning id`, [code, title, grade, d])).id;
  }

  const people = [
    // code, first, last, email, gender, dept, position, location, manager code, joined
    ["DEMO-001", "Sara", "Ahmed", PERSONAS.admin.email, "female", dept.HR, pos["DEMO-HRM"], loc.LHR, null, "2019-03-01"],
    ["DEMO-002", "Bilal", "Khan", PERSONAS.manager.email, "male", dept.IT, pos["DEMO-ITM"], loc.LHR, null, "2018-07-15"],
    ["DEMO-003", "Ayesha", "Malik", PERSONAS.employee.email, "female", dept.IT, pos["DEMO-SE"], loc.LHR, "DEMO-002", "2023-02-01"],
    ["DEMO-004", "Usman", "Raza", null, "male", dept.IT, pos["DEMO-SSE"], loc.LHR, "DEMO-002", "2021-09-01"],
    ["DEMO-005", "Hamza", "Iqbal", null, "male", dept.IT, pos["DEMO-NET"], loc.ISB, "DEMO-002", "2022-05-16"],
    ["DEMO-006", "Fatima", "Noor", null, "female", dept.IT, pos["DEMO-SE"], loc.LHR, "DEMO-002", "2024-01-08"],
    ["DEMO-007", "Ali", "Hassan", PERSONAS.finance.email, "male", dept.FIN, pos["DEMO-ACC"], loc.LHR, "DEMO-001", "2020-11-02"],
    ["DEMO-008", "Zainab", "Shah", null, "female", dept.OPS, pos["DEMO-OPS"], loc.GRW, "DEMO-001", "2022-08-22"],
    ["DEMO-009", "Imran", "Butt", null, "male", dept.ADM, pos["DEMO-ADM"], loc.GRW, "DEMO-001", "2025-06-02"],
  ];
  const emp = {};
  for (const [code, first, last, email, gender, d, p, l, mgr, joined] of people) {
    emp[code] = (await one(
      `insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, position_id, location_id,
         manager_id, organization_id, status, employment_type, joining_date, phone, city, nationality)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed','permanent',$11,$12,$13,'Pakistani') returning id`,
      [code, first, last, email, gender, d, p, l, mgr ? emp[mgr] : null, org, joined, `0300-${String(1000000 + Object.keys(emp).length * 137).slice(0, 7)}`, l === loc.GRW ? "Gujranwala" : l === loc.ISB ? "Islamabad" : "Lahore"],
    )).id;
  }
  await db.query(`update departments set head_employee_id = $1 where id = $2`, [emp["DEMO-001"], dept.HR]);
  await db.query(`update departments set head_employee_id = $1 where id = $2`, [emp["DEMO-002"], dept.IT]);
  await db.query(
    `insert into employee_private (employee_id, cnic, bank_name, account_title, iban, eobi_number)
     values ($1, '35202-0000000-3', 'Demo Bank', 'Ayesha Malik', 'PK00DEMO0000000000000003', 'EOBI-DEMO-003')`,
    [emp["DEMO-003"]],
  );
  await db.query(`insert into employee_emergency_contacts (employee_id, name, relationship, phone) values ($1,'Tariq Malik','Father','0321-0000000')`, [emp["DEMO-003"]]);

  // Roles
  await db.query(`insert into user_roles (user_id, role) values ($1,'system_admin'),($1,'hr_admin')`, [userIds.admin]);
  await db.query(`insert into user_roles (user_id, role, department_id) values ($1,'hod',$2)`, [userIds.manager, dept.IT]);
  await db.query(`insert into user_roles (user_id, role) values ($1,'finance')`, [userIds.finance]);

  // Leave balances for this year
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric" }).format(new Date()));
  for (const [code, eid] of Object.entries(emp)) {
    const gender = people.find((p) => p[0] === code)[4];
    await db.query(
      `insert into leave_balances (employee_id, leave_type_id, year, allocated)
       select $1, id, $2, days_per_year from leave_types where is_active and (gender is null or gender = $3)`,
      [eid, year, gender],
    );
  }

  // Two weeks of attendance (trusted manual punches, as if from a device)
  const days = pastWorkdays(10);
  const team = ["DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005", "DEMO-006", "DEMO-007", "DEMO-008", "DEMO-009"];
  for (const [i, date] of days.entries()) {
    for (const [j, code] of team.entries()) {
      const seedN = (i * 7 + j * 3) % 10;
      if (code === "DEMO-005" && i === 2) continue; // absent
      if (code === "DEMO-006" && i === 6) continue; // on approved leave (below)
      // Mostly on time; some late (stay later), one overtime, one half day per cycle.
      const late = seedN === 0 || seedN === 1;
      const inT = seedN === 0 ? "09:42" : seedN === 1 ? "09:24" : `09:0${seedN % 6}`;
      const outT = seedN === 2 ? "19:10" : seedN === 3 ? "13:05" : late ? "18:15" : `17:2${seedN}`;
      await db.query(
        `insert into attendance_punches (employee_id, punch_time, work_date, punch_type, source) values ($1, $2, $3, 'in', 'biometric')`,
        [emp[code], `${date} ${inT}+05`, date],
      );
      if (code === "DEMO-003" && i === 1) continue; // forgot to check out → missing punch
      await db.query(
        `insert into attendance_punches (employee_id, punch_time, work_date, punch_type, source) values ($1, $2, $3, 'out', 'biometric')`,
        [emp[code], `${date} ${outT}+05`, date],
      );
    }
  }
  for (const date of days) await db.query(`select private.mark_daily_attendance($1::date)`, [date]);

  // Requests made "as" the people involved (JWT claims), so workflow triggers apply.
  const as = async (userId, fn) => {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
    try {
      await fn();
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  };
  const al = await id("leave_types", "AL");
  const cl = await id("leave_types", "CL");
  const nextMonth = new Date();
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 10);
  while ([0, 6].includes(nextMonth.getUTCDay())) nextMonth.setUTCDate(nextMonth.getUTCDate() + 1);
  const start = nextMonth.toISOString().slice(0, 10);
  nextMonth.setUTCDate(nextMonth.getUTCDate() + 2);
  while ([0, 6].includes(nextMonth.getUTCDay())) nextMonth.setUTCDate(nextMonth.getUTCDate() + 1);
  const end = nextMonth.toISOString().slice(0, 10);
  if (start.slice(0, 4) === String(year)) {
    await as(userIds.employee, () =>
      db.query(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$4,'Family wedding in Faisalabad')`,
        [emp["DEMO-003"], al, start, end]),
    );
  }
  await as(userIds.employee, () =>
    db.query(`insert into attendance_regularizations (employee_id, work_date, requested_in, requested_out, reason)
              values ($1, $2, $3, $4, 'Forgot to check out — left at 17:30 after the sprint review')`,
      [emp["DEMO-003"], days[1], `${days[1]} 08:57+05`, `${days[1]} 17:30+05`]),
  );
  // A past casual leave filed by HR for Fatima, approved by her manager → attendance shows "Leave".
  let leaveId;
  await as(userIds.admin, async () => {
    leaveId = (await one(
      `insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1,$2,$3,$3,'Medical appointment') returning id`,
      [emp["DEMO-006"], cl, days[6]],
    )).id;
  });
  await as(userIds.manager, () =>
    db.query(`update leave_requests set status='approved', decision_comment='Get well soon' where id=$1`, [leaveId]),
  );

  // ---------- Payroll: salaries, a loan, last month fully paid, this month in draft ----------
  const basics = { "DEMO-001": 280000, "DEMO-002": 320000, "DEMO-003": 150000, "DEMO-004": 210000, "DEMO-005": 120000, "DEMO-006": 95000, "DEMO-007": 140000, "DEMO-008": 70000, "DEMO-009": 48000 };
  const std = (await one(`select id from salary_structures where code = 'STD'`)).id;
  const pkMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()).slice(0, 7);
  const prev = new Date(`${pkMonth}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevMonth = prev.toISOString().slice(0, 7);
  const existing = (await db.query(`select to_char(period_month,'YYYY-MM') m from payroll_runs where not is_parallel and to_char(period_month,'YYYY-MM') = any($1)`, [[prevMonth, pkMonth]])).rows.map((r) => r.m);

  await as(userIds.admin, async () => {
    for (const [code, basic] of Object.entries(basics)) {
      await db.query(
        `insert into employee_salaries (employee_id, effective_from, structure_id, basic_salary, pessi_covered, pf_member)
         values ($1, '2025-07-01', $2, $3, $4, $5)`,
        [emp[code], std, basic, basic <= 70000, ["DEMO-001", "DEMO-002", "DEMO-004"].includes(code)],
      );
    }
    await db.query(
      `insert into loans (employee_id, loan_type, principal, installment_amount, start_month, purpose, disbursed_on)
       values ($1, 'loan', 120000, 10000, $2, 'Motorcycle purchase', $3)`,
      [emp["DEMO-004"], `${prevMonth}-01`, `${prevMonth}-05`],
    );
  });

  if (existing.length) {
    console.log(`  (skipped demo payroll runs: real runs already exist for ${existing.join(", ")})`);
  } else {
    let prevRun, curRun;
    await as(userIds.admin, async () => {
      prevRun = (await one(`select public.payroll_create_run($1) id`, [`${prevMonth}-01`])).id;
      await db.query(`select public.payroll_process_run($1)`, [prevRun]);
      await db.query(`select public.payroll_transition($1, 'review', $2)`, [prevRun, DEMO_TAG]);
    });
    await as(userIds.finance, async () => {
      await db.query(`select public.payroll_transition($1, 'approved')`, [prevRun]);
      await db.query(`select public.payroll_transition($1, 'posted')`, [prevRun]);
      await db.query(`select public.payroll_transition($1, 'paid')`, [prevRun]);
    });
    // This month is calculated after last month is posted, so tax uses the right YTD.
    await as(userIds.admin, async () => {
      curRun = (await one(`select public.payroll_create_run($1) id`, [`${pkMonth}-01`])).id;
      await db.query(`select public.payroll_process_run($1)`, [curRun]);
    });
    await db.query(`update payroll_runs set notes = $1 where id = any($2)`, [DEMO_TAG, [prevRun, curRun]]);
  }

  // ---------- Finance: vendors, customers, bills, invoices, payment, receipt, budget ----------
  const acct = async (c) => (await one(`select id from chart_of_accounts where code = $1`, [c])).id;
  const bankOp = (await one(`select b.id from bank_accounts b join chart_of_accounts a on a.id = b.gl_account_id where a.code = '1120'`)).id;
  const gstIn = (await one(`select id from taxes where code = 'GST18-IN'`)).id;
  const gstOut = (await one(`select id from taxes where code = 'GST18-OUT'`)).id;
  const d = (day) => `${prevMonth}-${String(day).padStart(2, "0")}`;
  let ids = {};
  await as(userIds.admin, async () => {
    const v1 = (await one(`insert into vendors (code, name, ntn, payment_terms_days) values ('DEMO-V01','Gulberg Properties (Pvt) Ltd','DEMO-NTN-1',15) returning id`)).id;
    const v2 = (await one(`insert into vendors (code, name, ntn) values ('DEMO-V02','PakNet Telecom Services','DEMO-NTN-2') returning id`)).id;
    const c1 = (await one(`insert into customers (code, name, ntn) values ('DEMO-C01','Metro Builders Ltd','DEMO-NTN-3') returning id`)).id;
    const c2 = (await one(`insert into customers (code, name, ntn, payment_terms_days) values ('DEMO-C02','Indus Energy (Pvt) Ltd','DEMO-NTN-4',15) returning id`)).id;
    const b1 = (await one(`insert into bills (vendor_id, vendor_invoice_no, bill_date, due_date, description) values ($1,'GP-2201',$2,$3,'Head office rent') returning id`, [v1, d(1), d(15)])).id;
    await db.query(`insert into bill_lines (bill_id, account_id, amount, description) values ($1,$2,450000,'Office rent — Lahore HO')`, [b1, await acct("5210")]);
    const b2 = (await one(`insert into bills (vendor_id, vendor_invoice_no, bill_date, due_date, description) values ($1,'PN-88341',$2,$3,'Internet & leased line') returning id`, [v2, d(5), d(28)])).id;
    await db.query(`insert into bill_lines (bill_id, account_id, amount, tax_id, description) values ($1,$2,85000,$3,'Leased line 50 Mbps')`, [b2, await acct("5270"), gstIn]);
    const i1 = (await one(`insert into invoices (customer_id, invoice_date, due_date, description) values ($1,$2,$3,'Site supervision services') returning id`, [c1, d(3), d(28)])).id;
    await db.query(`insert into invoice_lines (invoice_id, account_id, amount, tax_id, description) values ($1,$2,1800000,$3,'Supervision — Phase 2')`, [i1, await acct("4110"), gstOut]);
    const i2 = (await one(`insert into invoices (customer_id, invoice_date, due_date, description) values ($1,$2,$3,'Solar EPC milestone 1') returning id`, [c2, d(2), d(10)])).id;
    await db.query(`insert into invoice_lines (invoice_id, account_id, amount, description) values ($1,$2,950000,'Milestone 1 — design approval')`, [i2, await acct("4120")]);
    for (const b of [b1, b2]) await db.query(`select public.fin_post_bill($1)`, [b]);
    for (const i of [i1, i2]) await db.query(`select public.fin_post_invoice($1)`, [i]);
    const pay = (await one(`insert into vendor_payments (vendor_id, payment_date, bank_account_id, amount, reference) values ($1,$2,$3,450000,'CHQ-004512') returning id`, [v1, d(14), bankOp])).id;
    await db.query(`insert into payment_allocations (payment_id, bill_id, amount) values ($1,$2,450000)`, [pay, b1]);
    const rec = (await one(`insert into customer_receipts (customer_id, receipt_date, bank_account_id, amount, wht_amount, reference) values ($1,$2,$3,1062000,40000,'IBFT-77120') returning id`, [c1, d(25), bankOp])).id;
    await db.query(`insert into receipt_allocations (receipt_id, invoice_id, amount) values ($1,$2,1062000)`, [rec, i1]);
    await db.query(`select public.fin_post_receipt($1)`, [rec]);
    const fy = Number(pkMonth.slice(0, 4)) + (Number(pkMonth.slice(5, 7)) >= 7 ? 1 : 0);
    const bud = (await one(`insert into budgets (fiscal_year, name) values ($1,'DEMO operating budget') returning id`, [fy])).id;
    for (const [code, annual] of [["5210", 5400000], ["5270", 1200000], ["5110", 32000000], ["4110", 24000000], ["4120", 12000000]]) {
      const a = await acct(code);
      for (let m = 0; m < 12; m++) {
        await db.query(`insert into budget_lines (budget_id, account_id, period_start, amount) values ($1,$2,$3,$4)`,
          [bud, a, new Date(Date.UTC(fy - 1, 6 + m, 1)).toISOString().slice(0, 10), annual / 12]);
      }
    }
    ids = { pay, bud };
  });
  // Maker-checker: Sara prepared; Ali releases the payment and approves the budget.
  await as(userIds.finance, async () => {
    await db.query(`select public.fin_post_vendor_payment($1)`, [ids.pay]);
    await db.query(`select public.fin_approve_budget($1)`, [ids.bud]);
  });
  return { employees: Object.keys(emp).length, days: days.length };
}

(async () => {
  const cmd = process.argv[2];
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    if (cmd === "remove") {
      console.log(`Removed ${await remove(db)} demo employees and their data.`);
    } else if (cmd === "seed") {
      if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) throw new Error("Set DEMO_PASSWORD (12+ chars) in .env.local");
      const r = await seed(db, process.env.DEMO_PASSWORD);
      console.log(`Seeded ${r.employees} demo employees with ${r.days} days of attendance.`);
      for (const p of Object.values(PERSONAS)) console.log(`  login: ${p.email}`);
    } else {
      console.log("usage: node scripts/demo-data.cjs seed|remove");
    }
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
