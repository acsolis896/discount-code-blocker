/**
 * @typedef {import("../generated/api").InputQuery} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
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

  const { productIds, percentage, blockedProductTypes, requiredTag, blockedTag } = config;

  const rejectableCodes = (input.enteredDiscountCodes ?? [])
    .filter((c) => c.rejectable)
    .map((c) => ({ code: c.code }));

  const reject = (message) => {
    if (rejectableCodes.length > 0) {
      return {
        operations: [{ enteredDiscountCodesReject: { codes: rejectableCodes, message } }],
      };
    }
    return { operations: [] };
  };

  // 1. Block if a blocked product type (e.g. GWP) is in the cart
  const blocked = Array.isArray(blockedProductTypes) ? blockedProductTypes : ["GWP"];
  const hasBlockedType = input.cart.lines.some(
    (line) => blocked.includes(line.merchandise?.product?.productType)
  );
  if (hasBlockedType) {
    return reject("This discount code can't be used when a gift item is in your cart.");
  }

  // 2. Customer tag eligibility — checked in real-time, no sync required
  if (requiredTag || blockedTag) {
    const customer = input.cart.buyerIdentity?.customer;
    if (!customer) {
      return reject("Please log in to your account to use this discount code.");
    }
    const customerTags = (customer.tags ?? []).map((t) => t.toLowerCase());
    if (requiredTag && !customerTags.includes(requiredTag.toLowerCase())) {
      return reject("This discount code is not available for your account.");
    }
    if (blockedTag && customerTags.includes(blockedTag.toLowerCase())) {
      return reject("You've reached your usage limit for this discount code.");
    }
  }

  // 3. Apply discount to eligible products
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
