"use client";

import { DemoPanel } from "@/components/DemoPanel";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Ledger } from "@/components/Ledger";
import { Masthead } from "@/components/Masthead";
import { Terms } from "@/components/Terms";
import { demoMode } from "@/lib/config";
import { useVaultState } from "@/lib/vault";

export default function Home() {
  const vault = useVaultState();

  return (
    <>
      <Masthead vault={vault} />
      <main>
        <Hero vault={vault} />
        {demoMode && vault.deployed && <DemoPanel vault={vault} />}
        <HowItWorks vault={vault} />
        <Ledger vault={vault} />
      </main>
      <Terms vault={vault} />
    </>
  );
}
