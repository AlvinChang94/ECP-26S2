// What: everything a person can do to a PO draft (story 2): edit a value, undo, accept a suggestion, override a flag, remember an alias.
// Who calls it: the server actions of the PO review page; the seed and the KPI replay (as simulated staff).
// To extend: every change must go through recordAudit() with who, old value and new value. Never update a value silently.
import type { Actor } from "@/domain/audit";
import { fieldLabel, findFieldSpec, lineIndexes, lineKey, normalizeInput, parseLineKey, undoTarget } from "@/domain/fields";
import { flagTitle, validateDecisionInput } from "@/domain/flags";
import { aliasKey } from "@/domain/po/partMatch";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { requireThat, UserError } from "./errors";
import { refreshOrderSummary } from "./orders";
import { loadPoReview, type PoReview, requireSalesRole } from "./poReview";

type EditDeps = Pick<Deps, "db" | "clock" | "navision" | "config">;

function quoted(value: string | null): string {
  return value === null ? "(empty)" : `"${value}"`;
}

/** Loads the review and refuses when the version can no longer be changed or the actor may not change it. */
async function loadEditable(deps: EditDeps, actor: Actor, orderNo: string): Promise<PoReview> {
  requireSalesRole(actor);
  const review = await loadPoReview(deps, orderNo);
  requireThat(review.canEdit, `${orderNo} can no longer be edited: this PO version is ${review.version.status}.`);
  return review;
}

/** Is this a field a person may set on a customer PO? Header fields, line columns, and a line's "removed" marker. */
function isEditableField(review: PoReview, field: string): boolean {
  const line = parseLineKey(field);
  if (!line) return review.spec.fields.some((spec) => spec.key === field);
  const known = line.name === "removed" || review.spec.lineFields.some((spec) => spec.key === line.name);
  const existing = lineIndexes(review.values);
  const nextIndex = existing.length === 0 ? 0 : existing[existing.length - 1] + 1;
  // An existing line, or the next free line number (that is how a line is added).
  return known && (existing.includes(line.index) || line.index === nextIndex);
}

export type EditInput = {
  orderNo: string;
  field: string;
  value: string | null;
  /** For part numbers: remember "what the PO said means what I typed" for next time. */
  rememberAlias?: boolean;
  /** Optional note stored with the audit event, for example "accepted the suggested part". */
  reason?: string | null;
};

/**
 * A person changes one value. The extracted value stays stored as it was read; the change is an audit event
 * (who, when, field, old, new) and the current value is worked out from those events.
 */
export async function editField(deps: EditDeps, actor: Actor, input: EditInput): Promise<{ changed: boolean }> {
  const review = await loadEditable(deps, actor, input.orderNo);
  requireThat(isEditableField(review, input.field), `"${input.field}" is not a field of a customer PO.`);

  const oldValue = review.values[input.field] ?? null;
  const newValue = normalizeInput(input.value);
  if (oldValue === newValue) return { changed: false };

  const label = fieldLabel(review.spec, input.field);
  await recordAudit(deps, {
    actor,
    action: "field_edit",
    entityType: "document",
    entityId: review.document.id,
    orderNo: input.orderNo,
    field: input.field,
    oldValue,
    newValue,
    reason: input.reason ?? null,
    summary: `${actor.name} changed ${label} from ${quoted(oldValue)} to ${quoted(newValue)}.`,
  });

  const line = parseLineKey(input.field);
  if (input.rememberAlias && line?.name === "partNo" && newValue) {
    // The alias is from what the customer wrote (the value read from the PDF) to the Navision item the person chose.
    const written = review.original[input.field] ?? oldValue;
    await rememberAlias(deps, actor, { orderNo: input.orderNo, writtenPartNo: written, itemNo: newValue });
  }
  await refreshOrderSummary(deps, input.orderNo);
  return { changed: true };
}

/** Saves several fields at once (one audit event per value that actually changed). Returns how many changed. */
export async function editFields(
  deps: EditDeps,
  actor: Actor,
  orderNo: string,
  changes: { field: string; value: string | null; rememberAlias?: boolean }[],
): Promise<number> {
  let changed = 0;
  for (const change of changes) {
    if ((await editField(deps, actor, { orderNo, ...change })).changed) changed++;
  }
  return changed;
}

/** Restores the value from before the latest edit of a field. The undo is itself an audit event. */
export async function undoField(deps: EditDeps, actor: Actor, input: { orderNo: string; field: string }): Promise<void> {
  const review = await loadEditable(deps, actor, input.orderNo);
  const target = undoTarget(input.field, review.edits);
  requireThat(target, "There is nothing to undo for this field.");
  const current = review.values[input.field] ?? null;
  const label = fieldLabel(review.spec, input.field);
  await recordAudit(deps, {
    actor,
    action: "field_undo",
    entityType: "document",
    entityId: review.document.id,
    orderNo: input.orderNo,
    field: input.field,
    oldValue: current,
    newValue: target.restoreTo,
    summary: `${actor.name} undid a change to ${label}: back from ${quoted(current)} to ${quoted(target.restoreTo)}.`,
  });
  await refreshOrderSummary(deps, input.orderNo);
}

/** Adds an empty line at the end; the person then types its values. */
export async function addLine(deps: EditDeps, actor: Actor, orderNo: string, partNo: string): Promise<void> {
  const review = await loadEditable(deps, actor, orderNo);
  requireThat(normalizeInput(partNo), "Type the part number of the new line.");
  const existing = lineIndexes(review.values);
  const index = existing.length === 0 ? 0 : existing[existing.length - 1] + 1;
  await editField(deps, actor, { orderNo, field: lineKey(index, "partNo"), value: partNo, reason: "Line added by hand" });
}

// ------------------------------------------------------------------------------------- alias memory

/** Remembers "this part number means that item". It is only ever offered as a suggestion afterwards. */
export async function rememberAlias(
  deps: Pick<Deps, "db" | "clock" | "navision">,
  actor: Actor,
  input: { orderNo: string | null; writtenPartNo: string | null; itemNo: string },
): Promise<boolean> {
  if (!input.writtenPartNo) return false;
  const from = aliasKey(input.writtenPartNo);
  // Only a real Navision item can be the target, and a part number that is itself an item needs no alias.
  const target = await deps.navision.getItem(input.itemNo);
  if (!target || from === aliasKey(target.itemNo) || (await deps.navision.getItem(input.writtenPartNo))) return false;

  const existing = await deps.db.partAlias.findUnique({ where: { fromPartNo: from } });
  if (existing?.toItemNo === target.itemNo) return false;
  await deps.db.partAlias.upsert({
    where: { fromPartNo: from },
    create: { fromPartNo: from, toItemNo: target.itemNo, createdBy: actor.name, createdAt: deps.clock.now() },
    update: { toItemNo: target.itemNo, createdBy: actor.name, createdAt: deps.clock.now(), timesConfirmed: 0 },
  });
  await recordAudit(deps, {
    actor,
    action: "alias_remembered",
    entityType: "alias",
    entityId: from,
    orderNo: input.orderNo,
    oldValue: existing?.toItemNo ?? null,
    newValue: target.itemNo,
    summary: `${actor.name} asked to remember that ${from} means ${target.itemNo}. It will be suggested next time.`,
  });
  return true;
}

export async function removeAlias(deps: Pick<Deps, "db" | "clock">, actor: Actor, fromPartNo: string): Promise<void> {
  const existing = await deps.db.partAlias.findUnique({ where: { fromPartNo } });
  requireThat(existing, "That alias no longer exists.");
  await deps.db.partAlias.delete({ where: { fromPartNo } });
  await recordAudit(deps, {
    actor,
    action: "alias_removed",
    entityType: "alias",
    entityId: fromPartNo,
    oldValue: existing.toItemNo,
    summary: `${actor.name} removed the remembered alias ${fromPartNo} = ${existing.toItemNo}.`,
  });
}

export async function listAliases(deps: Pick<Deps, "db">) {
  return deps.db.partAlias.findMany({ orderBy: { fromPartNo: "asc" } });
}

// ------------------------------------------------------------------------------------- suggestions and decisions on flags

/**
 * A person clicks a suggestion ("Use AB1234X"). Only now is the value changed, as that person's edit.
 * `remember` stores the fix in the alias memory when the suggestion came from a similar item.
 */
export async function acceptSuggestion(
  deps: EditDeps,
  actor: Actor,
  input: { orderNo: string; fingerprint: string; remember?: boolean },
): Promise<void> {
  const review = await loadEditable(deps, actor, input.orderNo);
  const flag = review.flags.find((candidate) => candidate.fingerprint === input.fingerprint);
  requireThat(flag?.suggestion, "That suggestion is no longer current. The page has been refreshed with the latest findings.");
  const { suggestion } = flag;
  await editField(deps, actor, {
    orderNo: input.orderNo,
    field: suggestion.field,
    value: suggestion.value,
    rememberAlias: Boolean(input.remember) && suggestion.source === "similar_part",
    reason: `Accepted the suggestion "${suggestion.label}" (${suggestion.source.replace("_", " ")}).`,
  });
  if (suggestion.source === "alias_memory" && flag.data?.written) {
    await deps.db.partAlias.updateMany({ where: { fromPartNo: aliasKey(flag.data.written) }, data: { timesConfirmed: { increment: 1 } } });
  }
}

/**
 * A person accepts a flagged difference as it is (for example a special-deal price). Needs a reason; the name is the actor's.
 * Invariant test: tests/invariants/override-needs-reason.test.ts
 */
export async function overrideFlag(deps: EditDeps, actor: Actor, input: { orderNo: string; fingerprint: string; reason: string }): Promise<void> {
  const review = await loadEditable(deps, actor, input.orderNo);
  const flag = review.flags.find((candidate) => candidate.fingerprint === input.fingerprint);
  requireThat(flag, "That finding is no longer current. The page has been refreshed with the latest findings.");
  requireThat(flag.decision === null, "That finding was already accepted.");
  const problem = validateDecisionInput(flag, { reason: input.reason, byName: actor.name }, "override");
  if (problem) throw new UserError(problem);

  await deps.db.flagDecision.create({
    data: {
      entityType: "document",
      entityId: review.document.id,
      kind: "override",
      flagCode: flag.code,
      field: flag.field,
      fingerprint: flag.fingerprint,
      reason: input.reason.trim(),
      byName: actor.name,
      byRole: actor.role,
      at: deps.clock.now(),
    },
  });
  await recordAudit(deps, {
    actor,
    action: "flag_override",
    entityType: "document",
    entityId: review.document.id,
    orderNo: input.orderNo,
    field: flag.field,
    reason: input.reason.trim(),
    summary: `${actor.name} accepted "${flagTitle(flag.code)}" as it is: ${flag.reason}`,
  });
}

/** Takes back an override while the PO is still a draft. */
export async function withdrawOverride(deps: EditDeps, actor: Actor, input: { orderNo: string; fingerprint: string }): Promise<void> {
  const review = await loadEditable(deps, actor, input.orderNo);
  const flag = review.flags.find((candidate) => candidate.fingerprint === input.fingerprint && candidate.decision !== null);
  requireThat(flag, "There is no accepted finding to take back.");
  await deps.db.flagDecision.deleteMany({ where: { entityType: "document", entityId: review.document.id, fingerprint: input.fingerprint } });
  await recordAudit(deps, {
    actor,
    action: "flag_override",
    entityType: "document",
    entityId: review.document.id,
    orderNo: input.orderNo,
    field: flag.field,
    summary: `${actor.name} took back the acceptance of "${flagTitle(flag.code)}". The finding is open again.`,
  });
}

// ------------------------------------------------------------------------------------- new customer card

export type CustomerCardInput = { orderNo: string; address: string; country: string; email: string };

/**
 * The customer is not in Navision: a person proposes a new customer card. Nothing is created yet;
 * the card is written together with the order when the export preview is approved.
 */
export async function proposeCustomerCard(deps: EditDeps, actor: Actor, input: CustomerCardInput): Promise<void> {
  const review = await loadEditable(deps, actor, input.orderNo);
  requireThat(review.po.customerName, "The customer name is missing. Type it in first.");
  requireThat(review.customer === null, `${review.po.customerName} is already a customer in Navision.`);
  const card = {
    name: review.po.customerName,
    address: normalizeInput(input.address) ?? review.po.customerAddress,
    country: normalizeInput(input.country),
    email: normalizeInput(input.email),
  };
  await deps.db.poVersion.update({ where: { id: review.version.id }, data: { customerCardJson: JSON.stringify(card) } });
  await recordAudit(deps, {
    actor,
    action: "customer_card_proposed",
    entityType: "order",
    entityId: input.orderNo,
    orderNo: input.orderNo,
    newValue: JSON.stringify(card),
    summary: `${actor.name} proposed a new customer card for "${card.name}". It is created in Navision only when the export is approved.`,
  });
}

export async function withdrawCustomerCard(deps: EditDeps, actor: Actor, orderNo: string): Promise<void> {
  const review = await loadEditable(deps, actor, orderNo);
  requireThat(review.version.customerCardJson, "No customer card is proposed for this PO.");
  await deps.db.poVersion.update({ where: { id: review.version.id }, data: { customerCardJson: null } });
  await recordAudit(deps, {
    actor,
    action: "customer_card_proposed",
    entityType: "order",
    entityId: orderNo,
    orderNo,
    oldValue: review.version.customerCardJson,
    summary: `${actor.name} withdrew the proposed customer card.`,
  });
}

/** Which fields of the review have something to undo, for showing Undo buttons. */
export function undoableFields(review: PoReview): string[] {
  const fields = [...new Set(review.edits.map((edit) => edit.field))];
  return fields.filter((field) => undoTarget(field, review.edits) !== null && findFieldSpecOrLine(review, field));
}

function findFieldSpecOrLine(review: PoReview, field: string): boolean {
  return findFieldSpec(review.spec, field) !== null || parseLineKey(field)?.name === "removed";
}
