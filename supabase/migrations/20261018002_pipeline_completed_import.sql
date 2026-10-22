-- Migration 039: Exchange pipeline: "Completed" stage and EXPA CSV import.
--
--   * Stages are now Signed up → Applied → Accepted → Approved → Realized →
--     Finished → Completed (exchanges.completed_at, goals can target it).
--   * Stage dates: when an exchange arrives at a stage with earlier dates
--     missing (typical for imports), each missing date takes the next known
--     later date instead of today, so conversion and "this term" numbers stay
--     right. Sign-up is never after the application.
--   * expa_id is unique per LC, so re-importing an EXPA export updates the
--     exchanges already there instead of duplicating them.
--   * import_exchanges(lc, product, rows) inserts or updates many exchanges in
--     one call. It runs with the caller's own rights (SECURITY INVOKER), so the
--     usual RLS decides what each person may add or change; rows it can't
--     write are counted and reported back, not silently dropped.

-- ── 1. Completed stage ───────────────────────────────────────────────────────

alter table exchanges add column if not exists completed_at date;

alter table exchanges drop constraint if exists exchanges_stage_check;
alter table exchanges add constraint exchanges_stage_check
  check (stage in ('signed_up', 'applied', 'accepted', 'approved', 'realized', 'finished', 'completed'));

alter table goals drop constraint if exists goals_stage_check;
alter table goals add constraint goals_stage_check
  check (stage in ('signed_up', 'applied', 'accepted', 'approved', 'realized', 'finished', 'completed'));

create or replace function _exchanges_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank integer := array_position(
    array['signed_up', 'applied', 'accepted', 'approved', 'realized', 'finished', 'completed'], new.stage);
begin
  if new.department_id is null then
    select id into new.department_id from departments
    where project_id = new.project_id and new.product = any (products)
    order by sort_order limit 1;
  elsif not exists (select 1 from departments where id = new.department_id and project_id = new.project_id) then
    raise exception 'Department does not belong to this LC';
  end if;
  if new.owner_id is not null and not exists (
    select 1 from team_members where project_id = new.project_id and user_id = new.owner_id
  ) then
    raise exception 'The owner must be a member of this LC';
  end if;

  -- Reaching a stage implies the earlier ones. A missing date takes the next
  -- known later date (imports often carry only the latest), else today.
  if v_rank >= 7 then new.completed_at := coalesce(new.completed_at, current_date); end if;
  if v_rank >= 6 then new.finished_at  := coalesce(new.finished_at,  new.completed_at, current_date); end if;
  if v_rank >= 5 then new.realized_at  := coalesce(new.realized_at,  new.finished_at,  current_date); end if;
  if v_rank >= 4 then new.approved_at  := coalesce(new.approved_at,  new.realized_at,  current_date); end if;
  if v_rank >= 3 then new.accepted_at  := coalesce(new.accepted_at,  new.approved_at,  current_date); end if;
  if v_rank >= 2 then new.applied_at   := coalesce(new.applied_at,   new.accepted_at,  current_date); end if;
  new.signed_up_at := least(coalesce(new.signed_up_at, current_date), coalesce(new.applied_at, current_date));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function goal_progress(p_project_id uuid)
returns table (goal_id uuid, current numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if not auth_is_project_member(p_project_id) then
    return;
  end if;
  return query
  select g.id,
         case when g.metric = 'manual' then g.current_value
         else (
           select count(*)::numeric
           from   exchanges e
           where  e.project_id = g.project_id
             and  (g.product is not null and e.product = g.product
                   or g.product is null and (g.department_id is null or e.department_id = g.department_id))
             and  (case g.stage
                     when 'signed_up' then e.signed_up_at
                     when 'applied'   then e.applied_at
                     when 'accepted'  then e.accepted_at
                     when 'approved'  then e.approved_at
                     when 'realized'  then e.realized_at
                     when 'finished'  then e.finished_at
                     when 'completed' then e.completed_at
                   end) between g.starts_on and g.ends_on
         ) end
  from goals g
  where g.project_id = p_project_id;
end;
$$;

-- ── 2. One exchange per EXPA application per LC ──────────────────────────────

create unique index if not exists exchanges_project_expa_id_key
  on exchanges (project_id, expa_id) where expa_id is not null;

-- ── 3. Bulk import ───────────────────────────────────────────────────────────
-- p_rows: [{ expa_id, person_name, email, phone, opportunity, host_entity,
--            expa_url, stage, signed_up_at, applied_at, accepted_at,
--            approved_at, realized_at, finished_at, completed_at }, …]

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
          completed_at = coalesce((r->>'completed_at')::date, completed_at)
        where id = v_id;
        if not found then
          raise exception 'you can''t edit this exchange';
        end if;
        v_upd := v_upd + 1;
      else
        insert into exchanges (project_id, product, stage, person_name, email, phone, opportunity, host_entity,
                               expa_id, expa_url, signed_up_at, applied_at, accepted_at, approved_at,
                               realized_at, finished_at, completed_at, created_by)
        values (p_project_id, p_product, coalesce(nullif(r->>'stage', ''), 'signed_up'), v_name,
                nullif(trim(r->>'email'), ''), nullif(trim(r->>'phone'), ''),
                nullif(trim(r->>'opportunity'), ''), nullif(trim(r->>'host_entity'), ''),
                v_expa, nullif(trim(r->>'expa_url'), ''),
                coalesce((r->>'signed_up_at')::date, (r->>'applied_at')::date, current_date),
                (r->>'applied_at')::date, (r->>'accepted_at')::date, (r->>'approved_at')::date,
                (r->>'realized_at')::date, (r->>'finished_at')::date, (r->>'completed_at')::date,
                auth.uid());
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

revoke execute on function import_exchanges(uuid, text, jsonb) from public, anon;
grant  execute on function import_exchanges(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
