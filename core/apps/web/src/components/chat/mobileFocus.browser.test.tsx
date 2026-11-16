import { createRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { render, act } from "../../../test/render";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";

it("mobile navigation cannot steal composer focus; a trusted tap restores editing", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    ...originalMatchMedia(query),
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })) as typeof window.matchMedia;
  const originalFocus = HTMLElement.prototype.focus;
  const originalPath = location.pathname;
  try {
    await import("../../extensions/mobile-focus-intent.js");
    await import("../../extensions/mobile-focus-guard.js");
    const ref = createRef<ComposerPromptEditorHandle>();
    await using screen = await render(
      <div data-chat-composer-main-surface>
        <ComposerPromptEditorTiptap
          editorRef={ref}
          value="synthetic draft"
          cursor={15}
          richTextEnabled={false}
          contextRecords={new Map()}
          skills={[]}
          disabled={false}
          placeholder="mobile draft"
          onChange={vi.fn()}
          onPaste={() => {}}
        />
      </div>,
    );
    const editable = screen.container.querySelector<HTMLElement>('[contenteditable="true"]')!;
    await act(() => ref.current?.focus());
    expect(document.activeElement).not.toBe(editable);
    await screen.getByRole("textbox").click();
    expect(document.activeElement).toBe(editable);
    editable.blur();
    history.replaceState(null, "", "/synthetic-navigation");
    await act(() => ref.current?.focusAtEnd());
    expect(document.activeElement).not.toBe(editable);
    expect(editable.textContent).toContain("synthetic draft");
  } finally {
    history.replaceState(null, "", originalPath);
    window.matchMedia = originalMatchMedia;
    HTMLElement.prototype.focus = originalFocus;
  }
});
