-- Clerk is the web authentication authority. Existing account data keeps its
-- internal UUID owner so switching identity providers does not orphan records.
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index app_users_email_unique
on public.app_users (lower(email))
where email is not null;

insert into public.app_users (id, email)
select id, lower(email)
from auth.users
on conflict (id) do nothing;

alter table public.app_users enable row level security;
revoke all on table public.app_users from anon, authenticated;

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

-- Resolve the private application owner UUID from the verified Clerk subject.
-- The identity table itself remains inaccessible through the browser API.
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.app_users
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;

-- Replace direct auth.users ownership with the provider-neutral app identity.
do $$
declare
  relation_name text;
  constraint_name text;
begin
  foreach relation_name in array array[
    'user_settings','repositories','paseo_hosts','host_repository_mappings','workstreams',
    'provisioning_checkpoints','agent_runs','timeline_items','agent_questions','plans',
    'plan_dependencies','plan_comments','review_iterations','audit_events','workflow_runs',
    'github_connections','paseo_connections','aws_accounts','aws_connection_secrets',
    'aws_paseo_deployments'
  ] loop
    select con.conname into constraint_name
    from pg_constraint con
    where con.conrelid = format('public.%I', relation_name)::regclass
      and con.confrelid = 'auth.users'::regclass
      and con.contype = 'f'
    limit 1;

    if constraint_name is not null then
      execute format('alter table public.%I drop constraint %I', relation_name, constraint_name);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references public.app_users(id) on delete cascade not valid',
      relation_name,
      relation_name || '_app_user_fkey'
    );
    execute format(
      'alter table public.%I validate constraint %I',
      relation_name,
      relation_name || '_app_user_fkey'
    );
  end loop;
end $$;

-- Clerk subjects are strings, so policies resolve them through app_users rather
-- than using auth.uid(), which only supports UUID subjects.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings','repositories','paseo_hosts','host_repository_mappings','workstreams',
    'provisioning_checkpoints','agent_runs','timeline_items','agent_questions','plans',
    'plan_dependencies','plan_comments','review_iterations','audit_events','workflow_runs',
    'aws_accounts','aws_paseo_deployments'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);

    execute format('create policy %I on public.%I for select to authenticated using ((select public.current_app_user_id()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.current_app_user_id()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.current_app_user_id()) = user_id) with check ((select public.current_app_user_id()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.current_app_user_id()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end $$;
