import { describe, expect, it } from "vitest";
import { applyReview, previewIntervals } from "../fsrs";
import type { CardRow } from "../types";

// Characterization tests for the FSRS wrapper. The refactor in step 6 (move
// ReviewMode into src/modules/srs/) must preserve these contracts —
// applyReview's output shape and previewIntervals's per-rating values are
// what ReviewMode.tsx writes to the SQLite `card` table and renders on
// the rating-button labels.

const NOW = new Date("2026-05-04T00:00:00Z");

function newCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: 1,
    segment_id: 10,
    saved_at: NOW.toISOString(),
    due_at: NOW.toISOString(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: "new",
    last_review_at: null,
    cloze_word_indices: [],
    ...overrides,
  };
}

describe("applyReview", () => {
  it("returns a fully-populated ReviewResult for a brand-new card", () => {
    const result = applyReview(newCard(), "Good", NOW);

    expect(result).toEqual({
      due_at: expect.any(String),
      stability: expect.any(Number),
      difficulty: expect.any(Number),
      reps: expect.any(Number),
      lapses: expect.any(Number),
      card_state: expect.any(String),
    });
  });

  it("advances reps on each review", () => {
    const result = applyReview(newCard(), "Good", NOW);
    expect(result.reps).toBeGreaterThan(0);
  });

  it("Again schedules sooner than Easy", () => {
    const card = newCard();
    const again = applyReview(card, "Again", NOW);
    const easy = applyReview(card, "Easy", NOW);

    expect(new Date(again.due_at).getTime()).toBeLessThan(
      new Date(easy.due_at).getTime(),
    );
  });

  it("returns a known card_state string the Rust side accepts", () => {
    const result = applyReview(newCard(), "Good", NOW);
    expect(["new", "learning", "review", "relearning"]).toContain(
      result.card_state,
    );
  });
});

describe("previewIntervals", () => {
  it("returns a human-readable interval for each of the four buttons", () => {
    const intervals = previewIntervals(newCard(), NOW);

    expect(Object.keys(intervals).sort()).toEqual([
      "Again",
      "Easy",
      "Good",
      "Hard",
    ]);
    for (const v of Object.values(intervals)) {
      expect(v).toMatch(/^\d+(m|h|d|mo|y)$/);
    }
  });

  it("ranks Again < Hard <= Good <= Easy by interval length", () => {
    // We can't compare strings directly; convert back to ms via applyReview.
    const card = newCard();
    const again = new Date(applyReview(card, "Again", NOW).due_at).getTime();
    const hard = new Date(applyReview(card, "Hard", NOW).due_at).getTime();
    const good = new Date(applyReview(card, "Good", NOW).due_at).getTime();
    const easy = new Date(applyReview(card, "Easy", NOW).due_at).getTime();

    expect(again).toBeLessThan(easy);
    expect(hard).toBeLessThanOrEqual(good);
    expect(good).toBeLessThanOrEqual(easy);
  });
});
