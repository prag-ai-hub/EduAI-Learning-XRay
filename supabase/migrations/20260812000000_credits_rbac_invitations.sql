alter table public.users add column if not exists total_credits integer not null default 0 check (total_credits >= 0);
alter table public.users add column if not exists used_credits integer not null default 0 check (used_credits >= 0);
alter table public.users add column if not exists disabled_at timestamptz;

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  transaction_type text not null check (transaction_type in ('allocation','adjustment','consumption','refund')),
  operation_key text,
  reference text,
  reason text,
  admin_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists credit_transactions_operation_key_idx
  on public.credit_transactions(user_id, operation_key) where operation_key is not null;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  role text not null default 'Teacher' check (role in ('Teacher','Admin')),
  credits integer not null default 0 check (credits >= 0),
  school_id text references public.schools(id),
  invited_by uuid not null references auth.users(id),
  status text not null default 'Pending' check (status in ('Pending','Accepted','Expired','Revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists invitations_email_idx on public.invitations(lower(email));

create or replace function public.consume_credit(p_operation_key text, p_reference text default null, p_cost integer default 1)
returns table(total_credits integer, used_credits integer, remaining_credits integer, charged boolean)
language plpgsql security definer set search_path = public as $$
declare v_user public.users%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_cost < 1 then raise exception 'Invalid credit cost'; end if;
  select * into v_user from public.users where id = auth.uid() for update;
  if v_user.disabled_at is not null or v_user.status <> 'Active' then raise exception 'Account disabled'; end if;
  if exists(select 1 from public.credit_transactions where user_id=auth.uid() and operation_key=p_operation_key) then
    return query select v_user.total_credits, v_user.used_credits, greatest(0,v_user.total_credits-v_user.used_credits), false;
    return;
  end if;
  if v_user.total_credits-v_user.used_credits < p_cost then raise exception 'Insufficient credits'; end if;
  update public.users set used_credits=used_credits+p_cost, updated_at=now() where id=auth.uid() returning * into v_user;
  insert into public.credit_transactions(user_id,amount,transaction_type,operation_key,reference,reason)
    values(auth.uid(),-p_cost,'consumption',p_operation_key,p_reference,'Assessment analysis');
  return query select v_user.total_credits, v_user.used_credits, v_user.total_credits-v_user.used_credits, true;
end $$;

create or replace function public.refund_credit(p_operation_key text, p_reason text default 'Analysis failed')
returns void language plpgsql security definer set search_path=public as $$
declare v_amount integer;
begin
  select -amount into v_amount from public.credit_transactions
    where user_id=auth.uid() and operation_key=p_operation_key and transaction_type='consumption' for update;
  if v_amount is null or exists(select 1 from public.credit_transactions where user_id=auth.uid() and operation_key=p_operation_key||':refund') then return; end if;
  update public.users set used_credits=greatest(0,used_credits-v_amount),updated_at=now() where id=auth.uid();
  insert into public.credit_transactions(user_id,amount,transaction_type,operation_key,reason)
    values(auth.uid(),v_amount,'refund',p_operation_key||':refund',p_reason);
end $$;

grant execute on function public.consume_credit(text,text,integer) to authenticated;
grant execute on function public.refund_credit(text,text) to authenticated;

update public.users set role='Admin'
where lower(email) in ('priyadarshini.adap@eduaihub','priyadarshini.adap@eduaihub.in');
