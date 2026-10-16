"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const err = (e: { message: string; code?: string } | null): ActionState => ({ error: friendlyError(e) });
const optUuid = z.union([z.uuid(), z.literal("")]).optional();
const parse = <T extends z.ZodTypeAny>(schema: T, fd: FormData) => schema.safeParse(Object.fromEntries(fd));

// =================== Recruitment ===================

export async function raiseRequisition(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      title: z.string().trim().min(2).max(120),
      department_id: z.uuid("Choose a department."),
      position_id: optUuid,
      location_id: optUuid,
      headcount: z.coerce.number().int().min(1).max(100),
      employment_type: z.enum(["permanent", "contractual", "probationary", "intern", "consultant"]),
      salary_min: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
      salary_max: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
      justification: z.string().trim().min(5, "Explain why this role is needed.").max(1000),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("requisitions").insert(emptyToNull(p.data));
  if (error) return err(error);
  revalidatePath("/recruitment");
  return { ok: true, message: "Requisition sent to HR for approval." };
}

export async function setRequisitionStatus(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const status = String(fd.get("status"));
  if (!["approved", "rejected", "cancelled", "closed"].includes(status)) return { error: "Invalid action." };
  const comment = String(fd.get("comment") ?? "").trim() || null;
  if (status === "rejected" && !comment) return { error: "Give a reason when rejecting." };
  const supabase = await createClient();
  const { error } = await supabase.from("requisitions").update({ status, decision_comment: comment }).eq("id", id);
  if (error) return err(error);
  revalidatePath("/recruitment", "layout");
  return { ok: true, message: `Requisition ${status}.` };
}

export async function addCandidate(reqId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      full_name: z.string().trim().min(2).max(120),
      email: z.union([z.email("Email is not valid."), z.literal("")]).optional(),
      phone: z.string().trim().max(30).optional(),
      cnic: z.union([z.string().regex(/^\d{5}-\d{7}-\d$/, "CNIC must look like 35202-1234567-1."), z.literal("")]).optional(),
      current_company: z.string().trim().max(120).optional(),
      experience_years: z.union([z.coerce.number().min(0).max(60), z.literal("")]).optional(),
      expected_salary: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
      source: z.enum(["direct", "referral", "job_board", "linkedin", "agency", "walk_in", "other"]),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  let cv_path: string | null = null;
  const file = fd.get("cv");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) return { error: "CV must be 5 MB or smaller." };
    cv_path = `${reqId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-60)}`;
    const { error: upErr } = await supabase.storage.from("candidate-cvs").upload(cv_path, file, { contentType: file.type });
    if (upErr) return { error: upErr.message.includes("mime") ? "Upload a PDF or Word CV." : upErr.message };
  }
  const { error } = await supabase.from("candidates").insert(emptyToNull({ requisition_id: reqId, ...p.data, cv_path: cv_path ?? "" }));
  if (error) return err(error);
  revalidatePath(`/recruitment/${reqId}`);
  return { ok: true, message: "Candidate added." };
}

export async function moveCandidate(id: string, reqId: string, stage: string) {
  await requireSession();
  if (!["applied", "screening", "interview", "selected", "offered", "rejected"].includes(stage)) throw new Error("Invalid stage");
  const supabase = await createClient();
  const { error } = await supabase.from("candidates").update({ stage }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath(`/recruitment/${reqId}`);
  revalidatePath(`/recruitment/candidates/${id}`);
}

export async function rateCandidate(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const rating = Number(fd.get("rating")) || null;
  const notes = String(fd.get("notes") ?? "").trim().slice(0, 2000) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("candidates").update({ rating, notes }).eq("id", id);
  if (error) return err(error);
  revalidatePath(`/recruitment/candidates/${id}`);
  return { ok: true, message: "Saved." };
}

export async function scheduleInterview(candidateId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      round: z.string().trim().min(2).max(60),
      date: z.iso.date(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      mode: z.enum(["onsite", "video", "phone"]),
      location: z.string().trim().max(200).optional(),
      interviewer_id: z.uuid("Choose an interviewer."),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const { date, time, ...rest } = p.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("interviews")
    .insert(emptyToNull({ candidate_id: candidateId, ...rest, scheduled_at: new Date(`${date}T${time}:00+05:00`).toISOString() }));
  if (error) return err(error);
  revalidatePath(`/recruitment/candidates/${candidateId}`);
  return { ok: true, message: "Interview scheduled; the interviewer has been notified." };
}

export async function interviewFeedback(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      score: z.coerce.number().int().min(1).max(5),
      recommendation: z.enum(["hire", "hold", "reject"]),
      feedback: z.string().trim().min(3, "Write a short assessment.").max(3000),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("interviews").update({ ...p.data, status: "completed" }).eq("id", id);
  if (error) return err(error);
  revalidatePath("/recruitment", "layout");
  return { ok: true, message: "Feedback recorded." };
}

export async function saveOffer(candidateId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      offered_salary: z.coerce.number().positive("Enter the monthly gross salary."),
      joining_date: z.iso.date(),
      expiry_date: z.iso.date(),
      probation_months: z.coerce.number().int().min(0).max(12),
      notes: z.string().trim().max(1000).optional(),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("offers")
    .upsert(emptyToNull({ candidate_id: candidateId, ...p.data, status: "draft" }), { onConflict: "candidate_id" });
  if (error) return err(error);
  await supabase.from("candidates").update({ stage: "offered" }).eq("id", candidateId).in("stage", ["selected", "interview", "screening", "applied"]);
  revalidatePath(`/recruitment/candidates/${candidateId}`);
  return { ok: true, message: "Offer saved. Print the letter, then record the candidate's answer." };
}

export async function setOfferStatus(candidateId: string, status: "sent" | "accepted" | "declined" | "withdrawn") {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("offers").update({ status }).eq("candidate_id", candidateId);
  if (error) throw new Error(friendlyError(error));
  if (status === "declined" || status === "withdrawn") await supabase.from("candidates").update({ stage: "rejected" }).eq("id", candidateId);
  revalidatePath(`/recruitment/candidates/${candidateId}`);
}

export async function hireCandidate(candidateId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const code = String(fd.get("employee_code") ?? "").trim();
  if (!/^[A-Za-z0-9-]{2,20}$/.test(code)) return { error: "Enter a new employee code (letters, numbers, -)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rec_hire", { p_candidate: candidateId, p_employee_code: code });
  if (error) return err(error);
  revalidatePath("/recruitment", "layout");
  redirect(`/employees/${data}`);
}

export async function toggleOnboardingTask(id: string, done: boolean) {
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("onboarding_tasks")
    .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? session.employee?.id ?? null : null })
    .eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/recruitment/onboarding");
}

// =================== Performance ===================

export async function createCycle(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z
      .object({
        name: z.string().trim().min(3).max(100),
        cycle_type: z.enum(["annual", "semi_annual", "quarterly"]),
        period_start: z.iso.date(),
        period_end: z.iso.date(),
      })
      .refine((v) => v.period_end > v.period_start, { message: "End must be after start." }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("appraisal_cycles").insert(p.data);
  if (error) return err(error);
  revalidatePath("/performance");
  return { ok: true, message: "Cycle created. Start it to open goal setting." };
}

export async function cycleAction(id: string, action: "start" | "review" | "close") {
  await requireSession();
  const supabase = await createClient();
  const { error } =
    action === "start"
      ? await supabase.rpc("perf_start_cycle", { p_cycle: id })
      : action === "review"
        ? await supabase.rpc("perf_open_review", { p_cycle: id })
        : await supabase.from("appraisal_cycles").update({ status: "closed" }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/performance", "layout");
}

export async function addGoal(appraisalId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      kind: z.enum(["kpi", "okr", "goal"]),
      title: z.string().trim().min(3).max(200),
      target: z.string().trim().max(300).optional(),
      weight: z.coerce.number().positive().max(100),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("goals").insert(emptyToNull({ appraisal_id: appraisalId, ...p.data }));
  if (error) return err(error);
  revalidatePath(`/performance/${appraisalId}`);
  return { ok: true, message: "Goal added." };
}

export async function removeGoal(appraisalId: string, goalId: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("goals").delete().eq("id", goalId);
  if (error) throw new Error(friendlyError(error));
  revalidatePath(`/performance/${appraisalId}`);
}

/** Saves self or manager scores for all goals in one form (fields score_<goalId>, comment_<goalId>). */
export async function saveScores(appraisalId: string, who: "self" | "manager", _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const ids = [...fd.keys()].filter((k) => k.startsWith("score_")).map((k) => k.slice(6));
  for (const id of ids) {
    const score = Number(fd.get(`score_${id}`)) || null;
    const comment = String(fd.get(`comment_${id}`) ?? "").trim().slice(0, 1000) || null;
    const patch = who === "self" ? { self_score: score, self_comment: comment } : { manager_score: score, manager_comment: comment };
    const { error } = await supabase.from("goals").update(patch).eq("id", id);
    if (error) return err(error);
  }
  if (fd.get("submit") === "1") {
    const overall = String(fd.get("overall_comment") ?? "").trim().slice(0, 2000) || null;
    const { error } =
      who === "self"
        ? await supabase.rpc("perf_submit_self", { p_appraisal: appraisalId, p_comment: overall })
        : await supabase.rpc("perf_submit_manager", {
            p_appraisal: appraisalId,
            p_comment: overall,
            p_recommendation: String(fd.get("recommendation") || "none"),
            p_increment: fd.get("increment_pct") ? Number(fd.get("increment_pct")) : null,
          });
    if (error) return err(error);
  }
  revalidatePath(`/performance/${appraisalId}`);
  revalidatePath("/performance");
  return { ok: true, message: fd.get("submit") === "1" ? "Submitted." : "Saved as draft." };
}

export async function acknowledgeAppraisal(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("perf_acknowledge", { p_appraisal: id });
  if (error) throw new Error(friendlyError(error));
  revalidatePath(`/performance/${id}`);
}

export async function requestFeedback(appraisalId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const reviewer = String(fd.get("reviewer_id") ?? "");
  const relationship = String(fd.get("relationship") ?? "peer");
  if (!reviewer) return { error: "Choose a reviewer." };
  const supabase = await createClient();
  const { error } = await supabase.from("feedback_requests").insert({ appraisal_id: appraisalId, reviewer_id: reviewer, relationship });
  if (error) return err(error);
  revalidatePath(`/performance/${appraisalId}`);
  return { ok: true, message: "Feedback requested." };
}

export async function giveFeedback(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z.object({
      score: z.coerce.number().int().min(1).max(5),
      strengths: z.string().trim().min(3).max(2000),
      improvements: z.string().trim().max(2000).optional(),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("feedback_requests").update(emptyToNull(p.data)).eq("id", id);
  if (error) return err(error);
  revalidatePath("/performance");
  return { ok: true, message: "Thanks — feedback submitted." };
}

// =================== Training ===================

export async function createTraining(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = parse(
    z
      .object({
        title: z.string().trim().min(3).max(150),
        provider: z.string().trim().max(120).optional(),
        trainer: z.string().trim().max(120).optional(),
        start_date: z.iso.date(),
        end_date: z.iso.date(),
        mode: z.enum(["classroom", "online", "on_job", "external"]),
        location: z.string().trim().max(150).optional(),
        capacity: z.union([z.coerce.number().int().min(1), z.literal("")]).optional(),
        cost: z.coerce.number().min(0).default(0),
        description: z.string().trim().max(2000).optional(),
      })
      .refine((v) => v.end_date >= v.start_date, { message: "End date can't be before start." }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("training_events").insert(emptyToNull(p.data));
  if (error) return err(error);
  revalidatePath("/training");
  return { ok: true, message: "Training scheduled." };
}

export async function nominate(eventId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const employee = String(fd.get("employee_id") ?? "");
  if (!employee) return { error: "Choose an employee." };
  const supabase = await createClient();
  const { error } = await supabase.from("training_participants").insert({ event_id: eventId, employee_id: employee });
  if (error) return err(error);
  revalidatePath("/training");
  return { ok: true, message: "Nominated." };
}

export async function setAttendance(participantId: string, status: "attended" | "absent" | "cancelled") {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("training_participants").update({ status }).eq("id", participantId);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/training");
}

export async function setEventStatus(eventId: string, status: "completed" | "cancelled") {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("training_events").update({ status }).eq("id", eventId);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/training");
}

export async function trainingFeedback(participantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const rating = Number(fd.get("feedback_rating"));
  if (!(rating >= 1 && rating <= 5)) return { error: "Choose a rating." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_participants")
    .update({ feedback_rating: rating, feedback_comment: String(fd.get("feedback_comment") ?? "").trim().slice(0, 1000) || null })
    .eq("id", participantId);
  if (error) return err(error);
  revalidatePath("/training");
  return { ok: true, message: "Thanks for the feedback." };
}

export async function raiseNeed(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  const p = parse(
    z.object({
      employee_id: z.union([z.uuid(), z.literal("")]).optional(),
      skill: z.string().trim().min(2).max(120),
      reason: z.string().trim().max(500).optional(),
      priority: z.enum(["low", "medium", "high"]),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const employee_id = p.data.employee_id || session.employee?.id;
  if (!employee_id) return { error: "Choose an employee." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_needs")
    .insert(emptyToNull({ ...p.data, employee_id, raised_by: session.employee?.id ?? "" }));
  if (error) return err(error);
  revalidatePath("/training");
  return { ok: true, message: "Training need recorded." };
}

export async function setNeedStatus(id: string, status: "planned" | "closed") {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("training_needs").update({ status }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/training");
}

export async function addCertification(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  const p = parse(
    z.object({
      employee_id: z.union([z.uuid(), z.literal("")]).optional(),
      name: z.string().trim().min(2).max(150),
      issuer: z.string().trim().max(150).optional(),
      credential_id: z.string().trim().max(100).optional(),
      issued_on: z.union([z.iso.date(), z.literal("")]).optional(),
      expires_on: z.union([z.iso.date(), z.literal("")]).optional(),
    }),
    fd,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const employee_id = p.data.employee_id || session.employee?.id;
  if (!employee_id) return { error: "Choose an employee." };
  const supabase = await createClient();
  const { error } = await supabase.from("certifications").insert(emptyToNull({ ...p.data, employee_id }));
  if (error) return err(error);
  revalidatePath("/training");
  return { ok: true, message: "Certification added." };
}

export async function verifyCertification(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("certifications").update({ verified: true }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/training");
}
