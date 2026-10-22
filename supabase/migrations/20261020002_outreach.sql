-- Migration 045: oGX outreach: approved templates and email sequences tied to
-- the pipeline.
--
--   exchanges            + email_consent / consent_source (only people who
--                        signed up with AIESEC and agreed to be contacted are
--                        ever emailed), unsubscribed_at, replied_at.
--   outreach_templates   subject + body with merge fields. Draft → Pending →
--                        Approved / Rejected. Approvers: the president, the VP
--                        of the template's department, or a member of the LC's
--                        MC. Editing an approved template sends it back to
--                        draft unless the editor can approve.
--   outreach_sequences   e.g. "oGV sign-ups": steps on day 0 / 3 / 7, each an
--   outreach_steps       approved template, for exchanges at a trigger stage.
--   outreach_enrollments one exchange in one sequence, sent from one member.
--                        Stops automatically when the exchange leaves the
--                        trigger stage, replies, or unsubscribes.
--   outreach_messages    every email sent, shown on the lead's record.
--   outreach_stats()     per sequence: enrolled, replied, moved on, applied.

-- ── 1. Consent and status on exchanges ───────────────────────────────────────

alter table exchanges
  add column if not exists email_consent   boolean not null default false,
  add column if not exists consent_source  text,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists replied_at      timestamptz;

-- ── 2. Templates ─────────────────────────────────────────────────────────────

create table if not exists outreach_templates (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  name          text not null check (length(trim(name)) > 0),
  subject       text not null check (length(trim(subject)) between 1 and 150),
  body          text not null check (length(trim(body)) between 1 and 5000),
  status        text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected')),
  review_note   text,
  created_by    uuid references user_profiles(id) on delete set null,
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function can_approve_template(p_project_id uuid, p_department_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_lc_president(p_project_id)
      or (p_department_id is not null and p_department_id in (select led_department_ids(p_project_id)))
      or exists (select 1 from projects p where p.id = p_project_id and p.mc_id is not null and is_mc_member(p.mc_id));
$$;

-- Who works on outreach for a department: the exec board and that department's members.
create or replace function can_use_outreach(p_project_id uuid, p_department_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_lc_exec(p_project_id)
      or (p_department_id is not null and p_department_id = my_department_id(p_project_id))
      or (p_department_id is null and auth_is_project_member(p_project_id));
$$;

create or replace function _outreach_template_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_approver boolean := auth.uid() is null or can_approve_template(new.project_id, new.department_id);
begin
  if new.department_id is not null and not exists (
    select 1 from departments where id = new.department_id and project_id = new.project_id
  ) then
    raise exception 'Department does not belong to this LC';
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending') and not v_approver then
      raise exception 'New templates start as a draft';
    end if;
  else
    -- Only approvers decide; anyone else changing an approved template sends it back to draft.
    if new.status in ('approved', 'rejected') and new.status is distinct from old.status and not v_approver then
      raise exception 'Only the president, the department''s VP or your MC can approve templates';
    end if;
    if (new.subject, new.body) is distinct from (old.subject, old.body) and old.status = 'approved' and not v_approver then
      new.status := 'draft';
    end if;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status <> 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_outreach_template_guard on outreach_templates;
create trigger trg_outreach_template_guard before insert or update on outreach_templates
  for each row execute function _outreach_template_guard();

alter table outreach_templates enable row level security;

drop policy if exists "outreach templates visible to their team and approvers" on outreach_templates;
create policy "outreach templates visible to their team and approvers" on outreach_templates for select
  using (can_use_outreach(project_id, department_id) or can_approve_template(project_id, department_id));
drop policy if exists "team writes outreach templates" on outreach_templates;
create policy "team writes outreach templates" on outreach_templates for insert
  with check (can_use_outreach(project_id, department_id) and created_by = auth.uid());
drop policy if exists "author or approver edits outreach templates" on outreach_templates;
create policy "author or approver edits outreach templates" on outreach_templates for update
  using (created_by = auth.uid() or can_approve_template(project_id, department_id))
  with check (can_use_outreach(project_id, department_id) or can_approve_template(project_id, department_id));
drop policy if exists "author or approver deletes outreach templates" on outreach_templates;
create policy "author or approver deletes outreach templates" on outreach_templates for delete
  using (created_by = auth.uid() or can_approve_template(project_id, department_id));

-- ── 3. Sequences ─────────────────────────────────────────────────────────────

create table if not exists outreach_sequences (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  name          text not null check (length(trim(name)) > 0),
  product       text not null check (product in ('ogv', 'ogta', 'ogte', 'igv', 'igta', 'igte')),
  trigger_stage text not null default 'signed_up' check (trigger_stage in ('signed_up', 'applied', 'accepted')),
  active        boolean not null default false,
  created_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists outreach_steps (
  sequence_id uuid not null references outreach_sequences(id) on delete cascade,
  step_no     integer not null check (step_no between 1 and 10),
  delay_days  integer not null check (delay_days between 0 and 60),
  template_id uuid not null references outreach_templates(id) on delete restrict,
  primary key (sequence_id, step_no)
);

create or replace function _outreach_sequence_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is null then
    select id into new.department_id from departments
    where project_id = new.project_id and new.product = any (products) order by sort_order limit 1;
  end if;
  -- A sequence can only go live when every step uses an approved template.
  if new.active and (
       not exists (select 1 from outreach_steps where sequence_id = new.id)
       or exists (select 1 from outreach_steps s join outreach_templates t on t.id = s.template_id
                  where s.sequence_id = new.id and t.status <> 'approved')
     ) then
    raise exception 'Every step needs an approved template before the sequence can start';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_outreach_sequence_guard on outreach_sequences;
create trigger trg_outreach_sequence_guard before insert or update on outreach_sequences
  for each row execute function _outreach_sequence_guard();

create or replace function _outreach_step_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from outreach_templates t join outreach_sequences s on s.project_id = t.project_id
    where t.id = new.template_id and s.id = new.sequence_id
  ) then
    raise exception 'Template does not belong to this LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_outreach_step_guard on outreach_steps;
create trigger trg_outreach_step_guard before insert or update on outreach_steps
  for each row execute function _outreach_step_guard();

alter table outreach_sequences enable row level security;
alter table outreach_steps     enable row level security;

drop policy if exists "team sees sequences" on outreach_sequences;
create policy "team sees sequences" on outreach_sequences for select using (can_use_outreach(project_id, department_id));
drop policy if exists "exec manages sequences" on outreach_sequences;
create policy "exec manages sequences" on outreach_sequences for all
  using (is_lc_president(project_id) or (department_id is not null and department_id in (select led_department_ids(project_id))))
  with check (is_lc_president(project_id) or (department_id is null and is_lc_exec(project_id)) or (department_id in (select led_department_ids(project_id))));

drop policy if exists "steps follow their sequence" on outreach_steps;
create policy "steps follow their sequence" on outreach_steps for select
  using (exists (select 1 from outreach_sequences s where s.id = sequence_id and can_use_outreach(s.project_id, s.department_id)));
drop policy if exists "sequence managers edit steps" on outreach_steps;
create policy "sequence managers edit steps" on outreach_steps for all
  using (exists (select 1 from outreach_sequences s where s.id = sequence_id
                 and (is_lc_president(s.project_id) or s.department_id in (select led_department_ids(s.project_id)))))
  with check (exists (select 1 from outreach_sequences s where s.id = sequence_id
                 and (is_lc_president(s.project_id) or s.department_id in (select led_department_ids(s.project_id)) or (s.department_id is null and is_lc_exec(s.project_id)))));

-- ── 4. Enrollments and messages ──────────────────────────────────────────────

create table if not exists outreach_enrollments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  sequence_id  uuid not null references outreach_sequences(id) on delete cascade,
  exchange_id  uuid not null references exchanges(id) on delete cascade,
  sender_id    uuid not null references user_profiles(id) on delete cascade,
  enrolled_at  timestamptz not null default now(),
  next_step    integer not null default 1,
  next_send_at timestamptz,
  status       text not null default 'active' check (status in ('active', 'stopped', 'completed')),
  stop_reason  text check (stop_reason in ('stage_changed', 'replied', 'unsubscribed', 'manual', 'no_email', 'template_unapproved')),
  stopped_at   timestamptz,
  unique (sequence_id, exchange_id)
);

create index if not exists outreach_enrollments_due_idx on outreach_enrollments (next_send_at) where status = 'active';

create table if not exists outreach_messages (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  exchange_id   uuid not null references exchanges(id) on delete cascade,
  enrollment_id uuid references outreach_enrollments(id) on delete set null,
  template_id   uuid references outreach_templates(id) on delete set null,
  step_no       integer,
  sender_id     uuid references user_profiles(id) on delete set null,
  to_email      text not null,
  subject       text not null,
  status        text not null check (status in ('sent', 'failed')),
  error         text,
  sent_at       timestamptz not null default now()
);

create index if not exists outreach_messages_exchange_idx on outreach_messages (exchange_id, sent_at desc);
create index if not exists outreach_messages_sender_idx on outreach_messages (sender_id, sent_at desc);

alter table outreach_enrollments enable row level security;
alter table outreach_messages    enable row level security;

drop policy if exists "enrollments follow the exchange" on outreach_enrollments;
create policy "enrollments follow the exchange" on outreach_enrollments for select
  using (exists (select 1 from exchanges e where e.id = exchange_id and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)));
drop policy if exists "stop an enrollment you can see" on outreach_enrollments;
create policy "stop an enrollment you can see" on outreach_enrollments for update
  using (exists (select 1 from exchanges e where e.id = exchange_id and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)))
  with check (status in ('active', 'stopped'));

drop policy if exists "messages follow the exchange" on outreach_messages;
create policy "messages follow the exchange" on outreach_messages for select
  using (exists (select 1 from exchanges e where e.id = exchange_id and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)));
-- Messages are written by the sending job (service role) only.

-- Enroll exchanges; returns how many were enrolled and why others weren't.
create or replace function enroll_in_sequence(p_sequence_id uuid, p_exchange_ids uuid[])
returns table (enrolled integer, skipped integer, reasons text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq   outreach_sequences%rowtype;
  v_ex    exchanges%rowtype;
  v_first integer;
  v_in    integer := 0;
  v_skip  integer := 0;
  v_why   text[] := '{}';
  x       uuid;
begin
  select * into v_seq from outreach_sequences where id = p_sequence_id;
  if not found or not can_use_outreach(v_seq.project_id, v_seq.department_id) then raise exception 'Sequence not found'; end if;
  if not v_seq.active then raise exception 'Start the sequence first (it needs approved templates)'; end if;
  select delay_days into v_first from outreach_steps where sequence_id = p_sequence_id order by step_no limit 1;

  foreach x in array p_exchange_ids loop
    select * into v_ex from exchanges where id = x and project_id = v_seq.project_id;
    if not found or not can_work_on_exchange(v_ex.project_id, v_ex.department_id, v_ex.owner_id) then
      v_skip := v_skip + 1; continue;
    end if;
    if v_ex.email is null then v_skip := v_skip + 1; v_why := v_why || (v_ex.person_name || ': no email'); continue; end if;
    if not v_ex.email_consent then v_skip := v_skip + 1; v_why := v_why || (v_ex.person_name || ': no consent to be contacted'); continue; end if;
    if v_ex.unsubscribed_at is not null then v_skip := v_skip + 1; v_why := v_why || (v_ex.person_name || ': unsubscribed'); continue; end if;
    if v_ex.product <> v_seq.product or v_ex.stage <> v_seq.trigger_stage then
      v_skip := v_skip + 1; v_why := v_why || (v_ex.person_name || ': not at the sequence''s stage'); continue;
    end if;
    insert into outreach_enrollments (project_id, sequence_id, exchange_id, sender_id, next_send_at)
    values (v_seq.project_id, p_sequence_id, x, auth.uid(), now() + make_interval(days => coalesce(v_first, 0)))
    on conflict (sequence_id, exchange_id) do nothing;
    if found then v_in := v_in + 1; else v_skip := v_skip + 1; v_why := v_why || (v_ex.person_name || ': already in this sequence'); end if;
  end loop;
  return query select v_in, v_skip, v_why[1:20];
end;
$$;

revoke execute on function enroll_in_sequence(uuid, uuid[]) from public, anon;
grant  execute on function enroll_in_sequence(uuid, uuid[]) to authenticated;

-- Stop sequences automatically: the person moved on, replied, or unsubscribed.
create or replace function _exchange_outreach_stop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unsubscribed_at is not null and old.unsubscribed_at is null then
    update outreach_enrollments set status = 'stopped', stop_reason = 'unsubscribed', stopped_at = now()
     where exchange_id = new.id and status = 'active';
  end if;
  if new.replied_at is not null and old.replied_at is null then
    update outreach_enrollments set status = 'stopped', stop_reason = 'replied', stopped_at = now()
     where exchange_id = new.id and status = 'active';
  end if;
  if new.stage is distinct from old.stage then
    update outreach_enrollments en set status = 'stopped', stop_reason = 'stage_changed', stopped_at = now()
      from outreach_sequences s
     where en.exchange_id = new.id and en.status = 'active' and s.id = en.sequence_id and s.trigger_stage <> new.stage;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exchange_outreach_stop on exchanges;
create trigger trg_exchange_outreach_stop after update of stage, replied_at, unsubscribed_at on exchanges
  for each row execute function _exchange_outreach_stop();

-- ── 5. Results ───────────────────────────────────────────────────────────────

create or replace function outreach_stats(p_project_id uuid)
returns table (sequence_id uuid, name text, product text, enrolled integer, active integer, replied integer,
               unsubscribed integer, moved_on integer, applied integer, emails_sent integer)
language sql
security definer
stable
set search_path = public
as $$
  select s.id, s.name, s.product,
         count(en.*)::int,
         count(*) filter (where en.status = 'active')::int,
         count(*) filter (where en.stop_reason = 'replied')::int,
         count(*) filter (where en.stop_reason = 'unsubscribed')::int,
         count(*) filter (where en.stop_reason = 'stage_changed')::int,
         count(*) filter (where e.applied_at is not null and e.applied_at >= en.enrolled_at::date)::int,
         (select count(*)::int from outreach_messages m join outreach_enrollments x on x.id = m.enrollment_id
           where x.sequence_id = s.id and m.status = 'sent')
  from outreach_sequences s
  left join outreach_enrollments en on en.sequence_id = s.id
  left join exchanges e on e.id = en.exchange_id
  where s.project_id = p_project_id and can_use_outreach(s.project_id, s.department_id)
  group by s.id, s.name, s.product;
$$;

revoke execute on function outreach_stats(uuid) from public, anon;
grant  execute on function outreach_stats(uuid) to authenticated;

-- ── 6. Imports can record consent ────────────────────────────────────────────
-- Same as migration 039, plus email_consent / consent_source per row. Consent
-- is only ever added by an import, never taken away.

create or replace function import_exchanges(p_project_id uuid, p_product text, p_rows jsonb)
returns table (inserted integer, updated integer, failed integer, errors text[])
language plpgsql
security invoker
set search_path = public
as $$
declare
  r        jsonb;
  v_id     uuid;
  v_expa   text;
  v_name   text;
  v_ins    integer := 0;
  v_upd    integer := 0;
  v_fail   integer := 0;
  v_errors text[]  := '{}';
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of rows';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2000 rows at a time';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_expa := nullif(trim(r->>'expa_id'), '');
    v_name := coalesce(nullif(trim(r->>'person_name'), ''), v_expa, '(no name)');
    begin
      v_id := null;
      if v_expa is not null then
        select id into v_id from exchanges where project_id = p_project_id and expa_id = v_expa;
      end if;

      if v_id is not null then
        update exchanges set
          stage        = coalesce(nullif(r->>'stage', ''), stage),
          person_name  = coalesce(nullif(trim(r->>'person_name'), ''), person_name),
          email        = coalesce(nullif(trim(r->>'email'), ''), email),
          phone        = coalesce(nullif(trim(r->>'phone'), ''), phone),
          opportunity  = coalesce(nullif(trim(r->>'opportunity'), ''), opportunity),
          host_entity  = coalesce(nullif(trim(r->>'host_entity'), ''), host_entity),
          expa_url     = coalesce(nullif(trim(r->>'expa_url'), ''), expa_url),
          signed_up_at = coalesce((r->>'signed_up_at')::date, signed_up_at),
          applied_at   = coalesce((r->>'applied_at')::date, applied_at),
          accepted_at  = coalesce((r->>'accepted_at')::date, accepted_at),
          approved_at  = coalesce((r->>'approved_at')::date, approved_at),
          realized_at  = coalesce((r->>'realized_at')::date, realized_at),
          finished_at  = coalesce((r->>'finished_at')::date, finished_at),
          completed_at = coalesce((r->>'completed_at')::date, completed_at),
          email_consent  = email_consent or coalesce((r->>'email_consent')::boolean, false),
          consent_source = coalesce(consent_source, nullif(r->>'consent_source', ''))
        where id = v_id;
        if not found then
          raise exception 'you can''t edit this exchange';
        end if;
        v_upd := v_upd + 1;
      else
        insert into exchanges (project_id, product, stage, person_name, email, phone, opportunity, host_entity,
                               expa_id, expa_url, signed_up_at, applied_at, accepted_at, approved_at,
                               realized_at, finished_at, completed_at, created_by, email_consent, consent_source)
        values (p_project_id, p_product, coalesce(nullif(r->>'stage', ''), 'signed_up'), v_name,
                nullif(trim(r->>'email'), ''), nullif(trim(r->>'phone'), ''),
                nullif(trim(r->>'opportunity'), ''), nullif(trim(r->>'host_entity'), ''),
                v_expa, nullif(trim(r->>'expa_url'), ''),
                coalesce((r->>'signed_up_at')::date, (r->>'applied_at')::date, current_date),
                (r->>'applied_at')::date, (r->>'accepted_at')::date, (r->>'approved_at')::date,
                (r->>'realized_at')::date, (r->>'finished_at')::date, (r->>'completed_at')::date,
                auth.uid(), coalesce((r->>'email_consent')::boolean, false), nullif(r->>'consent_source', ''));
        v_ins := v_ins + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      if coalesce(array_length(v_errors, 1), 0) < 20 then
        v_errors := v_errors || (v_name || ': ' ||
          case when sqlstate = '23505' then 'already in the pipeline, in a department you can''t see'
               when sqlstate = '42501' then 'you can''t add exchanges for this product'
               else sqlerrm end);
      end if;
    end;
  end loop;

  return query select v_ins, v_upd, v_fail, v_errors;
end;
$$;

notify pgrst, 'reload schema';
