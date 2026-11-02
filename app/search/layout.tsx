"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import SearchLoading from "./loading";

export default function SearchLayout({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();

  // Next preserves page state across query-only navigation. Reset the result
  // subtree so a suspended/deferred render cannot retain the previous filters.
  return (
    <Suspense key={searchParams.toString()} fallback={<SearchLoading />}>
      {children}
    </Suspense>
  );
}
