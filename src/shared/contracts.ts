export * from "../../packages/domain/src/index.js";
import type { AgentLensApi } from "../../packages/domain/src/index.js";

declare global {
  interface Window {
    lens: AgentLensApi;
  }
}
