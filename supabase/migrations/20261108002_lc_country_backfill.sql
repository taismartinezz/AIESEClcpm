-- Migration 065: give LCs without a country their president's.
--
-- An LC got its country when it was created with one, or when its president
-- answered the one-time country question. A president who already had a
-- country on their profile was never asked, so their LC stayed without one and
-- didn't appear in its MC's "not linked yet" list. Fill those from the
-- president's profile (the currency follows, through the trigger from
-- migration 061). Presidents can change it in Settings > LC & departments.

update projects p
set country_code = up.country_code
from team_members tm
join user_profiles up on up.id = tm.user_id
where tm.project_id = p.id
  and tm.role = 'president'
  and p.country_code is null
  and up.country_code is not null
  and not coalesce(p.is_demo, false);
