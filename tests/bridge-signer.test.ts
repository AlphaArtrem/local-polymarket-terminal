import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SIGN_TIMEOUT_MS, type OpKind } from "@/lib/wallet-protocol";
import {
  BridgeSigner,
  OutsideOperationError,
  RequestNotAllowedError,
  SignatureMismatchError,
  TransactionMismatchError,
  UserRejectedError,
} from "@/server/wallet/bridge-signer";
import { Operation } from "@/server/wallet/operation";

// Throwaway keys only: nothing here can touch a real account.
const user = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

const clobAuth = {
  domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
  types: { ClobAuth: [{ name: "address", type: "address" }, { name: "nonce", type: "uint256" }] },
  primaryType: "ClobAuth" as const,
  message: { address: user.address, nonce: 0n },
};
const orderTyped = {
  domain: { name: "Exchange", version: "2", chainId: 137 },
  types: { Order: [{ name: "salt", type: "uint256" }] },
  primaryType: "Order" as const,
  message: { salt: 1n },
};

function setup(kind: OpKind, rpc: Partial<ConstructorParameters<typeof BridgeSigner>[1]["rpc"]> = {}) {
  const op = new Operation(kind);
  const signer = new BridgeSigner(user.address, {
    rpc: { getTransaction: vi.fn(), waitForTransactionReceipt: vi.fn(), ...rpc } as never,
    txLookupPollMs: 1,
    txLookupTimeoutMs: 50,
  });
  signer.attach(op);
  return { op, signer };
}

async function pending(op: Operation) {
  const env = await op.next(1000);
  if (env.state !== "needs-wallet") throw new Error(`unexpected ${env.state}`);
  return env.pending;
}

afterEach(() => vi.useRealTimers());

describe("BridgeSigner", () => {
  it("throws OutsideOperationError immediately with no active operation", async () => {
    const signer = new BridgeSigner(user.address, { rpc: {} as never });
    await expect(signer.signTypedData(clobAuth as never)).rejects.toBeInstanceOf(OutsideOperationError);
    await expect(signer.signMessage("0x00")).rejects.toBeInstanceOf(OutsideOperationError);
    await expect(signer.sendTransaction({ chainId: 137, to: other.address as never })).rejects.toBeInstanceOf(OutsideOperationError);
  });

  it("returns a signature that recovers to the session signer", async () => {
    const { op, signer } = setup("connect");
    const p = signer.signTypedData(clobAuth as never);
    const sign = await pending(op);
    const signature = await user.signTypedData(clobAuth);
    op.reply({ opId: sign.opId, requestId: sign.requestId, result: { signature } });
    await expect(p).resolves.toBe(signature);
  });

  it("refuses an Order primary type during connect without asking the wallet", async () => {
    const { op, signer } = setup("connect");
    await expect(signer.signTypedData(orderTyped as never)).rejects.toBeInstanceOf(RequestNotAllowedError);
    expect((await op.next(0)).state).toBe("working");
  });

  it("rejects a signature made by another key", async () => {
    const { op, signer } = setup("connect");
    const p = signer.signTypedData(clobAuth as never);
    const sign = await pending(op);
    const signature = await other.signTypedData(clobAuth);
    op.reply({ opId: sign.opId, requestId: sign.requestId, result: { signature } });
    await expect(p).rejects.toBeInstanceOf(SignatureMismatchError);
  });

  it("surfaces a wallet rejection", async () => {
    const { op, signer } = setup("order");
    const p = signer.signTypedData(orderTyped as never);
    const sign = await pending(op);
    op.reply({ opId: sign.opId, requestId: sign.requestId, result: { rejected: true } });
    await expect(p).rejects.toBeInstanceOf(UserRejectedError);
  });

  it("refuses messages and transactions during an order", async () => {
    const { signer } = setup("order");
    await expect(signer.signMessage("0x00")).rejects.toBeInstanceOf(RequestNotAllowedError);
    await expect(signer.sendTransaction({ chainId: 137, to: other.address as never })).rejects.toBeInstanceOf(RequestNotAllowedError);
  });

  it("verifies a personal_sign signature in an approvals operation", async () => {
    const { op, signer } = setup("approvals");
    const p = signer.signMessage("0x1234");
    const sign = await pending(op);
    op.reply({ opId: sign.opId, requestId: sign.requestId, result: { signature: await other.signMessage({ message: { raw: "0x1234" } }) } });
    await expect(p).rejects.toBeInstanceOf(SignatureMismatchError);
  });

  it("rejects a sign request after the timeout", async () => {
    vi.useFakeTimers();
    const { signer } = setup("connect");
    const p = signer.signTypedData(clobAuth as never);
    const assertion = expect(p).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(SIGN_TIMEOUT_MS + 1);
    await assertion;
  });

  describe("sendTransaction", () => {
    const req = { chainId: 137, to: other.address as never, data: "0xabcd" as const, value: 0n };
    const hash = `0x${"11".repeat(32)}` as const;
    const tx = (over: object) => ({ from: user.address, to: other.address, input: "0xabcd", value: 0n, chainId: 137, ...over });

    it("returns a handle once the transaction matches the request", async () => {
      const { op, signer } = setup("approvals", {
        getTransaction: vi.fn().mockResolvedValue(tx({})) as never,
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }) as never,
      });
      const p = signer.sendTransaction(req);
      const sign = await pending(op);
      op.reply({ opId: sign.opId, requestId: sign.requestId, result: { txHash: hash } });
      const handle = await p;
      expect(handle.transactionHash).toBe(hash);
      expect(handle.transactionId).toBeNull();
      await expect(handle.wait()).resolves.toMatchObject({ transactionHash: hash });
    });

    it("refuses a transaction whose input differs from the request", async () => {
      const { op, signer } = setup("redeem", { getTransaction: vi.fn().mockResolvedValue(tx({ input: "0xdead" })) as never });
      const p = signer.sendTransaction(req);
      const sign = await pending(op);
      op.reply({ opId: sign.opId, requestId: sign.requestId, result: { txHash: hash } });
      await expect(p).rejects.toBeInstanceOf(TransactionMismatchError);
    });

    it("refuses a transaction from another sender, and another chain", async () => {
      for (const over of [{ from: other.address }, { chainId: 1 }, { value: 1n }, { to: user.address }]) {
        const { op, signer } = setup("approvals", { getTransaction: vi.fn().mockResolvedValue(tx(over)) as never });
        const p = signer.sendTransaction(req);
        const sign = await pending(op);
        op.reply({ opId: sign.opId, requestId: sign.requestId, result: { txHash: hash } });
        await expect(p).rejects.toBeInstanceOf(TransactionMismatchError);
      }
    });

    it("refuses a request for another chain before asking the wallet", async () => {
      const { signer } = setup("approvals");
      await expect(signer.sendTransaction({ ...req, chainId: 1 })).rejects.toBeInstanceOf(RequestNotAllowedError);
    });

    it("fails when the transaction can never be found", async () => {
      const { op, signer } = setup("approvals", { getTransaction: vi.fn().mockRejectedValue(new Error("nf")) as never });
      const p = signer.sendTransaction(req);
      const sign = await pending(op);
      op.reply({ opId: sign.opId, requestId: sign.requestId, result: { txHash: hash } });
      await expect(p).rejects.toBeInstanceOf(TransactionMismatchError);
    });

    it("wait() throws on a reverted receipt", async () => {
      const { op, signer } = setup("approvals", {
        getTransaction: vi.fn().mockResolvedValue(tx({})) as never,
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "reverted" }) as never,
      });
      const p = signer.sendTransaction(req);
      const sign = await pending(op);
      op.reply({ opId: sign.opId, requestId: sign.requestId, result: { txHash: hash } });
      await expect((await p).wait()).rejects.toThrow(/reverted/);
    });
  });
});

describe("Operation", () => {
  it("reply throws on a wrong opId or an unknown requestId", async () => {
    const { op, signer } = setup("connect");
    void signer.signTypedData(clobAuth as never).catch(() => undefined);
    const sign = await pending(op);
    const result = { signature: `0x${"00".repeat(65)}` as const };
    expect(() => op.reply({ opId: "nope", requestId: sign.requestId, result })).toThrow();
    expect(() => op.reply({ opId: sign.opId, requestId: "nope", result })).toThrow();
    op.settle({ status: 200, body: null });
  });

  it("next() reports working after the wait elapses, then done with the status preserved", async () => {
    const op = new Operation("order");
    expect((await op.next(5)).state).toBe("working");
    op.settle({ status: 422, body: { error: { code: "X", message: "m" } } });
    expect(await op.next(5)).toMatchObject({ state: "done", status: 422 });
  });
});
