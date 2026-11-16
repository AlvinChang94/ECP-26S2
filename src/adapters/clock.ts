// What: the Clock interface (the only source of "now") and its three implementations.
// Who calls it: services ask deps.clock.now(); tests and the KPI replay pass a FakeClock; the app uses OffsetClock.
// To extend: in AWS the real clock stays SystemClock; scheduled work is triggered by EventBridge calling runDueJobs(now).

export interface Clock {
  now(): Date;
}

/** Real time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Real time shifted by a fixed amount. The demo uses it so the seeded scenario always starts at the same
 * simulated moment, and so "advance 24 hours" can show reminders without waiting a day.
 */
export class OffsetClock implements Clock {
  constructor(private readonly offsetMs: number) {}

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
}

/** A clock that only moves when told to. Used by tests, the seed script and the KPI replay. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 60 * 60 * 1000);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60 * 1000);
  }
}
