import { notFound } from "next/navigation";
import { DemoCase } from "@/features/demo/case-detail";
import { contextFrom, firstValue, packs, snapshot, type SearchValues } from "@/features/demo/data";

export default async function DemoCasePage({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<SearchValues> }) {
  const [{ caseId }, values] = await Promise.all([params, searchParams]);
  const pack = packs.find((item) => item.id === caseId);
  if (!pack) notFound();
  return <DemoCase view={snapshot(pack, firstValue(values.checkpoint))} context={contextFrom(values)} />;
}
