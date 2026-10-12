import { notFound } from "next/navigation";
import { Masthead } from "@/components/Masthead";
import { PositionView } from "@/components/PositionView";
import { Terms } from "@/components/Terms";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || id === "0") notFound();
  return (
    <>
      <Masthead />
      <main>
        <PositionView id={BigInt(id)} />
      </main>
      <Terms />
    </>
  );
}
