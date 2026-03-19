// // EXAMPLE FROM WEBSITE

// /**
//  * @typedef {import("../generated/api").CartInput} RunInput
//  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
//  */

// /**
//  * @param {RunInput} input
//  * @returns {CartLinesDiscountsGenerateRunResult}
//  */

// export function cartLinesDiscountsGenerateRun(input) {
//   const allInfluencerCodes = input.enteredDiscountCodes.filter(({ code }) =>
//     code.toLowerCase().startsWith("BASS100-"),
//   );

//   const rejectableInfluencerCodes = allInfluencerCodes.filter(
//     ({ rejectable }) => rejectable,
//   );

//   const hasNonRejectable = allInfluencerCodes.some(
//     ({ rejectable }) => !rejectable,
//   );

//   const codesToReject = hasNonRejectable
//     ? rejectableInfluencerCodes
//     : rejectableInfluencerCodes.slice(0, -1);

//   if (codesToReject.length === 0) {
//     return { operations: [] };
//   }

//   return {
//     operations: [
//       {
//         enteredDiscountCodesReject: {
//           codes: codesToReject.map(({ code }) => ({ code })),
//           message: `Only one influencer code allowed. Rejected: ${codesToReject.map((c) => c.code).join(", ")}`,
//         },
//       },
//     ],
//   };
// }

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * Reject discount codes if cart contains a product with type "GWP"
 * 
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {

  // Check if any product in cart has type "GWP"
  const hasGwpProduct = input.cart.lines.some(line => {
    const productType = line.merchandise?.product?.productType;
    return productType === "GWP";
  });

  // If no GWP items, allow all discounts
  if (!hasGwpProduct) {
    return { operations: [] };
  }

  // Find all discount codes that Shopify allows us to reject
  const rejectableCodes = input.enteredDiscountCodes.filter(
    ({ rejectable }) => rejectable
  );

  if (rejectableCodes.length === 0) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        enteredDiscountCodesReject: {
          codes: rejectableCodes.map(({ code }) => ({ code })),
          message: "Discount codes cannot be used with free gift items.",
        },
      },
    ],
  };
}
