// What: UserError, the error type for problems a person can fix (a missing reason, an expired link, a wrong role).
// Who calls it: services throw it; server actions catch it and show the message on the page (see src/app/_lib/forms.ts).
// To extend: throw UserError for expected problems. Let every other error crash loudly so bugs are not hidden.

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** Throws a UserError unless the condition holds. Reads well at the top of a service function. */
export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new UserError(message);
}
