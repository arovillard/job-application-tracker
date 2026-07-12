import { Suspense } from "react";

import { NewOpportunityPage } from "../../../components/NewOpportunityPage";

export default function NewOpportunityRoute() {
  return <Suspense fallback={<main className="app-shell app-shell--narrow"><p>Loading opportunity form…</p></main>}><NewOpportunityPage /></Suspense>;
}
