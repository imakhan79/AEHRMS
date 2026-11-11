-- =====================================================================
-- Employee document review: files an employee uploads to their own
-- personnel file wait for HR to verify or reject them. HR uploads are
-- verified on arrival. Existing documents are treated as verified.
-- =====================================================================

alter table public.employee_documents
  add column status      text not null default 'verified' check (status in ('pending', 'verified', 'rejected')),
  add column review_note text check (char_length(review_note) <= 300),
  add column reviewed_by uuid references public.employees (id) on delete set null,
  add column reviewed_at timestamptz;

create index documents_pending_idx on public.employee_documents (created_at) where status = 'pending';

-- HR uploads to someone else's file are verified; anything else (an employee's
-- own upload, or HR uploading to their own file) goes to HR for review.
create function private.document_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (private.is_hr() and new.employee_id is distinct from private.current_employee_id()) then
    new.status := 'verified';
    new.reviewed_by := private.current_employee_id();
    new.reviewed_at := now();
  else
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  new.review_note := null;
  return new;
end $$;

create trigger documents_before_insert
  before insert on public.employee_documents
  for each row execute function private.document_before_insert();

-- Only the review decision may change, only by HR, never on their own file.
create function private.document_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.id, new.employee_id, new.doc_type, new.title, new.file_path, new.file_name, new.mime_type,
      new.size_bytes, new.expiry_date, new.uploaded_by, new.created_at)
     is distinct from
     (old.id, old.employee_id, old.doc_type, old.title, old.file_path, old.file_name, old.mime_type,
      old.size_bytes, old.expiry_date, old.uploaded_by, old.created_at) then
    raise exception 'Documents cannot be edited. Upload a new one instead.';
  end if;
  if new.status is not distinct from old.status and new.review_note is not distinct from old.review_note then
    return new;
  end if;
  if auth.uid() is not null then
    if not private.is_hr() then
      raise exception 'Only HR can review documents.' using errcode = '42501';
    end if;
    if old.employee_id = private.current_employee_id() then
      raise exception 'You cannot review your own documents.' using errcode = '42501';
    end if;
  end if;
  if old.status <> 'pending' or new.status not in ('verified', 'rejected') then
    raise exception 'Only pending documents can be verified or rejected.';
  end if;
  if new.status = 'rejected' and nullif(trim(new.review_note), '') is null then
    raise exception 'Give a reason when rejecting a document.';
  end if;
  new.reviewed_by := private.current_employee_id();
  new.reviewed_at := now();
  return new;
end $$;

create trigger documents_before_update
  before update on public.employee_documents
  for each row execute function private.document_before_update();

create function private.document_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select full_name into who from public.employees where id = new.employee_id;
    perform private.notify_roles(array['hr_admin']::public.app_role[], 'Document to verify: ' || who, new.title, '/employees/documents');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform private.notify_employee(new.employee_id, 'Document ' || new.status || ': ' || new.title,
      coalesce(new.review_note, 'Your personnel file has been updated.'), '/profile#documents');
  end if;
  return null;
end $$;

create trigger documents_notify after insert or update on public.employee_documents
  for each row execute function private.document_notify();

-- Admins can mute the HR alerts like other categories (ADM-04).
insert into public.notification_rules (module, label, link_prefix, sort_order)
values ('documents', 'Employee documents to verify', '/employees/documents', 15)
on conflict (module) do nothing;

create policy "documents: hr review" on public.employee_documents for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
grant update (status, review_note) on public.employee_documents to authenticated;
