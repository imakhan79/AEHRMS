// Expense draft editing + optional receipts. Runs in one transaction that is ROLLED BACK.
// usage: npm run test:expense-edit   (reads DATABASE_URL from .env.local)
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ids = { emp: "00000000-0000-4000-a000-000000000021", out: "00000000-0000-4000-a000-000000000022" };
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
  const tryq = async (sql, p) => {
    await q("savepoint s");
    try { const r = await q(sql, p); await q("release savepoint s"); return { r }; }
    catch (e) { await q("rollback to savepoint s"); return { e }; }
  };

  try {
    await q("begin");
    const applied = (await q(`select 1 from pg_policies where tablename='expense_items' and policyname='expense_items: own draft update'`)).rowCount > 0;
    if (!applied) {
      await q(fs.readFileSync(path.join(__dirname, "../migrations/20261112110000_expense_receipts_optional_draft_edit.sql"), "utf8"));
      console.log("(expense migration applied inside the test transaction)");
    }
    for (const [k, id] of Object.entries(ids)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())`,
        [id, `exp-${k}@test.aeglobal.local`]);
    }
    const dept = (await q(`select id from departments where code='HR'`)).rows[0].id;
    for (const [k, code] of [["emp", "TE-001"], ["out", "TE-002"]]) {
      await q(`insert into employees (employee_code, first_name, last_name, work_email, gender, department_id, status)
               values ($1, $2, 'Test', $3, 'male', $4, 'active')`, [code, k, `exp-${k}@test.aeglobal.local`, dept]);
    }
    const cat = (await q(`select id from expense_categories where code='TRAVEL'`)).rows[0].id;
    const today = new Date().toISOString().slice(0, 10);

    await as("emp");
    const claim = (await q(`insert into expense_claims (employee_id, title) values (private.current_employee_id(), 'Trip') returning id`)).rows[0].id;
    const item = (await q(`insert into expense_items (claim_id, category_id, expense_date, description, amount) values ($1,$2,$3,'Taxi',1000) returning id`, [claim, cat, today])).rows[0].id;
    let t = await tryq(`update expense_items set amount=1500, description='Taxi to airport' where id=$1`, [item]);
    ok("employee edits an item on own draft", !t.e && t.r.rowCount === 1, t.e?.message);
    let r = await q(`select total from expense_claims where id=$1`, [claim]);
    ok("claim total follows the edit", Number(r.rows[0].total) === 1500, r.rows[0].total);
    t = await tryq(`update expense_claims set title='Lahore trip' where id=$1`, [claim]);
    ok("employee renames own draft", !t.e && t.r.rowCount === 1, t.e?.message);
    t = await tryq(`update expense_items set claim_id=claim_id where id=$1`, [item]);
    ok("item cannot be moved to another claim", !!t.e, t.e?.message);
    t = await tryq(`select public.exp_submit($1)`, [claim]);
    ok("submit works without a receipt (TRAVEL)", !t.e, t.e?.message);
    t = await tryq(`update expense_items set amount=10 where id=$1`, [item]);
    ok("submitted claim items can't be edited", !!t.e || t.r.rowCount === 0, t.e?.message);

    await as("out");
    t = await tryq(`update expense_items set amount=1 where id=$1`, [item]);
    ok("another employee can't edit the item", !!t.e || t.r.rowCount === 0, t.e?.message);
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
