// App-wide fallback skeleton: shown instantly during navigation to any route
// that doesn't define its own loading state (admin, wishlists, sign-in, host
// forms, etc.). This keeps every click feeling responsive even while the server
// renders against the remote database.
export default function RootLoading() {
  return (
    <div className="container animate-pulse py-8">
      <div className="h-7 w-56 max-w-[70%] rounded-md bg-muted" />
      <div className="mt-2 h-4 w-72 max-w-[80%] rounded bg-muted" />

      <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="aspect-[4/3] rounded-xl bg-muted" />
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
