"use client";

import { createContext, useContext } from "react";
import type { ProviderDetail } from "@/lib/eip6963";
import type { AccountInfo, AccountMode } from "@/lib/wallet-protocol";

export type WalletState = {
  mode: AccountMode;
  /** Server session info; null until the first answer or when nothing is connected. */
  info: AccountInfo | null;
  /** False until the first session check finished (avoids flashing a "connect" prompt). */
  ready: boolean;
  connected: boolean;
  providers: ProviderDetail[];
  /** Name of the extension that signs for this tab, if this tab holds the controller. */
  walletName: string | null;
  busy: boolean;
  error: string | null;
  /** Bumps on connect, disconnect and lost sessions so dependants can refetch. */
  version: number;
  connectOpen: boolean;
  openConnect(): void;
  closeConnect(): void;
  connect(detail: ProviderDetail, accountWallet?: string): Promise<void>;
  disconnect(): Promise<void>;
  /** fetch that runs the signing loop for operation envelopes; identical to fetch otherwise. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
};

const noop = async () => undefined;

/** Fallback used outside the provider (isolated renders): key mode, plain fetch. */
export const WalletContext = createContext<WalletState>({
  mode: "key",
  info: null,
  ready: true,
  connected: true,
  providers: [],
  walletName: null,
  busy: false,
  error: null,
  version: 0,
  connectOpen: false,
  openConnect: () => undefined,
  closeConnect: () => undefined,
  connect: noop,
  disconnect: noop,
  fetch: (url, init) => fetch(url, init),
});

export function useWallet(): WalletState {
  return useContext(WalletContext);
}
