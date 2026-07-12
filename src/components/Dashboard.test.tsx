import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./ThemeProvider", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("./Toast", () => ({ Toast: () => null }));

import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  it("renders opportunity type and broad-status controls", () => {
    const markup = renderToStaticMarkup(<Dashboard />);

    expect(markup).toContain("Opportunities");
    expect(markup).toContain("Jobs");
    expect(markup).toContain("Connections");
    expect(markup).toContain("Active");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Closed");
    expect(markup).toContain("Archived");
    expect(markup).toContain("New opportunity");
    expect(markup).not.toContain('href="/opportunities/new"');
    expect(markup).not.toContain("New application");
  });
});
