// Thin wrapper around ts-fsrs. Handles two impedance mismatches:
//   1. Rust persists a flat row of strings + numbers; ts-fsrs wants Date
//      objects + a numeric State enum. We convert at the boundary.
//   2. Brand-new cards (state="new", reps=0) need ts-fsrs-internal fields
//      like `learning_steps`, `elapsed_days`, `scheduled_days` that aren't
//      worth persisting separately. createEmptyCard() seeds those for us.
import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import type { CardRow } from "./types";

export type RatingButton = "Again" | "Hard" | "Good" | "Easy";

export type ReviewResult = {
  due_at: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  card_state: string;
};

const scheduler = fsrs();

const RATING_TO_GRADE: Record<RatingButton, Grade> = {
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
};

function stateStringToFsrs(s: string): State {
  switch (s) {
    case "learning":
      return State.Learning;
    case "review":
      return State.Review;
    case "relearning":
      return State.Relearning;
    default:
      return State.New;
  }
}

function fsrsStateToString(s: State): string {
  switch (s) {
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "new";
  }
}

function rowToFsrsCard(row: CardRow, now: Date): FsrsCard {
  // First-ever review: createEmptyCard initializes all the bookkeeping
  // fields ts-fsrs's scheduler reads. Using the persisted row directly
  // would leave learning_steps/elapsed_days at 0 and skip the new→learning
  // transition.
  if (row.reps === 0 && row.state === "new") {
    return createEmptyCard(now);
  }
  return {
    due: new Date(row.due_at),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: stateStringToFsrsState(row.state),
    last_review: row.last_review_at ? new Date(row.last_review_at) : undefined,
  };
}

// Avoids a name collision with the function above; see comment.
const stateStringToFsrsState = stateStringToFsrs;

export function applyReview(
  row: CardRow,
  rating: RatingButton,
  now: Date = new Date(),
): ReviewResult {
  const card = rowToFsrsCard(row, now);
  const result = scheduler.next(card, now, RATING_TO_GRADE[rating]);
  return {
    due_at: result.card.due.toISOString(),
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    reps: result.card.reps,
    lapses: result.card.lapses,
    card_state: fsrsStateToString(result.card.state),
  };
}

// Used by the rating buttons to show the user the next interval ("Good · 4d").
// Cheap — runs the same scheduler four times.
export function previewIntervals(
  row: CardRow,
  now: Date = new Date(),
): Record<RatingButton, string> {
  const card = rowToFsrsCard(row, now);
  return {
    Again: humanInterval(scheduler.next(card, now, Rating.Again).card.due, now),
    Hard: humanInterval(scheduler.next(card, now, Rating.Hard).card.due, now),
    Good: humanInterval(scheduler.next(card, now, Rating.Good).card.due, now),
    Easy: humanInterval(scheduler.next(card, now, Rating.Easy).card.due, now),
  };
}

function humanInterval(due: Date, now: Date): string {
  const ms = Math.max(0, due.getTime() - now.getTime());
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h`;
  const day = hr / 24;
  if (day < 30) return `${Math.round(day)}d`;
  const mo = day / 30;
  if (mo < 12) return `${Math.round(mo)}mo`;
  return `${Math.round(day / 365)}y`;
}
