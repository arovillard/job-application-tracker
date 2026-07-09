import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("./ThemeProvider", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() })
}));

vi.mock("./Toast", () => ({
  Toast: () => null
}));

import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  it("uses the stage filter without a duplicate saved-view row", () => {
    const markup = renderToStaticMarkup(<Dashboard />);

    expect(markup).not.toContain("All opportunities");
    expect(markup).not.toContain("Pipeline progress");
    expect(markup).toContain("Wishlist");
    expect(markup).toContain("Applied");
    expect(markup).toContain("Interviewing");
  });
});
