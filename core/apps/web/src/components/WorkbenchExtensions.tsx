import { SkillManagementSection } from "./SkillManagementSection";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useWorkbenchI18n } from "../i18n";
import "../extensions/motion.css";
import { WorkbenchConnectionCenter } from "./WorkbenchConnectionCenter";
import { WorkbenchFolderUpload } from "./WorkbenchFolderUpload";
export function WorkbenchExtensions() {
  const environmentId = usePrimaryEnvironmentId();
  const { language, setLanguage } = useWorkbenchI18n();
  return (
    <div className="px-2 py-1">
      <WorkbenchConnectionCenter language={language} />
      <WorkbenchFolderUpload />
      <a className="block px-3 py-2 text-xs" href="/floe/" target="_blank" rel="noreferrer">
        Shared browser
      </a>
      {environmentId && <SkillManagementSection environmentId={environmentId} />}
      <label className="block px-3 py-2 text-xs">
        扩展语言 / Extension language{" "}
        <select
          aria-label="Workbench language"
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value === "en" ? "en" : "zh-CN");
            location.reload();
          }}
        >
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
  );
}
