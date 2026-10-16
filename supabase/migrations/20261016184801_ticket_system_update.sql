-- First-response stamping by the comment trigger must pass the ticket field guard.
-- The comment trigger sets app.ticket_system for its own update only.
create or replace function private.ticket_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sys   boolean := coalesce(current_setting('app.ticket_system', true), '') = 'on';
  agent boolean := auth.uid() is null or sys or private.is_ticket_agent(old.id);
begin
  if not sys and auth.uid() is not null
     and (new.requester_id, new.category_id, new.subject, new.description, new.ticket_no, new.response_due_at, new.resolution_due_at, new.first_response_at, new.escalated)
         is distinct from (old.requester_id, old.category_id, old.subject, old.description, old.ticket_no, old.response_due_at, old.resolution_due_at, old.first_response_at, old.escalated) then
    raise exception 'These ticket fields can''t be changed.';
  end if;
  if not agent then
    if old.requester_id is distinct from private.current_employee_id() then
      raise exception 'Not your ticket.' using errcode = '42501';
    end if;
    if (new.priority, new.assignee_id) is distinct from (old.priority, old.assignee_id)
       or not (new.status = old.status or (old.status = 'resolved' and new.status in ('closed', 'open')))
       or (new.satisfaction is distinct from old.satisfaction and old.status not in ('resolved', 'closed')) then
      raise exception 'You can close, reopen or rate a resolved ticket.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now(); end if;
  if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
  if new.status = 'open' and old.status = 'resolved' then new.resolved_at := null; end if;
  new.updated_at := now();
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform private.notify_employee(new.assignee_id, 'Ticket assigned to you: ' || new.subject, old.ticket_no, '/helpdesk/' || old.id);
  end if;
  if new.status is distinct from old.status and not sys then
    perform private.notify_employee(old.requester_id, 'Ticket ' || old.ticket_no || ' is ' || replace(new.status::text, '_', ' '), old.subject, '/helpdesk/' || old.id);
  end if;
  return new;
end $$;

create or replace function private.ticket_comment_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t     public.tickets;
  me    uuid := private.current_employee_id();
  agent boolean;
begin
  select * into t from public.tickets where id = new.ticket_id;
  agent := private.is_ticket_agent(t.id);
  if not agent and t.requester_id is distinct from me then raise exception 'Not your ticket.' using errcode = '42501'; end if;
  if not agent then new.is_internal := false; end if;
  new.author_id := me;
  if agent and t.first_response_at is null and t.requester_id is distinct from me and not new.is_internal then
    perform set_config('app.ticket_system', 'on', true);
    update public.tickets set first_response_at = now(), status = case when status = 'open' then 'in_progress'::public.ticket_status else status end where id = t.id;
    perform set_config('app.ticket_system', '', true);
  end if;
  if not new.is_internal then
    if agent then
      perform private.notify_employee(t.requester_id, 'Reply on ' || t.ticket_no, left(new.body, 120), '/helpdesk/' || t.id);
    elsif t.assignee_id is not null then
      perform private.notify_employee(t.assignee_id, 'Requester replied on ' || t.ticket_no, left(new.body, 120), '/helpdesk/' || t.id);
    end if;
  end if;
  return new;
end $$;

revoke execute on function private.ticket_before_update(), private.ticket_comment_before_insert() from public, anon, authenticated;
