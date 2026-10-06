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
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="lg:w-1/2 bg-primary relative flex items-center justify-center p-8 lg:p-16">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="relative z-10 text-center lg:text-left max-w-xl">
          <h1 className="text-4xl lg:text-6xl font-bold text-primary-foreground mb-4">SSAA</h1>
          <p className="text-2xl lg:text-3xl font-medium text-primary-foreground/90 mb-6 whitespace-pre-line">
            {"Schedule Someone,\nAnytime, Anywhere"}
          </p>
          <p className="text-lg text-primary-foreground/80 mb-8">
            The complete construction scheduling platform for General Contractors and Subcontractors.
          </p>

          {inviteNote && (
            <div className="bg-primary-foreground/20 border border-primary-foreground/30 rounded-lg p-4 mb-6">
              <p className="text-primary-foreground font-medium text-sm">{inviteNote}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-4 justify-center lg:justify-start">
            {features.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 bg-primary-foreground/10 px-4 py-2 rounded-lg">
                <Icon className="h-5 w-5 text-primary-foreground" />
                <span className="text-primary-foreground text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:w-1/2 flex items-center justify-center p-8 bg-background">{children}</div>
    </div>
  );
}
