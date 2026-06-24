/**
 * @typedef {import("../generated/api").InputQuery} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * Applies a percentage discount to 1 unit of the highest-priced eligible product.
 * Eligible product IDs and the percentage are read from the discount's metafield.
 *
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
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

  // Normalize GIDs to numeric IDs for comparison (Functions API may return either format)
  const numericIds = productIds.map((id) => id.split("/").pop());

  const eligibleLines = input.cart.lines.filter((line) => {
    const productId = line.merchandise?.product?.id;
    if (!productId) return false;
    const numericProductId = productId.split("/").pop();
    return numericIds.includes(numericProductId);
  });

  if (eligibleLines.length === 0) return { operations: [] };

  const bestLine = eligibleLines.reduce((best, line) => {
    const price = parseFloat(line.cost.amountPerQuantity.amount);
    const bestPrice = parseFloat(best.cost.amountPerQuantity.amount);
    return price > bestPrice ? line : best;
  });

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: `${percentage}% off`,
              targets: [{ cartLine: { id: bestLine.id, quantity: 1 } }],
              value: { percentage: { value: percentage } },
            },
          ],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
