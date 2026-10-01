import { contextFrom, firstValue, type SearchValues } from "@/features/demo/data";
import { DemoQueue } from "@/features/demo/queue";

export default async function DemoPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const values = await searchParams;
  return <DemoQueue context={contextFrom(values)} view={firstValue(values.view)} />;
}
