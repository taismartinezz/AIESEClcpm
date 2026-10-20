-- Migration 052: people in the demo LC.
--
-- The demo LC had only you in it: no team, an empty chat, no pulse. It now gets
-- seven made-up members (three VPs, four members) with tasks, exchanges they
-- own, a few chat messages, this period's check-ins and a win, so it feels like
-- an LC. They are placeholder accounts: an unreachable @demo.invalid address and
-- no password, so nobody can sign in as them. Each is listed in demo_people and
-- deleted with its demo LC.

create table if not exists demo_people (
  user_id    uuid primary key,
  project_id uuid not null references projects(id) on delete cascade
);
alter table demo_people enable row level security;   -- no policies: only the functions below touch it

-- Keep the original seed as-is and add the people after it.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_create_demo_lc_base') then
    alter function create_demo_lc() rename to _create_demo_lc_base;
  end if;
end $$;
revoke execute on function _create_demo_lc_base() from public, anon, authenticated;

create or replace function _seed_demo_people(p_lc uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ogv uuid := (select id from departments where project_id = p_lc and name = 'Outgoing Global Volunteer');
  v_mkt uuid := (select id from departments where project_id = p_lc and name = 'Marketing');
  v_fl  uuid := (select id from departments where project_id = p_lc and name = 'Finance & Legality');
  v_ids uuid[] := array[]::uuid[];
  v_id  uuid;
  v_task uuid;
  p     record;
  i     integer := 0;
  v_scores integer[][] := array[
    [4,3,5,4,5,3], [3,2,4,3,4,2], [5,4,5,5,5,4], [4,4,4,3,4,4], [2,3,4,4,3,2], [4,3,4,4,5,3], [3,4,5,4,4,4]];
  v_q text[] := array['energy', 'workload', 'purpose', 'support', 'belonging', 'balance'];
begin
  for p in
    select * from (values
      (1, 'Sofia Almeida',  'vp',     v_ogv, '#F85A40'),
      (2, 'Kwame Mensah',   'vp',     v_mkt, '#FFC845'),
      (3, 'Priya Nair',     'vp',     v_fl,  '#037EF3'),
      (4, 'Diego Ramos',    'member', v_ogv, '#30C39E'),
      (5, 'Aisha Bello',    'member', v_ogv, '#7552CC'),
      (6, 'Lucas Martin',   'member', v_ogv, '#00C16E'),
      (7, 'Jonas Weber',    'member', v_mkt, '#F48924')
    ) as t(n, name, role, dept, color)
    order by n
  loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_id, 'demo+' || v_id || '@demo.invalid', jsonb_build_object('name', p.name, 'demo', true));
    insert into user_profiles (id, name, role, avatar_color, avatar_initials)
    values (v_id, p.name, 'member', p.color, upper(left(split_part(p.name, ' ', 1), 1) || left(split_part(p.name, ' ', 2), 1)));
    insert into team_members (project_id, user_id, role, department_id) values (p_lc, v_id, p.role, p.dept);
    insert into demo_people (user_id, project_id) values (v_id, p_lc);
    if p.role = 'vp' then update departments set vp_user_id = v_id where id = p.dept; end if;
    v_ids := v_ids || v_id;
  end loop;
  -- v_ids: 1 Sofia, 2 Kwame, 3 Priya, 4 Diego, 5 Aisha, 6 Lucas, 7 Jonas

  -- Small enough team that the pulse shows numbers (the floor is 2).
  update projects set min_wellbeing_respondents = 3 where id = p_lc;

  -- Every exchange has an owner, so stuck alerts name someone.
  update exchanges set owner_id = case
      when person_name in ('Nadia Farah', 'Sam Okoro', 'Eli Novak') then v_ids[4]
      when person_name in ('Ana Costa', 'Inês Pereira', 'Tom Reyes') then v_ids[5]
      else v_ids[1] end
  where project_id = p_lc;

  -- Their tasks, and the existing ones shared out.
  for p in
    select * from (values
      (4, 'Call this week''s oGV sign-ups', 'todo', 'high', 1, v_ogv),
      (5, 'Prepare the info session slides', 'in_progress', 'medium', 4, v_ogv),
      (6, 'Follow up with Nadia about her visa', 'todo', 'medium', -1, v_ogv),
      (7, 'Post the info session on Instagram', 'in_review', 'medium', 2, v_mkt),
      (2, 'Book a photographer for the conference', 'done', 'low', -5, v_mkt)
    ) as t(who, title, status, priority, due, dept)
  loop
    insert into tasks (project_id, title, status, priority, due_date, department_id, created_by)
    values (p_lc, p.title, p.status, p.priority, current_date + p.due, p.dept, v_ids[1])
    returning id into v_task;
    insert into task_assignees (task_id, user_id) values (v_task, v_ids[p.who]);
  end loop;
  insert into task_assignees (task_id, user_id)
  select t.id, v_ids[3] from tasks t where t.project_id = p_lc and t.title = 'Collect conference receipts';
  insert into task_assignees (task_id, user_id)
  select t.id, v_ids[1] from tasks t where t.project_id = p_lc and t.title = 'Book the auditorium for the info session';

  -- A bit of chat in the Whole LC channel.
  insert into chat_messages (channel, sender_id, content, created_at) values
    ('lab:' || p_lc, v_ids[1], 'Good morning! LC meeting moved to Thursday, 19:00. Bring your department updates.', now() - interval '26 hours'),
    ('lab:' || p_lc, v_ids[2], 'Noted! Marketing will share the info session posters there.', now() - interval '25 hours'),
    ('lab:' || p_lc, v_ids[4], 'Three new oGV sign-ups since Monday, I''m calling them today.', now() - interval '5 hours'),
    ('lab:' || p_lc, v_ids[3], 'Reminder: conference receipts to me by Friday please 🧾', now() - interval '3 hours'),
    ('lab:' || p_lc, v_ids[5], 'Inês just got approved for Hanoi! 🎉', now() - interval '1 hour');

  -- This period's check-ins (anonymous in the pulse; shown only as averages).
  foreach v_id in array v_ids loop
    i := i + 1;
    insert into checkins (user_id, project_id, period_start, scores)
    select v_id, p_lc, current_date, jsonb_agg(jsonb_build_object('questionId', v_q[q], 'score', v_scores[i][q]))
    from generate_series(1, 6) q;
  end loop;

  insert into lab_wins (project_id, author_id, content)
  values (p_lc, v_ids[5], 'Inês Pereira was approved for Women Empowerment in Hanoi. Our 3rd oGV approval this month!');

  insert into event_attendance (event_id, user_id, project_id, recorded_by)
  select e.id, u, p_lc, p_owner from lc_events e, unnest(v_ids[1:5]) u
  where e.project_id = p_lc and e.name = 'Local conference';
end;
$$;
revoke execute on function _seed_demo_people(uuid, uuid) from public, anon, authenticated;

create or replace function create_demo_lc()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lc uuid := _create_demo_lc_base();
begin
  perform _seed_demo_people(v_lc, auth.uid());
  return v_lc;
end;
$$;

-- Deleting a demo LC also deletes its placeholder accounts.
create or replace function delete_demo_lc(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people uuid[];
begin
  if not exists (select 1 from projects where id = p_project_id and is_demo and owner_id = auth.uid()) then
    raise exception 'Only your own demo LCs can be deleted';
  end if;
  -- The LC first (its tasks name these people as creators), then the people.
  v_people := array(select user_id from demo_people where project_id = p_project_id);
  delete from projects where id = p_project_id;
  delete from auth.users where id = any (v_people);
end;
$$;

revoke execute on function create_demo_lc()      from public, anon;
revoke execute on function delete_demo_lc(uuid)  from public, anon;
grant  execute on function create_demo_lc()      to authenticated;
grant  execute on function delete_demo_lc(uuid)  to authenticated;

notify pgrst, 'reload schema';
