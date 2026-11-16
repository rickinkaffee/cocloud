export function sidebarSwipeAction({
  open,
  startX,
  deltaX,
  deltaY,
  elapsed,
}: {
  open: boolean;
  startX: number;
  deltaX: number;
  deltaY: number;
  elapsed: number;
}): boolean | null {
  if (
    elapsed > 900 ||
    elapsed < 0 ||
    Math.abs(deltaX) < 64 ||
    Math.abs(deltaX) < Math.abs(deltaY) * 1.5
  )
    return null;
  if (open) return deltaX < 0 ? false : null;
  return startX >= 8 && startX <= 36 && deltaX > 0 ? true : null;
}

export function sidebarDragPosition(open: boolean, deltaX: number, width: number) {
  return Math.max(0, Math.min(width, (open ? width : 0) + deltaX));
}

export function workbenchPanelForSwipe(deltaX: number) {
  return deltaX > 0 ? "left" : "right";
}

export function workbenchPanelDragDelta(side: "left" | "right", deltaX: number) {
  return side === "left" ? deltaX : -deltaX;
}

export function sidebarDragTarget(
  position: number,
  width: number,
  velocity: number,
  startPosition: number,
) {
  const delta = position - startPosition;
  if (Math.abs(delta) >= 10 && Math.abs(velocity) >= 0.35) return velocity > 0;
  if (Math.abs(delta) >= Math.min(28, width * 0.1)) return delta > 0;
  return startPosition >= width * 0.5;
}

export function sidebarSettleDuration(distance: number, velocity: number, reducedMotion: boolean) {
  if (reducedMotion || distance < 1) return 0;
  return Math.max(140, Math.min(280, 170 + distance * 0.32 - Math.abs(velocity) * 45));
}

export function sidebarSettleEasing(displacement: number, velocity: number, duration: number) {
  const slope = displacement === 0 ? 0 : Math.max(0, (velocity * duration) / displacement);
  const control = Math.max(0.12, Math.min(0.9, slope * 0.2));
  return `cubic-bezier(0.2, ${control}, 0.24, 1)`;
}
