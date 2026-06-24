import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const numericId = params.id;
    const gid = `gid://shopify/DiscountCodeNode/${numericId}`;

    const res = await admin.graphql(
      `#graphql
      query GetDiscount($id: ID!) {
        discountNode(id: $id) {
          discount {
            ... on DiscountCodeApp {
              title
            }
          }
        }
      }`,
      { variables: { id: gid } }
    );

    const data = await res.json();
    const title = data.data?.discountNode?.discount?.title ?? "Discount";

    return { numericId, title, error: null as string | null };
  } catch (err: unknown) {
    return {
      numericId: params.id,
      title: "Discount",
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export default function DiscountDetails() {
  const { title, numericId, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading={title ?? "Discount"}>
      {error && (
        <s-banner title="Error" tone="critical">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}
      <s-section heading="Discount codes">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Bulk codes are processed asynchronously by Shopify and will appear
            in the admin within a few seconds.
          </s-paragraph>
          <s-paragraph>
            To view or export all codes, open the discount in Shopify admin:
          </s-paragraph>
          <s-button
            onClick={() => {
              window.open(
                `https://admin.shopify.com/store/bajio-development/discounts/${numericId}`,
                "_top"
              );
            }}
          >
            View codes in Shopify admin
          </s-button>
        </s-stack>
      </s-section>
      <s-stack direction="inline" gap="base">
        <s-button onClick={() => navigate("/app")}>Create another discount</s-button>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
