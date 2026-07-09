import { ApplicationDetailPage } from "../../../components/ApplicationDetailPage";

type ApplicationDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ApplicationDetailRoute({ params }: ApplicationDetailRouteProps) {
  const { id } = await params;

  return <ApplicationDetailPage applicationId={id} />;
}
