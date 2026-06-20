import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "@/components/admin/user-actions";

export const metadata = { title: "Admin · Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await auth();
  const users = await prisma.user.findMany({
    include: { _count: { select: { listings: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>

      <div className="space-y-3">
        {users.map((u) => {
          const isHost = u.roles.includes("HOST");
          return (
            <div key={u.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{u.name ?? "—"}</span>
                    {u.isAdmin && <Badge>Admin</Badge>}
                    {isHost && <Badge variant="secondary">Host</Badge>}
                    {u.suspended && <Badge variant="destructive">Suspended</Badge>}
                    {u.id === session!.user.id && <Badge variant="outline">You</Badge>}
                  </div>
                  <p className="break-words text-sm text-muted-foreground">
                    {u.email} · {u._count.listings} listings
                  </p>
                </div>
                <UserActions
                  userId={u.id}
                  isSelf={u.id === session!.user.id}
                  isAdmin={u.isAdmin}
                  isHost={isHost}
                  suspended={u.suspended}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
