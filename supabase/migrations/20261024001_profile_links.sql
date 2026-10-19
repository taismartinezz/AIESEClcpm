-- Migration 050: LinkedIn and GitHub on the profile.
--
-- The profile's Links tab offered six research-lab links (Scholar, ResearchGate,
-- ORCID…) and saved none of them. It now has just LinkedIn and GitHub, stored
-- here. Members update their own row under the existing user_profiles policy.

alter table user_profiles add column if not exists linkedin_url text;
alter table user_profiles add column if not exists github_url   text;

alter table user_profiles drop constraint if exists user_profiles_linkedin_url_https;
alter table user_profiles add constraint user_profiles_linkedin_url_https
  check (linkedin_url is null or linkedin_url ~* '^https://');
alter table user_profiles drop constraint if exists user_profiles_github_url_https;
alter table user_profiles add constraint user_profiles_github_url_https
  check (github_url is null or github_url ~* '^https://');

notify pgrst, 'reload schema';
