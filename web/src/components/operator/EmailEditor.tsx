import { useEffect, useRef, useState } from "react";
import { Bold, Code2, Heading2, Italic, Link2, List, ListOrdered, Pilcrow, Plus, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Correspondence email editor (Lovable used TipTap). Visual mode edits the email as it will look,
 * with a small toolbar and placeholder chips that insert `{name}` at the cursor; HTML mode shows the
 * source for anything the toolbar doesn't cover. No extra packages: the browser's own editing commands.
 */
export default function EmailEditor({
  value,
  onChange,
  placeholders,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholders: string[];
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const box = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  // The last HTML this editor produced, so outside changes (a different template) re-render it but our
  // own typing doesn't reset the cursor.
  const ours = useRef<string | null>(null);

  useEffect(() => {
    if (mode === "visual" && box.current && value !== ours.current) {
      box.current.innerHTML = value;
      ours.current = value;
    }
  }, [value, mode]);

  const sync = () => {
    if (!box.current) return;
    ours.current = box.current.innerHTML;
    onChange(box.current.innerHTML);
  };

  const command = (name: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(name, false, arg);
    sync();
  };

  const insert = (token: string) => {
    if (mode === "html") {
      const el = source.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + token + value.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    command("insertText", token);
  };

  const tool = (label: string, icon: typeof Bold, onClick: () => void) => {
    const Icon = icon;
    return (
      <Button
        key={label}
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={label}
        title={label}
        disabled={mode === "html"}
        // Keep the selection in the editor when clicking a toolbar button.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        <Icon className="h-4 w-4" />
      </Button>
    );
  };

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/10 px-1 py-1">
        {tool("Bold", Bold, () => command("bold"))}
        {tool("Italic", Italic, () => command("italic"))}
        {tool("Underline", Underline, () => command("underline"))}
        <span className="mx-1 h-5 w-px bg-border" />
        {tool("Heading", Heading2, () => command("formatBlock", "h2"))}
        {tool("Paragraph", Pilcrow, () => command("formatBlock", "p"))}
        {tool("Bulleted list", List, () => command("insertUnorderedList"))}
        {tool("Numbered list", ListOrdered, () => command("insertOrderedList"))}
        {tool("Link", Link2, () => {
          const url = window.prompt("Link address (https://…)");
          if (url) command("createLink", url);
        })}
        <div className="ml-auto flex items-center">
          <Button
            type="button"
            variant={mode === "html" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              if (mode === "visual") sync();
              ours.current = null;
              setMode(mode === "visual" ? "html" : "visual");
            }}
          >
            <Code2 className="h-4 w-4" />
            {mode === "html" ? "Visual" : "HTML"}
          </Button>
        </div>
      </div>

      {placeholders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-2">
          <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Plus className="h-3 w-3" />
            Insert:
          </span>
          {placeholders.map((p) => (
            <button
              key={p}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(`{${p}}`)}
              className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/10"
            >
              {`{${p}}`}
            </button>
          ))}
        </div>
      )}

      {mode === "visual" ? (
        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          onInput={sync}
          onBlur={sync}
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          className="min-h-[180px] max-h-[360px] overflow-y-auto bg-white px-4 py-3 text-sm text-neutral-900 outline-none [&_a]:text-blue-700 [&_a]:underline [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
        />
      ) : (
        <textarea
          ref={source}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={12}
          spellCheck={false}
          aria-label="Email HTML"
          className="block w-full resize-y bg-background px-3 py-2 font-mono text-xs outline-none"
        />
      )}
    </div>
  );
}
