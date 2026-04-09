// import type { LoaderFunctionArgs } from "react-router";
// import { authenticate } from "../shopify.server";

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const { admin } = await authenticate.admin(request);

//   const response = await admin.graphql(`
//     mutation {
//       discountAutomaticAppCreate(
//         automaticAppDiscount: {
//           title: "Discount Rejection"
//           functionHandle: "discount-rejection-function-js"
//           discountClasses: [PRODUCT, ORDER]
//           startsAt: "2025-01-01T00:00:00Z"
//         }
//       ) {
//         automaticAppDiscount {
//           discountId
//         }
//         userErrors {
//           message
//         }
//       }
//     }
//   `);

//   const data = await response.json();

//   return new Response(JSON.stringify(data), {
//     headers: { "Content-Type": "application/json" },
//   });
// };