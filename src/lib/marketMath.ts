export interface AmmQuoteResult {
  spotBeforeInr: number;
  executionPriceInr: number;
  spotAfterInr: number;
  priceImpactPercent: number;
  outputAmount: number;
  newInrReserve: number;
  newXyphReserve: number;
}

export const INITIAL_POOL_INR_RESERVE = 2_500;
export const INITIAL_POOL_XYPH_RESERVE = 250_000;
export const MIN_POOL_INR_RESERVE = 250;
export const MIN_POOL_XYPH_RESERVE = 10_000;

/**
 * Constant-product AMM (x * y = k) quote for BUYING XYPH with INR.
 * Buying adds INR to the pool and removes XYPH, moving the live price UP.
 */
export function quoteBuyAmm(
  inrIn: number,
  inrReserve: number,
  xyphReserve: number
): AmmQuoteResult {
  const safeInrRes = Math.max(MIN_POOL_INR_RESERVE, inrReserve);
  const safeXyphRes = Math.max(MIN_POOL_XYPH_RESERVE, xyphReserve);
  const spotBeforeInr = safeInrRes / safeXyphRes;

  if (!Number.isFinite(inrIn) || inrIn <= 0) {
    return {
      spotBeforeInr: Number(spotBeforeInr.toFixed(6)),
      executionPriceInr: Number(spotBeforeInr.toFixed(6)),
      spotAfterInr: Number(spotBeforeInr.toFixed(6)),
      priceImpactPercent: 0,
      outputAmount: 0,
      newInrReserve: safeInrRes,
      newXyphReserve: safeXyphRes,
    };
  }

  const k = safeInrRes * safeXyphRes;
  const newInrReserve = safeInrRes + inrIn;
  const newXyphReserve = Math.max(MIN_POOL_XYPH_RESERVE, k / newInrReserve);
  const xyphOut = Math.max(0.0001, safeXyphRes - newXyphReserve);
  const executionPriceInr = inrIn / xyphOut;
  const spotAfterInr = newInrReserve / newXyphReserve;
  const priceImpactPercent = ((spotAfterInr - spotBeforeInr) / spotBeforeInr) * 100;

  return {
    spotBeforeInr: Number(spotBeforeInr.toFixed(6)),
    executionPriceInr: Number(executionPriceInr.toFixed(6)),
    spotAfterInr: Number(spotAfterInr.toFixed(6)),
    priceImpactPercent: Number(priceImpactPercent.toFixed(2)),
    outputAmount: Number(xyphOut.toFixed(4)),
    newInrReserve: Number(newInrReserve.toFixed(4)),
    newXyphReserve: Number(newXyphReserve.toFixed(4)),
  };
}

/**
 * Constant-product AMM (x * y = k) quote for SELLING XYPH for INR.
 * Selling adds XYPH to the pool and removes INR, moving the live price DOWN.
 */
export function quoteSellAmm(
  xyphIn: number,
  inrReserve: number,
  xyphReserve: number
): AmmQuoteResult {
  const safeInrRes = Math.max(MIN_POOL_INR_RESERVE, inrReserve);
  const safeXyphRes = Math.max(MIN_POOL_XYPH_RESERVE, xyphReserve);
  const spotBeforeInr = safeInrRes / safeXyphRes;

  if (!Number.isFinite(xyphIn) || xyphIn <= 0) {
    return {
      spotBeforeInr: Number(spotBeforeInr.toFixed(6)),
      executionPriceInr: Number(spotBeforeInr.toFixed(6)),
      spotAfterInr: Number(spotBeforeInr.toFixed(6)),
      priceImpactPercent: 0,
      outputAmount: 0,
      newInrReserve: safeInrRes,
      newXyphReserve: safeXyphRes,
    };
  }

  const k = safeInrRes * safeXyphRes;
  const newXyphReserve = safeXyphRes + xyphIn;
  const newInrReserve = Math.max(MIN_POOL_INR_RESERVE, k / newXyphReserve);
  const inrOut = Math.max(0.01, safeInrRes - newInrReserve);
  const executionPriceInr = inrOut / xyphIn;
  const spotAfterInr = newInrReserve / newXyphReserve;
  const priceImpactPercent = ((spotAfterInr - spotBeforeInr) / spotBeforeInr) * 100;

  return {
    spotBeforeInr: Number(spotBeforeInr.toFixed(6)),
    executionPriceInr: Number(executionPriceInr.toFixed(6)),
    spotAfterInr: Number(spotAfterInr.toFixed(6)),
    priceImpactPercent: Number(priceImpactPercent.toFixed(2)),
    outputAmount: Number(inrOut.toFixed(2)),
    newInrReserve: Number(newInrReserve.toFixed(4)),
    newXyphReserve: Number(newXyphReserve.toFixed(4)),
  };
}
