import { redirect } from "next/navigation";

export default function LegacyNewApplicationRoute() { redirect("/opportunities/new?type=job"); }
