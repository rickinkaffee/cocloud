import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render, act } from "../../../test/render";
import { ComposerAttachButton } from "./ComposerAttachmentStrip";
import { useSharedBrowserPanel } from "./SharedBrowserPanel";
import type { RightPanelTabsProps } from "../RightPanelTabs";
import { TurnMetricsFooter } from "./TurnMetricsFooter";
import "~/index.css";

it("camera uses the existing attachment pipeline and cancellation leaves the draft intact", async () => {
  const intake = vi.fn(async (_files: File[]) => true),
    focus = vi.fn();
  await using screen = await render(
    <ComposerAttachButton addComposerAttachments={intake} focusComposer={focus} />,
  );
  const camera = screen.container.querySelector<HTMLInputElement>('input[capture="environment"]')!;
  expect(camera.accept).toBe("image/*");
  expect(camera.multiple).toBe(false);
  await act(() => {
    camera.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(intake).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  const transfer = new DataTransfer();
  transfer.items.add(new File(["synthetic image"], "photo.jpg", { type: "image/jpeg" }));
  await act(() => {
    camera.files = transfer.files;
    camera.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(intake).toHaveBeenCalledOnce();
  expect(intake.mock.calls[0]?.[0][0]?.name).toBe("photo.jpg");
  expect(camera.value).toBe("");
  expect(focus).not.toHaveBeenCalled();
});

function PanelHarness() {
  const [active, setActive] = useState("files");
  const props = useSharedBrowserPanel({
    activeSurfaceId: active,
    onActivate: (_surface: RightPanelTabsProps["surfaces"][number]) => setActive("files"),
    children: <input aria-label="unsent draft" defaultValue="preserve me" />,
    layoutControls: <button onClick={() => setActive("files")}>controls</button>,
  });
  return (
    <div>
      {props.layoutControls}
      <button
        onClick={() => props.onActivate({ id: "files" } as RightPanelTabsProps["surfaces"][number])}
      >
        Files
      </button>
      {props.children}
    </div>
  );
}

it("the shared browser is lazy and survives tab switches without discarding other panel state", async () => {
  await using screen = await render(<PanelHarness />);
  expect(screen.container.querySelector("iframe")).toBeNull();
  const draft = screen.container.querySelector<HTMLInputElement>("input")!;
  draft.value = "retained text";
  await screen.getByRole("tab", { name: "Floe浏览器" }).click();
  const frame = screen.container.querySelector("iframe")!;
  expect(frame.getAttribute("src")).toBe("/floe/");
  expect(frame.title).toBe("Floe浏览器");
  await screen.getByRole("button", { name: "Files", exact: true }).click();
  expect(draft.value).toBe("retained text");
  await screen.getByRole("tab", { name: "Floe浏览器" }).click();
  expect(screen.container.querySelector("iframe")).toBe(frame);
});

it("statistics display measured speed and open details without changing the draft", async () => {
  await using screen = await render(
    <TurnMetricsFooter
      metrics={{
        round: 2,
        steps: 3,
        stepsComplete: true,
        totalTokens: 1200,
        cacheHitPercent: 50,
        tokensPerSecond: 40,
        contextUsed: 1000,
        contextMax: 10000,
        partial: false,
      }}
    />,
  );
  expect(screen.container.textContent).toContain("40 tok/s");
  await screen.getByRole("button", { name: /会话统计|Session statistics/ }).click();
  await expect.element(page.getByText(/输出速度|Output speed/)).toBeVisible();
});
