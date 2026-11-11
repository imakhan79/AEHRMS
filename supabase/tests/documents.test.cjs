// Employee document review tests. Everything runs in one transaction that is ROLLED BACK.
// usage: npm run test:documents   (reads DATABASE_URL from .env.local)
// If the review migration isn't applied yet, it is applied inside the transaction first.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ids = {
  hr: "00000000-0000-4000-a000-000000000011",
  emp: "00000000-0000-4000-a000-000000000012",
  out: "00000000-0000-4000-a000-000000000013",
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
    const applied = (await q(`select 1 from information_schema.columns where table_schema='public' and table_name='employee_documents' and column_name='status'`)).rowCount > 0;
    if (!applied) {
      await q(fs.readFileSync(path.join(__dirname, "../migrations/20261112100000_document_review.sql"), "utf8"));
      console.log("(review migration applied inside the test transaction)");
    }

    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`,
        [id, `doc-${k}@test.aeglobal.local`]);
    }
    const dept = (await q(`select id from departments where code='HR'`)).rows[0].id;
    const mk = async (code, who) =>
      (await q(`insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, status)
                values ($1, $2, 'Test', $3, 'male', $4, 'active') returning id`,
        [code, who, `doc-${who}@test.aeglobal.local`, dept])).rows[0];
    const eHr = await mk("TD-001", "hr");
    const eEmp = await mk("TD-002", "emp");
    const eOut = await mk("TD-003", "out");
    await q(`insert into user_roles (user_id, role) values ($1,'hr_admin')`, [ids.hr]);
    const ins = `insert into employee_documents (employee_id, doc_type, title, file_path, file_name) values ($1,'cnic',$2,$3,'x.pdf') returning id, status`;

    // --- employee uploads own document → pending, HR notified ---
    await as("emp");
    let t = await tryq(ins, [eEmp.id, "My CNIC", `${eEmp.id}/a.pdf`]);
    ok("employee upload is pending", !t.e && t.r.rows[0].status === "pending", t.e?.message);
    const docA = t.r.rows[0].id;
    t = await tryq(`insert into employee_documents (employee_id, doc_type, title, file_path, file_name, status) values ($1,'cnic','Sneaky',$2,'x.pdf','verified') returning status`, [eEmp.id, `${eEmp.id}/b.pdf`]);
    ok("employee cannot self-verify on insert", !t.e && t.r.rows[0].status === "pending", t.e?.message);
    const docB = (await q(`select id from employee_documents where file_path=$1`, [`${eEmp.id}/b.pdf`])).rows[0].id;
    t = await tryq(`update employee_documents set status='verified' where id=$1`, [docA]);
    ok("employee cannot verify own document", !!t.e || t.r.rowCount === 0, t.e?.message);
    await asAdmin();
    let r = await q(`select 1 from notifications where user_id=$1 and link='/employees/documents'`, [ids.hr]);
    ok("HR notified of the pending upload", r.rowCount >= 1);

    // --- HR uploads → verified; HR's own file → pending ---
    await as("hr");
    t = await tryq(ins, [eOut.id, "Contract", `${eOut.id}/c.pdf`]);
    ok("HR upload to another file is verified", !t.e && t.r.rows[0].status === "verified", t.e?.message);
    t = await tryq(ins, [eHr.id, "HR own CNIC", `${eHr.id}/d.pdf`]);
    ok("HR upload to own file is pending", !t.e && t.r.rows[0].status === "pending", t.e?.message);
    const docD = t.r.rows[0].id;
    t = await tryq(`update employee_documents set status='verified' where id=$1`, [docD]);
    ok("HR cannot verify own document", !!t.e, t.e?.message);

    // --- HR reviews ---
    t = await tryq(`update employee_documents set status='rejected' where id=$1`, [docB]);
    ok("reject without a reason is refused", !!t.e, t.e?.message);
    t = await tryq(`update employee_documents set status='verified' where id=$1 returning reviewed_by, reviewed_at`, [docA]);
    ok("HR verifies a pending document", !t.e && t.r.rows[0].reviewed_by === eHr.id && !!t.r.rows[0].reviewed_at, t.e?.message);
    t = await tryq(`update employee_documents set status='rejected', review_note='Blurry scan' where id=$1`, [docB]);
    ok("HR rejects with a reason", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`update employee_documents set status='pending' where id=$1`, [docA]);
    ok("a decided document cannot be reopened", !!t.e, t.e?.message);
    t = await tryq(`update employee_documents set title='Renamed' where id=$1`, [docA]);
    ok("HR cannot edit document details", !!t.e, t.e?.message);

    await asAdmin();
    r = await q(`select title from notifications where user_id=$1 and link='/profile#documents' order by created_at`, [ids.emp]);
    ok("employee notified of both decisions", r.rowCount === 2, r.rows.map((x) => x.title).join(" | "));

    // --- employee sees outcome ---
    await as("emp");
    r = await q(`select status, review_note from employee_documents where id=$1`, [docB]);
    ok("employee sees rejection reason", r.rows[0]?.status === "rejected" && r.rows[0]?.review_note === "Blurry scan");
  } catch (e) {
    fail++;
    console.error("ERROR", e);
  } finally {
    await q("rollback").catch(() => {});
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
