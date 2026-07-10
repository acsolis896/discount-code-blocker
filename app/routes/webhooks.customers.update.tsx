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
      configJson: true,
      eligibleCustomerIds: true,
      blockedCustomerIds: true,
      functionNodeId: true,
    },
  });

  for (const code of codes) {
    if (!code.configJson) continue;

    const eligible: string[] = code.eligibleCustomerIds ? JSON.parse(code.eligibleCustomerIds) : [];
    const blocked: string[] = code.blockedCustomerIds ? JSON.parse(code.blockedCustomerIds) : [];

    // Skip if sync has never run (no eligible list populated yet)
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

    let baseConfig: Record<string, unknown>;
    try { baseConfig = JSON.parse(code.configJson); } catch { continue; }

    await db.singleCodeDiscount.update({
      where: { shop_discountId: { shop, discountId: code.discountId } },
      data: {
        eligibleCustomerIds: JSON.stringify(eligible),
        blockedCustomerIds: JSON.stringify(blocked),
      },
    });

    // Update native Shopify customer selection for the eligible list (reliable — uses DiscountCodeApp GID)
    if (code.requiredTag) {
      const appId = code.discountId.replace("DiscountCodeNode", "DiscountCodeApp");
      const action = hasRequiredTag
        ? { customers: { add: [customerId], remove: [] as string[] } }
        : { customers: { remove: [customerId], add: [] as string[] } };
      await admin.graphql(
        `#graphql
        mutation UpdateCustomerSelection($id: ID!, $input: DiscountCodeAppInput!) {
          discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
            userErrors { field message }
          }
        }`,
        { variables: { id: appId, input: { customerSelection: { all: false, ...action } } } }
      );
    }

    // Update blockedCustomerIds in function metafield
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
