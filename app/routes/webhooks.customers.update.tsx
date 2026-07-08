import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Customer eligibility is now stored in each discount's metafield (eligibleCustomerIds).
// Use the "Sync customer tags" button in Settings after updating customer tags in Shopify admin.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  return new Response();
};
