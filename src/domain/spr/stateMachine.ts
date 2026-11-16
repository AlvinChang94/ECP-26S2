// What: the SPR state machine (Draft, Submitted, Approved, Rejected), the reminder schedule, and who must decide.
// Who calls it: the SPR service. In AWS this is the part the deck draws as Step Functions and EventBridge Scheduler.
// To extend: change REMINDER_SCHEDULE to change the timing (see the developer guide recipe). Add a state here before using it anywhere.
import type { LeavePeriod, StaffDirectory, StaffMember } from "../navision";
import { addHours, businessDate, formatDate } from "../time";

export const SPR_STATUSES = ["Draft", "Submitted", "Approved", "Rejected"] as const;
export type SprStatus = (typeof SPR_STATUSES)[number];
export type SprEvent = "submit" | "approve" | "reject";

/** From which state each event is allowed, and where it leads. Anything not listed is refused. */
const TRANSITIONS: Record<SprEvent, { from: SprStatus; to: SprStatus }> = {
  submit: { from: "Draft", to: "Submitted" },
  approve: { from: "Submitted", to: "Approved" },
  reject: { from: "Submitted", to: "Rejected" },
};

export type TransitionResult = { ok: true; status: SprStatus } | { ok: false; error: string };

export function nextSprStatus(current: SprStatus, event: SprEvent): TransitionResult {
  const rule = TRANSITIONS[event];
  if (current !== rule.from) {
    const action = event === "submit" ? "submitted" : event === "approve" ? "approved" : "rejected";
    return { ok: false, error: `An SPR that is ${current} cannot be ${action}. Only a ${rule.from} SPR can.` };
  }
  return { ok: true, status: rule.to };
}

/** A decided SPR never changes again. */
export function isFinal(status: SprStatus): boolean {
  return status === "Approved" || status === "Rejected";
}

export type ReminderStep = {
  /** Hours after submission. */
  afterHours: number;
  /** "reminder" nudges whoever must decide; "escalate" hands the SPR to the stand-in. */
  kind: "reminder" | "escalate";
};

/** The deck's ladder: remind at 24 and 48 hours, hand over to Janet's stand-in at 72 hours. */
export const REMINDER_SCHEDULE: ReminderStep[] = [
  { afterHours: 24, kind: "reminder" },
  { afterHours: 48, kind: "reminder" },
  { afterHours: 72, kind: "escalate" },
];

export type PlannedReminder = ReminderStep & { dueAt: Date };

/** The jobs to schedule when an SPR is submitted. */
export function planReminders(submittedAt: Date, schedule: ReminderStep[] = REMINDER_SCHEDULE): PlannedReminder[] {
  return schedule.map((step) => ({ ...step, dueAt: addHours(submittedAt, step.afterHours) }));
}

/** The planned leave that covers `at` for this person, or null. Leave dates are whole business days, both inclusive. */
export function leaveCovering(staffId: string, plannedLeave: LeavePeriod[], at: Date): LeavePeriod | null {
  const day = businessDate(at);
  return plannedLeave.find((leave) => leave.staffId === staffId && leave.from <= day && day <= leave.to) ?? null;
}

export type Assignment = {
  assignee: StaffMember;
  /** True when the SPR goes to the stand-in instead of the approver. */
  toStandIn: boolean;
  /** Why it went to the stand-in, in plain language. Null when it goes to the approver as usual. */
  note: string | null;
};

/**
 * Who must decide an SPR submitted (or reminded) at `at`: the approver, unless she is on planned leave,
 * in which case her stand-in gets it straight away.
 */
export function chooseAssignee(directory: StaffDirectory, at: Date): Assignment {
  const approver = directory.staff.find((member) => member.id === directory.approverId);
  const standIn = directory.staff.find((member) => member.id === directory.standInId);
  if (!approver || !standIn) throw new Error("The staff file must name an approver and a stand-in who are both in the staff list.");
  const leave = leaveCovering(approver.id, directory.plannedLeave, at);
  if (leave) {
    return {
      assignee: standIn,
      toStandIn: true,
      note: `${approver.name} is on planned leave from ${formatDate(leave.from)} to ${formatDate(leave.to)}, so this SPR comes to ${standIn.name} as the stand-in.`,
    };
  }
  return { assignee: approver, toStandIn: false, note: null };
}

export type SprDraftInput = { partNo: string | null; quantity: number | null; reason: string | null };

/** What is wrong with a new SPR as typed by the product manager, or null when it can be saved. */
export function validateSprDraft(input: SprDraftInput): string | null {
  if (!input.partNo || input.partNo.trim().length === 0) return "Type a part number.";
  if (input.quantity === null || !Number.isInteger(input.quantity) || input.quantity <= 0) return "The quantity must be a whole number above zero.";
  if (!input.reason || input.reason.trim().length < 3) return "Give a reason for the request (a few words are enough).";
  return null;
}
