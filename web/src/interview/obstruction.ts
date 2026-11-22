import { useEffect } from "react";

/** The share of the viewport height that fixed or sticky Interview surfaces may cover, together. */
export const OBSTRUCTION_SHARE = 0.25;

/** The block-end space the page keeps clear for scrolling targets: the sum of the heights, capped at 25% of the viewport. */
export function obstructionPx(heights: number[], viewportHeight: number): number {
  const sum = heights.reduce((total, height) => total + Math.max(0, height), 0);
  return Math.min(sum, OBSTRUCTION_SHARE * Math.max(0, viewportHeight));
}

const VARIABLE = "--interview-obstruction";
const heights = new Map<string, number>();
let listening = false;

function apply(): void {
  if (typeof document === "undefined") return;
  const px = obstructionPx([...heights.values()], window.innerHeight);
  document.documentElement.style.setProperty(VARIABLE, `${px}px`);
}

function onResize(): void {
  apply();
}

/** Record, change or (with null) remove the height one surface covers, then recompute `--interview-obstruction`. */
export function setObstruction(key: string, height: number | null): void {
  if (height === null) heights.delete(key);
  else heights.set(key, height);
  if (typeof window !== "undefined") {
    if (heights.size > 0 && !listening) {
      window.addEventListener("resize", onResize);
      listening = true;
    } else if (heights.size === 0 && listening) {
      window.removeEventListener("resize", onResize);
      listening = false;
    }
  }
  apply();
}

/** Register an element's height under a key while it is mounted (`null` registers nothing). */
export function useObstruction(key: string, element: HTMLElement | null): void {
  useEffect(() => {
    if (!element) return;
    const measure = () => setObstruction(key, element.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element, { box: "border-box" });
    return () => {
      observer?.disconnect();
      setObstruction(key, null);
    };
  }, [key, element]);
}
