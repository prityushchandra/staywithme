// Instant skeleton shown while search results load — clicking "Search" swaps to
// this immediately instead of hanging on the previous page.
export default function SearchLoading() {
  return (
    <div className="container animate-pulse py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="h-6 w-40 rounded bg-muted" />
          <div className="mt-2 h-4 w-24 rounded bg-muted" />
        </div>
      </div>

      <div className="flex gap-8">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24 space-y-4 rounded-xl border p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-muted" />
            ))}
          </div>
        </aside>

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[4/3] rounded-xl bg-muted" />
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-4 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
