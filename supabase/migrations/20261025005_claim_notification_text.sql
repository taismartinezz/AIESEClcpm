-- Migration 058: claim notifications without an em dash.
--
-- The text of "Expense claim approved / rejected" notifications is built in the
-- database; it used an em dash ("Lunch - Reason: …"). Same function, plain
-- punctuation: "EUR 12: Lunch" and "Lunch. Reason: …".

create or replace function _expense_claim_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'approved' then
    insert into finance_entries (project_id, type, amount, currency, entry_date, category_id,
                                 department_id, description, recorded_by, receipt_path, claim_id)
    values (new.project_id, 'expense', new.amount, new.currency, new.expense_date, new.category_id,
            new.department_id, 'Expense claim: ' || new.description, new.reviewed_by, new.receipt_path, new.id)
    on conflict (claim_id) do nothing;
  elsif old.status = 'approved' then
    delete from finance_entries where claim_id = new.id;
  end if;

  if new.status in ('approved', 'rejected') then
    insert into notifications (user_id, type, title, body, related_id, link_to, read)
    values (
      new.submitted_by,
      'claim_' || new.status,
      case new.status when 'approved' then 'Expense claim approved' else 'Expense claim rejected' end,
      case new.status
        when 'approved' then new.currency || ' ' || new.amount || ': ' || new.description
        else new.description || '. Reason: ' || new.rejection_reason
      end,
      new.id, '/finance', false
    );
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
