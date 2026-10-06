import { useMemo } from 'react';

interface Props {
  html: string;
  subject?: string;
  placeholders: string[];
  channel: 'email' | 'sms';
}

// Friendly sample values used to fill placeholders in the live preview only.
const SAMPLE_VALUES: Record<string, string> = {
  employee_name: 'Jane Doe',
  sub_company: 'Acme Subcontractors',
  gc_company: 'BuildRight GC',
  project_name: 'Riverside Tower',
  recipient_name: 'Sam Taylor',
  sender_name: 'Alex Morgan',
  user_name: 'Sam Taylor',
  company_name: 'BuildRight GC',
  date: 'Mon, Jan 15',
  time: '7:00 AM',
  start_time: '7:00 AM',
  end_time: '3:30 PM',
  trade: 'Electrical',
  count: '4',
  url: 'https://ssaainc.com',
  link: 'https://ssaainc.com',
  code: '123456',
  password: 'TempPass123',
  email: 'user@example.com',
};

function fillPlaceholders(text: string, placeholders: string[]): string {
  let out = text;
  for (const name of placeholders) {
    const re = new RegExp(`\\{${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
    out = out.replace(re, SAMPLE_VALUES[name] ?? `[${name}]`);
  }
  // Catch any remaining unknown placeholders.
  return out.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_m, n) => SAMPLE_VALUES[n] ?? `[${n}]`);
}

const TemplatePreview = ({ html, subject, placeholders, channel }: Props) => {
  const filledSubject = useMemo(
    () => (subject ? fillPlaceholders(subject, placeholders) : ''),
    [subject, placeholders]
  );
  const filledBody = useMemo(
    () => fillPlaceholders(html || '', placeholders),
    [html, placeholders]
  );

  if (channel === 'sms') {
    return (
      <div className="rounded-md border border-input bg-muted/20 p-4">
        <div className="text-xs font-medium text-muted-foreground mb-2">Live preview</div>
        <div className="rounded-2xl bg-primary/10 px-4 py-3 text-sm whitespace-pre-wrap max-w-md">
          {filledBody || <span className="text-muted-foreground italic">Empty message</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-input bg-muted/20">
      <div className="border-b px-4 py-2 text-xs">
        <div className="text-muted-foreground">Recipient preview (placeholders filled with sample values)</div>
        {filledSubject && <div className="font-medium mt-1">Subject: {filledSubject}</div>}
      </div>
      <div className="bg-white text-black p-5 rounded-b-md max-h-[360px] overflow-y-auto">
        <div
          // Preview only — values come from a sanitized whitelist of sample
          // strings combined with the operator's own template HTML.
          dangerouslySetInnerHTML={{ __html: filledBody || '<p style="color:#888;font-style:italic;">Empty email</p>' }}
        />
      </div>
    </div>
  );
};

export default TemplatePreview;
