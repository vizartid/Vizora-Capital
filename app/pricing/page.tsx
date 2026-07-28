import { PricingView } from "../components/EntryViews";
import { Suspense } from "react";

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingView />
    </Suspense>
  );
}
