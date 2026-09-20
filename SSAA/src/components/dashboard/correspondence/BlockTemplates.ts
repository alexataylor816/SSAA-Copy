// Pre-styled HTML snippets the "Insert block" menu drops into the editor.
// Each block is editable in place once inserted; styles match the live
// rendered email so what you see in the editor matches what recipients get.

export interface BlockTemplate {
  id: string;
  label: string;
  description: string;
  html: string;
}

const calloutBox = (title: string, bg: string, border: string, titleColor: string) => `
<div style="background: ${bg}; border: 1px solid ${border}; border-radius: 8px; padding: 16px 20px; margin: 12px 0;">
  <p style="margin: 0 0 8px 0; font-weight: 600; color: ${titleColor};">${title}</p>
  <p style="margin: 0 0 4px 0;">First bullet point</p>
  <p style="margin: 0 0 4px 0;">Second bullet point</p>
  <p style="margin: 0;">Third bullet point</p>
</div>
<p></p>
`.trim();

export const BLOCK_TEMPLATES: BlockTemplate[] = [
  {
    id: 'callout-green',
    label: 'Callout — Green',
    description: 'Recommended option box',
    html: calloutBox('Option Title (Recommended)', '#dcfce7', '#86efac', '#166534'),
  },
  {
    id: 'callout-amber',
    label: 'Callout — Amber',
    description: 'Alternative option box',
    html: calloutBox('Option Title (Quick & Free)', '#fef3c7', '#fcd34d', '#92400e'),
  },
  {
    id: 'callout-blue',
    label: 'Callout — Blue',
    description: 'Informational box',
    html: calloutBox('Heads up', '#dbeafe', '#93c5fd', '#1e40af'),
  },
  {
    id: 'callout-red',
    label: 'Callout — Red',
    description: 'Warning / important box',
    html: calloutBox('Important', '#fee2e2', '#fca5a5', '#991b1b'),
  },
  {
    id: 'callout-neutral',
    label: 'Callout — Neutral',
    description: 'Plain framed box',
    html: calloutBox('Note', '#f1f5f9', '#cbd5e1', '#334155'),
  },
  {
    id: 'cta-button',
    label: 'CTA Button',
    description: 'Centered call-to-action link button',
    html: `
<div style="text-align: center; margin: 20px 0;">
  <a href="https://example.com" style="display: inline-block; background: #1e3a5f; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600;">Get Started</a>
</div>
<p></p>
`.trim(),
  },
  {
    id: 'code-box',
    label: 'Code / Token Box',
    description: 'Framed monospaced display (e.g. for codes)',
    html: `
<div style="background: #f1f5f9; border-radius: 8px; padding: 18px 20px; margin: 16px 0; text-align: center;">
  <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;">Label for the code below</p>
  <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 22px; font-weight: 700; letter-spacing: 2px;">CODE123</p>
</div>
<p></p>
`.trim(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Thin horizontal rule',
    html: `<div style="border-top: 1px solid #e5e7eb; margin: 20px 0;"></div><p></p>`,
  },
  {
    id: 'spacer',
    label: 'Spacer',
    description: 'Vertical breathing room',
    html: `<div style="height: 24px;"></div><p></p>`,
  },
];
