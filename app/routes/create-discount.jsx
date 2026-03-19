import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // 👇 This ensures it only runs AFTER auth
  if (!admin) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const response = await admin.graphql(`
    mutation {
      discountAutomaticAppCreate(
        automaticAppDiscount: {
          title: "Discount Rejection"
          functionHandle: "discount-rejection-function-js"
          discountClasses: [ORDER]
          startsAt: "2025-01-01T00:00:00"
        }
      ) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          message
        }
      }
    }
  `);

  const data = await response.json();

  console.log("CREATE DISCOUNT RESULT:", JSON.stringify(data, null, 2));

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
};