import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { TooltipFlagsProvider } from "@/components/onboarding/TooltipFlagsProvider";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Messages from "./pages/Messages";
import Onboarding from "./pages/Onboarding";
import OnboardingReset from "./pages/OnboardingReset";
import InviteAccept from "./pages/InviteAccept";
import ForgotPassword from "./pages/ForgotPassword";
import ForgotUsername from "./pages/ForgotUsername";
import NotFound from "./pages/NotFound";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <LanguageProvider>
          <AuthProvider>
            <ImpersonationProvider>
            <TooltipFlagsProvider>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/onboarding-reset" element={<OnboardingReset />} />
                <Route path="/invite-accept" element={<InviteAccept />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/forgot-username" element={<ForgotUsername />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </TooltipFlagsProvider>
            </ImpersonationProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
