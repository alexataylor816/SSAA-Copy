import type { ReactNode } from "react";
import { Building2, Calendar, Users } from "lucide-react";
import heroImage from "@/assets/hero-construction.jpg";

const features = [
  { icon: Calendar, label: "Smart Scheduling" },
  { icon: Users, label: "Team Management" },
  { icon: Building2, label: "Project Tracking" },
];

/**
 * Split-screen shell shared by every auth page, matching the Lovable
 * `Landing` look: primary hero branding on the left, the form card on the
 * right. `Landing.tsx` keeps its own copy of the hero markup because its
 * invite banner lives there; everything else funnels through here.
 */
export default function AuthLayout({ children, inviteNote }: { children: ReactNode; inviteNote?: string }) {
  return (
    <div className="min-h-dvh flex flex-col lg:flex-row">
      {/* Phones get a slim banner (name + tagline) so the form fits on one screen. */}
      <div className="lg:w-1/2 bg-primary relative flex items-center justify-center px-6 py-5 lg:p-16">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="relative z-10 text-center lg:text-left max-w-xl">
          <h1 className="text-3xl lg:text-6xl font-bold text-primary-foreground mb-1 lg:mb-4">SSAA</h1>
          <p className="text-base lg:text-3xl font-medium text-primary-foreground/90 lg:mb-6 lg:whitespace-pre-line">
            {"Schedule Someone,\nAnytime, Anywhere"}
          </p>
          <p className="hidden lg:block text-lg text-primary-foreground/80 mb-8">
            The complete construction scheduling platform for General Contractors and Subcontractors.
          </p>

          {inviteNote && (
            <div className="bg-primary-foreground/20 border border-primary-foreground/30 rounded-lg p-3 mt-3 lg:mt-0 lg:p-4 mb-0 lg:mb-6">
              <p className="text-primary-foreground font-medium text-sm">{inviteNote}</p>
            </div>
          )}

          <div className="hidden lg:flex flex-wrap gap-4 justify-start">
            {features.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 bg-primary-foreground/10 px-4 py-2 rounded-lg">
                <Icon className="h-5 w-5 text-primary-foreground" />
                <span className="text-primary-foreground text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:w-1/2 flex flex-1 items-start justify-center px-4 py-5 sm:p-8 lg:items-center bg-background">{children}</div>
    </div>
  );
}
