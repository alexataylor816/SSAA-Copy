import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GoogleId {
  initialize(options: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, options: { theme: string; size: string; width: number }): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

/** The four-color "G", copied from the Lovable reference's Google button. */
export function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

interface Props {
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

/**
 * Google's own Identity Services button, so the Lovable "Continue with
 * Google" row has a working counterpart here. Needs `VITE_GOOGLE_CLIENT_ID`
 * (and the matching `GOOGLE_CLIENT_ID` on the backend) — without it the
 * button renders disabled with an honest caption instead of failing vaguely.
 */
export default function GoogleSignInButton({ onCredential, onError, disabled }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  // Refs, because the GIS callback fires long after the render that set it.
  const credentialRef = useRef(onCredential);
  credentialRef.current = onCredential;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!CLIENT_ID || renderedRef.current) return;

    const render = () => {
      const api = window.google?.accounts?.id;
      const slot = slotRef.current;
      if (!api || !slot) return;
      try {
        api.initialize({
          client_id: CLIENT_ID,
          callback: (response) => credentialRef.current(response.credential),
        });
        // The rendered iframe takes a fixed pixel width (200-400), so measure
        // the slot and clamp rather than guessing.
        const width = slot.clientWidth
          ? Math.min(400, Math.max(200, Math.floor(slot.clientWidth)))
          : 320;
        api.renderButton(slot, { theme: "outline", size: "large", width });
        renderedRef.current = true;
      } catch {
        setScriptFailed(true);
      }
    };

    if (window.google?.accounts?.id) {
      render();
      return;
    }
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      // Another instance already loading it; poll briefly for readiness.
      let tries = 0;
      const timer = window.setInterval(() => {
        if (window.google?.accounts?.id || ++tries > 40) {
          window.clearInterval(timer);
          if (window.google?.accounts?.id) render();
          else setScriptFailed(true);
        }
      }, 250);
      return () => window.clearInterval(timer);
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () => setScriptFailed(true);
    document.head.appendChild(script);
  }, []);

  if (!CLIENT_ID) {
    return (
      <div className="space-y-2">
        <Button variant="outline" className="w-full" disabled title="Set VITE_GOOGLE_CLIENT_ID to enable this">
          <GoogleIcon className="h-4 w-4 mr-2" />
          Continue with Google
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Google sign-in isn&apos;t configured yet — ask your admin for a client ID.
        </p>
      </div>
    );
  }

  if (scriptFailed) {
    return (
      <Button
        variant="outline"
        className="w-full"
        disabled={disabled}
        onClick={() => errorRef.current("Could not load Google sign-in. Check your connection and try again.")}
      >
        <GoogleIcon className="h-4 w-4 mr-2" />
        Continue with Google
      </Button>
    );
  }

  return <div ref={slotRef} className="flex min-h-10 items-center justify-center" />;
}
