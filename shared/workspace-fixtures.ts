import type { WorkspaceState } from "./workspace-contracts.ts";

/** Invented, disposable provider fixtures. No network or provider credentials. */
export function createFixtureWorkspace(): WorkspaceState {
  return {
    accounts: [
      { id: "alex_gmail", ownerId: "demo_alex", provider: "gmail", label: "Personal Gmail", address: "alex@gmail.example.invalid", mode: "fixture" },
      { id: "alex_outlook", ownerId: "demo_alex", provider: "outlook", label: "Work Outlook", address: "alex@outlook.example.invalid", mode: "fixture" },
      { id: "alex_imap", ownerId: "demo_alex", provider: "imap", label: "Studio IMAP", address: "alex@studio.example.invalid", mode: "fixture" },
      { id: "sam_gmail", ownerId: "demo_sam", provider: "gmail", label: "Sam Gmail", address: "sam@gmail.example.invalid", mode: "fixture" },
    ],
    messages: [
      { id: "alex_msg_launch", accountId: "alex_gmail", subject: "Launch checklist for Friday", from: "mia@team.example.invalid", to: "alex@gmail.example.invalid", body: "Could you review the launch checklist and reserve half an hour to prepare the demo? The draft is ready for your feedback.", receivedAt: "2026-10-16T08:30:00.000Z", read: false },
      { id: "alex_msg_design", accountId: "alex_outlook", subject: "Design review notes", from: "noah@work.example.invalid", to: "alex@outlook.example.invalid", body: "The team agreed on the simpler navigation. Please send your feedback on the new calendar layout before our next review.", receivedAt: "2026-10-16T09:15:00.000Z", read: false },
      { id: "alex_msg_receipt", accountId: "alex_imap", subject: "Studio booking confirmation", from: "bookings@studio.example.invalid", to: "alex@studio.example.invalid", body: "Your studio planning session is confirmed. This is an invented fixture message; no actual reservation exists.", receivedAt: "2026-10-15T16:00:00.000Z", read: true },
      { id: "sam_msg_private", accountId: "sam_gmail", subject: "Sam's private planning", from: "lee@team.example.invalid", to: "sam@gmail.example.invalid", body: "Private fixture correspondence belonging only to Sam.", receivedAt: "2026-10-16T10:00:00.000Z", read: false },
    ],
    tasks: [
      { id: "alex_task_plan", ownerId: "demo_alex", title: "Prepare the weekly plan", completed: false },
      { id: "sam_task_private", ownerId: "demo_sam", title: "Sam's personal errand", completed: false },
    ],
    calendars: [
      { id: "alex_personal", ownerId: "demo_alex", name: "Personal", color: "#2563eb" },
      { id: "alex_work", ownerId: "demo_alex", accountId: "alex_outlook", name: "Work", color: "#7c3aed" },
      { id: "sam_personal", ownerId: "demo_sam", name: "Sam Personal", color: "#0d9488" },
    ],
    events: [
      { id: "alex_event_review", calendarId: "alex_work", title: "Weekly design review", start: "2026-10-16T15:00:00.000Z", end: "2026-10-16T15:30:00.000Z" },
      { id: "sam_event_private", calendarId: "sam_personal", title: "Sam's private appointment", start: "2026-10-16T17:00:00.000Z", end: "2026-10-16T18:00:00.000Z" },
    ],
    drafts: [], agents: [], activity: [],
  };
}
