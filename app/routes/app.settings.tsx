import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function SettingsPage() {
  return (
    <s-page heading="Discount Rules">
      <s-section heading="Blocked product types">
        <s-paragraph>
          Discount codes will not apply when any item in the cart has one of the following product types.
          Product types are set on products in the Shopify admin under the product details.
        </s-paragraph>
        <s-stack direction="block" gap="tight">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base">
              <s-badge>GWP</s-badge>
              <s-text>Gift With Purchase — always blocks discount code usage</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
