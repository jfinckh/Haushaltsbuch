// Next.js calls register() once when the server starts. In the Node.js runtime it starts the
// hourly run that books due regular bookings (src/app/_lib/recurring-schedule.ts).

const started = globalThis as unknown as { recurringScheduleStarted?: boolean };

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || started.recurringScheduleStarted) return;
  started.recurringScheduleStarted = true;
  const [{ recurringRunner }, { startRecurringSchedule }] = await Promise.all([
    import("@/app/_lib/recurring"),
    import("@/app/_lib/recurring-schedule"),
  ]);
  startRecurringSchedule(() => recurringRunner.runDue(), console);
}
