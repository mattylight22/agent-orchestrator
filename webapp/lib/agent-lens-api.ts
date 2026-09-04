"use client";
import type { AgentLensApi, AppSettings, AppSnapshot, CreateHostInput, CreateWorkstreamInput, PaseoHost, PlanComment, PlanStatus, Repository, RoleConfig, Workstream, WorkstreamStatus } from "@agent-lens/domain";
import { createSupabaseBrowserClient } from "./supabase/client";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error ?? "Agent God Mode request failed");
  return value as T;
}

export class WebAgentLensApi implements AgentLensApi {
  async bootstrap() { return json<AppSnapshot>("/api/snapshot"); }
  async updateSettings(patch: Partial<AppSettings>) { await json("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }); return (await this.bootstrap()).settings; }
  async createHost(input: CreateHostInput) { const result = await json<{ hostId: string }>("/api/paseo/hosts/pair", { method: "POST", body: JSON.stringify({ name: input.name, pairingLink: input.endpoint }) }); return (await this.bootstrap()).hosts.find((host) => host.id === result.hostId) as PaseoHost; }
  async deleteHost() { throw new Error("Host removal is intentionally unavailable while workstreams reference it"); }
  async connectHost(hostId: string) { await json(`/api/paseo/hosts/${hostId}/refresh`, { method: "POST" }); }
  async startGithubDeviceFlow() { window.location.assign("/api/github/connect"); }
  async disconnectGithub() { await json("/api/github/disconnect", { method: "POST" }); }
  async signInSupabase(email: string, password: string) { await json("/api/auth/sign-in", { method: "POST", body: JSON.stringify({ email, password }) }); }
  async signUpSupabase(email: string, password: string) { return json<{ confirmationRequired: boolean }>("/api/auth/sign-up", { method: "POST", body: JSON.stringify({ email, password }) }); }
  async requestSupabasePasswordReset(email: string) { const { error } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/reset` }); if (error) throw error; }
  async signOutSupabase() { await json("/api/auth/sign-out", { method: "POST" }); }
  async syncSupabase() { await this.bootstrap(); }
  async refreshRepositories() { await json("/api/github/repositories", { method: "POST" }); return (await this.bootstrap()).repositories as Repository[]; }
  async refreshPaseoMappings() { const snapshot = await this.bootstrap(); await Promise.all(snapshot.hosts.map((host) => json(`/api/paseo/hosts/${host.id}/refresh`, { method: "POST" }))); }
  async createWorkstream(input: CreateWorkstreamInput) { const result = await json<{ id: string }>("/api/workstreams", { method: "POST", body: JSON.stringify(input) }); return (await this.bootstrap()).workstreams.find((item) => item.id === result.id) as Workstream; }
  async updateWorkstreamStatus(id: string, status: WorkstreamStatus) { await this.workstreamAction(id, "status", { status }); return (await this.bootstrap()).workstreams.find((item) => item.id === id) as Workstream; }
  async sendFollowup(id: string, prompt: string) { await this.workstreamAction(id, "followup", { prompt }); }
  async respondToAgentQuestion(id: string, agentId: string, requestId: string, answers: Record<string, string> | null) { await this.workstreamAction(id, "question", { agentId, requestId, answers }); }
  async updatePlanStatus(id: string, status: PlanStatus) { await this.planAction(id, "status", { status }); }
  async setPlanDependencies(id: string, dependencyIds: string[]) { await this.planAction(id, "dependencies", { dependencyIds }); }
  async addPlanComment(planId: string, quote: string, comment: string, startOffset: number, endOffset: number) { await this.planAction(planId, "add-comment", { quote, comment, startOffset, endOffset }); const snapshot = await this.bootstrap(); return snapshot.planComments.find((item) => item.planId === planId && item.quote === quote && item.comment === comment) as PlanComment; }
  async deletePlanComment(id: string) { const snapshot = await this.bootstrap(); const comment = snapshot.planComments.find((item) => item.id === id); if (comment) await this.planAction(comment.planId, "delete-comment", { commentId: id }); }
  async submitPlanComments(planId: string) { await this.planAction(planId, "submit-comments"); }
  async beginPlan(id: string) { await this.planAction(id, "begin"); }
  async markPlanReady(id: string) { const snapshot = await this.bootstrap(); const plan = snapshot.plans.find((item) => item.workstreamId === id); if (!plan) throw new Error("The planner has not produced a plan yet"); await this.updatePlanStatus(plan.id, "implementation-ready"); return (await this.bootstrap()).workstreams.find((item) => item.id === id) as Workstream; }
  async startBuild(id: string, config?: RoleConfig) { await this.workstreamAction(id, "build", { roleConfig: config }); }
  async startReviewFix(id: string) { await this.workstreamAction(id, "review-fix"); }
  async completeReview(id: string) { await this.workstreamAction(id, "complete-review"); }
  async startIndependentReview(id: string) { await this.workstreamAction(id, "independent-review"); }
  async openExternal(url: string) { const value = new URL(url); if (value.protocol !== "https:" || (value.hostname !== "github.com" && !value.hostname.endsWith(".paseo.sh"))) throw new Error("That external link is not allowed"); window.open(value, "_blank", "noopener,noreferrer"); }
  onSnapshot(handler: (snapshot: AppSnapshot) => void) { const supabase = createSupabaseBrowserClient(); const channel = supabase.channel(`agent-lens-api-${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public" }, () => void this.bootstrap().then(handler)).subscribe(); return () => { void supabase.removeChannel(channel); }; }
  onGithubVerification() { return () => undefined; }
  onToast() { return () => undefined; }
  private workstreamAction(id: string, action: string, payload: Record<string, unknown> = {}) { return json(`/api/workstreams/${id}/actions`, { method: "POST", body: JSON.stringify({ action, ...payload }) }); }
  private planAction(id: string, action: string, payload: Record<string, unknown> = {}) { return json(`/api/plans/${id}/actions`, { method: "POST", body: JSON.stringify({ action, ...payload }) }); }
}

export const agentLensApi = new WebAgentLensApi();
