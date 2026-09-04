import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./components/Dashboard";
import { SettingsPage } from "./components/SettingsPage";
import { PlansPage } from "./components/PlansPage";
import { WorkstreamDetail } from "./components/WorkstreamDetail";
import { getSnapshot, setSnapshot } from "./lib/store";
import "./styles.css";

const rootRoute = createRootRoute({ component: AppShell });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => ({ repo: typeof search.repo === "string" ? search.repo : undefined }),
  component: Dashboard,
});
const workstreamRoute = createRoute({ getParentRoute: () => rootRoute, path: "/workstreams/$workstreamId", component: WorkstreamDetail });
const plansRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plans", component: PlansPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });
const routeTree = rootRoute.addChildren([dashboardRoute, workstreamRoute, plansRoute, settingsRoute]);
const router = createRouter({ routeTree, history: createHashHistory() });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

function applyAppearance(): void {
  const settings = getSnapshot()?.settings;
  if (!settings) return;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.density = settings.density;
}

function Toasts() {
  const [toasts, setToasts] = useState<Array<{ id: number; kind: "success" | "error" | "info"; message: string }>>([]);
  useEffect(() => window.lens.onToast((toast) => {
    const id = Date.now();
    setToasts((values) => [...values, { id, ...toast }]);
    window.setTimeout(() => setToasts((values) => values.filter((item) => item.id !== id)), 4500);
  }), []);
  return <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast ${toast.kind}`} key={toast.id}>{toast.kind === "success" ? <CheckCircle2 size={17} /> : toast.kind === "error" ? <AlertCircle size={17} /> : <Info size={17} />}<span>{toast.message}</span><button onClick={() => setToasts((values) => values.filter((item) => item.id !== toast.id))}><X size={14} /></button></div>)}</div>;
}

const initial = await window.lens.bootstrap();
setSnapshot(initial);
applyAppearance();
window.lens.onSnapshot((snapshot) => { setSnapshot(snapshot); applyAppearance(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /><Toasts /></QueryClientProvider></StrictMode>,
);
