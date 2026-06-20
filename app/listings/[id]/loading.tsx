// Instant skeleton shown while the listing page's data loads. Eliminates the
// "hang on the old page, then snap" feel when opening a listing — navigation
// now swaps immediately to this placeholder that matches the real layout.
export default function ListingLoading() {
  return (
    <div className="container animate-pulse py-6">
      {/* Title + meta */}
      <div className="h-7 w-2/3 max-w-md rounded-md bg-muted sm:h-8" />
      <div className="mt-2 h-4 w-48 rounded bg-muted" />

      {/* Gallery */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4 sm:grid-rows-2">
        <div className="aspect-[4/3] rounded-2xl bg-muted sm:col-span-2 sm:row-span-2 sm:aspect-auto" />
        <div className="hidden aspect-square rounded-2xl bg-muted sm:block" />
        <div className="hidden aspect-square rounded-2xl bg-muted sm:block" />
        <div className="hidden aspect-square rounded-2xl bg-muted sm:block" />
        <div className="hidden aspect-square rounded-2xl bg-muted sm:block" />
      </div>

      {/* Two columns */}
      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="h-6 w-1/2 rounded bg-muted" />
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="mt-6 space-y-2">
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-11/12 rounded bg-muted" />
            <div className="h-4 w-4/5 rounded bg-muted" />
          </div>
        </div>
        <div className="lg:col-span-1">
          <div className="h-80 rounded-2xl border bg-muted/40" />
        </div>
      </div>
    </div>
  );
}
