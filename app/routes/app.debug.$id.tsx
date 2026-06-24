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
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}

  return { title: node?.discount?.title, raw, parsed };
};

export default function DebugDiscount() {
  const { title, raw, parsed } = useLoaderData<typeof loader>();
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
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "12px" }}>
            {JSON.stringify(parsed.productIds, null, 2)}
          </pre>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
