import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, session } = await authenticate.webhook(request);

  if (!admin || !session) return new Response();

  const customer = payload as { id: number };
  const customerId = `gid://shopify/Customer/${customer.id}`;

  // Tags are not included in the 2026-04 webhook payload — fetch them via Admin API
  const customerRes = await admin.graphql(
    `#graphql
    query GetCustomerTags($id: ID!) {
      customer(id: $id) { tags }
    }`,
    { variables: { id: customerId } }
  );
  const customerData = await customerRes.json();
  const customerTags: string[] = (customerData.data?.customer?.tags ?? []).map(
    (t: string) => t.trim().toLowerCase()
  );

  console.log(`[customers/update] customer=${customerId} tags=[${customerTags.join(", ")}]`);

  // Get all single codes for this shop
  const singleCodes = await db.singleCodeDiscount.findMany({
    where: { shop: session.shop },
    select: { discountId: true, requiredTag: true, blockedTag: true },
  });

  console.log(`[customers/update] found ${singleCodes.length} single codes for shop ${session.shop}`);

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

    console.log(`[customers/update] discount=${code.discountId} requiredTag=${code.requiredTag} blockedTag=${code.blockedTag} eligibleCount=${eligibleIds.length} blockedCount=${blockedIds.length} customerInBlocked=${blockedIds.includes(customerId)}`);

    let changed = false;

    // Update eligible list based on required tag
    if (code.requiredTag) {
      const hasTag = customerTags.includes(code.requiredTag.toLowerCase());
      if (hasTag && !eligibleIds.includes(customerId)) {
        eligibleIds = [...eligibleIds, customerId];
        changed = true;
        console.log(`[customers/update] adding customer to eligibleIds`);
      } else if (!hasTag && eligibleIds.includes(customerId)) {
        eligibleIds = eligibleIds.filter((id) => id !== customerId);
        changed = true;
        console.log(`[customers/update] removing customer from eligibleIds`);
      }
    }

    // Update blocked list based on blocked tag
    if (code.blockedTag) {
      const hasTag = customerTags.includes(code.blockedTag.toLowerCase());
      console.log(`[customers/update] blockedTag check: hasTag=${hasTag} inList=${blockedIds.includes(customerId)}`);
      if (hasTag && !blockedIds.includes(customerId)) {
        blockedIds = [...blockedIds, customerId];
        changed = true;
        console.log(`[customers/update] adding customer to blockedIds`);
      } else if (!hasTag && blockedIds.includes(customerId)) {
        blockedIds = blockedIds.filter((id) => id !== customerId);
        changed = true;
        console.log(`[customers/update] removing customer from blockedIds`);
      }
    }

    if (!changed) {
      console.log(`[customers/update] no changes needed for this discount`);
      continue;
    }

    const newConfig = { ...config, eligibleCustomerIds: eligibleIds, blockedCustomerIds: blockedIds };

    const updateRes = await admin.graphql(
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
    const updateData = await updateRes.json();
    const userErrors = updateData.data?.metafieldsSet?.userErrors ?? [];
    console.log(`[customers/update] metafieldsSet userErrors=${JSON.stringify(userErrors)}`);
  }

  return new Response();
};
