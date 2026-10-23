/**
 * Tiny, pure state-machine helper. Each transition lists the evidence it requires
 * (e.g. "DELIVERY_ORDER", "APPROVAL"); callers pass the evidence they hold and get a
 * yes/no with the reason. No side effects: persisting the new state is the caller's job.
 */

export interface Transition<S extends string, E extends string> {
  from: S | readonly S[];
  to: S;
  requires?: readonly E[];
}

export interface StateMachineDefinition<S extends string, E extends string> {
  states: readonly S[];
  initial: S;
  transitions: readonly Transition<S, E>[];
}

export type TransitionCheck<E extends string> =
  | { ok: true }
  | { ok: false; reason: "UNKNOWN_STATE"; state: string }
  | { ok: false; reason: "NOT_ALLOWED" }
  | { ok: false; reason: "MISSING_EVIDENCE"; missing: E[] };

export interface StateMachine<S extends string, E extends string> {
  readonly definition: StateMachineDefinition<S, E>;
  /** States reachable from `from` in one step. */
  allowedTargets(from: S): S[];
  /** Evidence required for from → to, or null if that transition does not exist. */
  requiredEvidence(from: S, to: S): E[] | null;
  check(from: S, to: S, evidence: readonly E[]): TransitionCheck<E>;
}

export function defineStateMachine<S extends string, E extends string = never>(
  definition: StateMachineDefinition<S, E>,
): StateMachine<S, E> {
  const known = new Set<string>(definition.states);
  const fromList = (t: Transition<S, E>): readonly S[] =>
    typeof t.from === "string" ? [t.from as S] : (t.from as readonly S[]);

  // Fail at definition time, not at runtime, if the machine references unknown states.
  if (!known.has(definition.initial)) {
    throw new Error(`Initial state "${definition.initial}" is not in states`);
  }
  for (const t of definition.transitions) {
    for (const s of [...fromList(t), t.to]) {
      if (!known.has(s)) throw new Error(`Transition references unknown state "${s}"`);
    }
  }

  const find = (from: S, to: S) =>
    definition.transitions.find((t) => t.to === to && fromList(t).includes(from));

  return {
    definition,
    allowedTargets(from) {
      return definition.transitions.filter((t) => fromList(t).includes(from)).map((t) => t.to);
    },
    requiredEvidence(from, to) {
      const t = find(from, to);
      return t ? [...(t.requires ?? [])] : null;
    },
    check(from, to, evidence) {
      for (const s of [from, to]) {
        if (!known.has(s)) return { ok: false, reason: "UNKNOWN_STATE", state: s };
      }
      const t = find(from, to);
      if (!t) return { ok: false, reason: "NOT_ALLOWED" };
      const held = new Set(evidence);
      const missing = (t.requires ?? []).filter((e) => !held.has(e));
      return missing.length > 0 ? { ok: false, reason: "MISSING_EVIDENCE", missing } : { ok: true };
    },
  };
}
