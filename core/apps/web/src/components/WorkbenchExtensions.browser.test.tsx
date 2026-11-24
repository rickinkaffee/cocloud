import {afterEach, expect, it, vi} from "vite-plus/test";
import {act, render} from "../../test/render";
import {WorkbenchFolderUpload, selectedFolder} from "./WorkbenchFolderUpload";
import {CocloudConnectionCenter} from "../extensions/connection-center.js";
import "../extensions/motion.css";
import {page} from "vite-plus/test/browser";

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
  const files = Array.from({length: 52905}, (_, i) => ({webkitRelativePath: `incoming/${i}.bin`, size: 9639} as File));
  expect(selectedFolder(files)?.files).toHaveLength(52905);
  const boundary = Array.from({length: 100000}, (_, i) => ({webkitRelativePath: `incoming/${i}.bin`, size: 0} as File));
  expect(selectedFolder(boundary)?.files).toHaveLength(100000);
  expect(() => selectedFolder([...boundary, {webkitRelativePath: "incoming/overflow", size: 0} as File])).toThrow("100,000");
  expect(() => selectedFolder([{webkitRelativePath: "incoming/oversize", size: 20 * 1024 ** 3 + 1} as File])).toThrow("20 GB");
});

it("keeps live connection summaries collapsed, shares settings state and clears failures", async () => {
  let offline = false;
  const fetcher = vi.fn(async (input: string) => {
    if (offline) return json({error: "login_required"}, 401);
    if (input.endsWith("/github")) return json({installed: true, authenticated: true, connected: true, account: "test-account", canControl: false});
    return json(input.includes("/wechat/") ? {status: "已登录", db_available: false} : {enabled: true, startup: true, canControl: false});
  });
  vi.stubGlobal("fetch", fetcher);
  await using screen = await render(<CocloudConnectionCenter authorizationCount={2} canView={true} deviceSettings={<a href="/settings/access">管理设备与授权</a>}/>);
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="proxy"]')?.getAttribute("data-state")).toBe("online");
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="wechat"]')?.getAttribute("data-state")).toBe("abnormal");
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="github"]')?.getAttribute("data-state")).toBe("online");
  expect(screen.container.querySelector(".cocloud-connection-count")?.textContent).toBe("2");
  expect(screen.container.querySelector(".cocloud-connection-settings")).toBeNull();
  await screen.getByRole("button", {name: /连接中心/}).click();
  await expect.element(screen.getByText("消息读取尚未就绪", {exact: true})).toBeInTheDocument();
  await expect.element(screen.getByRole("switch")).toBeDisabled();
  await expect.element(screen.getByRole("link", {name: "管理设备与授权"})).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("刷新状态");
  offline = true;
  await screen.getByRole("button", {name: /连接中心/}).click();
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="proxy"]')?.getAttribute("data-state")).toBe("abnormal");
  await screen.rerender(<CocloudConnectionCenter authorizationCount={0} canView={true} deviceSettings={null}/>);
  expect(screen.container.querySelector(".cocloud-connection-count")?.textContent).toBe("0");
  expect(screen.container.querySelector('[data-connection-kind="authorization"]')?.getAttribute("data-state")).toBe("offline");
});

it("shows the two-row icon-only connection summary and merged memory entry", async () => {
  let wechat: {status: string; db_available: boolean} = {status: "未登录", db_available: false};
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.endsWith("/github")) return json({installed: false, authenticated: false, canControl: false});
    if (input.includes("/wechat/")) return json(wechat);
    return json({enabled: false, startup: false, canControl: false});
  }));
  await using screen = await render(<CocloudConnectionCenter authorizationCount={3} canView={true} deviceSettings={null}/>);
  const center = screen.container.querySelector("[data-workbench-connections]")!;
  expect(center.getAttribute("data-open")).toBe("false");
  for (const kind of ["proxy", "authorization", "github", "wechat", "email", "enterpriseWechat"]) {
    expect(center.querySelector(`[data-connection-kind="${kind}"]`)).not.toBeNull();
  }
  expect(center.querySelector("[data-workbench-memory]")).not.toBeNull();
  expect(center.querySelector(".cocloud-connection-label")).not.toBeNull();
  expect((center.querySelector(".cocloud-connection-label") as HTMLElement).hidden).toBe(true);
  expect(center.querySelector('[data-connection-kind="wechat"]')?.getAttribute("data-state")).toBe("offline");
  expect(center.querySelector('[data-connection-kind="wechat"] .cocloud-connection-icon') && getComputedStyle(center.querySelector('[data-connection-kind="wechat"] .cocloud-connection-icon')!).color).toBe("rgb(37, 133, 244)");
  expect(getComputedStyle(center.querySelector('[data-connection-kind="email"]')!).gridRow).toBe("2");
  expect(getComputedStyle(center.querySelector('[data-connection-kind="enterpriseWechat"]')!).gridRow).toBe("2");
  await page.screenshot({element: center.querySelector(".cocloud-connection-summary")!, path: "../../../../artifacts/connection-center-collapsed.png"});
  wechat = {status: "已登录", db_available: true};
  await screen.getByRole("button", {name: /连接中心/}).click();
  expect(center.getAttribute("data-open")).toBe("true");
  expect((center.querySelector(".cocloud-connection-label") as HTMLElement).hidden).toBe(false);
  await expect.poll(() => center.querySelector('[data-connection-kind="wechat"]')?.getAttribute("data-state")).toBe("online");
  await screen.getByRole("link", {name: "记忆中心"}).click();
  expect(document.querySelector("[data-memory-panel]")).not.toBeNull();
  await screen.getByRole("button", {name: "返回工作台"}).click();
  expect(document.querySelector("[data-memory-panel]")).toBeNull();
});


it("refreshes the WeCom status, clears stale health and restricts the desktop link", async () => {
  let reply = () => json({state: "offline", detail: "等待桌面登录"});
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    if (url === "/wecom/api/status") {
      expect(options.method ?? "GET").toBe("GET");
      expect(options.credentials).toBe("same-origin");
      return reply();
    }
    if (url.endsWith("/github")) return json({installed: false, authenticated: false});
    if (url.startsWith("/wechat/")) return json({status: "未登录", db_available: false});
    return json({enabled: false, canControl: false});
  }));
  const props = {authorizationCount: 2, canView: true, deviceSettings: null};
  await using screen = await render(<CocloudConnectionCenter {...props}/>);
  const badge = screen.container.querySelector('[data-connection-kind="enterpriseWechat"]')!;
  const color = () => getComputedStyle(badge, "::after").backgroundColor;
  await expect.poll(color).toBe("rgb(156, 163, 175)");
  await screen.getByRole("button", {name: /连接中心/}).click();
  await expect.element(screen.getByText("等待桌面登录")).toBeVisible();
  expect(screen.container.querySelector('a[href="/wecom/"]')).toBeNull();
  await screen.rerender(<CocloudConnectionCenter {...props} canOpenWecom/>);
  const card = screen.container.querySelector('section[aria-label="企业微信"]')!;
  expect(card.querySelector('a[href="/wecom/"]')).not.toBeNull();
  const refresh = () => act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  reply = () => json({state: "online", detail: "模拟桌面已连接"});
  await refresh();
  await expect.poll(color).toBe("rgb(22, 163, 74)");
  await expect.element(screen.getByText("模拟桌面已连接")).toBeVisible();
  await page.screenshot({element: screen.container, path: "../../../../artifacts/wecom-expanded.png"});
  for (const [response, detail] of [
    [() => json({state: "error", detail: "桌面连接中断"}), "桌面连接中断"],
    [() => json({state: "online"}), "状态响应异常"],
    [() => json({}, 403), "请重新登录工作台或检查访问权限"],
  ] as const) {
    reply = response;
    await refresh();
    await expect.poll(() => card.textContent).toContain(detail);
    expect(color()).toBe("rgb(220, 38, 38)");
    expect(card.textContent).not.toContain("模拟桌面已连接");
  }
});

it("offers GitHub device login, cancellation and explicit connection checks without automatic login", async () => {
  let github = {installed: true, authenticated: false, connected: null as boolean | null, account: null as string | null, canControl: true, busy: false, temporaryProxy: false, login: null as null | {state: string; code?: string; verificationUrl?: string; message: string}};
  const actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit = {}) => {
    if (!input.includes("/github")) return json(input.includes("/wechat/") ? {status: "未登录", db_available: false} : {enabled: false, startup: false, canControl: true});
    if (options.method === "POST") {
      actions.push(input); expect(new Headers(options.headers).get("X-Cocloud-Proxy")).toBe("1");
      if (input.endsWith("/login")) github = {...github, temporaryProxy: true, busy: true, login: {state: "pending", code: "ABCD-1234", verificationUrl: "https://github.com/login/device", message: "等待授权"}};
      if (input.endsWith("/cancel")) github = {...github, temporaryProxy: false, busy: false, login: {state: "cancelled", message: "已取消登录"}};
      if (input.endsWith("/check")) github = {...github, authenticated: true, connected: true, account: "test-account"};
    }
    return json(github);
  }));
  await using screen = await render(<CocloudConnectionCenter authorizationCount={0} canView={true} deviceSettings={null}/>);
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="github"]')?.getAttribute("data-state")).toBe("offline");
  expect(actions).toEqual([]);
  await screen.getByRole("button", {name: /连接中心/}).click();
  await screen.getByRole("button", {name: "登录 GitHub", exact: true}).click();
  await expect.element(screen.getByText("ABCD-1234", {exact: true})).toBeInTheDocument();
  expect(screen.container.querySelector('a[href="https://github.com/login/device"]')).not.toBeNull();
  await screen.getByRole("button", {name: "取消 GitHub 登录"}).click();
  await expect.element(screen.getByText("已取消登录", {exact: true})).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("ABCD-1234");
  await screen.getByRole("button", {name: "检测 GitHub 连接"}).click();
  await expect.poll(() => screen.container.querySelector('[data-connection-kind="github"]')?.getAttribute("data-state")).toBe("online");
  expect(screen.container.textContent).toContain("@test-account");
  expect(actions.map(path => path.split("/").at(-1))).toEqual(["login", "cancel", "check"]);
});
