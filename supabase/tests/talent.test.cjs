// Recruitment, performance, training. ROLLED BACK. usage: npm run test:talent
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-a100-000000000001",
  rec: "00000000-0000-4000-a100-000000000002",
  mgr: "00000000-0000-4000-a100-000000000003",
  emp: "00000000-0000-4000-a100-000000000004",
  peer: "00000000-0000-4000-a100-000000000005",
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
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`, [id, `${k}@tal-test.local`]);
    }
    const dept = (await q(`select id from departments where code='IT'`)).rows[0].id;
    const mk = async (code, who, mgr) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, department_id, manager_id, status, joining_date)
                values ($1,$2,'Test',$3,$4,$5,'confirmed','2022-01-01') returning id`, [code, who, `${who}@tal-test.local`, dept, mgr])).rows[0].id;
    await mk("TL-001", "hr", null);
    await mk("TL-002", "rec", null);
    const eMgr = await mk("TL-003", "mgr", null);
    const eEmp = await mk("TL-004", "emp", eMgr);
    const ePeer = await mk("TL-005", "peer", eMgr);
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin'),($2,'recruiter')`, [ids.hr, ids.rec]);

    // ---------- Recruitment ----------
    await as("emp");
    let t = await tryq(`insert into requisitions (title, department_id, justification) values ('Dev', $1, 'x')`, [dept]);
    ok("plain employee can't raise a requisition", !!t.e);
    await as("mgr");
    const req = (await q(`insert into requisitions (title, department_id, headcount, justification, salary_min, salary_max) values ('Software Engineer', $1, 1, 'Backfill', 150000, 250000) returning id, status`, [dept])).rows[0];
    ok("manager raises requisition (pending)", req.status === "pending");
    t = await tryq(`update requisitions set status='approved' where id=$1`, [req.id]);
    ok("manager can't approve requisition", !!t.e || t.r.rowCount === 0);
    await as("rec");
    t = await tryq(`insert into candidates (requisition_id, full_name) values ($1,'Too Early')`, [req.id]);
    ok("no candidates before approval", !!t.e, t.e?.message);
    await as("hr");
    await q(`update requisitions set status='approved', decision_comment='ok' where id=$1`, [req.id]);
    await as("rec");
    const cand = (await q(`insert into candidates (requisition_id, full_name, email, cnic, expected_salary) values ($1,'Sana Javed','sana@example.com','35202-1111111-1',220000) returning id`, [req.id])).rows[0].id;
    t = await tryq(`update candidates set stage='hired' where id=$1`, [cand]);
    ok("can't mark hired directly", !!t.e, t.e?.message);
    await q(`insert into interviews (candidate_id, scheduled_at, interviewer_id) values ($1, now() + interval '1 day', $2)`, [cand, eMgr]);
    let r = await q(`select stage from candidates where id=$1`, [cand]);
    ok("scheduling an interview moves candidate to Interview", r.rows[0].stage === "interview");
    await as("mgr");
    r = await q(`select full_name from candidates where id=$1`, [cand]);
    ok("interviewer can see their candidate", r.rows.length === 1);
    t = await tryq(`update interviews set status='completed', score=4, recommendation='hire', feedback='Strong' where candidate_id=$1`, [cand]);
    ok("interviewer records feedback", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`update interviews set scheduled_at = now() where candidate_id=$1`, [cand]);
    ok("interviewer can't reschedule", !!t.e);
    await as("emp");
    r = await q(`select id from candidates`);
    ok("employees can't see candidates", r.rows.length === 0);
    await as("rec");
    await q(`insert into offers (candidate_id, offered_salary, joining_date, expiry_date) values ($1, 231000, current_date + 30, current_date + 7)`, [cand]);
    t = await tryq(`select public.rec_hire($1,'TL-NEW')`, [cand]);
    ok("can't hire before offer accepted", !!t.e, t.e?.message);
    await q(`update offers set status='accepted' where candidate_id=$1`, [cand]);
    const newEmp = (await q(`select public.rec_hire($1,'tl-new') id`, [cand])).rows[0].id;
    r = await q(`select employee_code, status, department_id, probation_end_date, joining_date from employees where id=$1`, [newEmp]);
    ok("hire creates employee (code upper-cased, probation, dept)", r.rows[0].employee_code === "TL-NEW" && r.rows[0].status === "probation" && r.rows[0].department_id === dept);
    r = await q(`select count(*)::int n from onboarding_tasks where employee_id=$1`, [newEmp]);
    ok("onboarding checklist generated (9 tasks)", r.rows[0].n === 9, r.rows[0].n);
    await q("reset role"); // recruiters correctly cannot read salaries
    r = await q(`select basic_salary from employee_salaries where employee_id=$1`, [newEmp]);
    await as("rec");
    ok("salary pre-filled: gross 231,000 / 1.65 = basic 140,000", n(r.rows[0]?.basic_salary) === 140000, r.rows[0]?.basic_salary);
    r = await q(`select status from requisitions where id=$1`, [req.id]);
    ok("requisition closed when headcount filled", r.rows[0].status === "closed");

    // ---------- Performance ----------
    await as("hr");
    const cyc = (await q(`insert into appraisal_cycles (name, period_start, period_end) values ('FY2027 annual','2026-07-01','2027-06-30') returning id`)).rows[0].id;
    const started = (await q(`select public.perf_start_cycle($1) n`, [cyc])).rows[0].n;
    ok("starting a cycle creates appraisals", started >= 3, started);
    await as("emp");
    const ap = (await q(`select id, manager_id from appraisals where cycle_id=$1 and employee_id=$2`, [cyc, eEmp])).rows[0];
    ok("appraisal snapshot has the line manager", ap.manager_id === eMgr);
    await q(`insert into goals (appraisal_id, title, weight) values ($1,'Ship HRMS v2',60),($1,'Mentor juniors',30)`, [ap.id]);
    t = await tryq(`update goals set self_score=5 where appraisal_id=$1`, [ap.id]);
    ok("no self-scores during goal setting", !!t.e);
    await as("peer");
    t = await tryq(`insert into goals (appraisal_id, title, weight) values ($1,'Hack',10)`, [ap.id]);
    ok("colleague can't add goals to someone's appraisal", !!t.e);
    await as("hr");
    await q(`select public.perf_open_review($1)`, [cyc]);
    await as("emp");
    t = await tryq(`insert into goals (appraisal_id, title, weight) values ($1,'Late goal',10)`, [ap.id]);
    ok("goals locked after review opens", !!t.e);
    await q(`update goals set self_score=4, self_comment='done' where appraisal_id=$1`, [ap.id]);
    t = await tryq(`select public.perf_submit_self($1,'Good year')`, [ap.id]);
    ok("self review blocked: weights total 90%", !!t.e, t.e?.message);
    await as("hr");
    await q("reset role");
    await q(`update appraisals set status='goal_setting' where id=$1`, [ap.id]);
    await q(`insert into goals (appraisal_id, title, weight) values ($1,'Docs',10)`, [ap.id]);
    await q(`update appraisals set status='self_review' where id=$1`, [ap.id]);
    await as("emp");
    await q(`update goals set self_score=4 where appraisal_id=$1 and self_score is null`, [ap.id]);
    await q(`select public.perf_submit_self($1,'Good year')`, [ap.id]);
    t = await tryq(`update goals set manager_score=5 where appraisal_id=$1`, [ap.id]);
    ok("employee can't enter manager scores", !!t.e);
    await as("mgr");
    await q(`insert into feedback_requests (appraisal_id, reviewer_id) values ($1,$2)`, [ap.id, ePeer]);
    await q(`update goals set manager_score = case when title='Ship HRMS v2' then 5 when title='Mentor juniors' then 3 else 4 end where appraisal_id=$1`, [ap.id]);
    const score = (await q(`select public.perf_submit_manager($1,'Great work','increment',12) s`, [ap.id])).rows[0].s;
    ok("weighted score = (5×60 + 3×30 + 4×10)/100 = 4.30", n(score) === 4.3, score);
    r = await q(`select rating from appraisals where id=$1`, [ap.id]);
    ok("rating band: Exceeds expectations", r.rows[0].rating === "Exceeds expectations");
    await as("peer");
    t = await tryq(`update feedback_requests set score=4, strengths='Helpful' where appraisal_id=$1`, [ap.id]);
    ok("peer submits 360° feedback", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`update feedback_requests set score=1 where appraisal_id=$1`, [ap.id]);
    ok("feedback can't be changed after submission", !!t.e);
    await as("emp");
    r = await q(`select id from feedback_requests where appraisal_id=$1`, [ap.id]);
    ok("employee can't see who gave 360° feedback", r.rows.length === 0);
    await q(`select public.perf_acknowledge($1)`, [ap.id]);
    r = await q(`select status from appraisals where id=$1`, [ap.id]);
    ok("employee acknowledges completed appraisal", r.rows[0].status === "acknowledged");

    // ---------- Training ----------
    await as("hr");
    const ev = (await q(`insert into training_events (title, start_date, end_date, capacity) values ('Excel for Finance', current_date + 10, current_date + 11, 1) returning id`)).rows[0].id;
    await as("mgr");
    t = await tryq(`insert into training_participants (event_id, employee_id) values ($1,$2)`, [ev, eEmp]);
    ok("manager nominates own report", !t.e, t.e?.message);
    t = await tryq(`insert into training_participants (event_id, employee_id) values ($1,$2)`, [ev, ePeer]);
    ok("capacity enforced (1 seat)", !!t.e, t.e?.message);
    await as("emp");
    t = await tryq(`insert into training_participants (event_id, employee_id) values ($1,$2)`, [ev, ePeer]);
    ok("employee can't nominate others", !!t.e);
    t = await tryq(`update training_participants set feedback_rating=5 where event_id=$1`, [ev]);
    ok("no feedback before attending", !!t.e);
    await as("hr");
    await q(`update training_participants set status='attended' where event_id=$1`, [ev]);
    await as("emp");
    t = await tryq(`update training_participants set feedback_rating=5, feedback_comment='Useful' where event_id=$1`, [ev]);
    ok("employee leaves feedback after attending", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`update training_participants set status='absent' where event_id=$1`, [ev]);
    ok("employee can't change attendance", !!t.e);
    const cert = (await q(`insert into certifications (employee_id, name, expires_on, verified) values ($1,'PMP', current_date + 20, true) returning verified`, [eEmp])).rows[0];
    ok("self-added certification is unverified", cert.verified === false);
    await q(`insert into training_needs (employee_id, skill, priority) values ($1,'Power BI','high')`, [eEmp]);
    await q("reset role");
    const sent = (await q(`select private.certification_reminders() n`)).rows[0].n;
    ok("certification expiry reminder fires (expires in 20 days)", sent >= 1, sent);
  } catch (e) {
    fail++; console.log("ERROR", e.message);
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
    process.exit(fail ? 1 : 0);
  }
})();
