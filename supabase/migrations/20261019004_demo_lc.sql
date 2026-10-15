-- Migration 043: A demo LC to click around in.
--
-- create_demo_lc() gives the caller a private LC full of fictional data
-- (exchanges at every stage, goals, partners, tasks, events, tabling slots,
-- recruits, finance entries, a handover note) with the caller as president.
-- Nobody else is in it, so nothing real can break, and it's a ready-made LC to
-- show at conferences. delete_demo_lc() removes it (only demo LCs, only by
-- their owner). The people in it are names on records, not accounts.

alter table projects add column if not exists is_demo boolean not null default false;

create or replace function create_demo_lc()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_lc   uuid;
  v_role uuid;
  d      record;
  v_ogv  uuid; v_igt uuid; v_mkt uuid; v_bd uuid; v_fl uuid; v_tm uuid;
  v_term date;
  v_ev   uuid;
  v_task uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from user_profiles where id = v_uid) then
    raise exception 'Create your profile first';
  end if;
  if (select count(*) from projects where owner_id = v_uid and is_demo) >= 3 then
    raise exception 'You already have 3 demo LCs. Delete one first.';
  end if;

  insert into projects (name, institution, owner_id, is_demo)
  values ('Demo LC (sample data)', 'Demo University', v_uid, true)
  returning id into v_lc;

  select id into v_role from lab_roles where project_id = v_lc and name = 'President';
  insert into team_members (project_id, user_id, role, lab_role_id) values (v_lc, v_uid, 'president', v_role);

  perform seed_default_departments(v_lc);
  select id into v_ogv from departments where project_id = v_lc and name = 'Outgoing Global Volunteer';
  select id into v_igt from departments where project_id = v_lc and name = 'Incoming Global Talent/Teacher';
  select id into v_mkt from departments where project_id = v_lc and name = 'Marketing';
  select id into v_bd  from departments where project_id = v_lc and name = 'Business Development';
  select id into v_fl  from departments where project_id = v_lc and name = 'Finance & Legality';
  select id into v_tm  from departments where project_id = v_lc and name = 'Talent Management';
  v_term := lc_term_start(v_lc);

  -- Exchanges: a realistic spread over the term (dates relative to today).
  insert into exchanges (project_id, product, stage, person_name, email, opportunity, host_entity, expa_id,
                         applied_at, accepted_at, approved_at, realized_at, finished_at, completed_at, created_by)
  values
    (v_lc, 'ogv', 'completed', 'Marta Silva',  'marta@demo.example', 'Teaching English to kids', 'AIESEC in Bogotá',   'DEMO-1',
       current_date - 160, current_date - 150, current_date - 140, current_date - 100, current_date - 60, current_date - 50, v_uid),
    (v_lc, 'ogv', 'realized',  'Leo Kamau',    'leo@demo.example',   'Climate education',        'AIESEC in Nairobi',  'DEMO-2',
       current_date - 90, current_date - 80, current_date - 70, current_date - 10, null, null, v_uid),
    (v_lc, 'ogv', 'approved',  'Inês Pereira', 'ines@demo.example',  'Women empowerment',        'AIESEC in Hanoi',    'DEMO-3',
       current_date - 30, current_date - 25, current_date - 3, null, null, null, v_uid),
    (v_lc, 'ogv', 'approved',  'Tom Reyes',    'tom@demo.example',   'Health awareness',         'AIESEC in Lima',     'DEMO-4',
       current_date - 20, current_date - 15, current_date - 9, null, null, null, v_uid),
    (v_lc, 'ogv', 'accepted',  'Nadia Farah',  'nadia@demo.example', 'Climate education',        'AIESEC in Nairobi',  'DEMO-5',
       current_date - 35, current_date - 21, null, null, null, null, v_uid),
    (v_lc, 'ogv', 'applied',   'Sam Okoro',    'sam@demo.example',   'Teaching English to kids', 'AIESEC in Bogotá',   'DEMO-6',
       current_date - 18, null, null, null, null, null, v_uid),
    (v_lc, 'ogv', 'applied',   'Ana Costa',    'ana@demo.example',   'Ocean clean-up',           'AIESEC in Bali',     'DEMO-7',
       current_date - 4, null, null, null, null, null, v_uid),
    (v_lc, 'ogv', 'signed_up', 'Eli Novak',    'eli@demo.example',   null, null, 'DEMO-8',
       null, null, null, null, null, null, v_uid),
    (v_lc, 'igta', 'realized', 'Chen Wei',     'chen@demo.example',  'Marketing intern at Demo Bank', 'AIESEC in Taipei', 'DEMO-9',
       current_date - 120, current_date - 110, current_date - 95, current_date - 40, null, null, v_uid),
    (v_lc, 'igte', 'approved', 'Priya Shah',   'priya@demo.example', 'English teacher, City Language School', 'AIESEC in Pune', 'DEMO-10',
       current_date - 25, current_date - 20, current_date - 6, null, null, null, v_uid);

  insert into goals (project_id, department_id, title, metric, product, stage, target, starts_on, ends_on, created_by)
  values (v_lc, v_ogv, 'oGV approvals',  'pipeline', 'ogv', 'approved', 20, v_term, v_term + 364, v_uid),
         (v_lc, v_ogv, 'oGV realizations','pipeline', 'ogv', 'realized', 15, v_term, v_term + 364, v_uid);
  insert into goals (project_id, department_id, title, metric, target, current_value, unit, starts_on, ends_on, created_by)
  values (v_lc, null, 'New members recruited', 'manual', 15, 6, 'members', v_term, v_term + 364, v_uid);

  insert into partners (project_id, name, industry, stage, department_id, next_follow_up, created_by)
  values (v_lc, 'Demo Bank', 'Banking', 'meeting', v_bd, current_date + 2, v_uid),
         (v_lc, 'City Language School', 'Education', 'partner', v_igt, null, v_uid),
         (v_lc, 'Print & Co', 'Printing', 'proposal', v_mkt, current_date - 1, v_uid);

  insert into tasks (project_id, title, status, priority, due_date, department_id, created_by)
  values (v_lc, 'Design recruitment posters', 'in_progress', 'high', current_date + 3, v_mkt, v_uid)
  returning id into v_task;
  insert into task_assignees (task_id, user_id) values (v_task, v_uid);
  insert into tasks (project_id, title, status, priority, due_date, department_id, created_by)
  values (v_lc, 'Collect conference receipts', 'todo', 'medium', current_date - 2, v_fl, v_uid),
         (v_lc, 'Book the auditorium for the info session', 'todo', 'high', current_date + 5, v_ogv, v_uid),
         (v_lc, 'Plan the next LC meeting', 'backlog', 'low', null, null, v_uid);

  insert into lc_events (project_id, name, type, starts_on, ends_on, location, created_by)
  values (v_lc, 'oGV info session', 'info_session', current_date + 6, current_date + 6, 'Room 2.14', v_uid);
  insert into lc_events (project_id, name, type, starts_on, ends_on, location, created_by)
  values (v_lc, 'Local conference', 'local_conference', current_date - 20, current_date - 19, 'Campus centre', v_uid)
  returning id into v_ev;
  insert into event_attendance (event_id, user_id, project_id, recorded_by) values (v_ev, v_uid, v_lc, v_uid);

  insert into tabling_slots (project_id, starts_at, ends_at, location, purpose, capacity, department_id, created_by)
  values (v_lc, date_trunc('day', now()) + interval '2 days 12 hours', date_trunc('day', now()) + interval '2 days 14 hours', 'Library entrance', 'oGV recruitment', 3, v_ogv, v_uid),
         (v_lc, date_trunc('day', now()) + interval '4 days 10 hours', date_trunc('day', now()) + interval '4 days 12 hours', 'Main hall', 'Member recruitment', 2, v_tm, v_uid);

  insert into recruits (project_id, name, email, source, department_id, stage, created_by)
  values (v_lc, 'Lucía Pérez', 'lucia@demo.example', 'Tabling', v_mkt, 'interview', v_uid),
         (v_lc, 'Omar Ben',    'omar@demo.example',  'Instagram', v_ogv, 'applied', v_uid),
         (v_lc, 'Hana Kim',    'hana@demo.example',  'Referral', null, 'offer', v_uid);

  insert into finance_entries (project_id, type, amount, currency, entry_date, department_id, description, recorded_by)
  values (v_lc, 'income',  450, 'EUR', current_date - 30, null, 'Sponsorship: Demo Bank', v_uid),
         (v_lc, 'expense', 120, 'EUR', current_date - 12, v_mkt, 'Posters for the info session', v_uid);

  insert into handover_notes (project_id, department_id, term_label, title, body, updated_by)
  values (v_lc, null, extract(year from v_term)::int || '/' || lpad(((extract(year from v_term)::int + 1) % 100)::text, 2, '0'),
          'LC-wide handover', E'## Open items and deadlines\n- Demo Bank contract renews in March.\n', v_uid);

  return v_lc;
end;
$$;

create or replace function delete_demo_lc(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from projects where id = p_project_id and is_demo and owner_id = auth.uid();
  if not found then raise exception 'Only your own demo LCs can be deleted'; end if;
end;
$$;

revoke execute on function create_demo_lc()      from public, anon;
revoke execute on function delete_demo_lc(uuid)  from public, anon;
grant  execute on function create_demo_lc()      to authenticated;
grant  execute on function delete_demo_lc(uuid)  to authenticated;

notify pgrst, 'reload schema';
