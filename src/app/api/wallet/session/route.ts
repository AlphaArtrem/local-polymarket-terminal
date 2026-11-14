import { isAddress } from "viem";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import {
  AccountLookupError,
  fetchPolBalance,
  resolveAccount,
  WalletNotDeployedError,
  WalletNotOwnedError,
  type ResolvedAccount,
} from "@/lib/polymarket-core";
import { LONG_POLL_MS, type AccountInfo, type WalletTypeName } from "@/lib/wallet-protocol";
import { getAccountMode } from "@/server/account/context";
import { getEnv } from "@/server/env";
import { getEnvAccount } from "@/server/polymarket";
import { envelopeResponse, errorBody } from "@/server/wallet/operation";
import { UserRejectedError } from "@/server/wallet/bridge-signer";
import {
  beginConnect,
  clearSessionCookie,
  currentSession,
  endSession,
  isCurrent,
  setSessionCookie,
  startOperation,
} from "@/server/wallet/session";

export const dynamic = "force-dynamic";

// Numeric order of the SDK's WalletType enum.
const WALLET_TYPES: WalletTypeName[] = ["EOA", "POLY_PROXY", "GNOSIS_SAFE", "DEPOSIT_WALLET"];

async function infoFor(mode: AccountInfo["mode"], account: ResolvedAccount): Promise<AccountInfo> {
  const env = getEnv();
  const { signer, wallet, walletType } = account.client.account;
  const polBalance = await fetchPolBalance(env.polygonRpcUrl, signer).catch((err: unknown) => {
    console.error(`[wallet] POL balance unavailable: ${err instanceof Error ? err.name : "error"}`);
    return null;
  });
  return {
    mode,
    connected: true,
    signer,
    wallet,
    walletType: WALLET_TYPES[walletType as number] ?? null,
    source: account.source,
    gasless: account.gasless,
    relayerMismatch: account.relayerMismatch,
    polBalance,
    automationAvailable: mode === "key" && env.automationEnabled,
  };
}

function disconnected(mode: AccountInfo["mode"]): AccountInfo {
  return {
    mode,
    connected: false,
    signer: null,
    wallet: null,
    walletType: null,
    source: null,
    gasless: false,
    relayerMismatch: false,
    polBalance: null,
    automationAvailable: false,
  };
}

export async function GET() {
  try {
    const mode = getAccountMode();
    if (mode === "key") return Response.json(await infoFor("key", await getEnvAccount()), { headers: { "Cache-Control": "no-store" } });
    const account = (await currentSession())?.account;
    return Response.json(account ? await infoFor("wallet", account) : disconnected("wallet"), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return connectError(err);
  }
}

const connectBody = z.object({
  address: z.string().refine((v) => isAddress(v, { strict: false }), "must be an address"),
  wallet: z.string().refine((v) => isAddress(v, { strict: false }), "must be an address").optional(),
});

/** Starts the `connect` operation: the wallet signs one ClobAuth message, then the account resolves. */
export async function POST(request: Request) {
  if (getAccountMode() === "key") return jsonError(409, "KEY_MODE", "A server key is configured; wallet connect is disabled");
  const json: unknown = await request.json().catch(() => null);
  const body = connectBody.safeParse(json);
  if (!body.success) {
    return jsonError(400, "INVALID_BODY", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const env = getEnv();
  const { token, session } = beginConnect(body.data.address, body.data.wallet);
  await setSessionCookie(token);
  const op = startOperation(session, "connect", async () => {
    try {
      const account = await resolveAccount({
        signer: session.bridge,
        signerAddress: session.signer,
        walletOverride: session.walletOverride,
        walletSource: "user",
        polygonRpcUrl: env.polygonRpcUrl,
        relayer: env.relayer,
      });
      if (!isCurrent(session)) {
        // Replaced or ended while the wallet was open: discard instead of reviving a dead slot.
        await account.client.closeSubscriptions().catch(() => undefined);
        return { status: 409, body: errorBody("SESSION_REPLACED", "The wallet session was replaced") };
      }
      session.account = account;
      return { status: 200, body: await infoFor("wallet", account) };
    } catch (err) {
      if (isCurrent(session)) {
        // Detach this op first: endSession fails a live op, which would mask the real error below.
        session.op = null;
        endSession();
      }
      const { status, response } = connectErrorParts(err);
      return { status, body: response };
    }
  });
  return envelopeResponse(await op.next(LONG_POLL_MS));
}

export async function DELETE() {
  endSession();
  await clearSessionCookie();
  return Response.json({ ok: true });
}

/** Maps account-resolution failures to stable codes; messages come from our own error classes only. */
function connectErrorParts(err: unknown): { status: number; response: ReturnType<typeof errorBody> } {
  if (err instanceof UserRejectedError) return { status: 403, response: errorBody("USER_REJECTED", err.message) };
  if (err instanceof AccountLookupError) return { status: 503, response: errorBody("ACCOUNT_LOOKUP_FAILED", err.message) };
  if (err instanceof WalletNotDeployedError || err instanceof WalletNotOwnedError) {
    return { status: 409, response: errorBody("WALLET_CONFIG", err.message) };
  }
  const name = err instanceof Error ? err.name : "Error";
  console.error(`[wallet] connect failed: ${name}`);
  return { status: 500, response: errorBody("CONNECT_FAILED", `Could not connect the wallet (${name})`) };
}

function connectError(err: unknown): Response {
  const { status, response } = connectErrorParts(err);
  return Response.json(response, { status });
}
