import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GET /create-discount?productIds=gid://shopify/Product/123,gid://shopify/Product/456&percentage=20&title=My+Bulk+Set
// Returns the new discountId so you can then POST codes against it.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const title = url.searchParams.get("title") ?? "Bulk Discount";
  const percentage = Number(url.searchParams.get("percentage") ?? "0");
  const productIds = (url.searchParams.get("productIds") ?? "").split(",").filter(Boolean);

  if (!percentage || productIds.length === 0) {
    return new Response(
      JSON.stringify({ error: "percentage and productIds are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Step 1: create the discount with the function configuration metafield
  const createResponse = await admin.graphql(
    `#graphql
    mutation CreateBulkCodeDiscount($input: DiscountCodeAppInput!) {
      discountCodeAppCreate(codeAppDiscount: $input) {
        codeAppDiscount {
          discountId
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title,
          functionHandle: "discount-rejection-function-js",
          startsAt: new Date().toISOString(),
          appliesOncePerCustomer: false,
          metafields: [
            {
              namespace: "$app",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify({ productIds, percentage }),
            },
          ],
        },
      },
    }
  );

  const createData = await createResponse.json();
  const userErrors = createData.data?.discountCodeAppCreate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return new Response(JSON.stringify({ userErrors }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const discountId = createData.data?.discountCodeAppCreate?.codeAppDiscount?.discountId;
  return new Response(JSON.stringify({ discountId }), {
    headers: { "Content-Type": "application/json" },
  });
};

// POST /create-discount
// Body: { discountId: "gid://shopify/DiscountCodeApp/...", codes: ["CODE-001", "CODE-002"] }
// Bulk-adds redemption codes to an existing discount.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { discountId, codes } = await request.json();

  if (!discountId || !Array.isArray(codes) || codes.length === 0) {
    return new Response(
      JSON.stringify({ error: "discountId and codes[] are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const bulkResponse = await admin.graphql(
    `#graphql
    mutation AddBulkCodes($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
      discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
        bulkCreation {
          id
          status
          codesCount
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        discountId,
        codes: codes.map((code: string) => ({ code })),
      },
    }
  );

  const bulkData = await bulkResponse.json();
  return new Response(JSON.stringify(bulkData.data), {
    headers: { "Content-Type": "application/json" },
  });
};
