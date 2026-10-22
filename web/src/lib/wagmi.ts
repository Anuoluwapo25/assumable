import { fallback } from "viem";
import { createConfig, http, injected } from "wagmi";
import { chain, rpcUrls } from "./config";

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: fallback(rpcUrls.map((u) => http(u))) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
