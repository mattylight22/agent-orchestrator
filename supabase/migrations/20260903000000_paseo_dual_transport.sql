-- Allow one logical Paseo host to retain both an encrypted relay capability and
-- an encrypted direct Tailscale endpoint. Existing relay hosts remain preferred.
alter table public.paseo_hosts
  add column if not exists preferred_transport text not null default 'relay';

alter table public.paseo_hosts
  drop constraint if exists paseo_hosts_preferred_transport_check;
alter table public.paseo_hosts
  add constraint paseo_hosts_preferred_transport_check
  check (preferred_transport in ('relay','tailscale'));

alter table public.paseo_connections
  drop constraint if exists paseo_connections_transport_check;
alter table public.paseo_connections
  add constraint paseo_connections_transport_check
  check (transport in ('relay','tailscale'));
