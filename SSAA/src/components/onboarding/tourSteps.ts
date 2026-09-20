import type { TooltipKey } from './TooltipFlagsProvider';

export type TourRole = 'gc' | 'guest' | 'sub' | 'mainsub';

/**
 * Single source of truth for guided-tour step copy. The spotlight tour and the
 * one-time first-click tooltips both read from here so a user never sees the
 * same explanation twice.
 */
export const TOUR_COPY: Record<string, { title?: string; copy: string }> = {
  tour_calendar_toggle: {
    title: 'Monthly & Weekly Schedule',
    copy:
      "Switch between Monthly and Weekly views. Monthly shows the full month at a glance — spot busy days and confirmed vs. pending requests. Weekly is where you drag, drop, and assign personnel to specific shifts.",
  },
  project_dropdown: {
    title: 'Projects',
    copy:
      "Switch between your active projects here. Each project has its own schedule, team assignments, and requests. Selecting a project brings you straight to that project's dashboard.",
  },
  messages: {
    title: 'Messages',
    copy:
      'Communicate directly with your team. Project correspondence, direct messages, and group chats are all here.',
  },
  tour_master_schedule: {
    title: 'Master Schedule',
    copy:
      'Choose Master Schedule to see every project in one place. Turn on project overlays to compare schedules side by side and catch conflicts before they happen.',
  },
  tour_team: {
    title: 'Project Team Members',
    copy:
      'This is your project team. View who is assigned, add team members to the project, and manage their details. Only people assigned here appear on this project\'s schedule.',
  },
  tour_company_account: {
    title: 'Manage My Company Account',
    copy:
      'Your company hub: company info, billing and plan, projects, team profiles, and connected contractors all live here.',
  },
  tour_messages: {
    title: 'Messages',
    copy:
      'Communicate directly with your team. Project correspondence, direct messages, and group chats are all here.',
  },
  connect_gc_sub: {
    title: 'Connecting Companies',
    copy:
      'Use a connection code to link with another company on this project. Share your code (or send an invite by email) to connect a subcontractor, or paste a code you received to connect to a General Contractor.',
  },
};

const CALENDAR_COPY: Record<TourRole, { monthly: string; weekly: string }> = {
  gc: {
    monthly:
      "Monthly view: click a day — or drag across several days — to request workers from a connected subcontractor. Day colors tell you at a glance what's pending versus confirmed.",
    weekly:
      "Weekly view: pick the specific shifts your sub has posted, set the headcount you need, and publish. You'll be asked how you want the sub notified — email, text, both, or in-app.",
  },
  guest: {
    monthly:
      "Monthly view: click a day — or drag across several days — to request workers from your subcontractor. Day colors tell you at a glance what's pending versus confirmed.",
    weekly:
      "Weekly view: pick the specific shifts your sub has posted, set the headcount you need, and publish. You'll be asked how you want the sub notified — email, text, both, or in-app.",
  },
  sub: {
    monthly:
      'Monthly view: day colors show your available capacity and any incoming requests. Click a day to add or edit which personnel are available.',
    weekly:
      'Weekly view: assign named personnel to shifts, approve or edit incoming requests, and use Remove Availability to pull someone off a day.',
  },
  mainsub: {
    monthly:
      'Monthly view: day colors show your available capacity and any incoming requests. Click a day to add or edit availability. You can also schedule your connected sub-of-sub personnel here — but only the company that owns those workers can approve the request.',
    weekly:
      'Weekly view: assign personnel to shifts and approve or edit incoming requests. Sub-of-sub personnel can be scheduled from here too, though final approval stays with the company that owns them.',
  },
};

export const getCalendarTipCopy = (role: TourRole, view: 'monthly' | 'weekly') =>
  CALENDAR_COPY[role][view];

export const calendarTipKey = (view: 'monthly' | 'weekly'): TooltipKey =>
  view === 'monthly' ? 'calendar_monthly_scheduling' : 'calendar_weekly_scheduling';
