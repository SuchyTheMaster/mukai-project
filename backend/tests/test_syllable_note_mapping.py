import unittest

from app.domain.contracts import NoteEvent, TranscriptSegment, TranscriptWord
from app.workers.pitch import build_arrangement


def segment_with_word(text: str) -> TranscriptSegment:
    return TranscriptSegment(
        segmentId="seg_0001",
        startSec=0.0,
        endSec=1.0,
        text=text,
        confidence=0.9,
        words=[
            TranscriptWord(
                wordId="word_0001_001",
                startSec=0.0,
                endSec=1.0,
                text=text,
                confidence=0.9,
            )
        ],
    )


def note(note_id: str, start: float, end: float, midi: int = 60) -> NoteEvent:
    return NoteEvent(
        noteId=note_id,
        startSec=start,
        endSec=end,
        midi=midi,
        frequencyHz=261.6256,
        confidence=0.9,
    )


class SyllableNoteMappingTest(unittest.TestCase):
    def test_equal_syllables_and_notes_map_one_to_one(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "a"])
        self.assertEqual([token.noteId for token in arrangement.tokens], ["n1", "n2"])
        self.assertFalse(any(token.isExtension for token in arrangement.tokens))

    def test_extra_notes_create_extension_tokens(self):
        arrangement = build_arrangement("job_1", [segment_with_word("a")], [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", ""])
        self.assertFalse(arrangement.tokens[0].isExtension)
        self.assertTrue(arrangement.tokens[1].isExtension)
        self.assertEqual(arrangement.tokens[1].extendsTokenId, arrangement.tokens[0].tokenId)

    def test_missing_notes_keep_syllables_for_review(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [note("n1", 0.0, 0.45)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "a"])
        self.assertEqual(arrangement.tokens[0].noteId, "n1")
        self.assertIsNone(arrangement.tokens[1].noteId)
        self.assertIn("missing_note", arrangement.tokens[1].qualityFlags)
        self.assertIn("needs_syllable_review", arrangement.tokens[1].qualityFlags)

    def test_no_notes_marks_each_syllable_missing(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "a"])
        self.assertTrue(all(token.noteId is None for token in arrangement.tokens))
        self.assertTrue(all("missing_note" in token.qualityFlags for token in arrangement.tokens))


if __name__ == "__main__":
    unittest.main()
