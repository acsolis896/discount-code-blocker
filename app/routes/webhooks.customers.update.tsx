import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload } = await authenticate.webhook(request);

  const customer = payload as {
    id: number;
    tags: string;
  };

  if (!customer?.id || !admin) return new Response();

  const customerId = `gid://shopify/Customer/${customer.id}`;
  // Shopify sends tags as a comma-separated string
  const tags = customer.tags
    ? customer.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
    : [];

  await admin.graphql(
    `#graphql
    mutation SyncCustomerTags($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [{
          ownerId: customerId,
          namespace: "custom",
          key: "bajio_discount_tags",
          type: "json",
          value: JSON.stringify(tags),
        }],
      },
    }
  );

  return new Response();
};
