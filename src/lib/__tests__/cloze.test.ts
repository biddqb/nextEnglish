import { describe, expect, it } from "vitest";
import { clozeBlankFor, tokenizeForCloze } from "../cloze";

// Characterization tests for cloze tokenization. These pin the behavior the
// SRS module relies on; the refactor in step 6 must preserve them.

describe("tokenizeForCloze", () => {
  it("assigns sequential word indices to non-whitespace tokens", () => {
    const tokens = tokenizeForCloze("touch base soon");

    const words = tokens.filter((t) => t.isWord);
    expect(words).toHaveLength(3);
    expect(words.map((w) => [w.text, w.wordIndex])).toEqual([
      ["touch", 0],
      ["base", 1],
      ["soon", 2],
    ]);
  });

  it("preserves whitespace tokens between words without indexing them", () => {
    const tokens = tokenizeForCloze("hello  world");

    expect(tokens.map((t) => [t.text, t.isWord])).toEqual([
      ["hello", true],
      ["  ", false],
      ["world", true],
    ]);
    const ws = tokens.find((t) => !t.isWord);
    expect(ws?.wordIndex).toBeUndefined();
  });

  it("handles empty string", () => {
    expect(tokenizeForCloze("")).toEqual([]);
  });

  it("handles single word with trailing punctuation in one token", () => {
    const tokens = tokenizeForCloze("base,");
    expect(tokens).toEqual([{ text: "base,", isWord: true, wordIndex: 0 }]);
  });
});

describe("clozeBlankFor", () => {
  it("renders a blank with at least 2 underscores even for short words", () => {
    expect(clozeBlankFor("a")).toBe("__");
    expect(clozeBlankFor("hi")).toBe("__");
  });

  it("renders an underscore per letter for normal words", () => {
    expect(clozeBlankFor("touch")).toBe("_____");
    expect(clozeBlankFor("base")).toBe("____");
  });

  it("preserves trailing punctuation", () => {
    expect(clozeBlankFor("base,")).toBe("____,");
    expect(clozeBlankFor("end.")).toBe("___.");
    expect(clozeBlankFor("really?!")).toBe("______?!");
  });

  it("treats apostrophes as letters (don't break contractions visually)", () => {
    // "don't" → 5 underscores (d, o, n, ', t)
    expect(clozeBlankFor("don't")).toBe("_____");
  });
});
