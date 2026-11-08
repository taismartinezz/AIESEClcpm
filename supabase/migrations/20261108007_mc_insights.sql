-- Migration 070: trends, funnel and LC health the MC can't get from EXPA.
--
-- mc_lc_insights(mc), per linked LC, counts only (never names), MC members only:
--   weekly            approvals in each of the last 12 weeks, oldest first
--   last_term_to_date approvals in last term up to the same point in it
--   applied … completed  this term's funnel, by the date each stage was reached
--   members, joined_term, term_ended   team size, joined this term, and still
--                     listed although their term has ended
--   active_14d        members who opened the app in the last 14 days
--   handover_due, handover_written    notes expected (each department with a
--                     VP, plus the LC-wide one) and written this term
--   recruits_term, recruits_joined    recruitment this term
--
-- Grants are written out: some projects don't expose new objects automatically.

create or replace function mc_lc_insights(p_mc_id uuid)
returns table (
  project_id uuid, weekly integer[], last_term_to_date integer,
  applied integer, accepted integer, approved integer, realized integer, completed integer,
  members integer, joined_term integer, term_ended integer, active_14d integer,
  handover_due integer, handover_written integer, recruits_term integer, recruits_joined integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_from      date;
  v_elapsed   integer;
  v_last_from date;
begin
  if not is_mc_member(p_mc_id) then
    return;
  end if;
  v_from      := mc_term_start(p_mc_id);
  v_elapsed   := current_date - v_from;
  v_last_from := (v_from - interval '1 year')::date;

  return query
  select p.id,
         array(select (select count(*)::int from exchanges e
                       where e.project_id = p.id
                         and e.approved_at >  current_date - (w * 7)
                         and e.approved_at <= current_date - ((w - 1) * 7))
               from generate_series(12, 1, -1) as w),
         (select count(*)::int from exchanges e where e.project_id = p.id
            and e.approved_at >= v_last_from and e.approved_at <= v_last_from + v_elapsed),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.applied_at   >= v_from),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.accepted_at  >= v_from),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.approved_at  >= v_from),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.realized_at  >= v_from),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.completed_at >= v_from),
         (select count(*)::int from team_members tm where tm.project_id = p.id),
         (select count(*)::int from team_members tm where tm.project_id = p.id and tm.joined_at >= v_from),
         (select count(*)::int from team_members tm where tm.project_id = p.id and tm.term_end < current_date),
         (select count(*)::int from team_members tm join user_profiles up on up.id = tm.user_id
            where tm.project_id = p.id and up.last_seen_at > now() - interval '14 days'),
         (select count(*)::int + 1 from departments d where d.project_id = p.id and d.vp_user_id is not null),
         (select count(*)::int from handover_notes h
            where h.project_id = p.id and h.updated_at >= v_from and length(trim(h.body)) > 0
              and (h.department_id is null
                   or h.department_id in (select d.id from departments d where d.project_id = p.id and d.vp_user_id is not null))),
         (select count(*)::int from recruits r where r.project_id = p.id and r.applied_on >= v_from),
         (select count(*)::int from recruits r where r.project_id = p.id and r.applied_on >= v_from and r.stage = 'joined')
  from projects p
  where p.mc_id = p_mc_id
  order by p.name;
end;
$$;

revoke execute on function mc_lc_insights(uuid) from public, anon;
grant  execute on function mc_lc_insights(uuid) to authenticated;

notify pgrst, 'reload schema';
