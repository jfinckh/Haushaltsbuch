const HOUR = 3_600_000;

type Log = Pick<Console, "info" | "error">;

/**
 * Books due regular bookings once now and then every `everyMs` (default: hourly). A run never
 * overlaps the previous one. Logs only the count; a failure logs the error's name, never its
 * message (it could hold booking data). Returns a function that stops the schedule.
 */
export function startRecurringSchedule(run: () => Promise<number>, log: Log, everyMs = HOUR): () => void {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      log.info(`recurring: booked ${await run()}`);
    } catch (error) {
      log.error("recurring: run failed", error instanceof Error ? error.name : "unknown");
    } finally {
      running = false;
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  return () => clearInterval(timer);
}
