import "server-only";
import type { Signer, SignerTransactionRequest, TransactionHandle, TypedDataPayload } from "@polymarket/client";
import { isAddressEqual, recoverMessageAddress, recoverTypedDataAddress, type Hex, type PublicClient as ViemPublicClient } from "viem";
import { ALLOWED_PRIMARY_TYPES, MESSAGE_ALLOWED, TX_ALLOWED } from "@/lib/wallet-protocol";
import type { Operation } from "./operation";

type EvmAddress = Awaited<ReturnType<Signer["getAddress"]>>;
type EvmSignature = Awaited<ReturnType<Signer["signTypedData"]>>;

const POLYGON_CHAIN_ID = 137;
const TX_LOOKUP_TIMEOUT_MS = 30_000;
const TX_LOOKUP_POLL_MS = 1_000;

/** The SDK asked for a signature or transaction while no user-started operation was active. */
export class OutsideOperationError extends Error {
  constructor() {
    super("Wallet request refused: no operation is active");
    this.name = "OutsideOperationError";
  }
}
/** The wallet returned a signature that does not recover to the session signer. */
export class SignatureMismatchError extends Error {
  constructor() {
    super("The wallet's signature does not match the connected address");
    this.name = "SignatureMismatchError";
  }
}
/** The request is not allowed for the active operation (primary type, message, transaction). */
export class RequestNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestNotAllowedError";
  }
}
export class UserRejectedError extends Error {
  constructor(reason?: string) {
    super(reason ? `Rejected in the wallet: ${reason}` : "Rejected in the wallet");
    this.name = "UserRejectedError";
  }
}
/** The transaction the wallet sent differs from what was requested. */
export class TransactionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionMismatchError";
  }
}

export type BridgeDeps = {
  rpc: Pick<ViemPublicClient, "getTransaction" | "waitForTransactionReceipt">;
  /** Test hooks; defaults are 30 s and 1 s. */
  txLookupTimeoutMs?: number;
  txLookupPollMs?: number;
};

/**
 * Signer that holds no key. Requests are parked on the active Operation for the browser wallet and
 * every answer is verified before the SDK sees it. Inert outside an operation the user started.
 */
export class BridgeSigner implements Signer {
  private op: Operation | null = null;

  constructor(
    private readonly address: `0x${string}`,
    private readonly deps: BridgeDeps,
  ) {}

  attach(op: Operation): void {
    this.op = op;
  }

  detach(): void {
    this.op = null;
  }

  async getAddress(): Promise<EvmAddress> {
    return this.address as EvmAddress;
  }

  private requireOp(): Operation {
    if (!this.op || this.op.finished) throw new OutsideOperationError();
    return this.op;
  }

  async signTypedData(p: TypedDataPayload): Promise<EvmSignature> {
    const op = this.requireOp();
    if (!ALLOWED_PRIMARY_TYPES[op.kind].includes(p.primaryType)) {
      throw new RequestNotAllowedError(`Typed data "${p.primaryType}" is not allowed during ${op.kind}`);
    }
    const result = await op.request("signTypedData", p, op.kind === "withdraw" ? `Withdraw: sign ${p.primaryType}` : `Sign ${p.primaryType}`);
    if (!("signature" in result)) throw rejectionOrProtocol(result);
    const recovered = await recoverTypedDataAddress({
      domain: p.domain,
      types: p.types,
      primaryType: p.primaryType,
      message: p.message,
      signature: result.signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]).catch(() => null);
    if (!recovered || !isAddressEqual(recovered, this.address)) throw new SignatureMismatchError();
    return result.signature as EvmSignature;
  }

  async signMessage(m: Hex): Promise<EvmSignature> {
    const op = this.requireOp();
    if (!MESSAGE_ALLOWED.includes(op.kind)) {
      throw new RequestNotAllowedError(`Message signing is not allowed during ${op.kind}`);
    }
    const result = await op.request("signMessage", m, "Sign a message");
    if (!("signature" in result)) throw rejectionOrProtocol(result);
    const recovered = await recoverMessageAddress({ message: { raw: m }, signature: result.signature }).catch(() => null);
    if (!recovered || !isAddressEqual(recovered, this.address)) throw new SignatureMismatchError();
    return result.signature as EvmSignature;
  }

  async sendTransaction(r: SignerTransactionRequest): Promise<TransactionHandle> {
    const op = this.requireOp();
    if (!TX_ALLOWED.includes(op.kind)) {
      throw new RequestNotAllowedError(`Transactions are not allowed during ${op.kind}`);
    }
    if (r.chainId !== POLYGON_CHAIN_ID) throw new RequestNotAllowedError(`Unexpected chain ${r.chainId}`);
    const result = await op.request("sendTransaction", r, `Send a transaction to ${r.to}`);
    if (!("txHash" in result)) throw rejectionOrProtocol(result);
    const hash = result.txHash;
    await this.verifyTransaction(hash, r);
    const { rpc } = this.deps;
    return {
      transactionHash: hash as never,
      transactionId: null,
      async wait() {
        const receipt = await rpc.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") throw new Error("Transaction reverted");
        return { transactionHash: hash as never, transactionId: null };
      },
    };
  }

  /** The wallet could send anything: look the transaction up and compare it with the request. */
  private async verifyTransaction(hash: `0x${string}`, r: SignerTransactionRequest): Promise<void> {
    const timeout = this.deps.txLookupTimeoutMs ?? TX_LOOKUP_TIMEOUT_MS;
    const poll = this.deps.txLookupPollMs ?? TX_LOOKUP_POLL_MS;
    const deadline = Date.now() + timeout;
    for (;;) {
      let tx: Awaited<ReturnType<BridgeDeps["rpc"]["getTransaction"]>> | null = null;
      try {
        tx = await this.deps.rpc.getTransaction({ hash });
      } catch (err) {
        // Not yet visible to the RPC node is expected right after sending; keep polling until the deadline.
        if (Date.now() >= deadline) throw new TransactionMismatchError(`Could not look up the transaction: ${err instanceof Error ? err.name : "error"}`);
      }
      if (tx) {
        const sameChain = tx.chainId === undefined || tx.chainId === r.chainId;
        const ok =
          isAddressEqual(tx.from, this.address) &&
          tx.to != null &&
          isAddressEqual(tx.to, r.to as `0x${string}`) &&
          (tx.input ?? "0x").toLowerCase() === (r.data ?? "0x").toLowerCase() &&
          tx.value === (r.value ?? 0n) &&
          sameChain;
        if (!ok) throw new TransactionMismatchError("The wallet sent a different transaction than requested");
        return;
      }
      if (Date.now() >= deadline) throw new TransactionMismatchError("Could not look up the transaction");
      await new Promise((res) => setTimeout(res, poll));
    }
  }
}

function rejectionOrProtocol(result: { rejected?: true; reason?: string } | Record<string, unknown>): Error {
  if ("rejected" in result) return new UserRejectedError(typeof result.reason === "string" ? result.reason : undefined);
  return new Error("Unexpected wallet reply for this request");
}
