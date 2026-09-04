create table public.aws_accounts (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_id text,
  role_arn text,
  state text not null default 'pending' check (state in ('pending','connected','error')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  unique (user_id, role_arn)
);

-- External IDs are encrypted with the application's versioned AES-256-GCM
-- envelope. This table deliberately has no browser policies.
create table public.aws_connection_secrets (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_external_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, id) references public.aws_accounts(user_id, id) on delete cascade
);

create table public.aws_paseo_deployments (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  aws_account_id uuid not null,
  name text not null,
  region text not null check (region in ('us-east-1','us-east-2','us-west-1','us-west-2')),
  vpc_id text not null,
  subnet_id text not null,
  route_type text not null check (route_type in ('nat','public')),
  associate_public_ip boolean not null,
  instance_type text not null,
  volume_size integer not null check (volume_size between 40 and 2048),
  state text not null default 'queued' check (state in ('queued','creating','waiting-for-ssm','pairing','ready','failed','deleting','deleted')),
  stack_name text not null,
  stack_arn text,
  instance_id text,
  pair_command_id text,
  paseo_host_id text,
  failure_detail text,
  workflow_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  unique (user_id, stack_name),
  foreign key (user_id, aws_account_id) references public.aws_accounts(user_id, id) on delete restrict,
  foreign key (user_id, paseo_host_id) references public.paseo_hosts(user_id, id) on delete restrict
);

create unique index aws_paseo_deployments_one_active_name
on public.aws_paseo_deployments (user_id, aws_account_id, name)
where state <> 'deleted' and deleted_at is null;

alter table public.aws_accounts enable row level security;
alter table public.aws_connection_secrets enable row level security;
alter table public.aws_paseo_deployments enable row level security;

create policy aws_accounts_select_own on public.aws_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy aws_accounts_insert_own on public.aws_accounts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy aws_accounts_update_own on public.aws_accounts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy aws_accounts_delete_own on public.aws_accounts for delete to authenticated using ((select auth.uid()) = user_id);

create policy aws_paseo_deployments_select_own on public.aws_paseo_deployments for select to authenticated using ((select auth.uid()) = user_id);
create policy aws_paseo_deployments_insert_own on public.aws_paseo_deployments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy aws_paseo_deployments_update_own on public.aws_paseo_deployments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy aws_paseo_deployments_delete_own on public.aws_paseo_deployments for delete to authenticated using ((select auth.uid()) = user_id);

create trigger aws_accounts_set_updated_at before update on public.aws_accounts for each row execute function public.set_updated_at();
create trigger aws_connection_secrets_set_updated_at before update on public.aws_connection_secrets for each row execute function public.set_updated_at();
create trigger aws_paseo_deployments_set_updated_at before update on public.aws_paseo_deployments for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.aws_accounts;
alter publication supabase_realtime add table public.aws_paseo_deployments;
