-- Enforce LC boundaries and counts-only national reporting.

CREATE OR REPLACE FUNCTION public.lc_term_start(p_project_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when auth_is_project_member(p_project_id) then coalesce(
    (select term_start_date from projects where id = p_project_id),
    case when current_date >= make_date(extract(year from current_date)::int, 2, 1)
         then make_date(extract(year from current_date)::int, 2, 1)
         else make_date(extract(year from current_date)::int - 1, 2, 1)
    end
  ) end;
$function$;

create or replace function find_team_member_id_by_email(p_project_id uuid, p_email text)
returns uuid language sql stable security definer set search_path = public as $$
select tm.user_id from team_members tm join auth.users u on u.id = tm.user_id
where tm.project_id = p_project_id and auth_is_project_member(p_project_id)
  and lower(u.email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function find_team_member_id_by_email(uuid, text) from public, anon;
grant execute on function find_team_member_id_by_email(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.can_work_on_exchange(p_project_id uuid, p_department_id uuid, p_owner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select auth_is_project_member(p_project_id) and (is_lc_president(p_project_id) or p_department_id in (select led_department_ids(p_project_id)));
$function$;

CREATE OR REPLACE FUNCTION public.partner_visible(p_project_id uuid, p_department_id uuid, p_owner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select auth_is_project_member(p_project_id) and (is_lc_president(p_project_id) or p_department_id in (select led_department_ids(p_project_id)));
$function$;

CREATE OR REPLACE FUNCTION public.can_use_outreach(p_project_id uuid, p_department_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select auth_is_project_member(p_project_id) and (is_lc_president(p_project_id) or p_department_id in (select led_department_ids(p_project_id)));
$function$;

CREATE OR REPLACE FUNCTION public.can_approve_template(p_project_id uuid, p_department_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select can_use_outreach(p_project_id, p_department_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_read_finance(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select coalesce(lc_role(p_project_id) in ('president', 'vp'), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_write_finance(p_project_id uuid, p_account text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select is_lc_president(p_project_id) and (p_account = 'lc' or (p_account = 'university'
    and exists (select 1 from projects where id = p_project_id and has_university_account)));
$function$;

drop policy if exists "LC exec and MC VP Finance read the ledger" on finance_entries;
create policy "LC department reads ledger" on finance_entries for select using (
  is_lc_president(project_id) or department_id in (select led_department_ids(project_id))
);
drop policy if exists "claims visible to submitter, finance lead, department VP" on expense_claims;
create policy "LC claim readers" on expense_claims for select using (
  submitted_by = auth.uid() or is_lc_president(project_id)
  or department_id in (select led_department_ids(project_id))
);
create or replace function can_review_claim(p_project_id uuid, p_department_id uuid, p_submitter uuid)
returns boolean language sql stable security definer set search_path = public as $$
select p_submitter <> auth.uid() and auth_is_project_member(p_project_id) and (
  is_lc_president(p_project_id) or p_department_id in (select led_department_ids(p_project_id))
);
$$;
revoke execute on function can_review_claim(uuid, uuid, uuid) from public, anon;
grant execute on function can_review_claim(uuid, uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.review_expense_claim(p_claim_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS expense_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claim expense_claims%rowtype;
begin
  select * into v_claim from expense_claims where id = p_claim_id for update;
  if not found or not can_review_claim(v_claim.project_id, v_claim.department_id, v_claim.submitted_by) then
    raise exception 'Claim not found';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown status %', p_status;
  end if;
  if p_status = 'rejected' and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Rejecting a claim requires a reason';
  end if;

  update expense_claims
     set status           = p_status,
         rejection_reason = case when p_status = 'rejected' then trim(p_reason) end,
         reviewed_by      = case when p_status = 'pending' then null else auth.uid() end,
         reviewed_at      = case when p_status = 'pending' then null else now() end
   where id = p_claim_id
  returning * into v_claim;
  return v_claim;
end;
$function$;

CREATE OR REPLACE FUNCTION public._expense_claim_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (new.status <> 'pending' or new.reviewed_by is not null) then
      raise exception 'New claims start as pending';
    end if;
    return new;
  end if;
  if (new.status, new.rejection_reason, new.reviewed_by, new.reviewed_at)
       is distinct from (old.status, old.rejection_reason, old.reviewed_by, old.reviewed_at)
     and auth.uid() is not null
     and not can_review_claim(old.project_id, old.department_id, old.submitted_by) then
    raise exception 'Only the LCP or department VP can review another member''s claim';
  end if;
  if new.submitted_by <> old.submitted_by or new.project_id <> old.project_id
     or new.department_id is distinct from old.department_id then
    raise exception 'A claim cannot change owner or LC';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_finance_entries(p_project_id uuid, p_rows jsonb)
 RETURNS TABLE(inserted integer, updated integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  v_inserted integer := 0;
begin
  if not is_lc_president(p_project_id) then raise exception 'Only your LC president can import the finance tracker'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r ->> 'type') not in ('income', 'expense', 'opening') or (r ->> 'amount')::numeric <= 0 then
      raise exception 'Bad row: %', r;
    end if;
    if exists (
      select 1 from finance_entries
      where project_id = p_project_id and entry_date = (r ->> 'date')::date
        and description = coalesce(r ->> 'description', '') and amount = (r ->> 'amount')::numeric
    ) then continue; end if;
    insert into finance_entries (project_id, type, amount, entry_date, description, payment_method, processed_via, area, notes, recorded_by)
    values (p_project_id, r ->> 'type', (r ->> 'amount')::numeric, (r ->> 'date')::date, coalesce(r ->> 'description', ''),
            nullif(r ->> 'payment_method', ''), nullif(r ->> 'processed_via', ''), nullif(r ->> 'area', ''), nullif(r ->> 'notes', ''), auth.uid());
    v_inserted := v_inserted + 1;
  end loop;
  return query select v_inserted, 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lc_finance_keeper(p_project_id uuid)
 RETURNS TABLE(has_keeper boolean, reviewed_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
           select 1 from projects p join mc_members m on m.mc_id = p.mc_id
           where p.id = p_project_id and m.role = 'vp_finance'
         ),
         (select finance_reviewed_on from projects where id = p_project_id)
  where auth_is_project_member(p_project_id);
$function$;

revoke execute on function mc_finance_lcs(), mc_finance_lcs(uuid), mc_lc_health(uuid), mc_lc_insights(uuid) from public, anon, authenticated;

drop policy if exists "finance readers see the change log" on finance_entry_changes;
create policy "LC president reads finance audit" on finance_entry_changes for select using (is_lc_president(project_id));

CREATE OR REPLACE FUNCTION public.department_area(p_department_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(d.pulse_area,
           case when d.products && array['ogv', 'ogta', 'ogte'] then 'outgoing'
                when d.products && array['igv', 'igta', 'igte'] then 'incoming'
                else 'support' end)
  from departments d where d.id = p_department_id and auth_is_project_member(d.project_id);
$function$;

CREATE OR REPLACE FUNCTION public.mc_term_start(p_mc_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(term_start,
           case when current_date >= make_date(extract(year from current_date)::int, 2, 1)
                then make_date(extract(year from current_date)::int, 2, 1)
                else make_date(extract(year from current_date)::int - 1, 2, 1) end)
  from mcs where id = p_mc_id and (is_mc_member(p_mc_id) or exists (select 1 from projects p where p.mc_id = p_mc_id and auth_is_project_member(p.id)));
$function$;

CREATE OR REPLACE FUNCTION public.seed_default_onboarding_steps(p_project_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into onboarding_steps (project_id, title, description, sort_order)
  select p_project_id, s.title, s.descr, s.ord
  from (values
    ('Meet your VP',                    'A first 1:1 with the VP of your department.', 1),
    ('Join the LC chat',                'Say hi in the LC channel in Chat.', 2),
    ('Read the LC handbook',            'It is in the LC Drive, in Templates, and the Handover tab has notes from last term.', 3),
    ('Attend your first LC meeting',    null, 4)
  ) as s(title, descr, ord)
  where not exists (select 1 from onboarding_steps where project_id = p_project_id);
$function$;
delete from onboarding_steps where title = 'Do your first check-in'
  and description = 'About a minute, every two weeks. Only averages are shared.';

create or replace function join_from_expa(p_timezone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  jsonb;
  v_pl       jsonb;
  v_kind     text;
  v_expa     text;
  v_name     text;
  v_country  text;
  v_role     text;
  v_target   uuid;
  v_title    text;
  v_dep      uuid;
  v_full     text;
  v_parts    text[];
  v_photo    text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select profile into v_profile from expa_connections where user_id = v_uid;
  v_pl := v_profile -> 'placement';
  if v_pl is null or jsonb_typeof(v_pl) <> 'object' then
    return jsonb_build_object('status', 'none');
  end if;
  v_kind    := v_pl ->> 'kind';
  v_expa    := nullif(trim(v_pl ->> 'expaId'), '');
  v_name    := nullif(trim(v_pl ->> 'name'), '');
  v_country := upper(nullif(trim(v_pl ->> 'country'), ''));
  if v_country !~ '^[A-Z]{2}$' then v_country := null; end if;
  v_role    := v_pl ->> 'role';

  -- Find the LC or MC.
  if v_kind = 'lc' then
    if v_role is null or v_role not in ('president', 'vp', 'member') then v_role := 'member'; end if;
    if v_expa is not null then
      select id, name into v_target, v_title from projects where expa_lc_id = v_expa;
    end if;
    if v_target is null and v_country is not null and lc_name_key(v_name) <> '' then
      select p.id, p.name into v_target, v_title from projects p
      where p.country_code = v_country and not coalesce(p.is_demo, false)
        and lc_name_key(p.name) = lc_name_key(v_name)
        and (p.expa_lc_id is null or v_expa is null)
      limit 1;
      if v_target is not null and v_expa is not null then
        update projects set expa_lc_id = v_expa where id = v_target and expa_lc_id is null;
      end if;
    end if;
    if v_target is null then
      return jsonb_build_object('status', case when v_role = 'president' then 'create_lc' else 'lc_missing' end,
                                'kind', 'lc', 'name', v_name);
    end if;
    if exists (select 1 from team_members where project_id = v_target and user_id = v_uid) then
      return jsonb_build_object('status', 'already', 'kind', 'lc', 'id', v_target, 'name', v_title);
    end if;
  elsif v_kind = 'mc' then
    v_role := case when v_role = 'mcp' then 'mcp' when v_role = 'vp_finance' then 'vp_finance' else 'member' end;
    if v_expa is not null then
      select id, name into v_target, v_title from mcs where expa_mc_id = v_expa;
    end if;
    if v_target is null and v_country is not null then
      select id, name into v_target, v_title from mcs
      where country_code = v_country and (expa_mc_id is null or v_expa is null);
      if v_target is not null and v_expa is not null then
        update mcs set expa_mc_id = v_expa where id = v_target and expa_mc_id is null;
      end if;
    end if;
    if v_target is null then
      return jsonb_build_object('status', case when v_role = 'mcp' then 'create_mc' else 'mc_missing' end,
                                'kind', 'mc', 'name', v_name);
    end if;
    if exists (select 1 from mc_members where mc_id = v_target and user_id = v_uid) then
      return jsonb_build_object('status', 'already', 'kind', 'mc', 'id', v_target, 'name', v_title);
    end if;
  else
    return jsonb_build_object('status', 'none');
  end if;

  -- Their profile, from EXPA, when they have none yet.
  v_full  := coalesce(nullif(trim(v_profile ->> 'fullName'), ''),
                      (select split_part(email, '@', 1) from auth.users where id = v_uid), 'Member');
  v_parts := regexp_split_to_array(v_full, '\s+');
  v_photo := v_profile ->> 'photoUrl';
  insert into user_profiles (id, name, role, avatar_initials, avatar_color, avatar_url, country_code)
  values (v_uid, left(v_full, 120), 'member',
          upper(left(v_parts[1], 1) || case when cardinality(v_parts) > 1 then left(v_parts[cardinality(v_parts)], 1) else '' end),
          '#B4D4E3', case when v_photo ~* '^https://' then v_photo end, v_country)
  on conflict (id) do nothing;
  if p_timezone is not null and length(p_timezone) between 1 and 64 then
    insert into user_settings (user_id, timezone) values (v_uid, p_timezone) on conflict (user_id) do nothing;
  end if;

  if v_kind = 'lc' then
    v_dep := _expa_department(v_target, v_pl ->> 'department');
    insert into team_members (project_id, user_id, role, lab_role_id, department_id)
    values (v_target, v_uid, v_role,
            (select id from lab_roles where project_id = v_target and is_system and permission_level = v_role limit 1),
            v_dep)
    on conflict (project_id, user_id) do nothing;
    if v_role = 'vp' and v_dep is not null then
      update departments set vp_user_id = v_uid where id = v_dep and vp_user_id is null;
    end if;
  else
    insert into mc_members (mc_id, user_id, role) values (v_target, v_uid, v_role) on conflict do nothing;
  end if;

  return jsonb_build_object('status', 'joined', 'kind', v_kind, 'id', v_target, 'name', v_title, 'role', v_role);
end;
$$;

revoke execute on function join_from_expa(text) from public, anon;
grant  execute on function join_from_expa(text) to authenticated;


CREATE OR REPLACE FUNCTION public.event_audience(p_event_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tm.user_id
  from lc_events e
  join team_members tm on tm.project_id = e.project_id
  where e.id = p_event_id and (auth_is_project_member(e.project_id) or current_setting('role') not in ('anon', 'authenticated'))
    and case e.audience
          when 'lc'         then true
          when 'department' then tm.department_id = e.department_id
                                 or exists (select 1 from departments d where d.id = e.department_id and d.vp_user_id = tm.user_id)
          when 'role'       then case e.audience_role when 'exec' then tm.role in ('president', 'vp') else tm.role = e.audience_role end
          when 'people'     then exists (select 1 from event_invitees i where i.event_id = e.id and i.user_id = tm.user_id)
        end;
$function$;

CREATE OR REPLACE FUNCTION public.lc_in_mc(p_project_id uuid, p_mc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from projects where id = p_project_id and mc_id = p_mc_id and (auth_is_project_member(p_project_id) or is_mc_member(p_mc_id)));
$function$;

CREATE OR REPLACE FUNCTION public.checkin_period_start(p_project_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cfg as (
    select coalesce((select checkin_period_weeks from projects where id = p_project_id), 2) * 7 as days
  )
  select (date '2024-01-01'
          + (floor((date_trunc('week', p_at)::date - date '2024-01-01')::numeric / cfg.days) * cfg.days)::integer)
  from cfg where auth_is_project_member(p_project_id) or current_setting('role') not in ('anon', 'authenticated');
$function$;

CREATE OR REPLACE FUNCTION public.set_university_account(p_project_id uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_lc_president(p_project_id)) then
    raise exception 'Only the LC president can change this';
  end if;
  update projects set has_university_account = coalesce(p_on, false) where id = p_project_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_finance_reviewed(p_project_id uuid, p_on date DEFAULT CURRENT_DATE)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_lc_president(p_project_id) then raise exception 'Only the LC president can do this'; end if;
  update projects set finance_reviewed_on = p_on where id = p_project_id;
end;
$function$;

revoke execute on function _next_checkin_due(uuid, timestamptz) from public, anon, authenticated;
drop policy if exists "receipts: read own, finance lead, department VP" on storage.objects;
create policy "receipts: LC owner and department reviewers" on storage.objects for select to authenticated using (
  bucket_id = 'receipts' and (
    (storage.foldername(name))[2] = auth.uid()::text
    or is_lc_president(_try_uuid((storage.foldername(name))[1]))
    or exists (select 1 from expense_claims c where c.receipt_path = storage.objects.name
      and c.department_id in (select led_department_ids(c.project_id)))
    or exists (select 1 from finance_entries e where e.receipt_path = storage.objects.name
      and e.department_id in (select led_department_ids(e.project_id)))
  )
);
notify pgrst, 'reload schema';

create or replace function _expa_id_free(p_kind text, p_id text)
returns boolean language sql stable security definer set search_path = public as $$
select exists (select 1 from expa_connections where user_id = auth.uid()
  and profile #>> '{placement,kind}' = p_kind and profile #>> '{placement,expaId}' = p_id)
and case when p_kind = 'lc' then not exists (select 1 from projects where expa_lc_id = p_id)
  when p_kind = 'mc' then not exists (select 1 from mcs where expa_mc_id = p_id)
  else false end;
$$;

-- Writes must use the same department boundary as reads.
drop policy if exists "department adds exchanges" on exchanges;
create policy "department exec adds exchanges" on exchanges for insert with check (
  created_by = auth.uid() and can_work_on_exchange(project_id, department_id, owner_id)
);
drop policy if exists "members add partners for their department" on partners;
create policy "department exec adds partners" on partners for insert with check (
  created_by = auth.uid() and partner_visible(project_id, department_id, owner_id)
);
drop policy if exists "people who can see a partner can update it" on partners;
create policy "department exec updates partners" on partners for update
  using (partner_visible(project_id, department_id, owner_id))
  with check (partner_visible(project_id, department_id, owner_id));

CREATE OR REPLACE FUNCTION public.lc_compliance(p_project_id uuid)
 RETURNS TABLE(balance numeric, currency text, approvals_12m integer, meetings_12m integer, boa_members integer, university_affiliated boolean, debt_plan text, checks jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not is_lc_president(p_project_id) then
    return;
  end if;
  return query
  select
    -- Income and the opening balance add; expenses subtract.
    coalesce((select sum(case when f.type = 'expense' then -f.amount else f.amount end) from finance_entries f where f.project_id = p_project_id), 0),
    (select p.currency from projects p where p.id = p_project_id),
    (select count(*)::int from exchanges e where e.project_id = p_project_id
       and e.product in ('ogv', 'ogta', 'ogte') and e.approved_at > current_date - 365),
    (select count(*)::int from partner_activities a join partners pa on pa.id = a.partner_id
       where pa.project_id = p_project_id and a.kind = 'meeting' and a.happened_on > current_date - 365),
    coalesce((select i.boa_members::int from lc_compliance_info i where i.project_id = p_project_id), 0),
    coalesce((select i.university_affiliated from lc_compliance_info i where i.project_id = p_project_id), false),
    (select i.debt_plan from lc_compliance_info i where i.project_id = p_project_id),
    coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'month', c.month, 'done_on', c.done_on) order by c.month)
              from lc_compliance_checks c where c.project_id = p_project_id and c.month > current_date - 400), '[]'::jsonb);
end;
$function$;
