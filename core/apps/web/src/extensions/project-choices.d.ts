export function saveProjectChoices(keys: string | readonly string[], expanded: boolean): void;
export function restoreProjectChoices<T extends {projectExpandedById: Record<string, boolean>}>(state: T): T;
