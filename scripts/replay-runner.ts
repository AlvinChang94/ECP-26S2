// What: the KPI replay. Runs the six-month synthetic history through the real services on a simulated clock and measures four KPIs against the sample's baseline.
// Who calls it: scripts/replay.ts (`npm run replay`) and tests/integration/replay.test.ts.
// To extend: staff behaviour is simulated by the settings in DEFAULT_REPLAY_SETTINGS; change a number there (or with --set) and the report says so. Nothing here is a measurement of Spectra.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Actor } from "../src/domain/audit";
import { REMINDER_SCHEDULE } from "../src/domain/spr/stateMachine";
import { changePercent, durationsInHours, type DurationSummary, formatChange, formatHours, formatShare, share, summarizeHours } from "../src/domain/kpi";
import { addDays, addHours, BUSINESS_UTC_OFFSET_HOURS, endOfBusinessDay, hoursBetween } from "../src/domain/time";
import type { Deps } from "../src/services/deps";
import { recordDelivery } from "../src/services/fulfilment";
import { confirmDocumentType, ingestDocument, parseDocumentType } from "../src/services/intake";
import { runDueJobs } from "../src/services/jobs";
import { confirmPaid } from "../src/services/payments";
import { acceptSuggestion, editField, overrideFlag, proposeCustomerCard } from "../src/services/poEdit";
import { approveAndExport, buildExportPreview, exportedOrderFile } from "../src/services/poExport";
import { loadPoReview } from "../src/services/poReview";
import { getShipment, recordResolution } from "../src/services/shipments";
import { createSpr, decideSpr, latestApprovalTokenFromOutbox, submitSpr } from "../src/services/spr";
import { type ReplayFile, ReplayFileSchema, type ReplayOrder, type ReplayReceipt } from "./sample-data/replayTypes";
import { createRng } from "./sample-data/rng";
import { createTempWorkspace } from "./temp-workspace";

// ------------------------------------------------------------------------------------- simulated staff

/** How the simulated staff behave. Every value is an assumption made for the replay, not something measured at Spectra. */
export type ReplaySettings = {
  intakeDelayMinutes: number;
  reviewMinutes: number;
  minutesPerFinding: number;
  sprRaiseDelayHours: number;
  reminderResponseRate: number;
  reminderResponseHours: number;
  standInResponseHours: number;
  paymentLeadDays: number;
  unseenDelayShare: number;
};

export const DEFAULT_REPLAY_SETTINGS: ReplaySettings = {
  intakeDelayMinutes: 15,
  reviewMinutes: 20,
  minutesPerFinding: 15,
  sprRaiseDelayHours: 2,
  reminderResponseRate: 0.6,
  reminderResponseHours: 4,
  standInResponseHours: 4,
  paymentLeadDays: 3,
  unseenDelayShare: 0.3,
};

/** One plain sentence per setting, printed in the report so nobody mistakes an assumption for a result. */
export const REPLAY_SETTING_NOTES: Record<keyof ReplaySettings, string> = {
  intakeDelayMinutes: "minutes until a sales team member imports a PO that arrived and confirms its type",
  reviewMinutes: "minutes to review a PO, set the promised ship date and approve the export preview",
  minutesPerFinding: "extra minutes for each finding that has to be fixed or overridden",
  sprRaiseDelayHours: "hours until the product manager raises and submits the SPR for a shortage",
  reminderResponseRate: "chance that the approver decides after a reminder (each reminder of the SPR schedule)",
  reminderResponseHours: "hours between a reminder and the approver's decision, when she responds to it",
  standInResponseHours: "hours the stand-in takes to decide after the hand-over at 72 hours",
  paymentLeadDays: "days before the sample's ship date on which Finance confirms the customer's payment",
  unseenDelayShare: "share of late orders that are late for a reason the system cannot see (paid in time, shipped late anyway)",
};

const SAM: Actor = { name: "Sam Tan", role: "sales" };
const PRIYA: Actor = { name: "Priya Nair", role: "product_manager" };
const FARAH: Actor = { name: "Farah Lim", role: "finance" };
const PETER: Actor = { name: "Peter Goh", role: "purchase" };

const MINUTE = 60 * 1000;

/**
 * Staff work 09:00 to 18:00 Singapore time, Monday to Friday. Work that would be done outside those hours
 * is done at 09:30 on the next working day instead.
 */
export function workingTime(date: Date): Date {
  const local = new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * 60 * MINUTE);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const weekday = local.getUTCDay() >= 1 && local.getUTCDay() <= 5;
  if (weekday && minutes >= 9 * 60 && minutes <= 18 * 60) return date;
  // 09:30 local time on this day, or on the next day when it is already evening.
  let next = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 9, 30));
  if (minutes > 18 * 60) next = addDays(next, 1);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = addDays(next, 1);
  return new Date(next.getTime() - BUSINESS_UTC_OFFSET_HOURS * 60 * MINUTE);
}

/** The reminder and hand-over hours of the real SPR schedule (24 and 48, then 72), so the replay follows any change to it. */
const REMINDER_HOURS = REMINDER_SCHEDULE.filter((step) => step.kind === "reminder").map((step) => step.afterHours);
const HAND_OVER_HOURS = REMINDER_SCHEDULE.find((step) => step.kind === "escalate")?.afterHours ?? null;

/**
 * When the simulated approver decides, in hours after the SPR was submitted. She decides when she did in the sample
 * unless a reminder reaches her first: each reminder (24 h and 48 h with today's schedule) makes her decide
 * `reminderResponseHours` later with probability `reminderResponseRate`. At the hand-over (72 h) the SPR goes to the
 * stand-in, who decides `standInResponseHours` later. Never later than in the sample.
 */
export function approverDecisionHours(baselineHours: number, promptRolls: number[], settings: ReplaySettings): number {
  for (const [index, hours] of REMINDER_HOURS.entries()) {
    const respondedAt = hours + settings.reminderResponseHours;
    if (baselineHours <= respondedAt) return baselineHours;
    if ((promptRolls[index] ?? 1) < settings.reminderResponseRate) return respondedAt;
  }
  return HAND_OVER_HOURS === null ? baselineHours : Math.min(baselineHours, HAND_OVER_HOURS + settings.standInResponseHours);
}

// ------------------------------------------------------------------------------------- the report

export type CodeCount = { seeded: number; flagged: number };

export type ReplayReport = {
  period: { from: string; to: string };
  settings: ReplaySettings;
  ordersTotal: number;
  receiptsTotal: number;
  /** 1. Order-processing time: hours from the PO arriving to the order existing in (mock) Navision. */
  processing: { baseline: DurationSummary; solution: DurationSummary; exported: number; notExported: { id: string; reason: string }[] };
  /** 2. Error rate: documents that do not match Navision or the invoice, and how many of those the solution flagged. */
  errors: {
    poLines: number;
    typesDetected: number;
    documentsTotal: number;
    po: CodeCount;
    receipts: CodeCount;
    byCode: Record<string, CodeCount>;
    /** Blocking or warning findings the solution raised that were not seeded in the sample. */
    unexpected: { id: string; code: string; severity: string; reason: string }[];
    suggestionsFromAliasMemory: number;
  };
  /** 3. Approval turnaround: hours from an SPR being submitted to its decision. */
  approval: { baseline: DurationSummary; solution: DurationSummary; remindersSent: number; handedToStandIn: number; decidedByStandIn: number };
  /** 4. Overdue orders: not fully shipped when the promised ship date ended, and whether an alert was raised before that. */
  overdue: { baselineLate: number; solutionLate: number; alertedBefore: number; alertedButOnTime: number; lateForUnseenReason: number };
  jobRuns: number;
  eventsRun: number;
};

type OrderRecord = {
  spec: ReplayOrder;
  orderNo: string | null;
  exportedAt: Date | null;
  sprNo: string | null;
  /** Random numbers drawn up front per order, so the result does not depend on the order events happen to run in. */
  rolls: { prompts: number[]; unseen: number };
  unseenDelay: boolean;
};

type Event = { at: Date; sequence: number; label: string; run: () => Promise<void> };

/** Events in time order. Events at the same instant run in the order they were added. */
class Timeline {
  private events: Event[] = [];
  private sequence = 0;
  add(at: Date, label: string, run: () => Promise<void>): void {
    this.events.push({ at, sequence: this.sequence++, label, run });
  }
  next(): Event | undefined {
    this.events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.sequence - b.sequence);
    return this.events.shift();
  }
}

export type ReplayOptions = {
  /** Folder with orders.json, files/ and navision/ (data/replay). */
  replayDir: string;
  settings?: Partial<ReplaySettings>;
  /** Replay only the first N orders and receipts (used by the test to stay fast). */
  limitOrders?: number;
  limitReceipts?: number;
  onProgress?: (message: string) => void;
};

export async function runReplay(options: ReplayOptions): Promise<ReplayReport> {
  const settings: ReplaySettings = { ...DEFAULT_REPLAY_SETTINGS, ...options.settings };
  const file: ReplayFile = ReplayFileSchema.parse(JSON.parse(readFileSync(path.join(options.replayDir, "orders.json"), "utf8")));
  const orders = file.orders.slice(0, options.limitOrders ?? file.orders.length);
  const receipts = file.receipts.slice(0, options.limitReceipts ?? file.receipts.length);
  const readPdf = (relativePath: string): Uint8Array => new Uint8Array(readFileSync(path.join(options.replayDir, relativePath)));

  const workspace = createTempWorkspace({ navisionSource: path.join(options.replayDir, "navision"), now: `${file.period.from}T00:00:00.000Z` });
  const { deps, clock } = workspace;
  const timeline = new Timeline();
  const rng = createRng(`${file.seed}:replay-run`);
  let jobRuns = 0;
  let eventsRun = 0;

  const report: ReplayReport = {
    period: file.period,
    settings,
    ordersTotal: orders.length,
    receiptsTotal: receipts.length,
    processing: { baseline: summarizeHours([]), solution: summarizeHours([]), exported: 0, notExported: [] },
    errors: { poLines: 0, typesDetected: 0, documentsTotal: 0, po: { seeded: 0, flagged: 0 }, receipts: { seeded: 0, flagged: 0 }, byCode: {}, unexpected: [], suggestionsFromAliasMemory: 0 },
    approval: { baseline: summarizeHours([]), solution: summarizeHours([]), remindersSent: 0, handedToStandIn: 0, decidedByStandIn: 0 },
    overdue: { baselineLate: 0, solutionLate: 0, alertedBefore: 0, alertedButOnTime: 0, lateForUnseenReason: 0 },
    jobRuns: 0,
    eventsRun: 0,
  };
  const countCode = (code: string, group: CodeCount, flagged: boolean): void => {
    const entry = (report.errors.byCode[code] ??= { seeded: 0, flagged: 0 });
    entry.seeded++;
    group.seeded++;
    if (flagged) {
      entry.flagged++;
      group.flagged++;
    }
  };

  try {
    // ---------------------------------------------------------------- orders (stories 1 to 4 and 6)
    const records: OrderRecord[] = orders.map((spec) => ({
      spec,
      orderNo: null,
      exportedAt: null,
      sprNo: null,
      rolls: { prompts: REMINDER_HOURS.map(() => rng.next()), unseen: rng.next() },
      unseenDelay: false,
    }));

    for (const record of records) {
      const { spec } = record;
      const arrivedAt = new Date(spec.arrivedAt);
      report.errors.poLines += spec.lineCount;

      timeline.add(workingTime(new Date(arrivedAt.getTime() + settings.intakeDelayMinutes * MINUTE)), `${spec.id}: PO taken in`, async () => {
        const { documentId } = await ingestDocument(deps, SAM, { bytes: readPdf(spec.poFile), fileName: path.basename(spec.poFile), channel: spec.channel, sender: null, receivedAt: arrivedAt });
        const document = await deps.db.document.findUniqueOrThrow({ where: { id: documentId } });
        report.errors.documentsTotal++;
        if (document.detectedType === "customer_po") report.errors.typesDetected++;
        const route = await confirmDocumentType(deps, SAM, documentId, "customer_po");
        record.orderNo = route.routedId;
        if (!record.orderNo) return;

        // What did the solution flag, compared with the errors seeded in the sample?
        const review = await loadPoReview(deps, record.orderNo);
        for (const error of spec.seededErrors) {
          countCode(error.code, report.errors.po, review.flags.some((flag) => flag.code === error.code && flag.field === error.field));
        }
        for (const flag of review.flags) {
          if (flag.suggestion?.source === "alias_memory") report.errors.suggestionsFromAliasMemory++;
          const seeded = spec.seededErrors.some((error) => error.code === flag.code && error.field === flag.field);
          // The missing promised ship date is a step every PO goes through, not an error in the document.
          const shipDateStep = flag.code === "MISSING_FIELD" && flag.field === "promisedShipDate";
          if (!seeded && !shipDateStep && flag.severity !== "info") report.errors.unexpected.push({ id: spec.id, code: flag.code, severity: flag.severity, reason: flag.reason });
        }

        const reviewedAt = workingTime(new Date(clock.now().getTime() + (settings.reviewMinutes + settings.minutesPerFinding * spec.seededErrors.length) * MINUTE));
        timeline.add(reviewedAt, `${spec.id}: reviewed and exported`, () => reviewAndExport(record));
      });
    }

    const reviewAndExport = async (record: OrderRecord): Promise<void> => {
      const { spec } = record;
      const orderNo = record.orderNo as string;
      // The simulated sales team member deals with each seeded error the way orders.json says a person would.
      for (const error of spec.seededErrors) {
        const review = await loadPoReview(deps, orderNo);
        const flag = review.flags.find((candidate) => candidate.code === error.code && candidate.field === error.field && candidate.decision === null);
        const { resolution } = error;
        if (resolution.action === "use_suggestion" && flag?.suggestion) await acceptSuggestion(deps, SAM, { orderNo, fingerprint: flag.fingerprint, remember: true });
        if (resolution.action === "override" && flag) await overrideFlag(deps, SAM, { orderNo, fingerprint: flag.fingerprint, reason: resolution.reason });
        if (resolution.action === "set_value") await editField(deps, SAM, { orderNo, field: resolution.field, value: resolution.value, reason: "Corrected after checking with the customer (simulated)." });
        if (resolution.action === "propose_customer_card") await proposeCustomerCard(deps, SAM, { orderNo, address: "", country: "Not stated (simulated)", email: "accounts@customer.example" });
      }
      await editField(deps, SAM, { orderNo, field: "promisedShipDate", value: spec.baseline.promisedShipDate, reason: "Date agreed with the customer (from the sample)." });

      const review = await loadPoReview(deps, orderNo);
      if (review.blocking.length > 0) {
        // Nothing is forced through: an order with an open blocking finding stays a draft and is reported.
        report.processing.notExported.push({ id: spec.id, reason: review.blocking.map((flag) => flag.code).join(", ") });
        return;
      }
      const preview = await buildExportPreview(deps, orderNo);
      await approveAndExport(deps, SAM, { orderNo, previewHash: preview.previewHash });
      record.exportedAt = clock.now();

      // Story 3: a shortage leads to an SPR, decided through the approval link from the Outbox.
      if (spec.spr && spec.baseline.sprSubmittedAt && spec.baseline.sprDecidedAt) {
        const shortage = spec.spr;
        const baselineHours = hoursBetween(new Date(spec.baseline.sprSubmittedAt), new Date(spec.baseline.sprDecidedAt));
        timeline.add(workingTime(addHours(clock.now(), settings.sprRaiseDelayHours)), `${spec.id}: SPR raised`, async () => {
          record.sprNo = await createSpr(deps, PRIYA, {
            partNo: shortage.partNo,
            quantity: shortage.quantity,
            reason: `${orderNo} needs ${shortage.quantity} more than is in stock (simulated request).`,
            sourceOrderNo: orderNo,
          });
          await submitSpr(deps, PRIYA, record.sprNo);
          const decideAt = addHours(clock.now(), approverDecisionHours(baselineHours, record.rolls.prompts, settings));
          timeline.add(decideAt, `${spec.id}: SPR decided`, async () => {
            const token = await latestApprovalTokenFromOutbox(deps, record.sprNo as string);
            if (token) await decideSpr(deps, token, { decision: "approve", remarks: "Approved (simulated approver)." });
          });
        });
      }

      // Story 4 and shipping. The replay does not claim goods ship faster: each order ships on the date in the sample.
      const shipAt = new Date(`${spec.baseline.actualShipDate}T07:00:00.000Z`); // 15:00 Singapore time
      const late = spec.baseline.actualShipDate > spec.baseline.promisedShipDate;
      record.unseenDelay = late && record.rolls.unseen < settings.unseenDelayShare;
      let paidAt = record.unseenDelay ? addHours(clock.now(), 48) : new Date(Math.max(addHours(clock.now(), 1).getTime(), addDays(shipAt, -settings.paymentLeadDays).getTime()));
      if (paidAt.getTime() >= shipAt.getTime()) paidAt = addHours(shipAt, -1);
      timeline.add(paidAt, `${spec.id}: payment confirmed`, async () => {
        await confirmPaid(deps, FARAH, { orderNo, reason: "Simulated: payment seen on the bank statement." });
      });
      timeline.add(shipAt, `${spec.id}: shipped`, async () => {
        const exported = await exportedOrderFile(deps, orderNo);
        for (const line of exported?.lines ?? []) {
          await recordDelivery(deps, SAM, { orderNo, partNo: line.itemNo, quantity: line.quantity, note: "Shipped on the date in the sample (simulated)." });
        }
      });
    };

    // ---------------------------------------------------------------- goods receipts (story 5)
    const scheduleReceipt = (spec: ReplayReceipt): void => {
      const arrivedAt = new Date(spec.arrivedAt);
      timeline.add(workingTime(new Date(arrivedAt.getTime() + settings.intakeDelayMinutes * MINUTE)), `${spec.id}: shipping documents taken in`, async () => {
        let shipmentNo: string | null = null;
        for (const pdf of [spec.invoiceFile, spec.packingListFile]) {
          const { documentId } = await ingestDocument(deps, PETER, { bytes: readPdf(pdf), fileName: path.basename(pdf), channel: "email", sender: null, receivedAt: arrivedAt });
          const document = await deps.db.document.findUniqueOrThrow({ where: { id: documentId } });
          report.errors.documentsTotal++;
          const expectedType = pdf === spec.invoiceFile ? "vendor_invoice" : "packing_list";
          if (document.detectedType === expectedType) report.errors.typesDetected++;
          const route = await confirmDocumentType(deps, PETER, documentId, parseDocumentType(expectedType));
          shipmentNo = route.routedId ?? shipmentNo;
        }
        if (!shipmentNo) return;
        const view = await getShipment(deps, shipmentNo);
        for (const error of spec.seededErrors) {
          countCode(error.code, report.errors.receipts, view.flags.some((flag) => flag.code === error.code && flag.field === error.field));
        }
        for (const flag of view.flags) {
          const seeded = spec.seededErrors.some((error) => error.code === flag.code && error.field === flag.field);
          // The sample has no AWB or permit files, so "document missing" is expected for every receipt and not counted.
          if (!seeded && flag.severity === "blocking") report.errors.unexpected.push({ id: spec.id, code: flag.code, severity: flag.severity, reason: flag.reason });
        }
        const tracked = shipmentNo;
        timeline.add(workingTime(addHours(clock.now(), 4)), `${spec.id}: findings resolved`, async () => {
          const current = await getShipment(deps, tracked);
          for (const flag of current.flags.filter((candidate) => candidate.severity === "blocking" && candidate.decision === null)) {
            await recordResolution(deps, PETER, { shipmentNo: tracked, fingerprint: flag.fingerprint, reason: "Checked with the vendor and recorded (simulated reviewer)." });
          }
        });
      });
    };
    receipts.forEach(scheduleReceipt);

    // ---------------------------------------------------------------- the daily job run (08:00 Singapore time)
    const lastShipDate = orders.reduce((latest, spec) => (spec.baseline.actualShipDate > latest ? spec.baseline.actualShipDate : latest), file.period.to);
    const lastDay = addDays(new Date(`${lastShipDate}T00:00:00.000Z`), 3);
    for (let day = new Date(`${file.period.from}T00:00:00.000Z`); day.getTime() <= lastDay.getTime(); day = addDays(day, 1)) {
      timeline.add(day, "daily job run", async () => {
        await runDueJobs(deps);
        jobRuns++;
      });
    }

    // ---------------------------------------------------------------- run everything in time order
    /** Reminders and hand-overs are scheduled for exact times (24, 48, 72 hours). Each runs at its own time. */
    const runScheduledJobsUntil = async (until: Date): Promise<void> => {
      let lastJobId: string | null = null;
      for (;;) {
        const job = await deps.db.scheduledJob.findFirst({ where: { status: "pending", dueAt: { lte: until } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
        if (!job || job.id === lastJobId) return;
        lastJobId = job.id;
        if (job.dueAt.getTime() > clock.now().getTime()) clock.set(job.dueAt);
        await runDueJobs(deps);
        jobRuns++;
      }
    };

    for (let event = timeline.next(); event; event = timeline.next()) {
      await runScheduledJobsUntil(event.at);
      if (event.at.getTime() > clock.now().getTime()) clock.set(event.at);
      await event.run();
      eventsRun++;
      if (eventsRun % 100 === 0) options.onProgress?.(`${eventsRun} simulated events done (simulated date ${clock.now().toISOString().slice(0, 10)})`);
    }

    // ---------------------------------------------------------------- measure
    await measure(deps, records, report);
    report.jobRuns = jobRuns;
    report.eventsRun = eventsRun;
    return report;
  } finally {
    await workspace.cleanup();
  }
}

async function measure(deps: Deps, records: OrderRecord[], report: ReplayReport): Promise<void> {
  // 1. Order-processing time
  report.processing.baseline = summarizeHours(durationsInHours(records.map(({ spec }) => ({ from: new Date(spec.arrivedAt), to: new Date(spec.baseline.navisionCreatedAt) }))));
  const exportedOrders = [];
  for (const record of records) {
    const order = record.orderNo ? await deps.db.order.findUnique({ where: { orderNo: record.orderNo } }) : null;
    if (order?.exportedAt) exportedOrders.push({ from: new Date(record.spec.arrivedAt), to: order.exportedAt });
  }
  report.processing.solution = summarizeHours(durationsInHours(exportedOrders));
  report.processing.exported = exportedOrders.length;

  // 3. Approval turnaround
  report.approval.baseline = summarizeHours(
    durationsInHours(records.map(({ spec }) => ({ from: spec.baseline.sprSubmittedAt ? new Date(spec.baseline.sprSubmittedAt) : null, to: spec.baseline.sprDecidedAt ? new Date(spec.baseline.sprDecidedAt) : null }))),
  );
  const sprs = await deps.db.spr.findMany();
  const directory = await deps.navision.getStaffDirectory();
  const standIn = directory.staff.find((member) => member.id === directory.standInId)?.name;
  report.approval.solution = summarizeHours(durationsInHours(sprs.map((spr) => ({ from: spr.submittedAt, to: spr.decidedAt }))));
  report.approval.remindersSent = await deps.db.outboxMessage.count({ where: { type: "spr_reminder" } });
  report.approval.handedToStandIn = await deps.db.outboxMessage.count({ where: { type: "spr_escalation" } });
  report.approval.decidedByStandIn = sprs.filter((spr) => spr.decidedBy !== null && spr.decidedBy === standIn).length;

  // 4. Overdue orders
  for (const record of records) {
    const { spec } = record;
    if (spec.baseline.actualShipDate > spec.baseline.promisedShipDate) report.overdue.baselineLate++;
    if (!record.orderNo) continue;
    const promisedEnds = endOfBusinessDay(spec.baseline.promisedShipDate);
    const lastDelivery = await deps.db.delivery.findFirst({ where: { orderNo: record.orderNo }, orderBy: { recordedAt: "desc" } });
    const late = !lastDelivery || lastDelivery.recordedAt.getTime() >= promisedEnds.getTime();
    const alert = await deps.db.outboxMessage.findFirst({ where: { type: "ship_date_alert", orderNo: record.orderNo }, orderBy: { id: "asc" } });
    const alertedBefore = alert !== null && alert.createdAt.getTime() < promisedEnds.getTime();
    if (late) {
      report.overdue.solutionLate++;
      if (alertedBefore) report.overdue.alertedBefore++;
      if (record.unseenDelay) report.overdue.lateForUnseenReason++;
    } else if (alertedBefore) {
      report.overdue.alertedButOnTime++;
    }
  }
}

// ------------------------------------------------------------------------------------- printing

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row, index) => {
      const line = row.map((cell, column) => cell.padEnd(widths[column])).join("  ");
      return index === 0 ? `${line}\n${widths.map((width) => "-".repeat(width)).join("  ")}` : line;
    })
    .join("\n");
}

function durationRows(name: string, baseline: DurationSummary, solution: DurationSummary): string[][] {
  return [
    [name, "Baseline (sample)", "With OrderFlow (simulated)", "Change"],
    ["Measured", String(baseline.count), String(solution.count), ""],
    ["Mean", formatHours(baseline.mean), formatHours(solution.mean), formatChange(changePercent(baseline.mean, solution.mean))],
    ["Median", formatHours(baseline.median), formatHours(solution.median), formatChange(changePercent(baseline.median, solution.median))],
    ["Longest", formatHours(baseline.max), formatHours(solution.max), formatChange(changePercent(baseline.max, solution.max))],
  ];
}

/** The report as plain text: the four measures, then exactly what was assumed. */
export function formatReplayReport(report: ReplayReport): string {
  const { processing, errors, approval, overdue } = report;
  const seededTotal = errors.po.seeded + errors.receipts.seeded;
  const flaggedTotal = errors.po.flagged + errors.receipts.flagged;
  const lines: string[] = [];
  lines.push(
    "KPI replay: Spectra OrderFlow proof of concept",
    `Sample period ${report.period.from} to ${report.period.to}: ${report.ordersTotal} customer orders and ${report.receiptsTotal} goods receipts.`,
    "",
    "READ THIS FIRST",
    "  - The sample is SYNTHETIC. Every baseline timestamp was generated by scripts/generate-sample-data.ts. It is not Spectra's data.",
    "  - Staff actions in the replay are SIMULATED with the delays listed at the end. They are assumptions, not observations.",
    "  - The figures show how each measure is computed and that the system raises what it should. They do not predict Spectra's results.",
    "",
    "1. ORDER-PROCESSING TIME (hours from the PO arriving to the order existing in Navision)",
    table(durationRows("", processing.baseline, processing.solution)),
    `   Orders exported after a person approved the preview: ${processing.exported} of ${report.ordersTotal}.` +
      (processing.notExported.length > 0 ? ` Left as drafts: ${processing.notExported.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}.` : ""),
    "",
    "2. ERROR RATE (documents that do not match Navision or the invoice, and how many the solution flagged)",
    table([
      ["", "With a seeded error", "Flagged by the solution"],
      [`Customer PO lines (${errors.poLines})`, `${errors.po.seeded} (${formatShare(share(errors.po.seeded, errors.poLines))})`, `${errors.po.flagged} of ${errors.po.seeded} (${formatShare(share(errors.po.flagged, errors.po.seeded))})`],
      [`Goods receipts (${report.receiptsTotal})`, `${errors.receipts.seeded} (${formatShare(share(errors.receipts.seeded, report.receiptsTotal))})`, `${errors.receipts.flagged} of ${errors.receipts.seeded} (${formatShare(share(errors.receipts.flagged, errors.receipts.seeded))})`],
      ["All", String(seededTotal), `${flaggedTotal} of ${seededTotal} (${formatShare(share(flaggedTotal, seededTotal))})`],
    ]),
    "",
    table([["Flag code", "Seeded", "Flagged"], ...Object.entries(errors.byCode).sort(([a], [b]) => a.localeCompare(b)).map(([code, counts]) => [code, String(counts.seeded), String(counts.flagged)])]),
    `   Findings raised that were not seeded: ${errors.unexpected.length}.` +
      (errors.unexpected.length > 0 ? ` ${errors.unexpected.map((entry) => `${entry.id} ${entry.code} (${entry.severity})`).join(", ")}.` : ""),
    `   Document type detected correctly: ${errors.typesDetected} of ${errors.documentsTotal}. Part suggestions that came from alias memory: ${errors.suggestionsFromAliasMemory}.`,
    "   Baseline: the sample does not record which of these errors were caught by hand, so there is no baseline detection figure.",
    "   A flag is a detection, not a prevention: a person still had to fix or accept each one before the export.",
    "",
    "3. APPROVAL TURNAROUND (hours from an SPR being submitted to its decision)",
    table(durationRows("", approval.baseline, approval.solution)),
    `   Reminders sent: ${approval.remindersSent}. Handed to the stand-in after 72 hours: ${approval.handedToStandIn}. Decided by the stand-in: ${approval.decidedByStandIn}.`,
    "",
    "4. OVERDUE ORDERS (not fully shipped when the promised ship date ended)",
    table([
      ["", "Baseline (sample)", "With OrderFlow (simulated)"],
      ["Overdue orders", `${overdue.baselineLate} of ${report.ordersTotal} (${formatShare(share(overdue.baselineLate, report.ordersTotal))})`, `${overdue.solutionLate} of ${report.ordersTotal} (${formatShare(share(overdue.solutionLate, report.ordersTotal))})`],
      ["Alert raised before the promised date", "none (no alerts existed)", `${overdue.alertedBefore} of ${overdue.solutionLate} (${formatShare(share(overdue.alertedBefore, overdue.solutionLate))})`],
    ]),
    `   The number of overdue orders is the same by design: the replay ships every order on the date in the sample and does not claim faster shipping.`,
    `   Of the ${overdue.solutionLate} overdue orders, ${overdue.lateForUnseenReason} were late for a reason the system cannot see (paid and ready, shipped late anyway): those get an alert only after the date.`,
    `   Orders that got an alert and still shipped on time: ${overdue.alertedButOnTime}.`,
    "",
    "WHAT WAS SIMULATED (change any value with: npm run replay -- --set name=value)",
    table([["Setting", "Value", "Meaning"], ...(Object.keys(report.settings) as (keyof ReplaySettings)[]).map((key) => [key, String(report.settings[key]), REPLAY_SETTING_NOTES[key]])]),
    "   Staff work 09:00 to 18:00 Singapore time, Monday to Friday; work that would fall outside is done at 09:30 the next working day.",
    `   The approver decides when she did in the sample unless a reminder (${REMINDER_HOURS.map((hours) => `${hours} h`).join(", ")}) or the hand-over to the stand-in (${HAND_OVER_HOURS ?? "none"} h) comes first.`,
    "   Payment is confirmed by the simulated Finance person; no order is ever marked paid by the system.",
    `   The due jobs ran ${report.jobRuns} times on the simulated clock (once a day at 08:00 and at each scheduled reminder); ${report.eventsRun} simulated events in total.`,
  );
  return lines.join("\n");
}
