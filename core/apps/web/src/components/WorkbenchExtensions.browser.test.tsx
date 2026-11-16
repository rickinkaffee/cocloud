import {afterEach, expect, it, vi} from "vite-plus/test";
import {act, render} from "../../test/render";
import {WorkbenchFolderUpload, selectedFolder} from "./WorkbenchFolderUpload";
import {CocloudConnectionCenter} from "../extensions/connection-center.js";
import "../extensions/motion.css";

afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json"}});

it("uploads through the real folder UI after placement and per-file skip/overwrite/keep review", async () => {
  const staged: {path: string}[][] = [];
  const manifests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    if (input === "/api/projects") return json({projects: [{id: "project", title: "Sample", workspaceRoot: "/projects/sample"}]});
    if (input.includes("manifest?purpose=upload")) return json({version: "review", files: [{path: "a.txt"}, {path: "b.txt"}, {path: "c.txt"}], directories: []});
    expect(new Headers(init.headers).get("X-Cocloud-Import")).toBe("1");
    if (input === "/api/cocloud/imports") {
      const manifest = JSON.parse(String(init.body)); manifests.push(manifest); staged.push(manifest.files);
      return json({id: "session"});
    }
    if (input.endsWith("/commit")) return json({path: "/projects/sample"});
    if (init.method === "PUT") return json({offset: (init.body as ArrayBuffer).byteLength});
    throw Error("unexpected request: " + input);
  }));
  await using screen = await render(<WorkbenchFolderUpload/>);
  await screen.getByText("上传文件夹", {exact: true}).click();
  await expect.element(screen.getByRole("option", {name: "Sample"})).toBeInTheDocument();
  await act(async () => {
    const select = screen.container.querySelector("select")!; select.value = "project";
    select.dispatchEvent(new Event("change", {bubbles: true}));
  });
  await act(async () => {
    const transfer = new DataTransfer();
    for (const name of ["a.txt", "b.txt", "c.txt", "new.txt"]) {
      const file = new File(["content"], name); Object.defineProperty(file, "webkitRelativePath", {value: "incoming/" + name}); transfer.items.add(file);
    }
    const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.files = transfer.files; input.dispatchEvent(new Event("change", {bubbles: true}));
  });
  await screen.getByText("直接传到根目录", {exact: true}).click();
  await screen.getByRole("button", {name: "开始上传"}).click();
  await expect.element(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(staged).toHaveLength(0);
  await screen.getByRole("button", {name: "跳过", exact: true}).click();
  await screen.getByRole("button", {name: "覆盖", exact: true}).click();
  await screen.getByRole("button", {name: "保留", exact: true}).click();
  await expect.element(screen.getByRole("status").filter({hasText: "上传完成"})).toBeInTheDocument();
  expect(staged[0]!.map(f => f.path)).toEqual(["b.txt", "c.txt", "new.txt"]);
  expect(manifests[0]!.destination).toEqual({placement: "root", conflict: "keep", fileConflicts: {"a.txt": "skip", "b.txt": "overwrite", "c.txt": "keep"}, folderName: "incoming"});
  const files = Array.from({length: 9137}, (_, i) => ({webkitRelativePath: `incoming/${i}.bin`, size: 9639} as File));
  expect(selectedFolder(files)?.files).toHaveLength(9137);
});

it("keeps live connection summaries collapsed, shares settings state and clears failures", async () => {
  let offline = false;
  const fetcher = vi.fn(async (input: string) => {
    if (offline) return json({error: "login_required"}, 401);
    return json(input.includes("/wechat/") ? {status: "已登录", db_available: false} : {enabled: true, startup: true, canControl: false});
  });
  vi.stubGlobal("fetch", fetcher);
  await using screen = await render(<CocloudConnectionCenter authorizationCount={2} canView={true} deviceSettings={<a href="/settings/access">管理设备与授权</a>}/>);
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="proxy"]')?.getAttribute("data-state")).toBe("online");
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="wechat"]')?.getAttribute("data-state")).toBe("online");
  expect(screen.container.querySelector(".cocloud-connection-count")?.textContent).toBe("2");
  expect(screen.container.querySelector(".cocloud-connection-settings")).toBeNull();
  await screen.getByRole("button", {name: /连接中心/}).click();
  await expect.element(screen.getByText("消息读取尚未就绪", {exact: true})).toBeInTheDocument();
  await expect.element(screen.getByRole("switch")).toBeDisabled();
  await expect.element(screen.getByRole("link", {name: "管理设备与授权"})).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("刷新状态");
  offline = true;
  await screen.getByRole("button", {name: /连接中心/}).click();
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="proxy"]')?.getAttribute("data-state")).toBe("offline");
  await screen.rerender(<CocloudConnectionCenter authorizationCount={0} canView={true} deviceSettings={null}/>);
  expect(screen.container.querySelector(".cocloud-connection-count")?.textContent).toBe("0");
  expect(screen.container.querySelector('[data-connection-kind="authorization"]')?.getAttribute("data-state")).toBe("offline");
});
