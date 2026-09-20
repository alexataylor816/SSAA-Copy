import { format } from 'date-fns';
import { Calendar, Edit2, CheckCircle2, XCircle, Ban } from 'lucide-react';
import type { Message } from '@/hooks/useMessaging';
import { formatTime12 } from '@/lib/time';

const kindMeta: Record<string, { label: string; Icon: any; color: string }> = {
  system_schedule_request: { label: 'Schedule request', Icon: Calendar, color: 'text-blue-600' },
  system_schedule_edit: { label: 'Schedule edited', Icon: Edit2, color: 'text-amber-600' },
  system_schedule_confirm: { label: 'Schedule confirmed', Icon: CheckCircle2, color: 'text-green-600' },
  system_schedule_reject: { label: 'Schedule rejected', Icon: XCircle, color: 'text-red-600' },
  system_schedule_cancel: { label: 'Schedule cancelled', Icon: Ban, color: 'text-gray-600' },
  system_participant_added: { label: 'Participant added', Icon: Calendar, color: 'text-blue-600' },
};

function formatDateLabel(d: string): string {
  try {
    return format(new Date(d + 'T00:00:00'), 'MMM d, yyyy');
  } catch {
    return d;
  }
}

export default function SystemMessageCard({ message }: { message: Message }) {
  const meta = kindMeta[message.kind] || kindMeta.system_schedule_request;
  const Icon = meta.Icon;
  const m = (message.metadata || {}) as any;

  const dates: string[] = Array.isArray(m.scheduled_dates) && m.scheduled_dates.length > 0
    ? m.scheduled_dates
    : (m.scheduled_date ? [m.scheduled_date] : []);

  const startTime = m.start_time ? formatTime12(m.start_time) : '';
  const endTime = m.end_time ? formatTime12(m.end_time) : '';
  const timeRange = startTime && endTime ? `${startTime} – ${endTime}` : (startTime || endTime);

  const personnel: Array<{ name: string; job_title?: string | null; times?: string; company_name?: string | null }> =
    Array.isArray(m.personnel) ? m.personnel : [];

  const onBehalfName: string | null = m.target_sub_company_name || null;

  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] w-full border rounded-lg bg-card p-3 text-sm">
        <div className={`flex items-center gap-2 font-medium mb-1 ${meta.color}`}>
          <Icon className="h-4 w-4" />
          {meta.label}
          {onBehalfName && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · on behalf of <span className="font-medium text-foreground">{onBehalfName}</span>
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          {dates.length > 0 && (
            <div>
              <span className="font-medium">
                {dates.length === 1 ? 'Date:' : `Dates (${dates.length}):`}
              </span>{' '}
              {dates.map(formatDateLabel).join(', ')}
              {timeRange && ` · ${timeRange}`}
            </div>
          )}
          {personnel.length > 0 ? (
            <div>
              <div className="font-medium">Personnel:</div>
              <ul className="list-disc list-inside ml-1 space-y-0.5">
                {personnel.map((p, i) => (
                  <li key={i}>
                    <span className="text-foreground">{p.name}</span>
                    {p.company_name && (
                      <span className="text-muted-foreground"> — {p.company_name}</span>
                    )}
                    {p.job_title && <span> ({p.job_title})</span>}
                    {p.times && <span> — {p.times.replace(/(\d{1,2}:\d{2})\s*(AM|PM)?/g, (s) => formatTime12(s.replace(/\s*(AM|PM)/i, '')) || s)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : Array.isArray(m.employee_ids) && m.employee_ids.length > 0 ? (
            <div>
              <span className="font-medium">Personnel:</span> {m.employee_ids.length} requested
            </div>
          ) : null}

          {m.description && <div className="italic">"{m.description}"</div>}
          {m.cancellation_reason && (
            <div>
              <span className="font-medium">Reason:</span> {m.cancellation_reason}
            </div>
          )}
        </div>
        {Array.isArray(m.image_urls) && m.image_urls.length > 0 && (
          <div className="flex gap-2 mt-2">
            {m.image_urls.slice(0, 3).map((u: string) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <img src={u} alt="" className="h-16 w-16 object-cover rounded" />
              </a>
            ))}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-2">
          {format(new Date(message.created_at), 'MMM d, h:mm a')}
        </div>
      </div>
    </div>
  );
}
