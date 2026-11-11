import { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  rootRouteId,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { BrandHomeLink } from "@/components/BrandLogo";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("serves the document view, prepare and send screens as separate pages", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    // The document view must be an index child so the /document/$id layout can
    // render its own pages; without it /prepare and /send show the document view.
    expect(router.matchRoutes("/document/abc").at(-1)?.routeId).toBe("/_authenticated/document/$id/");
    expect(router.matchRoutes("/document/abc/prepare").at(-1)?.routeId).toBe("/_authenticated/document/$id/prepare");
    expect(router.matchRoutes("/document/abc/send").at(-1)?.routeId).toBe("/_authenticated/document/$id/send");
  });
});

describe("Brand header link", () => {
  it("points at the home screen", async () => {
    const root = createRootRoute();
    const home = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <BrandHomeLink iconClassName="h-7 w-7" />,
    });
    const router = createRouter({
      routeTree: root.addChildren([home]),
      history: createMemoryHistory({ initialEntries: [""] }),
    });
    await router.load();

    render(<RouterProvider router={router} />);

    const link = await screen.findByRole("link", { name: "DocuALL home" });
    expect(link.getAttribute("href")).toBe("/");
  });
});
