// Attendance tests. Everything runs in one transaction that is ROLLED BACK.
// usage: npm run test:attendance   (reads DATABASE_URL from .env.local)
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-b000-000000000001",
  mgr: "00000000-0000-4000-b000-000000000002",
  emp: "00000000-0000-4000-b000-000000000003",
  out: "00000000-0000-4000-b000-000000000004",
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
  const asAdmin = async () => {
    await q("reset role");
    await q(`select set_config('request.jwt.claims', '', true)`);
  };
  const tryq = async (sql, p) => {
    await q("savepoint s");
    try { const r = await q(sql, p); await q("release savepoint s"); return { r }; }
    catch (e) { await q("rollback to savepoint s"); return { e }; }
  };
  const att = async (emp, d) => (await q(`select * from attendance where employee_id=$1 and work_date=$2`, [emp, d])).rows[0];

  try {
    await q("begin");
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`,
        [id, `${k}@att-test.local`]);
    }
    // Office in Lahore with coordinates + 200 m geofence.
    const loc = (await q(`insert into locations (code, name, latitude, longitude, geofence_radius_m) values ('T-LOC','Test Office',31.520400,74.358700,200) returning id`)).rows[0].id;
    const dept = (await q(`select id from departments where code='IT'`)).rows[0].id;
    const mk = async (code, who, mgr, bio) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, location_id, manager_id, status, biometric_user_id, joining_date)
                values ($1,$2,'Test',$3,'male',$4,$5,$6,'active',$7,'2020-01-01') returning id`,
        [code, who, `${who}@att-test.local`, dept, loc, mgr, bio])).rows[0].id;
    const eHr = await mk("AT-001", "hr", null, null);
    const eMgr = await mk("AT-002", "mgr", null, null);
    const eEmp = await mk("AT-003", "emp", eMgr, "1003");
    const eOut = await mk("AT-004", "out", null, null);
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin')`, [ids.hr]);
    // Fixed past weekday: 2026-10-14 (Wed). Shift 09:00–17:00 PKT (UTC+5).
    const D = "2026-10-14";
    const pk = (t) => `${D} ${t}+05`;

    // --- trusted inserts (biometric-like, as postgres) for computation checks ---
    await q(`insert into attendance_punches (employee_id, punch_time, work_date, punch_type, source) values ($1,$2,$3,'in','manual'),($1,$4,$3,'out','manual')`,
      [eEmp, pk("09:40"), D, pk("18:45")]);
    let a = await att(eEmp, D);
    ok("late: in 09:40 vs 09:00 + 15 grace → late 40 min", a?.status === "late" && a.late_minutes === 40, `${a?.status} ${a?.late_minutes}`);
    ok("worked 9h05 = 545 min", a?.worked_minutes === 545, `${a?.worked_minutes}`);
    ok("overtime: 545 − 480 = 65 (≥ 30 threshold)", a?.overtime_minutes === 65, `${a?.overtime_minutes}`);

    await q(`insert into attendance_punches (employee_id, punch_time, work_date, punch_type, source) values ($1,$2,$3,'in','manual'),($1,$4,$3,'out','manual')`,
      [eOut, pk("09:10"), D, pk("14:00")]);
    a = await att(eOut, D);
    ok("within grace (09:10) → not late; 4h50 → half day", a?.status === "half_day" && a.late_minutes === 0, `${a?.status} ${a?.late_minutes}`);

    await q(`insert into attendance_punches (employee_id, punch_time, work_date, punch_type, source) values ($1,$2,$3,'in','manual')`, [eMgr, pk("08:55"), D]);
    a = await att(eMgr, D);
    ok("only check-in → missing_punch", a?.status === "missing_punch");

    await q(`select private.mark_daily_attendance($1::date)`, [D]);
    a = await att(eHr, D);
    ok("nightly job marks no-punch employee absent", a?.status === "absent");
    a = await att(eEmp, "2026-10-10");
    await q(`select private.recompute_attendance($1, '2026-10-10')`, [eEmp]);
    a = await att(eEmp, "2026-10-10");
    ok("Saturday (2026-10-10) → weekly_off", a?.status === "weekly_off", a?.status);

    // --- employee self check-in (web) ---
    await as("emp");
    let t = await tryq(`insert into attendance_punches (employee_id, punch_type, source, latitude, longitude, accuracy_m, punch_time)
                        values ($1,'in','web',31.520900,74.358700,12,'2020-01-01') returning verification, within_geofence, distance_m, punch_time > now() - interval '1 minute' as server_time`, [eEmp]);
    const r1 = t.r?.rows[0];
    ok("in-office check-in (~56 m) → auto-approved", !t.e && r1?.verification === "auto" && r1?.within_geofence === true, t.e?.message ?? `${r1?.distance_m} m`);
    ok("client-supplied time ignored (server time used)", r1?.server_time === true);
    t = await tryq(`insert into attendance_punches (employee_id, punch_type, source) values ($1,'in','web')`, [eEmp]);
    ok("duplicate check-in within 2 min rejected", !!t.e, t.e?.message);
    t = await tryq(`insert into attendance_punches (employee_id, punch_type, source, latitude, longitude) values ($1,'out','mobile',31.560000,74.400000) returning id, verification, distance_m`, [eEmp]);
    const fieldPunch = t.r?.rows[0];
    ok("field check-out ~5.8 km away → pending verification", fieldPunch?.verification === "pending", `${fieldPunch?.distance_m} m`);
    t = await tryq(`insert into attendance_punches (employee_id, punch_type, source) values ($1,'in','web')`, [eOut]);
    ok("cannot punch for someone else", !!t.e);
    t = await tryq(`insert into attendance_punches (employee_id, punch_type, source) values ($1,'in','biometric')`, [eEmp]);
    ok("cannot fake a biometric punch", !!t.e);
    t = await tryq(`insert into attendance_punches (employee_id, punch_type, source, verification, captured_offline, punch_time) values ($1,'in','web','auto', true, now() - interval '5 hours') returning verification`, [eEmp]);
    ok("cannot self-approve (no GPS → pending)", t.e || t.r.rows[0].verification === "pending", t.e?.message);
    t = await tryq(`update attendance_punches set verification='verified' where id=$1`, [fieldPunch?.id]);
    ok("cannot verify own punch", !!t.e || t.r.rowCount === 0);
    t = await tryq(`insert into attendance_punches (employee_id, punch_type, source, captured_offline, punch_time) values ($1,'out','mobile',true, now() - interval '3 hours') returning verification, punch_time < now() - interval '2 hours' as kept`, [eEmp]);
    ok("offline capture keeps device time and needs verification", t.r?.rows[0]?.kept === true && t.r.rows[0].verification === "pending", t.e?.message);
    t = await tryq(`delete from attendance_punches where employee_id=$1`, [eEmp]);
    ok("employee cannot delete punches", !!t.e);
    t = await tryq(`insert into attendance (employee_id, work_date, status) values ($1,'2026-10-13','present')`, [eEmp]);
    ok("employee cannot write daily attendance", !!t.e);
    t = await tryq(`select api_key_hash from biometric_devices`);
    ok("device key hashes not readable", !!t.e);

    // Regularization for D (late day) → 09:00–17:30
    t = await tryq(`insert into attendance_regularizations (employee_id, work_date, requested_in, requested_out, reason) values ($1,$2,$3,$4,'Traffic jam, gate log shows 09:00') returning id, stage`,
      [eEmp, D, pk("09:00"), pk("17:30")]);
    const reg = t.r?.rows[0];
    ok("employee requests correction (→ manager stage)", reg?.stage === "manager", t.e?.message);
    t = await tryq(`update attendance_regularizations set status='approved' where id=$1`, [reg?.id]);
    ok("employee cannot approve own correction", !!t.e);

    // --- outsider ---
    await as("out");
    let rr = await q(`select id from attendance_punches where employee_id=$1`, [eEmp]);
    ok("unrelated employee can't see others' punches", rr.rows.length === 0);
    rr = await q(`select id from attendance where employee_id=$1`, [eEmp]);
    ok("unrelated employee can't see others' attendance", rr.rows.length === 0);

    // --- manager ---
    await as("mgr");
    t = await tryq(`update attendance_punches set verification='verified', verification_note='On client site' where id=$1 returning verified_by`, [fieldPunch?.id]);
    ok("manager verifies field punch", !t.e && t.r.rows[0]?.verified_by === eMgr, t.e?.message);
    t = await tryq(`update attendance_regularizations set status='approved', decision_comment='ok' where id=$1 returning status`, [reg?.id]);
    ok("manager approves correction", t.r?.rows[0]?.status === "approved", t.e?.message);
    a = (await q(`select * from attendance where employee_id=$1 and work_date=$2`, [eEmp, D])).rows[0];
    ok("corrected day → present, regularized, not late", a?.status === "present" && a.is_regularized && a.late_minutes === 0, `${a?.status} late=${a?.late_minutes}`);
    t = await tryq(`update attendance_punches set punch_time = now() + interval '1 hour' where id=$1`, [fieldPunch?.id]);
    ok("punch times cannot be edited", !!t.e);

    // --- leave integration ---
    await asAdmin();
    const al = (await q(`select id from leave_types where code='AL'`)).rows[0].id;
    await q(`insert into leave_balances (employee_id, leave_type_id, year, allocated) values ($1,$2,2026,14)`, [eOut, al]);
    await as("out");
    const lr = (await q(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1,$2,'2026-10-13','2026-10-13') returning id`, [eOut, al])).rows[0].id;
    await as("hr");
    await q(`update leave_requests set status='approved' where id=$1`, [lr]);
    a = (await q(`select status from attendance where employee_id=$1 and work_date='2026-10-13'`, [eOut])).rows[0];
    ok("approved past leave → attendance status 'leave'", a?.status === "leave", a?.status);
    t = await tryq(`select public.recompute_attendance('2026-10-01','2026-10-02')`);
    ok("HR can recompute a range", !t.e, t.e?.message);
    await as("emp");
    t = await tryq(`select public.recompute_attendance('2026-10-01','2026-10-02')`);
    ok("employee cannot recompute", !!t.e);

    // --- biometric ingestion ---
    await asAdmin();
    await q(`insert into biometric_devices (code, name, location_id, api_key_hash) values ('ZK-T1','Test device',$1, encode(extensions.digest('secret-key','sha256'),'hex'))`, [loc]);
    await q("set local role anon");
    t = await tryq(`select public.ingest_biometric_events('ZK-T1','wrong', '[]'::jsonb)`);
    ok("biometric: wrong key rejected", !!t.e);
    t = await tryq(`select public.ingest_biometric_events('ZK-T1','secret-key', $1::jsonb) as r`,
      [JSON.stringify([
        { user_id: "1003", timestamp: "2026-10-12T09:02:00+05:00" },
        { user_id: "1003", timestamp: "2026-10-12T17:05:00+05:00" },
        { user_id: "1003", timestamp: "2026-10-12T17:05:00+05:00" },
        { user_id: "9999", timestamp: "2026-10-12T09:00:00+05:00" },
      ])]);
    const res = t.r?.rows[0]?.r;
    ok("biometric: 2 accepted, 1 duplicate, 1 unknown", res?.accepted === 2 && res?.duplicates === 1 && res?.unknown_user_ids?.[0] === "9999", t.e?.message ?? JSON.stringify(res));
    await asAdmin();
    a = await att(eEmp, "2026-10-12");
    ok("biometric in/out inferred → present", a?.status === "present" && a.worked_minutes === 483, `${a?.status} ${a?.worked_minutes}`);
    await q("set local role anon");
    t = await tryq(`select * from attendance_punches`);
    ok("anon cannot read punches", !!t.e);
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
