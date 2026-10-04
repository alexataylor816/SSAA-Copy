import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import Landing from "@/pages/Landing";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import ForgotUsername from "@/pages/ForgotUsername";
import Dashboard from "@/pages/Dashboard";
import ProjectSchedule from "@/pages/ProjectSchedule";
import ResourceMatrix from "@/pages/ResourceMatrix";
import CompanySettings from "@/pages/CompanySettings";
import { Loader2 } from "lucide-react";

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Signed-in users skip the marketing and auth pages. */
function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  if (initializing) return <FullPageSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Everything past this point needs an account. */
function Protected({ children }: { children: React.ReactNode }) {
  const { user, initializing, loading } = useAuth();
  if (initializing || loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <PublicOnly>
              <Landing />
            </PublicOnly>
          }
        />
        <Route
          path="/signin"
          element={
            <PublicOnly>
              <SignIn />
            </PublicOnly>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicOnly>
              <SignUp />
            </PublicOnly>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnly>
              <ForgotPassword />
            </PublicOnly>
          }
        />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/forgot-username"
          element={
            <PublicOnly>
              <ForgotUsername />
            </PublicOnly>
          }
        />

        <Route
          path="/dashboard"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/projects/:projectId/schedule"
          element={
            <Protected>
              <ProjectSchedule />
            </Protected>
          }
        />
        <Route
          path="/matrix"
          element={
            <Protected>
              <ResourceMatrix />
            </Protected>
          }
        />
        <Route
          path="/settings/company"
          element={
            <Protected>
              <CompanySettings />
            </Protected>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}