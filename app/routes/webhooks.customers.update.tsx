import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, payload } = await authenticate.webhook(request);

  const customer = payload as { id: number; tags: string };
  const customerId = `gid://shopify/Customer/${customer.id}`;
  const customerTags: string[] = (customer.tags ?? "")
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  // Customer eligibility (requiredTag whitelist) is handled by a dynamic customer segment
  // assigned to the discount — no action needed here for the eligible list.
  // We only update blockedCustomerIds in the function metafield as a backup check.

  const codes = await db.singleCodeDiscount.findMany({
    where: { shop },
    select: {
      discountId: true,
      blockedTag: true,
      configJson: true,
      blockedCustomerIds: true,
      functionNodeId: true,
    },
  });

  for (const code of codes) {
    if (!code.configJson || !code.blockedTag) continue;

    const blocked: string[] = code.blockedCustomerIds ? JSON.parse(code.blockedCustomerIds) : [];
    const hasBlockedTag = customerTags.includes(code.blockedTag);

    let changed = false;
    if (hasBlockedTag && !blocked.includes(customerId)) {
      blocked.push(customerId);
      changed = true;
    } else if (!hasBlockedTag && blocked.includes(customerId)) {
      blocked.splice(blocked.indexOf(customerId), 1);
      changed = true;
    }

    if (!changed) continue;

    let baseConfig: Record<string, unknown>;
    try { baseConfig = JSON.parse(code.configJson); } catch { continue; }

    await db.singleCodeDiscount.update({
      where: { shop_discountId: { shop, discountId: code.discountId } },
      data: { blockedCustomerIds: JSON.stringify(blocked) },
    });

    const metafieldConfig = JSON.stringify({ ...baseConfig, blockedCustomerIds: blocked });
    await admin.graphql(
      `#graphql
      mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [{ ownerId: code.functionNodeId ?? code.discountId, namespace: "$app", key: "function-configuration", type: "json", value: metafieldConfig }] } }
    );
  }

  return new Response();
};
