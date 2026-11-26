const projectChoicePrefix = 'cocloud:project-open:v1:';

function saveProjectChoices(keys, expanded) {
  try {
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      window.localStorage.setItem(projectChoicePrefix + key, String(expanded));
    }
  } catch {}
}

function restoreProjectChoices(state) {
  const choices = { ...state.projectExpandedById };
  try {
    const storage = window.localStorage;
    for (const [key, expanded] of Object.entries(choices)) {
      if (storage.getItem(projectChoicePrefix + key) === null) saveProjectChoices(key, expanded);
    }
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(projectChoicePrefix)) continue;
      const saved = storage.getItem(key);
      if (saved === 'true' || saved === 'false') choices[key.slice(projectChoicePrefix.length)] = saved === 'true';
    }
  } catch {}
  return { ...state, projectExpandedById: choices };
}
