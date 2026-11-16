import { useState } from "react";
import type { RightPanelTabsProps } from "../RightPanelTabs";

/** Retain both surfaces when switching, so browser sessions and editor state survive. */
export function useSharedBrowserPanel<
  T extends Pick<
    RightPanelTabsProps,
    "activeSurfaceId" | "onActivate" | "layoutControls" | "children"
  >,
>(props: T): T {
  const [active, setActive] = useState(false);
  const [visited, setVisited] = useState(false);
  return {
    ...props,
    activeSurfaceId: active ? "cocloud-floe" : props.activeSurfaceId,
    onActivate: (surface) => {
      setActive(false);
      props.onActivate(surface);
    },
    layoutControls: (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          role="tab"
          aria-label="Floe浏览器"
          aria-selected={active}
          data-floe-panel-tab
          className="shrink-0 rounded px-3 py-1.5 text-xs hover:bg-accent"
          onClick={() => {
            setVisited(true);
            setActive(true);
          }}
        >
          Floe浏览器
        </button>
        {props.layoutControls}
      </div>
    ),
    children: (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex min-h-0 flex-1 flex-col"
          hidden={active}
          inert={active}
          style={{ display: active ? "none" : undefined }}
        >
          {props.children}
        </div>
        {visited && (
          <div
            className="absolute inset-0 flex flex-col bg-background"
            hidden={!active}
            inert={!active}
            style={{ display: active ? undefined : "none" }}
          >
            <div className="flex items-center justify-between border-b px-3 py-1 text-xs">
              <span>Floe · 服务器共享会话</span>
              <a href="/floe/" target="_blank" rel="noopener noreferrer" className="underline">
                独立窗口
              </a>
            </div>
            <iframe
              src="/floe/"
              title="Floe浏览器"
              className="min-h-0 w-full flex-1 border-0"
              allow="clipboard-read; clipboard-write"
              referrerPolicy="same-origin"
            />
          </div>
        )}
      </div>
    ),
  };
}
