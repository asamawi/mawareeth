/** Class strings shared by the public pages. */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Focus rings for surfaces where the accent outline would vanish: accent fills and the inverted toast. */
export const focusRingOnAccent = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

export const focusRingOnToast = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-toast-focus";

export const primaryButton =
  `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-accent px-6 py-3 text-base font-semibold text-accent-foreground transition-colors duration-200 motion-reduce:transition-none hover:opacity-90 ${focusRing}`;

export const secondaryButton =
  `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line px-6 py-3 text-base font-semibold transition-colors duration-200 motion-reduce:transition-none hover:bg-surface ${focusRing}`;

export const sectionClass = "mx-auto w-full max-w-5xl px-6 py-12 md:py-16";

export const cardClass = "rounded-xl border border-line bg-surface p-6";
