import { Injectable } from '@nestjs/common';

/** Server clock. All business-time decisions use this, never the client's clock. Tests replace it. */
@Injectable()
export class Clock {
  private offsetMs = 0;
  private fixed: Date | null = null;
  now(): Date {
    if (this.fixed) return new Date(this.fixed.getTime());
    return new Date(Date.now() + this.offsetMs);
  }
  /** Test helpers */
  set(date: Date | null): void {
    this.fixed = date;
  }
  advance(ms: number): void {
    if (this.fixed) this.fixed = new Date(this.fixed.getTime() + ms);
    else this.offsetMs += ms;
  }
}
