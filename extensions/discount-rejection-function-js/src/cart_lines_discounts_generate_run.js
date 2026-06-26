/**
 * @typedef {import("../generated/api").InputQuery} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const hasGWP = input.cart.lines.some(
    (line) => line.merchandise?.product?.productType === "GWP"
  );
  if (hasGWP) return { operations: [] };

  const metafieldValue = input.discount?.metafield?.value;
  if (!metafieldValue) return { operations: [] };

  let config;
  try {
    config = JSON.parse(metafieldValue);
  } catch {
    return { operations: [] };
  }

  const { productIds, percentage } = config;
  if (!Array.isArray(productIds) || productIds.length === 0 || !percentage) {
    return { operations: [] };
  }

  const numericIds = productIds.map((id) => id.split("/").pop());

  const eligibleLines = input.cart.lines.filter((line) => {
    const productId = line.merchandise?.product?.id;
    if (!productId) return false;
    return numericIds.includes(productId.split("/").pop());
  });

  if (eligibleLines.length === 0) return { operations: [] };

  const bestLine = eligibleLines.reduce((best, line) => {
    const price = parseFloat(line.cost.amountPerQuantity.amount);
    const bestPrice = parseFloat(best.cost.amountPerQuantity.amount);
    return price > bestPrice ? line : best;
  });

  const pct = Number(percentage);
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: pct + "% off",
              targets: [{ cartLine: { id: bestLine.id, quantity: 1 } }],
              value: { percentage: { value: pct } },
            },
          ],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
