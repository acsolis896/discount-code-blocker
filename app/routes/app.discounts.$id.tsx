import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const numericId = params.id;
  const discountId = `gid://shopify/DiscountCodeApp/${numericId}`;

  const res = await admin.graphql(
    `#graphql
    query GetDiscount($id: ID!) {
      discountNode(id: $id) {
        id
        discount {
          ... on DiscountCodeApp {
            title
            startsAt
            codes(first: 10) {
              nodes { code }
              pageInfo { hasNextPage }
            }
          }
        }
      }
    }`,
    { variables: { id: discountId } }
  );

  const data = await res.json();
  const discount = data.data?.discountNode?.discount;

  return {
    discountId,
    title: discount?.title ?? "Discount",
    startsAt: discount?.startsAt ?? null,
    codes: (discount?.codes?.nodes ?? []).map((n: { code: string }) => n.code),
    hasMore: discount?.codes?.pageInfo?.hasNextPage ?? false,
  };
};

export default function DiscountDetails() {
  const { title, codes, hasMore, discountId } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading={title}>
      <s-section heading="Discount codes">
        <s-stack direction="block" gap="base">
          {codes.length === 0 ? (
            <s-paragraph>
              No codes found yet — bulk codes may still be processing. Refresh
              in a moment.
            </s-paragraph>
          ) : (
            <>
              <s-paragraph>
                Showing first {codes.length} codes{hasMore ? " (more exist)" : ""}.
              </s-paragraph>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="tight">
                  {codes.map((code: string) => (
                    <s-text key={code}>{code}</s-text>
                  ))}
                </s-stack>
              </s-box>
            </>
          )}
          <s-paragraph>
            To see all codes and manage the discount, open the{" "}
            <a
              href={`https://admin.shopify.com/discounts/${discountId.split("/").pop()}`}
              target="_top"
            >
              Shopify admin discount page
            </a>
            .
          </s-paragraph>
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
