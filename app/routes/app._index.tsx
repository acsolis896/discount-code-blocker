import { useState, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const title = String(formData.get("title") || "Bulk Discount");
  const percentage = Number(formData.get("percentage") || 0);
  // Keep hyphens and underscores; strip everything else; uppercase
  const prefix = String(formData.get("prefix") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, "")
    .replace(/^[\-_]+|[\-_]+$/g, ""); // trim leading/trailing separators
  const codeCount = Math.min(Math.max(Number(formData.get("codeCount") || 100), 1), 5000);
  const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));
  const collectionIds: string[] = JSON.parse(String(formData.get("collectionIds") || "[]"));

  if (!percentage || percentage < 1 || percentage > 100) {
    return { error: "Percentage must be between 1 and 100." };
  }
  if (productIds.length === 0 && collectionIds.length === 0) {
    return { error: "Select at least one eligible product or collection." };
  }
  if (!prefix) {
    return { error: "Code prefix is required." };
  }

  // Expand collection IDs → product IDs so the function only checks productIds
  let resolvedProductIds = [...productIds];
  if (collectionIds.length > 0) {
    for (const collectionId of collectionIds) {
      let cursor: string | null = null;
      do {
        const colRes = await admin.graphql(
          `#graphql
          query CollectionProducts($id: ID!, $after: String) {
            collection(id: $id) {
              products(first: 250, after: $after) {
                nodes { id }
                pageInfo { hasNextPage endCursor }
              }
            }
          }`,
          { variables: { id: collectionId, after: cursor } }
        );
        const colData = await colRes.json();
        const products = colData.data?.collection?.products;
        for (const p of products?.nodes ?? []) {
          if (!resolvedProductIds.includes(p.id)) resolvedProductIds.push(p.id);
        }
        cursor = products?.pageInfo?.hasNextPage ? products.pageInfo.endCursor : null;
      } while (cursor);
    }
  }

  if (resolvedProductIds.length === 0) {
    return { error: "No products found in the selected collections." };
  }

  // Generate codes upfront so the first one can be included in creation
  const firstCode = `${prefix}${String(1).padStart(5, "0")}`;

  // Step 1: create the function-based discount — first code must be included in creation
  const createRes = await admin.graphql(
    `#graphql
    mutation CreateBulkCodeDiscount($input: DiscountCodeAppInput!) {
      discountCodeAppCreate(codeAppDiscount: $input) {
        codeAppDiscount { discountId }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title,
          functionHandle: "discount-rejection-function-js",
          startsAt: new Date().toISOString(),
          appliesOncePerCustomer: false,
          code: firstCode,
          metafields: [
            {
              namespace: "$app",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify({ productIds: resolvedProductIds, percentage }),
            },
          ],
        },
      },
    }
  );

  const createData = await createRes.json();
  const createErrors = createData.data?.discountCodeAppCreate?.userErrors ?? [];
  if (createErrors.length > 0) {
    return { error: `Creating discount: ${createErrors.map((e: { message: string }) => e.message).join(", ")}` };
  }

  const discountId = createData.data?.discountCodeAppCreate?.codeAppDiscount?.discountId;
  if (!discountId) {
    return { error: "Failed to create discount." };
  }

  // Step 2: generate all codes upfront
  const codes = Array.from({ length: codeCount }, (_, i) => ({
    code: `${prefix}${String(i + 1).padStart(5, "0")}`,
  }));

  // Step 3: bulk-add remaining codes (first was included in creation)
  const remainingCodes = codes.slice(1);
  if (remainingCodes.length > 0) {
    const bulkRes = await admin.graphql(
      `#graphql
      mutation AddBulkCodes($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
        discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
          bulkCreation { id status codesCount }
          userErrors { field message }
        }
      }`,
      { variables: { discountId, codes: remainingCodes } }
    );

    const bulkData = await bulkRes.json();
    const bulkErrors = bulkData.data?.discountRedeemCodeBulkAdd?.userErrors ?? [];
    if (bulkErrors.length > 0) {
      return {
        error: `Adding codes: ${bulkErrors.map((e: { message: string }) => e.message).join(", ")}`,
        discountId,
      };
    }
  }

  return {
    discountId,
    title,
    percentage,
    prefix,
    codeCount,
    firstCode: codes[0].code,
    lastCode: codes[codes.length - 1].code,
  };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Unexpected error: ${message}` };
  }
};

type SelectedItem = { id: string; title: string };

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [title, setTitle] = useState("Bulk Discount");
  const [percentage, setPercentage] = useState("20");
  const [prefix, setPrefix] = useState("");
  const [codeCount, setCodeCount] = useState("100");
  const [selectionType, setSelectionType] = useState<"product" | "collection">("product");
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data as Record<string, unknown> | undefined;
  const hasError = result && "error" in result;
  const hasSuccess = result && "discountId" in result && !hasError;

  const handlePickItems = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: selectionType,
      multiple: true,
      selectionIds: selectedItems.map((p) => ({ id: p.id })),
    });
    if (selected) {
      setSelectedItems(
        selected.map((p: { id: string; title: string }) => ({
          id: p.id,
          title: p.title,
        }))
      );
    }
  }, [shopify, selectionType, selectedItems]);

  const handleSelectionTypeChange = useCallback((type: "product" | "collection") => {
    setSelectionType(type);
    setSelectedItems([]);
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("percentage", percentage);
    formData.set("prefix", prefix);
    formData.set("codeCount", codeCount);
    if (selectionType === "product") {
      formData.set("productIds", JSON.stringify(selectedItems.map((p) => p.id)));
      formData.set("collectionIds", JSON.stringify([]));
    } else {
      formData.set("collectionIds", JSON.stringify(selectedItems.map((p) => p.id)));
      formData.set("productIds", JSON.stringify([]));
    }
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, title, percentage, prefix, codeCount, selectionType, selectedItems]);

  const handleReset = useCallback(() => {
    setTitle("Bulk Discount");
    setPercentage("20");
    setPrefix("");
    setCodeCount("100");
    setSelectedItems([]);
    fetcher.load("/app");
  }, [fetcher]);

  const sanitizedPrefix = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, "")
    .replace(/^[\-_]+|[\-_]+$/g, "");
  const previewCode = sanitizedPrefix ? `${sanitizedPrefix}00001` : "";

  return (
    <s-page heading="Create Bulk Discount Codes">
      {hasSuccess && (
        <s-banner
          title={`Discount created: ${result.title}`}
          tone="success"
          onDismiss={handleReset}
        >
          <s-paragraph>
            {result.codeCount} codes queued •{" "}
            {result.firstCode as string} → {result.lastCode as string} •{" "}
            {result.percentage}% off eligible products
          </s-paragraph>
          <s-paragraph>
            Discount ID: {result.discountId as string}
          </s-paragraph>
        </s-banner>
      )}

      {hasError && (
        <s-banner title="Something went wrong" tone="critical">
          <s-paragraph>{result.error as string}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Discount details">
        <s-form-layout>
          <s-text-field
            label="Title"
            value={title}
            onInput={(e: InputEvent) =>
              setTitle((e.target as HTMLInputElement).value)
            }
            helpText="Shown in the Shopify admin discounts list"
          />
          <s-text-field
            label="Percentage off"
            type="number"
            value={percentage}
            min="1"
            max="100"
            suffix="%"
            onInput={(e: InputEvent) =>
              setPercentage((e.target as HTMLInputElement).value)
            }
          />
        </s-form-layout>
      </s-section>

      <s-section heading="Code generation">
        <s-form-layout>
          <s-text-field
            label="Code prefix"
            value={prefix}
            onInput={(e: InputEvent) =>
              setPrefix((e.target as HTMLInputElement).value)
            }
            helpText={
              previewCode ? `Preview: ${previewCode}` : "Letters and numbers only, e.g. BAJIO"
            }
          />
          <s-text-field
            label="Number of codes"
            type="number"
            value={codeCount}
            min="1"
            max="5000"
            onInput={(e: InputEvent) =>
              setCodeCount((e.target as HTMLInputElement).value)
            }
            helpText="Maximum 5,000 per batch"
          />
        </s-form-layout>
      </s-section>

      <s-section heading="Eligible items">
        <s-paragraph>
          The discount applies to the highest-priced eligible item in the cart — 1 unit only.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="tight">
            <s-button
              variant={selectionType === "product" ? "primary" : "tertiary"}
              onClick={() => handleSelectionTypeChange("product")}
            >
              Products
            </s-button>
            <s-button
              variant={selectionType === "collection" ? "primary" : "tertiary"}
              onClick={() => handleSelectionTypeChange("collection")}
            >
              Collections
            </s-button>
          </s-stack>
          <s-button onClick={handlePickItems}>
            {selectedItems.length > 0
              ? `${selectedItems.length} ${selectionType}${selectedItems.length > 1 ? "s" : ""} selected — change`
              : `Select ${selectionType}s`}
          </s-button>
          {selectedItems.length > 0 && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="tight">
                {selectedItems.map((p) => (
                  <s-text key={p.id}>{p.title}</s-text>
                ))}
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button
          variant="primary"
          onClick={handleSubmit}
          {...(isLoading ? { loading: true } : {})}
          disabled={!prefix || !percentage || selectedItems.length === 0}
        >
          Create discount codes
        </s-button>
        {hasSuccess && (
          <s-button onClick={handleReset}>Create another</s-button>
        )}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
