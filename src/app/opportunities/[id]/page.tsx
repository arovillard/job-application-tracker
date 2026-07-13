import { OpportunityDetailPage } from "../../../components/OpportunityDetailPage";
import { parseAttentionTarget, type AttentionSearchParams } from "../../../lib/opportunity-attention";

export default async function OpportunityDetailRoute({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AttentionSearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <OpportunityDetailPage opportunityId={id} attentionTarget={parseAttentionTarget(query)} />;
}
