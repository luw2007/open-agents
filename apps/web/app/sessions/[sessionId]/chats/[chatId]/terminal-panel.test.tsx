import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalPanelView } from "./terminal-panel";

describe("TerminalPanelView", () => {
  test("renders the loading state", () => {
    const html = renderToStaticMarkup(
      <TerminalPanelView state={{ status: "loading" }} />,
    );

    expect(html).toContain("Launching terminal…");
  });

  test("renders the requires-restart state", () => {
    const html = renderToStaticMarkup(
      <TerminalPanelView
        state={{
          status: "requires_restart",
          message: "Restart the sandbox to expose the terminal route.",
        }}
      />,
    );

    expect(html).toContain("Terminal needs a sandbox restart");
    expect(html).toContain("Restart the sandbox to expose the terminal route.");
  });

  test("renders the ready state with an inline terminal container", () => {
    const html = renderToStaticMarkup(
      <TerminalPanelView
        state={{
          status: "ready",
          terminalUrl:
            "https://terminal.vercel.run/#token=test-token&session=session-launch-1",
        }}
      />,
    );

    expect(html).toContain("bg-[#09090b]");
    expect(html).toContain("<div");
    expect(html).not.toContain("<iframe");
  });

  test("renders the error state", () => {
    const html = renderToStaticMarkup(
      <TerminalPanelView
        state={{
          status: "error",
          message: "Failed to launch terminal runtime.",
        }}
      />,
    );

    expect(html).toContain("Failed to open terminal");
    expect(html).toContain("Failed to launch terminal runtime.");
  });
});
