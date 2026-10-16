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
};

async function remove(db) {
  const emps = (await db.query(`select id::text from employees where employee_code like 'DEMO-%'`)).rows.map((r) => r.id);
  const users = (await db.query(`select id::text from auth.users where email like $1`, [`%@${DOMAIN}`])).rows.map((r) => r.id);
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
    ["DEMO-007", "Ali", "Hassan", null, "male", dept.FIN, pos["DEMO-ACC"], loc.LHR, "DEMO-001", "2020-11-02"],
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
