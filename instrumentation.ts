// Boot-time background timers. These rely on a long-running process, so they
// only run on a persistent host (e.g. `next start` on a VM/Render/Railway).
//
// On Vercel there is no long-lived process — setInterval would be created inside
// a serverless function that gets frozen the moment the response is sent, so it
// never fires reliably. There, reminders run via Vercel Cron hitting
// /api/cron/reminders (see vercel.json), and Neon cold-starts are fine.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL) return; // serverless: cron handles reminders, skip timers

  const { prisma } = await import("./lib/db");
  const ping = () => {
    prisma.$queryRaw`SELECT 1`.catch(() => {});
  };
  ping(); // warm immediately on boot
  setInterval(ping, 4 * 60 * 1000); // every 4 minutes (< Neon's 5 min idle)

  // Send the "3 days before check-in" reminders. reminderSentAt dedups, so
  // running a few times a day is safe; a missed run self-heals on the next tick.
  const reminders = async () => {
    try {
      const { runCheckinReminders } = await import("./lib/bookings");
      await runCheckinReminders();
    } catch (e) {
      console.error("[reminders] failed", e);
    }
  };
  reminders();
  setInterval(reminders, 6 * 60 * 60 * 1000); // every 6 hours
}
