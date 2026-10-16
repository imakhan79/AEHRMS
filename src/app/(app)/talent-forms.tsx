"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import * as A from "./talent-actions";

type Option = { id: string; label: string };
const Opts = ({ items, placeholder }: { items: Option[]; placeholder?: string }) => (
  <>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {items.map((o) => (
      <option key={o.id} value={o.id}>
        {o.label}
      </option>
    ))}
  </>
);
const Stars = ({ name, defaultValue }: { name: string; defaultValue?: number | null }) => (
  <Select name={name} defaultValue={defaultValue ? String(defaultValue) : ""} className="w-28 py-1.5">
    <option value="">—</option>
    {[5, 4, 3, 2, 1].map((s) => (
      <option key={s} value={s}>
        {s} — {["", "Poor", "Fair", "Good", "Very good", "Excellent"][s]}
      </option>
    ))}
  </Select>
);

// ---------- Recruitment ----------

export function RequisitionForm({ departments, positions, locations }: { departments: Option[]; positions: Option[]; locations: Option[] }) {
  return (
    <ActionForm action={A.raiseRequisition} resetOnSuccess className="space-y-3">
      <Field label="Role title" name="rq_title">
        <Input id="rq_title" name="title" required placeholder="e.g. Site Engineer" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department" name="rq_dept">
          <Select id="rq_dept" name="department_id" required defaultValue="">
            <Opts items={departments} placeholder="Select…" />
          </Select>
        </Field>
        <Field label="Position" name="rq_pos">
          <Select id="rq_pos" name="position_id" defaultValue="">
            <Opts items={positions} placeholder="—" />
          </Select>
        </Field>
        <Field label="Location" name="rq_loc">
          <Select id="rq_loc" name="location_id" defaultValue="">
            <Opts items={locations} placeholder="—" />
          </Select>
        </Field>
        <Field label="Headcount" name="rq_hc">
          <Input id="rq_hc" name="headcount" type="number" min={1} max={100} defaultValue={1} />
        </Field>
        <Field label="Employment type" name="rq_type">
          <Select id="rq_type" name="employment_type" defaultValue="permanent">
            {["permanent", "contractual", "probationary", "intern", "consultant"].map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Salary from" name="rq_min">
            <Input id="rq_min" name="salary_min" type="number" min={0} />
          </Field>
          <Field label="to" name="rq_max">
            <Input id="rq_max" name="salary_max" type="number" min={0} />
          </Field>
        </div>
      </div>
      <Field label="Justification" name="rq_just">
        <Textarea id="rq_just" name="justification" required placeholder="New project, backfill, growth…" />
      </Field>
      <SubmitButton size="sm">Raise requisition</SubmitButton>
    </ActionForm>
  );
}

export function RequisitionDecision({ id }: { id: string }) {
  return (
    <ActionForm action={A.setRequisitionStatus.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <Input name="comment" placeholder="Comment (required to reject)" className="w-52 py-1.5 text-xs" />
      <SubmitButton size="sm" variant="success" name="status" value="approved">
        Approve
      </SubmitButton>
      <SubmitButton size="sm" variant="danger" name="status" value="rejected">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

export function CloseRequisition({ id }: { id: string }) {
  return (
    <ActionForm action={A.setRequisitionStatus.bind(null, id)}>
      <SubmitButton size="sm" variant="secondary" name="status" value="closed">
        Close requisition
      </SubmitButton>
    </ActionForm>
  );
}

export function CandidateForm({ reqId }: { reqId: string }) {
  return (
    <ActionForm action={A.addCandidate.bind(null, reqId)} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name" name="cd_name" className="col-span-2">
          <Input id="cd_name" name="full_name" required />
        </Field>
        <Field label="Email" name="cd_email">
          <Input id="cd_email" name="email" type="email" />
        </Field>
        <Field label="Phone" name="cd_phone">
          <Input id="cd_phone" name="phone" type="tel" />
        </Field>
        <Field label="CNIC" name="cd_cnic">
          <Input id="cd_cnic" name="cnic" placeholder="35202-1234567-1" />
        </Field>
        <Field label="Source" name="cd_src">
          <Select id="cd_src" name="source" defaultValue="direct">
            {["direct", "referral", "job_board", "linkedin", "agency", "walk_in", "other"].map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Current company" name="cd_co">
          <Input id="cd_co" name="current_company" />
        </Field>
        <Field label="Experience (years)" name="cd_exp">
          <Input id="cd_exp" name="experience_years" type="number" min={0} step="0.5" />
        </Field>
        <Field label="Expected salary" name="cd_sal">
          <Input id="cd_sal" name="expected_salary" type="number" min={0} />
        </Field>
        <Field label="CV (PDF/Word, 5 MB)" name="cd_cv">
          <Input id="cd_cv" name="cv" type="file" accept=".pdf,.doc,.docx" className="py-1.5" />
        </Field>
      </div>
      <SubmitButton size="sm">Add candidate</SubmitButton>
    </ActionForm>
  );
}

export function CandidateNotesForm({ id, rating, notes }: { id: string; rating: number | null; notes: string | null }) {
  return (
    <ActionForm action={A.rateCandidate.bind(null, id)} className="space-y-3">
      <Field label="Overall rating" name="cn_rating">
        <Stars name="rating" defaultValue={rating} />
      </Field>
      <Field label="Notes" name="cn_notes">
        <Textarea id="cn_notes" name="notes" defaultValue={notes ?? ""} rows={3} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

export function InterviewForm({ candidateId, interviewers }: { candidateId: string; interviewers: Option[] }) {
  return (
    <ActionForm action={A.scheduleInterview.bind(null, candidateId)} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Round" name="iv_round">
          <Input id="iv_round" name="round" defaultValue="Technical" required />
        </Field>
        <Field label="Interviewer" name="iv_who">
          <Select id="iv_who" name="interviewer_id" required defaultValue="">
            <Opts items={interviewers} placeholder="Select…" />
          </Select>
        </Field>
        <Field label="Date" name="iv_date">
          <Input id="iv_date" name="date" type="date" required />
        </Field>
        <Field label="Time (PKT)" name="iv_time">
          <Input id="iv_time" name="time" type="time" required defaultValue="11:00" />
        </Field>
        <Field label="Mode" name="iv_mode">
          <Select id="iv_mode" name="mode" defaultValue="onsite">
            <option value="onsite">On-site</option>
            <option value="video">Video</option>
            <option value="phone">Phone</option>
          </Select>
        </Field>
        <Field label="Room / link" name="iv_loc">
          <Input id="iv_loc" name="location" />
        </Field>
      </div>
      <SubmitButton size="sm">Schedule interview</SubmitButton>
    </ActionForm>
  );
}

export function InterviewFeedbackForm({ id }: { id: string }) {
  return (
    <ActionForm action={A.interviewFeedback.bind(null, id)} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Field label="Score" name="if_score">
          <Stars name="score" />
        </Field>
        <Field label="Recommendation" name="if_rec">
          <Select id="if_rec" name="recommendation" defaultValue="hold" className="w-36 py-1.5">
            <option value="hire">Hire</option>
            <option value="hold">Hold</option>
            <option value="reject">Reject</option>
          </Select>
        </Field>
      </div>
      <Field label="Assessment" name="if_fb">
        <Textarea id="if_fb" name="feedback" required rows={3} />
      </Field>
      <SubmitButton size="sm">Submit feedback</SubmitButton>
    </ActionForm>
  );
}

export function OfferForm({ candidateId, defaults }: { candidateId: string; defaults?: { offered_salary: number; joining_date: string; expiry_date: string; probation_months: number; notes: string | null } }) {
  const d = new Date();
  const plus = (days: number) => new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
  return (
    <ActionForm action={A.saveOffer.bind(null, candidateId)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monthly gross (PKR)" name="of_sal">
          <Input id="of_sal" name="offered_salary" type="number" min={1} required defaultValue={defaults?.offered_salary} />
        </Field>
        <Field label="Joining date" name="of_join">
          <Input id="of_join" name="joining_date" type="date" required defaultValue={defaults?.joining_date ?? plus(30)} />
        </Field>
        <Field label="Offer valid until" name="of_exp">
          <Input id="of_exp" name="expiry_date" type="date" required defaultValue={defaults?.expiry_date ?? plus(7)} />
        </Field>
        <Field label="Probation (months)" name="of_prob">
          <Input id="of_prob" name="probation_months" type="number" min={0} max={12} defaultValue={defaults?.probation_months ?? 3} />
        </Field>
      </div>
      <Field label="Notes / benefits" name="of_notes">
        <Textarea id="of_notes" name="notes" defaultValue={defaults?.notes ?? ""} rows={2} />
      </Field>
      <SubmitButton size="sm">Save offer</SubmitButton>
    </ActionForm>
  );
}

export function HireForm({ candidateId }: { candidateId: string }) {
  return (
    <ActionForm action={A.hireCandidate.bind(null, candidateId)} className="flex flex-wrap items-end gap-2">
      <Field label="New employee code" name="hr_code">
        <Input id="hr_code" name="employee_code" required placeholder="AEG-0101" className="w-40" />
      </Field>
      <SubmitButton variant="success">Hire &amp; create employee</SubmitButton>
    </ActionForm>
  );
}

// ---------- Performance ----------

export function CycleForm() {
  return (
    <ActionForm action={A.createCycle} resetOnSuccess className="space-y-3">
      <Field label="Name" name="cy_name">
        <Input id="cy_name" name="name" required placeholder="FY2027 annual review" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Type" name="cy_type">
          <Select id="cy_type" name="cycle_type" defaultValue="annual">
            <option value="annual">Annual</option>
            <option value="semi_annual">Semi-annual</option>
            <option value="quarterly">Quarterly</option>
          </Select>
        </Field>
        <Field label="From" name="cy_from">
          <Input id="cy_from" name="period_start" type="date" required />
        </Field>
        <Field label="To" name="cy_to">
          <Input id="cy_to" name="period_end" type="date" required />
        </Field>
      </div>
      <SubmitButton size="sm">Create cycle</SubmitButton>
    </ActionForm>
  );
}

export function GoalForm({ appraisalId, remaining }: { appraisalId: string; remaining: number }) {
  return (
    <ActionForm action={A.addGoal.bind(null, appraisalId)} resetOnSuccess className="grid gap-3 sm:grid-cols-6 sm:items-end">
      <Field label="Type" name="gl_kind">
        <Select id="gl_kind" name="kind" defaultValue="kpi">
          <option value="kpi">KPI</option>
          <option value="okr">OKR</option>
          <option value="goal">Goal</option>
        </Select>
      </Field>
      <Field label="Goal" name="gl_title" className="sm:col-span-2">
        <Input id="gl_title" name="title" required />
      </Field>
      <Field label="Target / measure" name="gl_target" className="sm:col-span-2">
        <Input id="gl_target" name="target" />
      </Field>
      <Field label={`Weight % (${remaining} left)`} name="gl_w">
        <Input id="gl_w" name="weight" type="number" min={1} max={100} required defaultValue={remaining > 0 ? remaining : undefined} />
      </Field>
      <div className="sm:col-span-6">
        <SubmitButton size="sm" variant="secondary">
          Add goal
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

type G = { id: string; title: string; weight: number; target: string | null; self_score: number | null; self_comment: string | null; manager_score: number | null; manager_comment: string | null };

export function ScoreForm({ appraisalId, who, goals }: { appraisalId: string; who: "self" | "manager"; goals: G[] }) {
  return (
    <ActionForm action={A.saveScores.bind(null, appraisalId, who)} className="space-y-4">
      {goals.map((g) => (
        <div key={g.id} className="grid gap-2 rounded-lg border border-gray-100 p-3 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="font-medium text-gray-900">
              {g.title} <span className="text-xs text-gray-500">· {Number(g.weight)}%</span>
            </div>
            {who === "manager" && g.self_score && (
              <div className="text-xs text-gray-500">
                Self: {g.self_score}/5{g.self_comment ? ` — ${g.self_comment}` : ""}
              </div>
            )}
            <Input name={`comment_${g.id}`} defaultValue={(who === "self" ? g.self_comment : g.manager_comment) ?? ""} placeholder="Evidence / comment" className="mt-2 py-1.5 text-sm" />
          </div>
          <Stars name={`score_${g.id}`} defaultValue={who === "self" ? g.self_score : g.manager_score} />
        </div>
      ))}
      <Field label={who === "self" ? "Overall self-assessment" : "Manager's summary"} name="sc_overall">
        <Textarea id="sc_overall" name="overall_comment" rows={3} />
      </Field>
      {who === "manager" && (
        <div className="flex flex-wrap gap-3">
          <Field label="Recommendation" name="sc_rec">
            <Select id="sc_rec" name="recommendation" defaultValue="none" className="w-44">
              <option value="none">None</option>
              <option value="increment">Increment</option>
              <option value="promotion">Promotion</option>
              <option value="pip">Improvement plan</option>
            </Select>
          </Field>
          <Field label="Increment %" name="sc_inc">
            <Input id="sc_inc" name="increment_pct" type="number" min={0} max={100} step="0.5" className="w-28" />
          </Field>
        </div>
      )}
      <div className="flex gap-2">
        <SubmitButton size="sm" variant="secondary">
          Save draft
        </SubmitButton>
        <SubmitButton size="sm" name="submit" value="1">
          {who === "self" ? "Submit self review" : "Complete review"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FeedbackRequestForm({ appraisalId, people }: { appraisalId: string; people: Option[] }) {
  return (
    <ActionForm action={A.requestFeedback.bind(null, appraisalId)} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <Field label="Reviewer" name="fr_who">
        <Select id="fr_who" name="reviewer_id" required defaultValue="" className="w-56">
          <Opts items={people} placeholder="Select…" />
        </Select>
      </Field>
      <Field label="Relationship" name="fr_rel">
        <Select id="fr_rel" name="relationship" defaultValue="peer" className="w-40">
          <option value="peer">Peer</option>
          <option value="direct_report">Direct report</option>
          <option value="cross_functional">Cross-functional</option>
          <option value="client">Client</option>
        </Select>
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Request 360° feedback
      </SubmitButton>
    </ActionForm>
  );
}

export function GiveFeedbackForm({ id }: { id: string }) {
  return (
    <ActionForm action={A.giveFeedback.bind(null, id)} className="space-y-2">
      <Stars name="score" />
      <Textarea name="strengths" required placeholder="Strengths" rows={2} />
      <Textarea name="improvements" placeholder="Areas to improve" rows={2} />
      <SubmitButton size="sm">Submit</SubmitButton>
    </ActionForm>
  );
}

// ---------- Training ----------

export function TrainingEventForm() {
  return (
    <ActionForm action={A.createTraining} resetOnSuccess className="space-y-3">
      <Field label="Title" name="te_title">
        <Input id="te_title" name="title" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" name="te_from">
          <Input id="te_from" name="start_date" type="date" required />
        </Field>
        <Field label="To" name="te_to">
          <Input id="te_to" name="end_date" type="date" required />
        </Field>
        <Field label="Mode" name="te_mode">
          <Select id="te_mode" name="mode" defaultValue="classroom">
            <option value="classroom">Classroom</option>
            <option value="online">Online</option>
            <option value="on_job">On the job</option>
            <option value="external">External</option>
          </Select>
        </Field>
        <Field label="Seats" name="te_cap">
          <Input id="te_cap" name="capacity" type="number" min={1} />
        </Field>
        <Field label="Provider" name="te_prov">
          <Input id="te_prov" name="provider" />
        </Field>
        <Field label="Trainer" name="te_trainer">
          <Input id="te_trainer" name="trainer" />
        </Field>
        <Field label="Venue / link" name="te_loc">
          <Input id="te_loc" name="location" />
        </Field>
        <Field label="Cost (PKR)" name="te_cost">
          <Input id="te_cost" name="cost" type="number" min={0} defaultValue={0} />
        </Field>
      </div>
      <SubmitButton size="sm">Schedule training</SubmitButton>
    </ActionForm>
  );
}

export function NominateForm({ eventId, people }: { eventId: string; people: Option[] }) {
  return (
    <ActionForm action={A.nominate.bind(null, eventId)} resetOnSuccess className="flex gap-2">
      <Select name="employee_id" required defaultValue="" className="w-56 py-1.5 text-xs">
        <Opts items={people} placeholder="Nominate…" />
      </Select>
      <SubmitButton size="sm" variant="secondary">
        Add
      </SubmitButton>
    </ActionForm>
  );
}

export function TrainingFeedbackForm({ id }: { id: string }) {
  return (
    <ActionForm action={A.trainingFeedback.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <Stars name="feedback_rating" />
      <Input name="feedback_comment" placeholder="Was it useful?" className="w-56 py-1.5 text-xs" />
      <SubmitButton size="sm">Rate</SubmitButton>
    </ActionForm>
  );
}

export function NeedForm({ people }: { people?: Option[] }) {
  return (
    <ActionForm action={A.raiseNeed} resetOnSuccess className="space-y-3">
      {people && (
        <Field label="Employee" name="tn_emp">
          <Select id="tn_emp" name="employee_id" defaultValue="">
            <Opts items={people} placeholder="Myself" />
          </Select>
        </Field>
      )}
      <Field label="Skill / topic" name="tn_skill">
        <Input id="tn_skill" name="skill" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" name="tn_pri">
          <Select id="tn_pri" name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Field label="Why" name="tn_reason">
          <Input id="tn_reason" name="reason" />
        </Field>
      </div>
      <SubmitButton size="sm" variant="secondary">
        Record need
      </SubmitButton>
    </ActionForm>
  );
}

export function CertificationForm({ people }: { people?: Option[] }) {
  return (
    <ActionForm action={A.addCertification} resetOnSuccess className="space-y-3">
      {people && (
        <Field label="Employee" name="ce_emp">
          <Select id="ce_emp" name="employee_id" defaultValue="">
            <Opts items={people} placeholder="Myself" />
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Certification" name="ce_name">
          <Input id="ce_name" name="name" required />
        </Field>
        <Field label="Issuer" name="ce_iss">
          <Input id="ce_iss" name="issuer" />
        </Field>
        <Field label="Issued" name="ce_on">
          <Input id="ce_on" name="issued_on" type="date" />
        </Field>
        <Field label="Expires" name="ce_exp">
          <Input id="ce_exp" name="expires_on" type="date" />
        </Field>
      </div>
      <SubmitButton size="sm" variant="secondary">
        Add certification
      </SubmitButton>
    </ActionForm>
  );
}
