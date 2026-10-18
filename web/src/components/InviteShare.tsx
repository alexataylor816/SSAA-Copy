import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * An invite to pass on: the short code people can type, and the link to copy
 * or share (text, email, any app). Opening the link lands on the join page.
 */
export default function InviteShare({ url, code, caption }: { url: string; code?: string; caption: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy(text: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this:", text);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="max-w-xs text-sm text-muted-foreground">{caption}</p>

      {code && (
        <button
          type="button"
          onClick={() => void copy(code, "code")}
          className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 font-mono text-xl font-semibold tracking-[0.2em] transition-colors hover:bg-muted"
          aria-label={`Copy code ${code}`}
        >
          {code}
          {copied === "code" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
        </button>
      )}

      <div className="grid w-full grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void copy(url, "link")}>
          {copied === "link" ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied === "link" ? "Copied" : "Copy link"}
        </Button>
        <Button
          variant="outline"
          disabled={!canShare}
          title={canShare ? undefined : "Sharing works on phones; use Copy link here"}
          onClick={() => void navigator.share({ title: "Join on SSAA", url }).catch(() => {})}
        >
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
      </div>
      <p className="break-all text-[11px] text-muted-foreground">{url}</p>
    </div>
  );
}
