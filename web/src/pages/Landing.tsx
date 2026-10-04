import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Users, Building2 } from "lucide-react";
import heroImage from "@/assets/hero-construction.jpg";

const features = [
  { icon: Calendar, label: "Smart scheduling across every crew and project" },
  { icon: Users, label: "Team and permission management" },
  { icon: Building2, label: "Project tracking from bid to closeout" },
];

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="lg:w-1/2 bg-primary relative flex items-center justify-center p-8 lg:p-16">
        <div className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url(${heroImage})` }} />
        <div className="relative z-10 text-center lg:text-left max-w-xl">
          <h1 className="text-4xl lg:text-6xl font-bold text-primary-foreground mb-4">SSAA</h1>
          <p className="text-2xl lg:text-3xl font-medium text-primary-foreground/90 mb-6">
            Run your construction schedule in one place.
          </p>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Coordinate general contractors and subcontractors, schedule crews without the back-and-forth, and keep
            every project on track.
          </p>

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

      <div className="lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-md border-primary/20 shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold text-foreground">Get started</CardTitle>
            <p className="text-muted-foreground text-sm mt-1">Set up your company, then invite your crews.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild className="w-full" size="lg">
              <Link to="/signup">Create an account</Link>
            </Button>
            <Button asChild variant="outline" className="w-full" size="lg">
              <Link to="/signin">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}