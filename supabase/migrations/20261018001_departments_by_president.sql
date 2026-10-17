-- Migration 038: New LCs start without departments; the president creates them.
--
-- Until now every new LC was given the eight AIESEC departments automatically.
-- LCs organise their committees differently (oGX, oGT, oGV, …), so the
-- president now creates them in Settings → Departments, where the usual AIESEC
-- departments are offered as one-click suggestions. Existing LCs keep the
-- departments they already have.
--
-- seed_default_departments() stays (not callable through the API) for scripts
-- that want the classic setup.

drop trigger if exists trg_seed_lc_departments on projects;
drop function if exists _seed_lc_departments();

notify pgrst, 'reload schema';
