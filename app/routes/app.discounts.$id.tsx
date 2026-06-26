import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type RedeemCode = { code: string; usageCount: number };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const numericId = params.id;
    const gid = `gid://shopify/DiscountCodeNode/${numericId}`;
    const shop = session.shop;

    // Paginate through all codes (max 250 per page)
    const allCodes: RedeemCode[] = [];
    let cursor: string | null = null;
    let title = "Discount";
    let totalCount = 0;

    do {
      const res = await admin.graphql(
        `#graphql
        query GetDiscountCodes($id: ID!, $after: String) {
          discountNode(id: $id) {
            discount {
              ... on DiscountCodeApp {
                title
                codes(first: 250, after: $after) {
                  nodes { code asyncUsageCount }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }
        }`,
        { variables: { id: gid, after: cursor } }
      );

      const data = await res.json();
      const discount = data.data?.discountNode?.discount;
      if (discount?.title) title = discount.title;
      const codesPage = discount?.codes;
      for (const node of codesPage?.nodes ?? []) {
        allCodes.push({ code: node.code, usageCount: node.asyncUsageCount ?? 0 });
      }
      totalCount = allCodes.length;
      cursor = codesPage?.pageInfo?.hasNextPage ? codesPage.pageInfo.endCursor : null;

      // Cap at 2000 codes in the UI to keep response fast
      if (allCodes.length >= 2000) break;
    } while (cursor);

    const usedCount = allCodes.filter((c) => c.usageCount > 0).length;

    return { numericId, title, shop, codes: allCodes, totalCount, usedCount, error: null as string | null };
  } catch (err: unknown) {
    return {
      numericId: params.id,
      title: "Discount",
      shop: "",
      codes: [] as RedeemCode[],
      totalCount: 0,
      usedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export default function DiscountDetails() {
  const { title, numericId, shop, codes, totalCount, usedCount, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const unusedCount = totalCount - usedCount;

  return (
    <s-page heading={title ?? "Discount"}>
      {error && (
        <s-banner title="Error" tone="critical">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Summary">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold">{totalCount}</s-text>
              <s-text>Total codes</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold">{usedCount}</s-text>
              <s-text>Used</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-text emphasis="bold">{unusedCount}</s-text>
              <s-text>Remaining</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading={`Codes${totalCount >= 2000 ? " (first 2,000)" : ""}`}>
        <s-stack direction="block" gap="tight">
          {/* Header row */}
          <s-box padding="tight" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="none">
              <s-text emphasis="bold" style={{ flex: 1 }}>Code</s-text>
              <s-text emphasis="bold">Status</s-text>
            </s-stack>
          </s-box>

          {codes.map((c: RedeemCode) => (
            <s-box key={c.code} padding="tight" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="none">
                <s-text style={{ flex: 1, fontFamily: "monospace" }}>{c.code}</s-text>
                {c.usageCount > 0 ? (
                  <s-badge tone="success">Used</s-badge>
                ) : (
                  <s-badge>Unused</s-badge>
                )}
              </s-stack>
            </s-box>
          ))}

          {codes.length === 0 && (
            <s-paragraph>No codes found. Bulk codes may still be processing — refresh in a few seconds.</s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button
          onClick={() =>
            window.open(`https://${shop}/admin/discounts/${numericId}`, "_blank")
          }
        >
          View in Shopify admin
        </s-button>
        <s-button onClick={() => navigate("/app")}>Create another discount</s-button>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
