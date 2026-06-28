import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { label: "Create discount set", path: "/app" },
    { label: "Discount sets", path: "/app/additional" },
    { label: "Rules", path: "/app/settings" },
  ];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {navItems.map(({ label, path }) => (
          <s-link
            key={path}
            selected={location.pathname === path}
            onClick={(e: Event) => { e.preventDefault(); navigate(path); }}
          >
            {label}
          </s-link>
        ))}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
