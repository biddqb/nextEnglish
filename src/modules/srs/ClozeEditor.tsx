import clsx from "clsx";
import { useMemo } from "react";
import { tokenizeForCloze } from "../../lib/cloze";
import { useCard, useSetCardCloze } from "../../lib/queries";

// Tap-to-toggle cloze editor for a saved segment. Renders the segment text
// as inline word buttons; clicking a word toggles whether that word is
// blanked during review. No-op (returns null) if the segment isn't saved.
//
// Editorial styling: clozed words get a hairline strikethrough + slightly
// recessed color. No icons, no badges — the text itself is the affordance.
//
// Per Issue 1A from /plan-eng-review: this lives in the srs module and is
// imported by Shadow's Session for the during-shadowing edit-card workflow.
// Cloze stays a presentation mode of card; this editor is the create-side.
type Props = {
  clipId: number;
  segmentIndex: number;
  segmentText: string;
};

export function ClozeEditor({ clipId, segmentIndex, segmentText }: Props) {
  const { data: card } = useCard(clipId, segmentIndex);
  const setCloze = useSetCardCloze();

  const tokens = useMemo(() => tokenizeForCloze(segmentText), [segmentText]);
  const clozed = new Set(card?.cloze_word_indices ?? []);

  if (!card) return null;

  function toggle(wordIndex: number) {
    const next = new Set(clozed);
    if (next.has(wordIndex)) {
      next.delete(wordIndex);
    } else {
      next.add(wordIndex);
    }
    const indices = Array.from(next).sort((a, b) => a - b);
    setCloze.mutate({ clipId, segmentIndex, indices });
  }

  const hasAnyCloze = clozed.size > 0;

  return (
    <div className="border-t border-hairline pt-base mt-base">
      <div className="text-caption-uppercase text-muted mb-xs">
        Cloze · click words to blank during review
      </div>
      <p className="text-body-md text-ink leading-relaxed">
        {tokens.map((t, i) => {
          if (!t.isWord) return <span key={i}>{t.text}</span>;
          const isClozed = clozed.has(t.wordIndex!);
          return (
            <button
              key={i}
              onClick={() => toggle(t.wordIndex!)}
              aria-pressed={isClozed}
              className={clsx(
                "rounded-sm transition-colors px-[1px]",
                isClozed
                  ? "line-through text-muted decoration-ink decoration-[1.5px]"
                  : "hover:bg-surface-strong hover:text-ink",
              )}
            >
              {t.text}
            </button>
          );
        })}
      </p>
      {hasAnyCloze && (
        <div className="mt-xs text-caption text-muted">
          {clozed.size} word{clozed.size === 1 ? "" : "s"} blanked. Words are
          hidden during review; you still need to say them aloud.
        </div>
      )}
    </div>
  );
}
