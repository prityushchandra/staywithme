// Instant skeleton shown while an admin page's server render (DB queries) is in
// flight. Without this, navigating between admin pages blocks with no feedback,
// which feels "stuck". The sidebar (in the layout) stays; only this content
// area swaps.
export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-44 rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
