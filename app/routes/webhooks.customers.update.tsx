import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, session } = await authenticate.webhook(request);

  if (!admin || !session) return new Response();

  const customer = payload as { id: number; tags: string };
  const customerId = `gid://shopify/Customer/${customer.id}`;

  // Parse tags from the webhook payload (comma-separated string)
  const customerTags = customer.tags
    ? customer.tags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  // Get all single codes for this shop
  const singleCodes = await db.singleCodeDiscount.findMany({
    where: { shop: session.shop },
    select: { discountId: true, requiredTag: true, blockedTag: true },
  });

  for (const code of singleCodes) {
    // Fetch the current metafield
    const mfRes = await admin.graphql(
      `#graphql
      query GetMF($id: ID!) {
        discountNode(id: $id) {
          metafield(namespace: "$app", key: "function-configuration") { value }
        }
      }`,
      { variables: { id: code.discountId } }
    );
    const mfData = await mfRes.json();
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(mfData.data?.discountNode?.metafield?.value); } catch {}

    let eligibleIds: string[] = Array.isArray(config.eligibleCustomerIds)
      ? (config.eligibleCustomerIds as string[])
      : [];
    let blockedIds: string[] = Array.isArray(config.blockedCustomerIds)
      ? (config.blockedCustomerIds as string[])
      : [];

    let changed = false;

    // Update eligible list based on required tag
    if (code.requiredTag) {
      const hasTag = customerTags.includes(code.requiredTag.toLowerCase());
      if (hasTag && !eligibleIds.includes(customerId)) {
        eligibleIds = [...eligibleIds, customerId];
        changed = true;
      } else if (!hasTag && eligibleIds.includes(customerId)) {
        eligibleIds = eligibleIds.filter((id) => id !== customerId);
        changed = true;
      }
    }

    // Update blocked list based on blocked tag
    if (code.blockedTag) {
      const hasTag = customerTags.includes(code.blockedTag.toLowerCase());
      if (hasTag && !blockedIds.includes(customerId)) {
        blockedIds = [...blockedIds, customerId];
        changed = true;
      } else if (!hasTag && blockedIds.includes(customerId)) {
        blockedIds = blockedIds.filter((id) => id !== customerId);
        changed = true;
      }
    }

    if (!changed) continue;

    const newConfig = { ...config, eligibleCustomerIds: eligibleIds, blockedCustomerIds: blockedIds };

    await admin.graphql(
      `#graphql
      mutation UpdateDiscountMF($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [{
            ownerId: code.discountId,
            namespace: "$app",
            key: "function-configuration",
            type: "json",
            value: JSON.stringify(newConfig),
          }],
        },
      }
    );
  }

  return new Response();
};
