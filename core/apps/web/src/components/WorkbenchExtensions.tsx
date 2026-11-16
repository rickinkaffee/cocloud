import "../extensions/motion.css";
import { CocloudMemoryEntry } from "../extensions/memory-entry.js";
export function WorkbenchExtensions() {
  return <div className="px-2 py-1"><CocloudMemoryEntry /><a className="block px-3 py-2 text-xs" href="/floe/" target="_blank" rel="noreferrer">Shared browser</a></div>;
}
