import { Suspense } from "react";
import { BrowseView } from "@/components/browse/BrowseView";

// useSearchParams in BrowseView needs a Suspense boundary.
export default function Home() {
  return (
    <Suspense fallback={<div className="muted" role="status">Loading…</div>}>
      <BrowseView />
    </Suspense>
  );
}
