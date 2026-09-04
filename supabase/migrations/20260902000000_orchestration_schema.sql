-- Agent Lens uses a dedicated Supabase project, so tables have domain names rather
-- than product-name prefixes. This migration intentionally discards the unused
-- obsolete generic sync record store.
drop table if exists public.agm_sync_records cascade;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.repositories (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  github_id text not null,
  full_name text not null,
  owner text not null,
  name text not null,
  description text,
  default_branch text not null,
  is_private boolean not null default false,
  html_url text not null,
  github_updated_at timestamptz not null,
  installations jsonb not null default '[]'::jsonb,
  source_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  unique (user_id, github_id),
  unique (user_id, full_name)
);

create table public.paseo_hosts (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  daemon_id text,
  endpoint text not null default '',
  enabled boolean not null default true,
  daemon_version text,
  preferred_transport text not null default 'relay' check (preferred_transport in ('relay','tailscale')),
  provider_catalog jsonb not null default '[]'::jsonb,
  source_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  unique (user_id, daemon_id)
);

create table public.host_repository_mappings (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  host_id text not null,
  repository_id text not null,
  project_id text not null,
  project_root_path text not null,
  remote_url text,
  validated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, host_id, repository_id),
  foreign key (user_id, host_id) references public.paseo_hosts(user_id, id) on delete cascade,
  foreign key (user_id, repository_id) references public.repositories(user_id, id) on delete cascade
);

create table public.workstreams (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brief text not null,
  repository_id text not null,
  repository_full_name text not null,
  repository_url text not null,
  host_id text not null,
  branch_name text not null,
  base_branch text not null,
  base_sha text,
  workspace_id text,
  status text not null check (status in ('draft','ready-to-build','unreviewed','reviewed','merged')),
  phase text not null check (phase in ('provisioning','planning','ready','building','review-fix','pr-open','independent-review','complete','attention')),
  agent_state text not null check (agent_state in ('queued','running','idle','attention','failed','stopped')),
  accepted_plan text,
  pr_number integer,
  pr_url text,
  pr_checks text not null default 'none' check (pr_checks in ('none','pending','success','failure')),
  review_iteration integer not null default 0,
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  unique (user_id, repository_id, branch_name),
  foreign key (user_id, repository_id) references public.repositories(user_id, id) on delete restrict,
  foreign key (user_id, host_id) references public.paseo_hosts(user_id, id) on delete restrict
);

create table public.provisioning_checkpoints (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  checkpoint text not null,
  state text not null check (state in ('pending','running','complete','failed')),
  detail text,
  attempt integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, workstream_id, checkpoint),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.agent_runs (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  role text not null check (role in ('planner','builder','reviewer')),
  paseo_agent_id text,
  provider text not null,
  model text not null,
  state text not null check (state in ('queued','running','idle','attention','failed','stopped')),
  summary text,
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, paseo_agent_id),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.timeline_items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  role text not null check (role in ('user','assistant','system','tool')),
  kind text not null check (kind in ('message','status','tool','finding','question')),
  content text not null,
  agent_role text check (agent_role is null or agent_role in ('planner','builder','reviewer')),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.agent_questions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  agent_id text not null,
  request_id text not null,
  status text not null check (status in ('pending','answered','dismissed')),
  prompts jsonb not null,
  answers jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, agent_id, request_id),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.plans (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  title text not null,
  body text not null,
  status text not null check (status in ('product-feature','implementation-ready','cancelled')),
  execution_state text not null default 'staged' check (execution_state in ('staged','blocked','eligible','in-progress','completed','cancelled')),
  source_agent_id text,
  source_permission_id text,
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  unique (user_id, workstream_id),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.plan_dependencies (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  depends_on_plan_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, plan_id, depends_on_plan_id),
  check (plan_id <> depends_on_plan_id),
  foreign key (user_id, plan_id) references public.plans(user_id, id) on delete cascade,
  foreign key (user_id, depends_on_plan_id) references public.plans(user_id, id) on delete cascade
);

create or replace function public.reject_plan_dependency_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive dependency_path(plan_id) as (
      select new.depends_on_plan_id
      union
      select d.depends_on_plan_id
      from public.plan_dependencies d
      join dependency_path p on d.plan_id = p.plan_id
      where d.user_id = new.user_id
    )
    select 1 from dependency_path where plan_id = new.plan_id
  ) then
    raise exception 'Plan dependency cycle';
  end if;
  return new;
end;
$$;
create trigger plan_dependencies_reject_cycle
before insert or update on public.plan_dependencies
for each row execute function public.reject_plan_dependency_cycle();

create table public.plan_comments (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  quote text not null,
  comment text not null,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, plan_id) references public.plans(user_id, id) on delete cascade
);

create table public.review_iterations (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  iteration integer not null check (iteration between 1 and 3),
  verdict text not null check (verdict in ('clean','findings','blocked')),
  findings jsonb not null default '[]'::jsonb,
  fix_summary text,
  tests text,
  commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, workstream_id, iteration),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.audit_events (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  event_type text not null,
  title text not null,
  detail text,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);

create table public.workflow_runs (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id text not null,
  phase text not null,
  workflow_run_id text,
  state text not null check (state in ('queued','running','waiting','complete','failed','cancelled')),
  attempt integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, workstream_id) references public.workstreams(user_id, id) on delete cascade
);
create unique index workflow_runs_one_active_phase
on public.workflow_runs (user_id, workstream_id, phase)
where state in ('queued','running','waiting');

-- These two tables are intentionally server-only. Ciphertext uses a versioned
-- AES-256-GCM envelope; no authenticated/anon policies are created.
create table public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login text not null,
  encrypted_credentials text not null,
  installations jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.paseo_connections (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  host_id text not null,
  transport text not null check (transport in ('relay','tailscale')),
  encrypted_credentials text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, host_id, transport),
  foreign key (user_id, host_id) references public.paseo_hosts(user_id, id) on delete cascade
);

create index repositories_owner_activity on public.repositories (user_id, github_updated_at desc) where deleted_at is null;
create index workstreams_user_created on public.workstreams (user_id, created_at desc) where deleted_at is null;
create index workstreams_repository on public.workstreams (user_id, repository_id, created_at desc) where deleted_at is null;
create index timeline_workstream_created on public.timeline_items (workstream_id, created_at);
create index plans_user_updated on public.plans (user_id, updated_at desc) where deleted_at is null;
create index audit_workstream_created on public.audit_events (workstream_id, created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings','repositories','paseo_hosts','host_repository_mappings','workstreams',
    'provisioning_checkpoints','agent_runs','timeline_items','agent_questions','plans',
    'plan_dependencies','plan_comments','review_iterations','audit_events','workflow_runs',
    'github_connections','paseo_connections'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- Account data is readable and writable only by its owner.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings','repositories','paseo_hosts','host_repository_mappings','workstreams',
    'provisioning_checkpoints','agent_runs','timeline_items','agent_questions','plans',
    'plan_dependencies','plan_comments','review_iterations','audit_events','workflow_runs'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings','repositories','paseo_hosts','host_repository_mappings','workstreams',
    'provisioning_checkpoints','agent_runs','timeline_items','agent_questions','plans',
    'plan_comments','review_iterations','workflow_runs','github_connections','paseo_connections'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_set_updated_at', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings','repositories','paseo_hosts','host_repository_mappings','workstreams',
    'provisioning_checkpoints','agent_runs','timeline_items','agent_questions','plans',
    'plan_dependencies','plan_comments','review_iterations','audit_events','workflow_runs'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
