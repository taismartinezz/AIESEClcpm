-- Migration 061: an LC's currency follows its country; a sturdier chat rule.
--
-- 1. Currency: LCs defaulted to EUR, so a US LC showed €. currency_for_country()
--    maps each AIESEC country to its currency. When an LC gets its country (on
--    creation, or later), its currency follows unless someone already chose one
--    (anything other than the old EUR / USD defaults). Existing LCs with a
--    country are fixed the same way. The president can still change it in
--    Settings > LC.
-- 2. Chat: the read/post rules turned the channel name into an LC or project id
--    (::uuid) in each branch. Postgres doesn't promise to check "is this an LC
--    channel?" first, so a DM row could make the whole read fail. CASE makes
--    the order explicit.

create or replace function currency_for_country(p_country text)
returns text
language sql
immutable
set search_path = public
as $$
  select c.cur from (values
    ('AL','ALL'),('DZ','DZD'),('AR','ARS'),('AM','AMD'),('AU','AUD'),('AT','EUR'),('AZ','AZN'),('BH','BHD'),('BD','BDT'),('BE','EUR'),
    ('BJ','XOF'),('BO','BOB'),('BA','BAM'),('BR','BRL'),('BG','EUR'),('BF','XOF'),('KH','KHR'),('CM','XAF'),('CA','CAD'),('CL','CLP'),
    ('CN','CNY'),('CO','COP'),('CR','CRC'),('CI','XOF'),('HR','EUR'),('CZ','CZK'),('DK','DKK'),('DO','DOP'),('EC','USD'),('EG','EGP'),
    ('SV','USD'),('EE','EUR'),('ET','ETB'),('FI','EUR'),('FR','EUR'),('GE','GEL'),('DE','EUR'),('GH','GHS'),('GR','EUR'),('GT','GTQ'),
    ('HK','HKD'),('HU','HUF'),('IS','ISK'),('IN','INR'),('ID','IDR'),('IT','EUR'),('JP','JPY'),('JO','JOD'),('KZ','KZT'),('KE','KES'),
    ('KW','KWD'),('KG','KGS'),('LV','EUR'),('LB','LBP'),('LR','LRD'),('LT','EUR'),('MY','MYR'),('MX','MXN'),('MD','MDL'),('MN','MNT'),
    ('ME','EUR'),('MA','MAD'),('MZ','MZN'),('MM','MMK'),('NP','NPR'),('NL','EUR'),('NZ','NZD'),('NI','NIO'),('NG','NGN'),('MK','MKD'),
    ('NO','NOK'),('PK','PKR'),('PA','USD'),('PY','PYG'),('PE','PEN'),('PH','PHP'),('PL','PLN'),('PT','EUR'),('RO','RON'),('RU','RUB'),
    ('RW','RWF'),('SN','XOF'),('RS','RSD'),('SG','SGD'),('SK','EUR'),('ZA','ZAR'),('KR','KRW'),('ES','EUR'),('LK','LKR'),('SE','SEK'),
    ('CH','CHF'),('TW','TWD'),('TZ','TZS'),('TH','THB'),('TG','XOF'),('TN','TND'),('TR','TRY'),('UG','UGX'),('UA','UAH'),('AE','AED'),
    ('GB','GBP'),('US','USD'),('VE','VES'),('VN','VND')
  ) as c(code, cur)
  where c.code = upper(p_country);
$$;

create or replace function _projects_currency_from_country()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cur text := currency_for_country(new.country_code);
begin
  if v_cur is not null
     and (tg_op = 'INSERT' or old.country_code is distinct from new.country_code)
     and coalesce(new.currency, 'EUR') in ('EUR', 'USD') then
    new.currency := v_cur;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_currency_from_country on projects;
create trigger trg_projects_currency_from_country
  before insert or update of country_code on projects
  for each row execute function _projects_currency_from_country();

update projects
   set currency = currency_for_country(country_code)
 where country_code is not null
   and currency in ('EUR', 'USD')
   and currency_for_country(country_code) is not null
   and currency <> currency_for_country(country_code);

-- ── Chat rules with an explicit order ────────────────────────────────────────

drop policy if exists "chat_messages_member_select" on chat_messages;
create policy "chat_messages_member_select"
  on chat_messages for select to authenticated
  using (
    case
      when channel like 'lab:%'     then auth_is_project_member(_try_uuid(substr(channel, 5)))
      when channel like 'dm:%'      then auth.uid()::text = any(string_to_array(substr(channel, 4), ':'))
      when channel like 'project:%' then auth_uid_is_sub_project_member(_try_uuid(substr(channel, 9)))
      else false
    end
  );

drop policy if exists "chat_messages_member_insert" on chat_messages;
create policy "chat_messages_member_insert"
  on chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and case
      when channel like 'lab:%'     then auth_is_project_member(_try_uuid(substr(channel, 5)))
      when channel like 'dm:%'      then auth.uid()::text = any(string_to_array(substr(channel, 4), ':'))
      when channel like 'project:%' then auth_uid_is_sub_project_member(_try_uuid(substr(channel, 9)))
      else false
    end
  );

notify pgrst, 'reload schema';
