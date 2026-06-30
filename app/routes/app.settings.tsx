import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rows = await db.blockedProductType.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "asc" },
    select: { id: true, productType: true },
  });
  return { blockedTypes: rows };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const productType = (formData.get("productType") as string ?? "").trim().toUpperCase();
    if (!productType) return { error: "Product type is required." };
    await db.blockedProductType.upsert({
      where: { shop_productType: { shop: session.shop, productType } },
      create: { shop: session.shop, productType },
      update: {},
    });
    return { ok: true };
  }

  if (intent === "remove") {
    const id = formData.get("id") as string;
    await db.blockedProductType.deleteMany({ where: { id, shop: session.shop } });
    return { ok: true };
  }

  if (intent === "sync") {
    // Fetch current blocked types for this shop
    const rows = await db.blockedProductType.findMany({
      where: { shop: session.shop },
      select: { productType: true },
    });
    const blockedProductTypes = rows.length > 0 ? rows.map((r: { productType: string }) => r.productType) : ["GWP"];

    // Paginate through all discounts using this function
    let cursor: string | null = null;
    let updated = 0;
    let errors: string[] = [];

    do {
      const res = await admin.graphql(
        `#graphql
        query GetAllDiscounts($after: String) {
          discountNodes(first: 50, after: $after, query: "function_id:discount-rejection-function-js") {
            nodes {
              id
              discount {
                ... on DiscountCodeApp {
                  title
                }
              }
              metafield(namespace: "$app", key: "function-configuration") {
                value
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { variables: { after: cursor } }
      );

      const data = await res.json();
      const nodes = data.data?.discountNodes?.nodes ?? [];

      for (const node of nodes) {
        let config: Record<string, unknown> = {};
        try {
          if (node.metafield?.value) config = JSON.parse(node.metafield.value);
        } catch { /* keep empty config */ }

        const newConfig = { ...config, blockedProductTypes };

        const updateRes = await admin.graphql(
          `#graphql
          mutation SyncMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
          {
            variables: {
              metafields: [{
                ownerId: node.id,
                namespace: "$app",
                key: "function-configuration",
                type: "json",
                value: JSON.stringify(newConfig),
              }],
            },
          }
        );

        const updateData = await updateRes.json();
        const updateErrors = updateData.data?.metafieldsSet?.userErrors ?? [];
        if (updateErrors.length > 0) {
          errors.push(`${node.discount?.title ?? node.id}: ${updateErrors.map((e: { message: string }) => e.message).join(", ")}`);
        } else {
          updated++;
        }
      }

      const pageInfo = data.data?.discountNodes?.pageInfo;
      cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor);

    if (errors.length > 0) return { error: `Synced ${updated} discounts, but ${errors.length} failed: ${errors.join("; ")}` };
    return { synced: updated };
  }

  return { error: "Unknown action." };
};

export default function SettingsPage() {
  const { blockedTypes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [newType, setNewType] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data;

  const handleAdd = () => {
    if (!newType.trim()) return;
    const form = new FormData();
    form.append("intent", "add");
    form.append("productType", newType.trim());
    fetcher.submit(form, { method: "post" });
    setNewType("");
  };

  const handleRemove = (id: string) => {
    const form = new FormData();
    form.append("intent", "remove");
    form.append("id", id);
    fetcher.submit(form, { method: "post" });
  };

  const handleSync = () => {
    const form = new FormData();
    form.append("intent", "sync");
    fetcher.submit(form, { method: "post" });
  };

  return (
    <s-page heading="Discount Rules">
      <s-section heading="Blocked product types">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Discount codes will not apply when any item in the cart has one of the following product types.
            Product types are set on products in the Shopify admin under the product details.
          </s-paragraph>

          {(result as { error?: string })?.error && (
            <s-banner title="Error" tone="critical">
              <s-paragraph>{(result as { error: string }).error}</s-paragraph>
            </s-banner>
          )}
          {(result as { synced?: number })?.synced !== undefined && (
            <s-banner title="Synced" tone="success">
              <s-paragraph>Updated {(result as { synced: number }).synced} discount set{(result as { synced: number }).synced !== 1 ? "s" : ""} with the current blocked types.</s-paragraph>
            </s-banner>
          )}

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: "var(--s-color-bg-subdued, #f6f6f7)", borderRadius: "8px", gap: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", flex: 1 }}>Product type</span>
            <span style={{ width: "80px" }}></span>
          </div>

          {blockedTypes.length === 0 && (
            <div style={{ padding: "12px", color: "#6d7175", fontSize: "14px" }}>
              No blocked product types configured. Discounts will apply to all product types.
            </div>
          )}

          {blockedTypes.map((t: { id: string; productType: string }) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", padding: "12px", borderBottom: "1px solid #e1e3e5", gap: "12px" }}>
              <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 500, flex: 1 }}>{t.productType}</span>
              <div style={{ width: "80px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => handleRemove(t.id)}
                  disabled={isSubmitting}
                  style={{ padding: "4px 10px", fontSize: "12px", background: "transparent", border: "1px solid #f5c6c2", borderRadius: "5px", cursor: "pointer", color: "#d72c0d" }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {/* Add new */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
            <input
              type="text"
              placeholder="e.g. GWP"
              value={newType}
              onChange={(e) => setNewType(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              style={{ padding: "8px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #ccc", flex: 1 }}
            />
            <s-button variant="primary" onClick={handleAdd} disabled={isSubmitting || !newType.trim()}>
              Add
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Sync to existing discounts">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            After changing blocked product types, click Sync to update all existing discount sets.
            This applies the current blocked types list to every discount created with this app.
          </s-paragraph>
          <div>
            <s-button variant="primary" onClick={handleSync} disabled={isSubmitting}>
              {isSubmitting && (fetcher.formData?.get("intent") === "sync") ? "Syncing…" : "Sync to all discounts"}
            </s-button>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
