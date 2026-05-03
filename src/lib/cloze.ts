// Cloze tokenization shared between the editor and the review renderer.
// We split on whitespace runs and assign a 0-based "word index" only to
// non-whitespace tokens. Whitespace tokens are preserved as-is so the
// rendered text keeps the original spacing.
export type ClozeToken = {
  text: string;
  isWord: boolean;
  // Defined only when isWord is true: the 0-based word index in the
  // tokenized sequence. This is what `cloze_word_indices` references.
  wordIndex?: number;
};

export function tokenizeForCloze(text: string): ClozeToken[] {
  const parts = text.split(/(\s+)/);
  const out: ClozeToken[] = [];
  let wordIndex = 0;
  for (const p of parts) {
    if (p === "") continue;
    if (/^\s+$/.test(p)) {
      out.push({ text: p, isWord: false });
    } else {
      out.push({ text: p, isWord: true, wordIndex: wordIndex++ });
    }
  }
  return out;
}

// Render a cloze blank that's roughly proportional to the masked word's
// length, so a long word doesn't get a single-char blank that gives away
// the answer. We use full-width underscore-like characters; trailing
// punctuation is preserved (e.g. "base," → "____,").
export function clozeBlankFor(word: string): string {
  const m = word.match(/^([\p{L}\p{N}']+)([^\p{L}\p{N}']*)$/u);
  const lettersLen = m ? m[1].length : word.length;
  const trailing = m ? m[2] : "";
  return "_".repeat(Math.max(2, lettersLen)) + trailing;
}
