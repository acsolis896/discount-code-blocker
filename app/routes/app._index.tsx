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
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const title = String(formData.get("title") || "Bulk Discount");
  const percentage = Number(formData.get("percentage") || 0);
  const prefix = String(formData.get("prefix") || "DISCOUNT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codeCount = Math.min(Math.max(Number(formData.get("codeCount") || 100), 1), 5000);
  const productIds: string[] = JSON.parse(String(formData.get("productIds") || "[]"));

  if (!percentage || percentage < 1 || percentage > 100) {
    return { error: "Percentage must be between 1 and 100." };
  }
  if (productIds.length === 0) {
    return { error: "Select at least one eligible product." };
  }
  if (!prefix) {
    return { error: "Code prefix is required." };
  }

  // Step 1: create the function-based discount with eligible product config
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
          metafields: [
            {
              namespace: "$app",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify({ productIds, percentage }),
            },
          ],
        },
      },
    }
  );

  const createData = await createRes.json();
  const createErrors = createData.data?.discountCodeAppCreate?.userErrors ?? [];
  if (createErrors.length > 0) {
    return { error: createErrors.map((e: { message: string }) => e.message).join(", ") };
  }

  const discountId = createData.data?.discountCodeAppCreate?.codeAppDiscount?.discountId;
  if (!discountId) {
    return { error: "Failed to create discount." };
  }

  // Step 2: generate codes with the prefix pattern
  const codes = Array.from({ length: codeCount }, (_, i) => ({
    code: `${prefix}-${String(i + 1).padStart(5, "0")}`,
  }));

  const bulkRes = await admin.graphql(
    `#graphql
    mutation AddBulkCodes($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
      discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
        bulkCreation { id status codesCount }
        userErrors { field message }
      }
    }`,
    { variables: { discountId, codes } }
  );

  const bulkData = await bulkRes.json();
  const bulkErrors = bulkData.data?.discountRedeemCodeBulkAdd?.userErrors ?? [];
  if (bulkErrors.length > 0) {
    return {
      error: bulkErrors.map((e: { message: string }) => e.message).join(", "),
      discountId,
    };
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
};

type SelectedProduct = { id: string; title: string };

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [title, setTitle] = useState("Bulk Discount");
  const [percentage, setPercentage] = useState("20");
  const [prefix, setPrefix] = useState("");
  const [codeCount, setCodeCount] = useState("100");
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);

  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data as Record<string, unknown> | undefined;
  const hasError = result && "error" in result;
  const hasSuccess = result && "discountId" in result && !hasError;

  const handlePickProducts = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selectedProducts.map((p) => ({ id: p.id })),
    });
    if (selected) {
      setSelectedProducts(
        selected.map((p: { id: string; title: string }) => ({
          id: p.id,
          title: p.title,
        }))
      );
    }
  }, [shopify, selectedProducts]);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("percentage", percentage);
    formData.set("prefix", prefix);
    formData.set("codeCount", codeCount);
    formData.set("productIds", JSON.stringify(selectedProducts.map((p) => p.id)));
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, title, percentage, prefix, codeCount, selectedProducts]);

  const handleReset = useCallback(() => {
    setTitle("Bulk Discount");
    setPercentage("20");
    setPrefix("");
    setCodeCount("100");
    setSelectedProducts([]);
    fetcher.load("/app");
  }, [fetcher]);

  const previewCode = prefix
    ? `${prefix.toUpperCase().replace(/[^A-Z0-9]/g, "")}-00001`
    : "";

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

      <s-section heading="Eligible products">
        <s-paragraph>
          The discount will apply to the highest-priced eligible item in the
          cart — 1 unit only.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-button onClick={handlePickProducts}>
            {selectedProducts.length > 0
              ? `${selectedProducts.length} product${selectedProducts.length > 1 ? "s" : ""} selected — change`
              : "Select products"}
          </s-button>
          {selectedProducts.length > 0 && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="tight">
                {selectedProducts.map((p) => (
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
          disabled={!prefix || !percentage || selectedProducts.length === 0}
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
