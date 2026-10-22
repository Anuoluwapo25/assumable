import type { Metadata } from "next";
import { CashOut } from "@/components/cash/CashOut";
import { CashHeader } from "@/components/cash/CashHeader";

export const metadata: Metadata = {
  title: "Cash out: Bitcoin to local money in one tap",
  description: "Borrow against your Bitcoin and get local money in your bank or mobile wallet. Your Bitcoin stays yours.",
};

export default function CashPage() {
  return (
    <>
      <CashHeader />
      <main className="mx-auto max-w-[560px] px-4 pb-16 sm:px-8">
        <h1 className="wide animate-rise pb-6 pt-6 text-[40px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:pt-10 sm:text-[56px]">
          Cash <span className="text-musd">out.</span>
        </h1>
        <p className="-mt-2 mb-6 text-[16px] leading-snug text-ink-soft">
          Local money in your account, backed by your Bitcoin. You keep the Bitcoin.
        </p>
        <CashOut />
      </main>
    </>
  );
}
