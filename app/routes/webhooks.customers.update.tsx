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

  const codes = await db.singleCodeDiscount.findMany({
    where: { shop },
    select: {
      discountId: true,
      requiredTag: true,
      blockedTag: true,
      eligibleCustomerIds: true,
      blockedCustomerIds: true,
    },
  });

  for (const code of codes) {
    const eligible: string[] = code.eligibleCustomerIds ? JSON.parse(code.eligibleCustomerIds) : [];
    const blocked: string[] = code.blockedCustomerIds ? JSON.parse(code.blockedCustomerIds) : [];

    // Skip discounts that have no eligibility lists (customer sync never run)
    if (eligible.length === 0 && blocked.length === 0) continue;

    const hasRequiredTag = code.requiredTag ? customerTags.includes(code.requiredTag) : false;
    const hasBlockedTag = code.blockedTag ? customerTags.includes(code.blockedTag) : false;

    let changed = false;

    if (hasBlockedTag && !blocked.includes(customerId)) {
      blocked.push(customerId);
      changed = true;
    }
    if (!hasBlockedTag && blocked.includes(customerId)) {
      blocked.splice(blocked.indexOf(customerId), 1);
      changed = true;
    }
    if (eligible.length > 0) {
      if (hasRequiredTag && !eligible.includes(customerId)) {
        eligible.push(customerId);
        changed = true;
      }
      if (!hasRequiredTag && eligible.includes(customerId)) {
        eligible.splice(eligible.indexOf(customerId), 1);
        changed = true;
      }
    }

    if (!changed) continue;

    const eligibilityJson = JSON.stringify({ eligibleCustomerIds: eligible, blockedCustomerIds: blocked });

    // Update DB
    await db.singleCodeDiscount.update({
      where: { shop_discountId: { shop, discountId: code.discountId } },
      data: {
        eligibleCustomerIds: JSON.stringify(eligible),
        blockedCustomerIds: JSON.stringify(blocked),
      },
    });

    // Write ONLY to customer-eligibility key — never touch function-configuration
    await admin.graphql(
      `#graphql
      mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [{ ownerId: code.discountId, namespace: "$app", key: "customer-eligibility", type: "json", value: eligibilityJson }] } }
    );
  }

  return new Response();
};
