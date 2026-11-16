import chinese from "./zh-CN.json";

export type WorkbenchLanguage = "zh-CN" | "en";
const messages: Readonly<Record<string, string>> = chinese;

function readLanguage(): WorkbenchLanguage {
  try {
    return JSON.parse(window.localStorage.getItem("cocloud.interface-language") ?? '"zh-CN"') ===
      "en"
      ? "en"
      : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

// UI constants are also localized at module initialization. Switching language reloads
// this client after saving its choice; running server tasks are independent of it.
export const initialWorkbenchLanguage = readLanguage();

export function translateUiText(
  source: string,
  language: WorkbenchLanguage,
  values: readonly unknown[] = [],
): string {
  const key = source.replace(/\s+/g, " ").trim();
  const translated = language === "zh-CN" ? messages[key] : undefined;
  const text =
    translated === undefined
      ? source
      : `${source.match(/^\s*/)?.[0] ?? ""}${translated}${source.match(/\s*$/)?.[0] ?? ""}`;
  // Values are interpolated once and never translated or interpreted as markup.
  return values.length
    ? text.replace(/\{(\d+)\}/g, (match, index: string) => {
        const i = Number(index);
        return i < values.length ? String(values[i] ?? "") : match;
      })
    : text;
}

/** Localize application-owned copy. Never pass user messages, filenames or tool output. */
export function uiText(source: string, values: readonly unknown[] = []): string {
  return translateUiText(source, initialWorkbenchLanguage, values);
}
