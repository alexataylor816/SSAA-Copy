import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Users, Building2 } from "lucide-react";
import heroImage from "@/assets/hero-construction.jpg";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

const features = [
  { icon: Calendar, get label() { return tr("landing.smartScheduling"); } },
  { icon: Users, get label() { return tr("landing.teamManagement"); } },
  { icon: Building2, get label() { return tr("landing.projectTracking"); } },
];

export default function Landing() {
  const { t } = useLanguage();
  return (
    <div className="relative min-h-dvh flex flex-col lg:flex-row">
      <LanguageToggle tone="onPrimary" className="absolute right-3 top-3 z-20 lg:hidden" />
      <LanguageToggle className="absolute right-4 top-4 z-20 hidden lg:flex" />
      {/* Phones get a slim banner (name + tagline) so the form fits on one screen. */}
      <div className="lg:w-1/2 bg-primary relative flex items-center justify-center px-6 py-5 lg:p-16">
        <div className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url(${heroImage})` }} />
        <div className="relative z-10 text-center lg:text-left max-w-xl">
          <h1 className="text-3xl lg:text-6xl font-bold text-primary-foreground mb-1 lg:mb-4">SSAA</h1>
          <p className="text-base lg:text-3xl font-medium text-primary-foreground/90 lg:mb-6 lg:whitespace-pre-line">
            {"Schedule Someone,\nAnytime, Anywhere"}
          </p>
          <p className="hidden lg:block text-lg text-primary-foreground/80 mb-8">
            
            {t("landing.theCompleteConstructionSchedulingPlatfor")}
          </p>

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

      <div className="lg:w-1/2 flex flex-1 items-start justify-center px-4 py-5 sm:p-8 lg:items-center bg-background">
        <Card className="w-full max-w-md border-primary/20 shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold text-foreground">{t("landing.getStarted")}</CardTitle>
            <p className="text-muted-foreground text-sm mt-1">{t("landing.setUpYourCompanyThenInvite")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild className="w-full" size="lg">
              <Link to="/signup">{t("landing.createAnAccount")}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full" size="lg">
              <Link to="/signin">{t("landing.signIn")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}