export function cartValidationsGenerateRun(input: any) {

  let hasGift = false;

  for (const line of input.cart.lines) {
    const tags = line.merchandise.product.hasTags;

    if (tags && tags.length > 0 && tags[0].hasTag) {
      hasGift = true;
      break;
    }
  }

  if (hasGift) {
    return {
      operations: [
        {
          validationAdd: {
            errors: [
              {
                message: "Free gifts cannot be combined with discount codes. Remove the gift to apply a discount code.",
                target: "cart"
              }
            ]
          }
        }
      ]
    };
  }

  return {
    operations: []
  };
}