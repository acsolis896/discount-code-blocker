import { useCallback, useState, useMemo } from "react";
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

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

    // Fetch historically used codes from DB
    const preUsedRows = await db.preUsedCode.findMany({
      where: { shop: session.shop, discountId: gid },
      select: { code: true },
      orderBy: { createdAt: "asc" },
    });
    const preUsedCodes = preUsedRows.map((r) => r.code);

    return { numericId, title, shop, codes: allCodes, totalCount, usedCount, preUsedCodes, error: null as string | null };
  } catch (err: unknown) {
    return {
      numericId: params.id,
      title: "Discount",
      shop: "",
      codes: [] as RedeemCode[],
      totalCount: 0,
      usedCount: 0,
      preUsedCodes: [] as string[],
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export default function DiscountDetails() {
  const { title, numericId, shop, codes, totalCount, usedCount, preUsedCodes, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const unusedCount = totalCount - usedCount - preUsedCodes.length;

  const PAGE_SIZE = 50;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filteredCodes = useMemo(() => {
    const q = search.trim().toUpperCase();
    return q ? codes.filter((c: RedeemCode) => c.code.includes(q)) : codes;
  }, [codes, search]);

  const totalPages = Math.max(1, Math.ceil(filteredCodes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedCodes = filteredCodes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const handleExport = useCallback((unusedOnly = false) => {
    const filtered = unusedOnly ? codes.filter((c: RedeemCode) => c.usageCount === 0) : codes;
    const rows = [
      "Code,Status",
      ...filtered.map((c: RedeemCode) => `${c.code},${c.usageCount > 0 ? "Used" : "Unused"}`),
      ...(unusedOnly ? [] : preUsedCodes.map((c: string) => `${c},Previously Used`)),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title ?? "discount-codes"}${unusedOnly ? "-unused" : "-all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [codes, preUsedCodes, title]);

  return (
    <s-page heading={title ?? "Discount"}>
      {error && (
        <s-banner title="Error" tone="critical">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-stack direction="inline" gap="base">
        <s-button variant="primary" onClick={() => handleExport(false)} disabled={codes.length === 0 && preUsedCodes.length === 0}>
          Export all (CSV)
        </s-button>
        <s-button onClick={() => handleExport(true)} disabled={unusedCount === 0}>
          Export unused only
        </s-button>
        <s-button
          onClick={() =>
            window.open(`https://${shop}/admin/discounts/${numericId}`, "_blank")
          }
        >
          View in Shopify admin
        </s-button>
        <s-button onClick={() => navigate("/app")}>Create another discount</s-button>
      </s-stack>

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
          {preUsedCodes.length > 0 && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="none">
                <s-text emphasis="bold">{preUsedCodes.length}</s-text>
                <s-text>Previously used</s-text>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section heading={`Codes${totalCount >= 2000 ? " (first 2,000)" : ""}`}>
        <s-stack direction="block" gap="base">
          {/* Search */}
          <input
            type="search"
            placeholder="Search codes…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            style={{ padding: "8px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
          />

          {/* Header row */}
          <s-box padding="tight" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="none">
              <s-text emphasis="bold" style={{ flex: 1 }}>Code</s-text>
              <s-text emphasis="bold">Status</s-text>
            </s-stack>
          </s-box>

          {pagedCodes.map((c: RedeemCode) => (
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
          {filteredCodes.length === 0 && codes.length > 0 && (
            <s-paragraph>No codes match your search.</s-paragraph>
          )}

          {/* Pagination */}
          {filteredCodes.length > 0 && (
            <s-stack direction="inline" gap="base" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <s-button
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Previous
              </s-button>
              <s-text style={{ fontSize: "13px", color: "#6d7175" }}>
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredCodes.length)} of {filteredCodes.length}
              </s-text>
              <s-button
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Next →
              </s-button>
            </s-stack>
          )}

          {codes.length > 0 && !search && (
            <s-paragraph style={{ color: "#6d7175", fontSize: "13px" }}>
              Not seeing all codes? Shopify processes bulk uploads in the background — refresh in 30–60 seconds if the count looks low.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      {preUsedCodes.length > 0 && (
        <s-section heading="Previously used codes (historical)">
          <s-stack direction="block" gap="tight">
            <s-paragraph>
              These codes were imported as already used and are not active in Shopify.
            </s-paragraph>
            <s-box padding="tight" background="subdued" borderRadius="base">
              <s-stack direction="inline" gap="none">
                <s-text emphasis="bold" style={{ flex: 1 }}>Code</s-text>
                <s-text emphasis="bold">Status</s-text>
              </s-stack>
            </s-box>
            {preUsedCodes.map((c: string) => (
              <s-box key={c} padding="tight" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="none">
                  <s-text style={{ flex: 1, fontFamily: "monospace" }}>{c}</s-text>
                  <s-badge tone="critical">Previously Used</s-badge>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
