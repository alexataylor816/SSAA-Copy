import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";

// Route-level code splitting: each page (and its heavy deps like the matrix
// drag-and-drop kit) loads on demand instead of bloating the initial bundle.
const Landing = lazy(() => import("@/pages/Landing"));
const SignIn = lazy(() => import("@/pages/SignIn"));
const SignUp = lazy(() => import("@/pages/SignUp"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const ForgotUsername = lazy(() => import("@/pages/ForgotUsername"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const ProjectSchedule = lazy(() => import("@/pages/ProjectSchedule"));
const ResourceMatrix = lazy(() => import("@/pages/ResourceMatrix"));
const CompanySettings = lazy(() => import("@/pages/CompanySettings"));
const Messages = lazy(() => import("@/pages/Messages"));
const Admin = lazy(() => import("@/pages/Admin"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("@/pages/TermsOfService"));
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
      <Suspense fallback={<FullPageSpinner />}>
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
          path="/onboarding"
          element={
            <Protected>
              <Onboarding />
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
        <Route
          path="/messages"
          element={
            <Protected>
              <Messages />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected>
              <Admin />
            </Protected>
          }
        />

        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}