import { OpportunityDetailPage } from "../../../components/OpportunityDetailPage";

export default async function OpportunityDetailRoute({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OpportunityDetailPage opportunityId={id} />; }
