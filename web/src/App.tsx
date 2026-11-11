import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api/client";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { FlowsList } from "./pages/FlowsList";
import { FlowRuns } from "./pages/FlowRuns";

// Páginas pesadas em chunks separados — só baixam quando abertas.
// FlowEditor puxa @xyflow/react; WhatsApp puxa o inbox inteiro; Settings o
// painel de IA. Mantê-las fora do bundle inicial acelera o primeiro carregamento.
const FlowEditor = lazy(() =>
  import("./pages/FlowEditor").then((m) => ({ default: m.FlowEditor }))
);
const WhatsApp = lazy(() => import("./pages/WhatsApp").then((m) => ({ default: m.WhatsApp })));
const Funnel = lazy(() => import("./pages/Funnel").then((m) => ({ default: m.Funnel })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const MediaLibrary = lazy(() =>
  import("./pages/MediaLibrary").then((m) => ({ default: m.MediaLibrary }))
);
const Contacts = lazy(() => import("./pages/Contacts").then((m) => ({ default: m.Contacts })));

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-brand-400" />
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();
  const [checked, setChecked] = useState(!token);

  useEffect(() => {
    if (!token) return;
    api<{ email: string }>("/api/auth/me")
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [token]);

  if (!token) return <Navigate to="/login" replace />;
  if (!checked) return null;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/flows/:id/edit"
            element={
              <PrivateRoute>
                <FlowEditor />
              </PrivateRoute>
            }
          />
          <Route
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/flows" element={<FlowsList />} />
            <Route path="/flows/:id/runs" element={<FlowRuns />} />
            <Route path="/runs" element={<FlowRuns />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
            <Route path="/funil" element={<Funnel />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/media" element={<MediaLibrary />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
