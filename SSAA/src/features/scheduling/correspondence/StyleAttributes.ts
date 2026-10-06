// Safe inline-style allowlist used by editor nodes so styled HTML
// (callout boxes, buttons, code frames) round-trips through TipTap without
// losing its visual formatting.

const ALLOWED_STYLE_PROPS = new Set([
  'background', 'background-color',
  'color',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-width', 'border-style', 'border-radius',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-transform',
  'display', 'width', 'max-width', 'min-width', 'height',
  'box-shadow', 'opacity',
  'white-space', 'word-break',
]);

export function sanitizeStyle(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(decl => {
      const idx = decl.indexOf(':');
      if (idx === -1) return '';
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return '';
      // Reject anything that looks like javascript: or expression()
      if (/javascript:|expression\s*\(|url\s*\(\s*['"]?javascript:/i.test(val)) return '';
      return `${prop}: ${val}`;
    })
    .filter(Boolean)
    .join('; ');
}

export const styleAttribute = {
  default: null as string | null,
  parseHTML: (el: HTMLElement) => sanitizeStyle(el.getAttribute('style')) || null,
  renderHTML: (attrs: Record<string, any>) => {
    if (!attrs.style) return {};
    return { style: attrs.style };
  },
};

export const alignAttribute = {
  default: null as string | null,
  parseHTML: (el: HTMLElement) => el.getAttribute('align'),
  renderHTML: (attrs: Record<string, any>) => (attrs.align ? { align: attrs.align } : {}),
};
