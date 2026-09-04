import { contextBridge, ipcRenderer } from "electron";
import type { AgentLensApi, AppSnapshot } from "../shared/contracts.js";

const api: AgentLensApi = {
  bootstrap: () => ipcRenderer.invoke("lens:bootstrap"),
  updateSettings: (patch) => ipcRenderer.invoke("lens:settings:update", patch),
  createHost: (input) => ipcRenderer.invoke("lens:host:create", input),
  deleteHost: (hostId) => ipcRenderer.invoke("lens:host:delete", hostId),
  connectHost: (hostId) => ipcRenderer.invoke("lens:host:connect", hostId),
  startGithubDeviceFlow: (clientId) => ipcRenderer.invoke("lens:github:device", clientId),
  disconnectGithub: () => ipcRenderer.invoke("lens:github:disconnect"),
  signInSupabase: (email, password) => ipcRenderer.invoke("lens:supabase:sign-in", email, password),
  signUpSupabase: (email, password) => ipcRenderer.invoke("lens:supabase:sign-up", email, password),
  requestSupabasePasswordReset: (email) => ipcRenderer.invoke("lens:supabase:password-reset", email),
  signOutSupabase: () => ipcRenderer.invoke("lens:supabase:sign-out"),
  syncSupabase: () => ipcRenderer.invoke("lens:supabase:sync"),
  refreshRepositories: () => ipcRenderer.invoke("lens:github:refresh"),
  refreshPaseoMappings: () => ipcRenderer.invoke("lens:paseo:refresh-mappings"),
  createWorkstream: (input) => ipcRenderer.invoke("lens:workstream:create", input),
  updateWorkstreamStatus: (id, status) => ipcRenderer.invoke("lens:workstream:status", id, status),
  sendFollowup: (id, prompt) => ipcRenderer.invoke("lens:workstream:followup", id, prompt),
  respondToAgentQuestion: (id, agentId, requestId, answers) => ipcRenderer.invoke("lens:workstream:question", id, agentId, requestId, answers),
  updatePlanStatus: (id, status) => ipcRenderer.invoke("lens:plan:status", id, status),
  setPlanDependencies: (id, dependencyIds) => ipcRenderer.invoke("lens:plan:dependencies", id, dependencyIds),
  addPlanComment: (planId, quote, comment, startOffset, endOffset) => ipcRenderer.invoke("lens:plan-comment:add", planId, quote, comment, startOffset, endOffset),
  deletePlanComment: (id) => ipcRenderer.invoke("lens:plan-comment:delete", id),
  submitPlanComments: (planId) => ipcRenderer.invoke("lens:plan-comment:submit", planId),
  beginPlan: (id) => ipcRenderer.invoke("lens:plan:begin", id),
  markPlanReady: (id) => ipcRenderer.invoke("lens:workstream:plan-ready", id),
  startBuild: (id, config) => ipcRenderer.invoke("lens:workstream:build", id, config),
  startReviewFix: (id) => ipcRenderer.invoke("lens:workstream:review-fix", id),
  completeReview: (id) => ipcRenderer.invoke("lens:workstream:complete-review", id),
  startIndependentReview: (id) => ipcRenderer.invoke("lens:workstream:independent-review", id),
  openExternal: (url) => ipcRenderer.invoke("lens:external", url),
  onSnapshot(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: AppSnapshot) => handler(value);
    ipcRenderer.on("lens:snapshot", listener);
    return () => ipcRenderer.removeListener("lens:snapshot", listener);
  },
  onGithubVerification(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: { verificationUri: string; userCode: string }) => handler(value);
    ipcRenderer.on("lens:github-verification", listener);
    return () => ipcRenderer.removeListener("lens:github-verification", listener);
  },
  onToast(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: { kind: "success" | "error" | "info"; message: string }) => handler(value);
    ipcRenderer.on("lens:toast", listener);
    return () => ipcRenderer.removeListener("lens:toast", listener);
  },
};

contextBridge.exposeInMainWorld("lens", api);
