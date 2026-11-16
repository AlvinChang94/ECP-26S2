// What: hands out running numbers for references such as ORD-1042, SPR-0007 and SHP-0003.
// Who calls it: the services that create orders, SPRs and shipments.
// To extend: add an entry to SEQUENCES. The seed script sets the "order" counter so the demo order becomes ORD-1042.
import type { Deps } from "./deps";

const SEQUENCES = {
  order: { prefix: "ORD-", firstNumber: 1001, digits: 4 },
  spr: { prefix: "SPR-", firstNumber: 1, digits: 4 },
  shipment: { prefix: "SHP-", firstNumber: 1, digits: 4 },
} as const;

export type SequenceName = keyof typeof SEQUENCES;

/** Returns the next reference of a sequence, for example "ORD-1043". */
export async function nextReference(deps: Pick<Deps, "db">, name: SequenceName): Promise<string> {
  const sequence = SEQUENCES[name];
  const row = await deps.db.counter.upsert({
    where: { name },
    create: { name, value: sequence.firstNumber },
    update: { value: { increment: 1 } },
  });
  return `${sequence.prefix}${String(row.value).padStart(sequence.digits, "0")}`;
}

/** Makes the next reference of a sequence start after `lastUsed`. Only the seed script uses this. */
export async function setLastUsedNumber(deps: Pick<Deps, "db">, name: SequenceName, lastUsed: number): Promise<void> {
  await deps.db.counter.upsert({ where: { name }, create: { name, value: lastUsed }, update: { value: lastUsed } });
}
