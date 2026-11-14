/** Plain DTOs shared by the dashboard API routes and client components. No SDK types leak here. */

export type AccountDto = {
  signer: string;
  wallet: string;
  walletType: string;
  /** pUSD balance in dollars, decimal string. */
  balance: string;
  /** Portfolio value in dollars, or null when unavailable. */
  portfolioValue: string | null;
  /** Latest total PnL in dollars (realized + unrealized), or null when unavailable. */
  pnl: string | null;
};

export type PositionDto = {
  assetId: string;
  conditionId: string;
  title: string | null;
  eventSlug: string | null;
  outcome: string | null;
  size: string;
  avgPrice: string;
  currentPrice: string;
  currentValue: string;
  pnl: string;
  percentPnl: string;
  redeemable: boolean;
};

export type OrderDto = {
  id: string;
  assetId: string;
  conditionId: string;
  outcome: string;
  side: string;
  price: string;
  originalSize: string;
  sizeMatched: string;
  createdAt: string;
  status: string;
  /** GTD expiry, Unix seconds; null for good-til-cancelled. */
  expiresAt: number | null;
  /** Market question and parent event slug; null when the lookup failed. */
  question: string | null;
  eventSlug: string | null;
};

export type TradeDto = {
  id: string;
  time: string;
  side: string;
  outcome: string;
  price: string;
  size: string;
  assetId: string;
  conditionId: string;
  txHash: string | null;
  question: string | null;
  eventSlug: string | null;
};

export type ActivityDto = {
  id: string;
  /** Epoch milliseconds. */
  time: number;
  type: string;
  side: string | null;
  title: string | null;
  eventSlug: string | null;
  outcome: string | null;
  price: string | null;
  shares: string | null;
  /** Dollar amount when the row has one. */
  amount: string | null;
  txHash: string;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type ApiErrorBody = { error: { code: string; message: string } };
