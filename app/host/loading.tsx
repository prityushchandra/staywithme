// Instant skeleton for the host dashboard — after submitting a listing, the
// app navigates here and shows this immediately instead of waiting on the
// dashboard's analytics queries.
export default function HostLoading() {
  return (
    <div className="container animate-pulse py-8">
      <div className="h-7 w-48 rounded bg-muted" />
      <div className="mt-2 h-4 w-64 rounded bg-muted" />

      {/* KPI cards */}
      <div className="mb-8 mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border bg-muted/40" />
        ))}
      </div>

      {/* Listing rows */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 rounded-xl border p-4">
            <div className="h-20 w-32 shrink-0 rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 rounded bg-muted" />
              <div className="h-4 w-1/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
