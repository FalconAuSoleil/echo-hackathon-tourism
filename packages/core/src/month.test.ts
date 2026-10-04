import { afterEach, describe, expect, it } from "vitest";
import { localMonth, monthOfReceived } from "./month.ts";

// Le cœur est compilé sans types Node : accès typé à process.env, le temps du test (Node relit TZ à chaud).
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const initialTz = env.TZ;
afterEach(() => {
  if (initialTz === undefined) delete env.TZ;
  else env.TZ = initialTz;
});

describe("one clock for months (device local time)", () => {
  it("UTC-5, evening of the last day of the month: the message and the current month stay in the local month", () => {
    env.TZ = "America/New_York";
    const now = new Date("2026-11-01T02:30:00.000Z"); // 31 Oct, 21:30 local
    expect(monthOfReceived(now.toISOString())).toBe("2026-10");
    expect(localMonth(now)).toBe("2026-10");
  });

  it("Rwanda (UTC+2), 1st of the month at 01:00: next month, not the previous one", () => {
    env.TZ = "Africa/Kigali";
    const now = new Date("2026-09-30T23:00:00.000Z"); // 1 Oct, 01:00 local
    expect(monthOfReceived(now.toISOString())).toBe("2026-10");
    expect(localMonth(now)).toBe("2026-10");
  });

  it("an unreadable date falls back to its first 7 characters", () => {
    expect(monthOfReceived("2026-10")).toMatch(/^2026-(09|10)$/);
    expect(monthOfReceived("not a date")).toBe("not a d");
  });
});
