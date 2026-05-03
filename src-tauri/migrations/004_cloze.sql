-- v4 schema: cloze deletion. Each card optionally blanks one or more words
-- of its segment text during review. We store the blanked indices as a JSON
-- array of 0-based whitespace-split token positions. Empty array `[]` =
-- regular review (no cloze). One card per segment — cloze is a presentation
-- mode, not a separate FSRS item.

ALTER TABLE card ADD COLUMN cloze_word_indices TEXT NOT NULL DEFAULT '[]';

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (4, datetime('now'));
