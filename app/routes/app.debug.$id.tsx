import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const gid = `gid://shopify/DiscountCodeNode/${params.id}`;

  const res = await admin.graphql(
    `#graphql
    query DebugDiscount($id: ID!) {
      discountNode(id: $id) {
        metafield(namespace: "$app", key: "function-configuration") {
          value
        }
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
  const node = data.data?.discountNode;
  const raw = node?.metafield?.value ?? null;
  let parsed: { productIds?: string[]; percentage?: number } | null = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}

  // Resolve product titles for the stored IDs
  let products: { id: string; title: string }[] = [];
  if (parsed?.productIds && parsed.productIds.length > 0) {
    const titlesRes = await admin.graphql(
      `#graphql
      query ProductTitles($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title }
        }
      }`,
      { variables: { ids: parsed.productIds.slice(0, 50) } }
    );
    const titlesData = await titlesRes.json();
    products = (titlesData.data?.nodes ?? [])
      .filter((n: { id?: string; title?: string } | null) => n?.id)
      .map((n: { id: string; title: string }) => ({ id: n.id, title: n.title }));
  }

  return { title: node?.discount?.title, raw, parsed, products };
};

export default function DebugDiscount() {
  const { title, raw, parsed, products } = useLoaderData<typeof loader>();
  return (
    <s-page heading={`Debug: ${title ?? "unknown"}`}>
      <s-section heading="Raw metafield value">
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "12px" }}>
          {raw ?? "(null — metafield not found)"}
        </pre>
      </s-section>
      {parsed && (
        <s-section heading="Parsed">
          <s-paragraph>percentage: {parsed.percentage}</s-paragraph>
          <s-paragraph>productIds count: {parsed.productIds?.length ?? 0}</s-paragraph>
        </s-section>
      )}
      {products.length > 0 && (
        <s-section heading="Eligible products (resolved titles)">
          <s-stack direction="block" gap="tight">
            {products.map((p: { id: string; title: string }) => (
              <s-text key={p.id}>{p.title} — {p.id.split("/").pop()}</s-text>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
