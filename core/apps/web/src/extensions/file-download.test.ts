import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { downloadMedia } from "../components/media/mediaContent";
import { saveAttachment } from "./file-download";

const src = "https://host.test/api/assets/scoped-ticket/collection.zip";
let anchor: { href: string; download: string; style: object; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let append: ReturnType<typeof vi.fn>;
beforeEach(() => {
  anchor = { href: "", download: "", style: {}, click: vi.fn(), remove: vi.fn() };
  append = vi.fn();
  vi.stubGlobal("window", { location: { href: "https://host.test/", origin: "https://host.test" } });
  vi.stubGlobal("navigator", { userAgent: "Browser" });
  vi.stubGlobal("document", { body: { appendChild: append }, createElement: () => anchor });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("downloads an attachment even when the old HTTP-200 body read fails", async () => {
  const blob = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, blob });
  vi.stubGlobal("fetch", fetch);
  await expect(downloadMedia(src, "合集.zip")).rejects.toThrow("Failed to fetch");
  await saveAttachment(src, "合集.zip", downloadMedia);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(blob).toHaveBeenCalledTimes(1);
  expect(anchor.href).toBe(src);
  expect(anchor.download).toBe("合集.zip");
  expect(append).toHaveBeenCalledWith(anchor);
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
});

it.each([
  ["https://remote.test/api/assets/ticket/file", "Browser"],
  ["https://host.test/not-an-attachment", "Browser"],
  ["data:application/octet-stream;base64,eA==", "Browser"],
  [src, "CocloudAndroid/1.0.8"],
])("retains the original media/native transport for %s (%s)", async (url, userAgent) => {
  vi.stubGlobal("navigator", { userAgent });
  const fallback = vi.fn().mockResolvedValue(undefined);
  await saveAttachment(url, "file", fallback);
  expect(fallback).toHaveBeenCalledWith(url, "file");
  expect(anchor.click).not.toHaveBeenCalled();
});
