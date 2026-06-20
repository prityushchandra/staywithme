// Point the existing admin account at ADMIN_PHONE so the admin can sign in via
// phone OTP. Non-destructive; safe to re-run.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const email = process.env.ADMIN_EMAIL ?? "admin@mybnb.local";
const phone = process.env.ADMIN_PHONE;
if (!phone) {
  console.error("ADMIN_PHONE is not set in .env");
  process.exit(1);
}

const admin = await prisma.user.findUnique({ where: { email } });
if (!admin) {
  console.error(`No admin user found with email ${email}`);
  process.exit(1);
}

// Clear this phone off any other account first (unique constraint safety).
await prisma.user.updateMany({
  where: { phone, NOT: { id: admin.id } },
  data: { phone: null },
});

await prisma.user.update({
  where: { id: admin.id },
  data: { phone, isAdmin: true },
});

console.log(`Admin ${email} can now sign in with phone ${phone}`);
await prisma.$disconnect();
