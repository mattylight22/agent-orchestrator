import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("normalized orchestration schema", () => {
  const migration = readFileSync(fileURLToPath(new URL("../supabase/migrations/20260902000000_orchestration_schema.sql", import.meta.url)), "utf8");

  it("creates every normalized account table and removes the generic record store", () => {
    for (const table of ["user_settings", "repositories", "paseo_hosts", "host_repository_mappings", "workstreams", "provisioning_checkpoints", "agent_runs", "timeline_items", "agent_questions", "plans", "plan_dependencies", "plan_comments", "review_iterations", "audit_events", "workflow_runs", "github_connections", "paseo_connections"]) {
      expect(migration).toContain(`create table public.${table}`);
    }
    expect(migration).toContain("drop table if exists public.agm_sync_records cascade");
  });

  it("enables RLS while leaving connection-secret tables without browser policies", () => {
    expect(migration).toContain("alter table public.%I enable row level security");
    const policyBlock = migration.slice(migration.indexOf("-- Account data"), migration.indexOf("do $$", migration.indexOf("-- Account data") + 20));
    expect(policyBlock).not.toContain("github_connections");
    expect(policyBlock).not.toContain("paseo_connections");
  });

  it("uses account-composite keys for shared GitHub and orchestration identifiers", () => {
    expect(migration.match(/primary key \(user_id, id\)/g)?.length).toBeGreaterThanOrEqual(12);
    expect(migration).toContain("foreign key (user_id, repository_id) references public.repositories(user_id, id)");
    expect(migration).toContain("foreign key (user_id, workstream_id) references public.workstreams(user_id, id)");
  });

  it("supports relay and direct Tailscale connections without exposing secret rows", () => {
    expect(migration).toContain("preferred_transport text not null default 'relay'");
    expect(migration).toContain("transport in ('relay','tailscale')");
    expect(migration).toContain("unique (user_id, host_id, transport)");
  });
});

describe("desktop mutation outbox", () => {
  it("coalesces local settings mutations behind an idempotency key", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/main/database.ts", import.meta.url)), "utf8");
    expect(source).toContain("CREATE TABLE IF NOT EXISTS mutation_outbox");
    expect(source).toContain("PRIMARY KEY (entity_type, entity_id)");
    expect(source).toContain("settings:app:");
    expect(source).toContain("clearMutationOutbox()");
    expect(source).toContain("ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation");
    expect(source).toContain("DROP TRIGGER IF EXISTS hosts_mutation_outbox_update");
    expect(source).not.toContain("INSERT OR REPLACE INTO mutation_outbox");
  });
});
