/** Host bindings keep the camera on the same attachment validation/upload path. */
export function createAttachButton(
  React: any,
  MenuItem: any,
  Button: any,
  Paperclip: any,
  translate: (text: string) => string,
) {
  const h = React.createElement;
  function CameraIcon() {
    return h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        "aria-hidden": true,
      },
      h("path", {
        d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z",
      }),
      h("circle", { cx: 12, cy: 13, r: 4 }),
    );
  }
  return function ComposerAttachButton({
    addComposerAttachments,
    focusComposer,
    inMenu = false,
  }: any) {
    const files = React.useRef(null);
    const camera = React.useRef(null);
    const onChange = (event: any) => {
      const selected = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (selected.length === 0) return;
      void addComposerAttachments(selected).then((inserted: boolean) => {
        if (!inserted) focusComposer();
      });
    };
    const label = translate("Attach files");
    return h(
      React.Fragment,
      null,
      h("input", { ref: files, type: "file", multiple: true, className: "hidden", onChange }),
      h("input", {
        ref: camera,
        type: "file",
        accept: "image/*",
        capture: "environment",
        className: "hidden",
        "aria-label": "拍照",
        onChange,
      }),
      inMenu
        ? h(
            React.Fragment,
            null,
            h(
              MenuItem,
              { closeOnClick: true, onClick: () => files.current?.click() },
              h(Paperclip),
              label,
            ),
            h(
              MenuItem,
              { closeOnClick: true, onClick: () => camera.current?.click() },
              h(CameraIcon),
              "拍照",
            ),
          )
        : h(
            Button,
            {
              type: "button",
              variant: "ghost",
              size: "icon-sm",
              title: label,
              "aria-label": label,
              onPointerDown: (event: any) => event.preventDefault(),
              onClick: () => files.current?.click(),
            },
            h(Paperclip),
          ),
    );
  };
}
