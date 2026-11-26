// Shared project identity renderer for every workbench surface. Returning null
// removes images, monograms, emoji and fallback icons without reserving space or
// resolving favicon resources. Existing project data remains valid.
export function NoProjectIcon() {
  return null;
}
