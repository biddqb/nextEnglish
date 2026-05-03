import { ClipPicker } from "./ClipPicker";

// First-launch hero per UI_DESIGN.md `empty-state-hero`. Single soft mint
// gradient orb, display-lg headline, body-md description, ClipPicker.
//
// Used both on real first launch (no clips ever) AND when the user clicks
// "+ Add clip" in the sidebar (deselects current clip → returns here).
export function EmptyStateHero() {
  return (
    <div className="flex h-full items-center justify-center px-xl py-xxl">
      <div className="relative flex w-full max-w-2xl flex-col items-center text-center">
        <div
          className="orb-drift gradient-orb-mint pointer-events-none absolute -top-[40px] left-1/2 h-[320px] w-[320px] -translate-x-1/2 opacity-30"
          aria-hidden
        />
        <h1 className="text-display-lg text-ink relative">
          Sound like the people you listen to.
        </h1>
        <p className="text-body-md text-muted relative mt-base max-w-md">
          Paste a YouTube URL or podcast link. Pick a sentence. Shadow it. Get a
          score.
        </p>
        <div className="relative mt-xxl">
          <ClipPicker />
        </div>
      </div>
    </div>
  );
}
