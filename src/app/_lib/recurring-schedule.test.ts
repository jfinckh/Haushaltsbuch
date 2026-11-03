import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRecurringSchedule } from "./recurring-schedule";

const HOUR = 3_600_000;

function fakeLog() {
  return { info: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startRecurringSchedule", () => {
  it("runs once at start and then every hour", async () => {
    const run = vi.fn().mockResolvedValue(0);
    const stop = startRecurringSchedule(run, fakeLog());
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("logs only the count", async () => {
    const log = fakeLog();
    const stop = startRecurringSchedule(vi.fn().mockResolvedValue(2), log);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.info).toHaveBeenCalledWith("recurring: booked 2");
    stop();
  });

  it("keeps running after a failure", async () => {
    const log = fakeLog();
    const run = vi.fn().mockRejectedValueOnce(new Error("secret 1.234,56")).mockResolvedValue(0);
    const stop = startRecurringSchedule(run, log);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith("recurring: run failed", "Error");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("1.234,56");
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not overlap runs", async () => {
    const run = vi.fn().mockReturnValue(new Promise<number>(() => {}));
    const stop = startRecurringSchedule(run, fakeLog());
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stop() ends the timer", async () => {
    const run = vi.fn().mockResolvedValue(0);
    const stop = startRecurringSchedule(run, fakeLog());
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
