"use client";

import { erc20Abi, zeroAddress, type Address } from "viem";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import { backstopVaultAbi, mockStabilityPoolAbi, priceFeedAbi, stabilityPoolAbi } from "./abi";
import { demoMode, vaultAddress } from "./config";

const WAD_ONE = 10n ** 18n;

// Liquidations land whenever they land; a few seconds' lag is fine for a
// position page and keeps public RPCs happy.
const REFRESH_MS = 6_000;

const vault = { address: vaultAddress ?? zeroAddress, abi: backstopVaultAbi } as const;

/** Everything about the vault that doesn't depend on who is looking. */
export function useVaultState() {
  const enabled = vaultAddress !== null;

  const base = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...vault, functionName: "asset" },
      { ...vault, functionName: "totalAssets" },
      { ...vault, functionName: "totalSupply" },
      { ...vault, functionName: "pendingBtcValue" },
      { ...vault, functionName: "harvestableBtc" },
      { ...vault, functionName: "withdrawalsAvailable" },
      { ...vault, functionName: "harvestFeeBps" },
      { ...vault, functionName: "swapQualityBps" },
      { ...vault, functionName: "convertToAssets", args: [WAD_ONE] },
      { ...vault, functionName: "stabilityPool" },
      { ...vault, functionName: "priceFeed" },
      { ...vault, functionName: "swapper" },
      { ...vault, functionName: "owner" },
    ],
    query: { enabled, refetchInterval: REFRESH_MS },
  });

  const [
    asset,
    totalAssets,
    totalSupply,
    pendingBtcValue,
    harvestableBtc,
    withdrawalsAvailable,
    harvestFeeBps,
    swapQualityBps,
    sharePrice,
    stabilityPool,
    priceFeed,
    swapper,
    owner,
  ] = base.data ?? [];

  const pool = useReadContracts({
    allowFailure: false,
    contracts: [
      {
        address: stabilityPool ?? zeroAddress,
        abi: stabilityPoolAbi,
        functionName: "getTotalMUSDDeposits",
      },
      {
        address: stabilityPool ?? zeroAddress,
        abi: stabilityPoolAbi,
        functionName: "getCompoundedMUSDDeposit",
        args: [vaultAddress ?? zeroAddress],
      },
      { address: priceFeed ?? zeroAddress, abi: priceFeedAbi, functionName: "fetchPrice" },
    ],
    query: { enabled: !!stabilityPool && !!priceFeed, refetchInterval: REFRESH_MS },
  });

  const [poolTotal, vaultInPool, btcPrice] = pool.data ?? [];

  // The real pool has no view for "a Trove is liquidatable", which is why the
  // vault's own check is best-effort. The demo's mock pool does expose its
  // switch, so there the page can say exactly what a withdrawal would meet.
  const demoBlocked = useReadContract({
    address: stabilityPool ?? zeroAddress,
    abi: mockStabilityPoolAbi,
    functionName: "blockWithdrawals",
    query: { enabled: demoMode && !!stabilityPool, refetchInterval: REFRESH_MS },
  });

  return {
    deployed: enabled,
    loading: enabled && base.isLoading,
    error: base.error ?? pool.error,
    refetch: () => Promise.all([base.refetch(), pool.refetch()]),
    asset,
    totalAssets,
    totalSupply,
    pendingBtcValue,
    harvestableBtc,
    withdrawalsAvailable: demoBlocked.data === true ? false : withdrawalsAvailable,
    harvestFeeBps,
    swapQualityBps,
    sharePrice,
    stabilityPool,
    priceFeed,
    swapper,
    owner,
    poolTotal,
    vaultInPool,
    btcPrice,
  };
}

export type VaultState = ReturnType<typeof useVaultState>;

/** The connected account's side: its shares, its MUSD, its allowance. */
export function useAccountState(asset: Address | undefined) {
  const { address } = useConnection();
  const who = address ?? zeroAddress;
  const musd = { address: asset ?? zeroAddress, abi: erc20Abi } as const;

  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...vault, functionName: "balanceOf", args: [who] },
      { ...vault, functionName: "maxWithdraw", args: [who] },
      { ...musd, functionName: "balanceOf", args: [who] },
      { ...musd, functionName: "allowance", args: [who, vaultAddress ?? zeroAddress] },
    ],
    query: {
      enabled: !!address && !!asset && vaultAddress !== null,
      refetchInterval: REFRESH_MS,
    },
  });

  const [shares, maxWithdraw, musdBalance, allowance] = reads.data ?? [];

  return {
    address,
    shares,
    /** The MUSD those shares redeem for right now. */
    position: maxWithdraw,
    musdBalance,
    allowance,
    refetch: reads.refetch,
  };
}

export { vault as vaultContract };
