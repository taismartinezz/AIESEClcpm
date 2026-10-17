-- Migration 041: Import trackers (Google Sheets / CSV) into partners, recruits and tasks.
--
-- Same contract as import_exchanges(): SECURITY INVOKER (the caller's RLS
-- decides what they may write), one sub-transaction per row, and a summary of
-- inserted / updated / failed rows with up to 20 reasons. Re-importing the same
-- sheet updates instead of duplicating:
--   partners  matched by name (case-insensitive)
--   recruits  matched by email
--   tasks     a task with the same title and due date is left alone

-- ── Partners ──────────────────────────────────────────────────────────────────
-- rows: [{ name, industry, website, stage, department_id, next_follow_up, notes,
--          contact_name, contact_role, contact_email, contact_phone }]

create or replace function import_partners(p_project_id uuid, p_rows jsonb)
returns table (inserted integer, updated integer, failed integer, errors text[])
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb; v_id uuid; v_name text;
  v_ins integer := 0; v_upd integer := 0; v_fail integer := 0; v_errors text[] := '{}';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Expected a list of at most 2000 rows';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(trim(r->>'name'), '');
    begin
      if v_name is null then raise exception 'no organisation name'; end if;
      select id into v_id from partners where project_id = p_project_id and lower(name) = lower(v_name) limit 1;
      if v_id is not null then
        update partners set
          industry       = coalesce(nullif(trim(r->>'industry'), ''), industry),
          website        = coalesce(nullif(trim(r->>'website'), ''), website),
          stage          = coalesce(nullif(r->>'stage', ''), stage),
          next_follow_up = coalesce((r->>'next_follow_up')::date, next_follow_up),
          notes          = coalesce(nullif(trim(r->>'notes'), ''), notes)
        where id = v_id;
        if not found then raise exception 'you can''t edit this partner'; end if;
        v_upd := v_upd + 1;
      else
        insert into partners (project_id, name, industry, website, stage, department_id, next_follow_up, notes, created_by)
        values (p_project_id, v_name, nullif(trim(r->>'industry'), ''), nullif(trim(r->>'website'), ''),
                coalesce(nullif(r->>'stage', ''), 'lead'), (r->>'department_id')::uuid,
                (r->>'next_follow_up')::date, nullif(trim(r->>'notes'), ''), auth.uid())
        returning id into v_id;
        v_ins := v_ins + 1;
      end if;
      if nullif(trim(r->>'contact_name'), '') is not null and not exists (
        select 1 from partner_contacts where partner_id = v_id and lower(name) = lower(trim(r->>'contact_name'))
      ) then
        insert into partner_contacts (partner_id, name, role_title, email, phone)
        values (v_id, trim(r->>'contact_name'), nullif(trim(r->>'contact_role'), ''),
                nullif(trim(r->>'contact_email'), ''), nullif(trim(r->>'contact_phone'), ''));
      end if;
    exception when others then
      v_fail := v_fail + 1;
      if coalesce(array_length(v_errors, 1), 0) < 20 then
        v_errors := v_errors || (coalesce(v_name, '(no name)') || ': ' ||
          case when sqlstate = '42501' then 'you can''t add partners for that department' else sqlerrm end);
      end if;
    end;
  end loop;
  return query select v_ins, v_upd, v_fail, v_errors;
end;
$$;

-- ── Recruits ──────────────────────────────────────────────────────────────────
-- rows: [{ name, email, phone, source, department_id, stage, applied_on, notes }]

create or replace function import_recruits(p_project_id uuid, p_rows jsonb)
returns table (inserted integer, updated integer, failed integer, errors text[])
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb; v_id uuid; v_name text; v_email text;
  v_ins integer := 0; v_upd integer := 0; v_fail integer := 0; v_errors text[] := '{}';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Expected a list of at most 2000 rows';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(trim(r->>'name'), '');
    v_email := nullif(lower(trim(r->>'email')), '');
    begin
      if v_name is null then raise exception 'no name'; end if;
      v_id := null;
      if v_email is not null then
        select id into v_id from recruits where project_id = p_project_id and email = v_email;
      end if;
      if v_id is not null then
        update recruits set
          name          = v_name,
          phone         = coalesce(nullif(trim(r->>'phone'), ''), phone),
          source        = coalesce(nullif(trim(r->>'source'), ''), source),
          department_id = coalesce((r->>'department_id')::uuid, department_id),
          stage         = coalesce(nullif(r->>'stage', ''), stage),
          notes         = coalesce(nullif(trim(r->>'notes'), ''), notes)
        where id = v_id;
        if not found then raise exception 'you can''t edit recruits'; end if;
        v_upd := v_upd + 1;
      else
        insert into recruits (project_id, name, email, phone, source, department_id, stage, applied_on, notes, created_by)
        values (p_project_id, v_name, v_email, nullif(trim(r->>'phone'), ''), nullif(trim(r->>'source'), ''),
                (r->>'department_id')::uuid, coalesce(nullif(r->>'stage', ''), 'applied'),
                coalesce((r->>'applied_on')::date, current_date), nullif(trim(r->>'notes'), ''), auth.uid());
        v_ins := v_ins + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      if coalesce(array_length(v_errors, 1), 0) < 20 then
        v_errors := v_errors || (coalesce(v_name, '(no name)') || ': ' ||
          case when sqlstate = '42501' then 'only the exec board can add recruits' else sqlerrm end);
      end if;
    end;
  end loop;
  return query select v_ins, v_upd, v_fail, v_errors;
end;
$$;

-- ── Tasks ─────────────────────────────────────────────────────────────────────
-- rows: [{ title, description, status, priority, due_date, department_id, assignee_ids: [uuid] }]

create or replace function import_tasks(p_project_id uuid, p_rows jsonb)
returns table (inserted integer, updated integer, failed integer, errors text[])
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb; v_id uuid; v_title text; v_due date; a text;
  v_ins integer := 0; v_skip integer := 0; v_fail integer := 0; v_errors text[] := '{}';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Expected a list of at most 2000 rows';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_title := nullif(trim(r->>'title'), '');
    begin
      if v_title is null then raise exception 'no title'; end if;
      v_due := (r->>'due_date')::date;
      if exists (select 1 from tasks where project_id = p_project_id and title = v_title and due_date is not distinct from v_due) then
        v_skip := v_skip + 1;
        continue;
      end if;
      insert into tasks (project_id, title, description, status, priority, due_date, department_id, scope, created_by)
      values (p_project_id, v_title, coalesce(r->>'description', ''), coalesce(nullif(r->>'status', ''), 'todo'),
              coalesce(nullif(r->>'priority', ''), 'medium'), v_due, (r->>'department_id')::uuid, 'lab', auth.uid())
      returning id into v_id;
      for a in select * from jsonb_array_elements_text(coalesce(r->'assignee_ids', '[]'::jsonb)) loop
        insert into task_assignees (task_id, user_id) values (v_id, a::uuid) on conflict do nothing;
      end loop;
      v_ins := v_ins + 1;
    exception when others then
      v_fail := v_fail + 1;
      if coalesce(array_length(v_errors, 1), 0) < 20 then
        v_errors := v_errors || (coalesce(v_title, '(no title)') || ': ' || sqlerrm);
      end if;
    end;
  end loop;
  -- "updated" reports tasks that were already there and left alone.
  return query select v_ins, v_skip, v_fail, v_errors;
end;
$$;

revoke execute on function import_partners(uuid, jsonb) from public, anon;
revoke execute on function import_recruits(uuid, jsonb) from public, anon;
revoke execute on function import_tasks(uuid, jsonb)    from public, anon;
grant  execute on function import_partners(uuid, jsonb) to authenticated;
grant  execute on function import_recruits(uuid, jsonb) to authenticated;
grant  execute on function import_tasks(uuid, jsonb)    to authenticated;

notify pgrst, 'reload schema';
