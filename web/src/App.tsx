import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api/client";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { FlowsList } from "./pages/FlowsList";
import { FlowEditor } from "./pages/FlowEditor";
import { FlowRuns } from "./pages/FlowRuns";
import { Settings } from "./pages/Settings";
import { WhatsApp } from "./pages/WhatsApp";
import { MediaLibrary } from "./pages/MediaLibrary";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
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
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/media" element={<MediaLibrary />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
