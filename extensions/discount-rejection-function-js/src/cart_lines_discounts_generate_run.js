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

  const { productIds, percentage, fixedAmount, discountType, oncePerOrder, blockedProductTypes } = config;

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

  // 1. Block if a blocked product type (e.g. GWP) is in the cart — matched
  // case-insensitively since the input list is always uppercase but a real
  // product's productType may not be.
  const blocked = (Array.isArray(blockedProductTypes) ? blockedProductTypes : ["GWP"])
    .map((t) => (t ?? "").toUpperCase());
  const blockedLine = input.cart.lines.find((line) => {
    const productType = line.merchandise?.product?.productType;
    return productType != null && blocked.includes(productType.toUpperCase());
  });
  if (blockedLine) {
    // Use the product's own casing (e.g. "Accessories") rather than the
    // stored ALL-CAPS value, so the message doesn't read as shouting.
    const matchedType = blockedLine.merchandise?.product?.productType;
    return reject(`This discount code can't be used with ${matchedType} items in your cart.`);
  }

  // 2. Block customers who've hit their usage limit
  // (requiredTag whitelist is enforced natively by Shopify via discount customerSelection)
  const blockedCustomerIds = config.blockedCustomerIds ?? [];
  if (blockedCustomerIds.length > 0) {
    const customer = input.cart.buyerIdentity?.customer;
    if (customer && blockedCustomerIds.includes(customer.id)) {
      return reject("You've reached your usage limit for this discount code.");
    }
  }

  // 3. Apply discount to eligible products
  // "fixedAmount" is opt-in via discountType; absent/anything else defaults
  // to percentage to stay backward compatible with discounts created before
  // this field existed.
  const isFixedAmount = discountType === "fixedAmount";
  const hasValue = isFixedAmount ? Boolean(fixedAmount) : Boolean(percentage);

  if (!Array.isArray(productIds) || productIds.length === 0 || !hasValue) {
    return { operations: [] };
  }

  const numericIds = productIds.map((id) => id.split("/").pop());

  const eligibleLines = input.cart.lines.filter((line) => {
    const productId = line.merchandise?.product?.id;
    if (!productId) return false;
    return numericIds.includes(productId.split("/").pop());
  });

  if (eligibleLines.length === 0) return { operations: [] };

  // oncePerOrder is absent on discounts created before this field existed —
  // default to true so their behavior (highest-priced eligible item, 1 unit
  // only) doesn't change.
  const applyOncePerOrder = oncePerOrder !== false;

  let targets;
  if (applyOncePerOrder) {
    const bestLine = eligibleLines.reduce((best, line) => {
      const price = parseFloat(line.cost.amountPerQuantity.amount);
      const bestPrice = parseFloat(best.cost.amountPerQuantity.amount);
      return price > bestPrice ? line : best;
    });
    targets = [{ cartLine: { id: bestLine.id, quantity: 1 } }];
  } else {
    targets = eligibleLines.map((line) => ({ cartLine: { id: line.id } }));
  }

  const value = isFixedAmount
    ? { fixedAmount: { amount: Number(fixedAmount), appliesToEachItem: !applyOncePerOrder } }
    : { percentage: { value: Number(percentage) } };

  const message = isFixedAmount
    ? "$" + Number(fixedAmount) + " off"
    : Number(percentage) + "% off";

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [{ message, targets, value }],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
