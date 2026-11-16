import * as Schema from "effect/Schema";
import { translateUiText } from "./i18n/core";
import { useLocalStorage } from "./hooks/useLocalStorage";

const WorkbenchLanguage = Schema.Literals(["zh-CN", "en"]);
export type WorkbenchLanguage = typeof WorkbenchLanguage.Type;

export function useWorkbenchI18n() {
  const [language, setLanguage] = useLocalStorage<WorkbenchLanguage, WorkbenchLanguage>(
    "cocloud.interface-language",
    "zh-CN",
    WorkbenchLanguage,
  );
  return {
    language,
    setLanguage,
    t: (text: string) => translateUiText(text, language),
  };
}

export { translateUiText } from "./i18n/core";
