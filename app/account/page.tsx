import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountForm } from "@/components/account-form";

export const metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=/account");

  // Read straight from the DB so what's shown is always the source of truth.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, name: true, phone: true, email: true },
  });
  if (!user) redirect("/sign-in");

  // Fall back to splitting an older single `name` if first/last aren't set yet.
  const parts = (user.name ?? "").trim().split(" ");
  const firstName = user.firstName ?? parts[0] ?? "";
  const lastName = user.lastName ?? parts.slice(1).join(" ") ?? "";

  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <p className="mt-1 text-muted-foreground">
        Update your name. Changes are saved to your account right away.
      </p>
      <div className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
        <AccountForm
          initial={{
            firstName,
            lastName,
            phone: user.phone,
            email: user.email,
          }}
        />
      </div>
    </div>
  );
}
