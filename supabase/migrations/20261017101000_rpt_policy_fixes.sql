-- Fix: inside the EXISTS, "id" resolved to interviews.id — interviewers never saw their candidates.
drop policy "candidates: read" on public.candidates;
create policy "candidates: read" on public.candidates for select to authenticated
  using ((select private.is_recruiter()) or (select private.has_any_role(array['executive', 'auditor']::public.app_role[]))
         or exists (select 1 from public.interviews i where i.candidate_id = candidates.id and i.interviewer_id = (select private.current_employee_id())));

-- Replace always-true insert checks with the real rule (triggers still enforce details).
drop policy "requisitions: raise" on public.requisitions;
create policy "requisitions: raise" on public.requisitions for insert to authenticated
  with check ((select private.current_employee_id()) is not null or (select private.is_recruiter()));
drop policy "feedback: request" on public.feedback_requests;
create policy "feedback: request" on public.feedback_requests for insert to authenticated
  with check (private.appraisal_role(appraisal_id) in ('manager', 'hr'));
drop policy "participants: nominate" on public.training_participants;
create policy "participants: nominate" on public.training_participants for insert to authenticated
  with check ((select private.is_hr()) or private.can_see_team(employee_id));
