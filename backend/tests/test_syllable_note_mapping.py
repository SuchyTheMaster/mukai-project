import sys
import types
import unittest
from unittest.mock import patch

from app.domain.contracts import NoteEvent, SyllabificationSettings, TranscriptSegment, TranscriptWord
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


def note(
    note_id: str,
    start: float,
    end: float,
    midi: int = 60,
    frequency_hz: float = 261.6256,
    confidence: float | None = 0.9,
    requires_review: bool = False,
    quality_flags: list[str] | None = None,
) -> NoteEvent:
    return NoteEvent(
        noteId=note_id,
        startSec=start,
        endSec=end,
        midi=midi,
        frequencyHz=frequency_hz,
        confidence=confidence,
        requiresReview=requires_review,
        qualityFlags=quality_flags or [],
    )


def fake_pyphen_module(positions_by_word: dict[str, list[int]] | None = None, languages: dict[str, object] | None = None):
    positions_by_word = positions_by_word or {}

    class FakePyphenDictionary:
        def __init__(self, lang):
            self.lang = lang

        def positions(self, word):
            return positions_by_word.get(word, [])

    return types.SimpleNamespace(LANGUAGES=languages or {"pl_PL": object(), "en_US": object()}, Pyphen=FakePyphenDictionary)


class SyllableNoteMappingTest(unittest.TestCase):
    def test_equal_syllables_and_notes_map_one_to_one(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "a"])
        self.assertEqual([token.noteId for token in arrangement.tokens], ["n1", "n2"])
        self.assertFalse(any(token.isExtension for token in arrangement.tokens))

    def test_extra_notes_create_tilde_tokens(self):
        arrangement = build_arrangement("job_1", [segment_with_word("a")], [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "~"])
        self.assertFalse(arrangement.tokens[0].isExtension)
        self.assertFalse(arrangement.tokens[1].isExtension)
        self.assertIsNone(arrangement.tokens[1].extendsTokenId)
        self.assertEqual([token.noteId for token in arrangement.tokens], ["n1", "n2"])

    def test_extra_notes_with_same_midi_merge_without_tilde(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a")],
            [
                note("n1", 0.0, 0.4, 60, frequency_hz=260.0, confidence=0.8),
                note("n2", 0.4, 1.0, 60, frequency_hz=280.0, confidence=1.0),
            ],
        )

        self.assertEqual([token.text for token in arrangement.tokens], ["a"])
        self.assertEqual([token.noteId for token in arrangement.tokens], ["n1"])
        self.assertEqual([note_event.noteId for note_event in arrangement.noteEvents], ["n1"])
        self.assertEqual((arrangement.noteEvents[0].startSec, arrangement.noteEvents[0].endSec), (0.0, 1.0))
        self.assertEqual(arrangement.noteEvents[0].midi, 60)
        self.assertEqual(arrangement.noteEvents[0].frequencyHz, 272.0)
        self.assertEqual(arrangement.noteEvents[0].confidence, 0.92)

    def test_same_midi_runs_merge_before_tilde_for_pitch_change(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a")],
            [
                note("n1", 0.0, 0.25, 60),
                note("n2", 0.25, 0.5, 60),
                note("n3", 0.5, 0.75, 62),
                note("n4", 0.75, 1.0, 62),
            ],
        )

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "~"])
        self.assertEqual([token.noteId for token in arrangement.tokens], ["n1", "n3"])
        self.assertEqual([(note_event.noteId, note_event.midi) for note_event in arrangement.noteEvents], [("n1", 60), ("n3", 62)])

    def test_merged_same_midi_note_keeps_quality_flags(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a")],
            [
                note("n1", 0.0, 0.45, 60),
                note("n2", 0.45, 1.0, 60, requires_review=True, quality_flags=["uncertain_pitch"]),
            ],
        )

        self.assertEqual([token.text for token in arrangement.tokens], ["a"])
        self.assertEqual([note_event.noteId for note_event in arrangement.noteEvents], ["n1"])
        self.assertIn("uncertain_pitch", arrangement.noteEvents[0].qualityFlags)
        self.assertTrue(arrangement.noteEvents[0].requiresReview)

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

    def test_unassigned_note_stays_as_ghost_note(self):
        arrangement = build_arrangement("job_1", [segment_with_word("a")], [note("n1", 1.1, 1.4)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a"])
        self.assertIsNone(arrangement.tokens[0].noteId)
        self.assertIn("missing_note", arrangement.tokens[0].qualityFlags)
        self.assertEqual([note_event.noteId for note_event in arrangement.noteEvents], ["n1"])
        self.assertIn("unassigned_note", arrangement.noteEvents[0].qualityFlags)

    def test_one_note_over_multiple_syllables_is_split(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [note("n1", 0.0, 1.0, 64)])

        self.assertEqual([token.text for token in arrangement.tokens], ["a", "a"])
        self.assertEqual([token.noteId for token in arrangement.tokens], ["n1", "n1_part_02"])
        self.assertEqual([(note_event.noteId, note_event.midi) for note_event in arrangement.noteEvents], [("n1", 64), ("n1_part_02", 64)])
        self.assertEqual([(note_event.startSec, note_event.endSec) for note_event in arrangement.noteEvents], [(0.0, 0.5), (0.5, 1.0)])

    def test_no_note_id_is_assigned_to_multiple_tokens(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [note("n1", 0.0, 1.0, 64)])
        assigned_note_ids = [token.noteId for token in arrangement.tokens if token.noteId]

        self.assertEqual(len(assigned_note_ids), len(set(assigned_note_ids)))

    def test_none_syllabification_uses_whole_words(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("Panie")],
            [note("n1", 0.0, 1.0)],
            syllabification_settings=SyllabificationSettings(method="none"),
            language="pl",
            language_source="forced",
        )

        self.assertEqual([token.text for token in arrangement.tokens], ["Panie"])
        self.assertEqual(arrangement.syllabification.requestedMethod, "none")
        self.assertEqual(arrangement.syllabification.appliedMethod, "none")

    def test_kokosznicka_pl_uses_package_splitter(self):
        fake_kokosznicka = types.SimpleNamespace(syllabify=lambda word: ["Pa", "nie"] if word == "Panie" else [word])

        with patch.dict(sys.modules, {"kokosznicka": fake_kokosznicka}):
            arrangement = build_arrangement(
                "job_1",
                [segment_with_word("Panie")],
                [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)],
                syllabification_settings=SyllabificationSettings(method="kokosznicka"),
                language="pl",
                language_source="forced",
            )

        self.assertEqual([token.text for token in arrangement.tokens], ["Pa", "nie"])
        self.assertEqual(arrangement.syllabification.requestedMethod, "kokosznicka")
        self.assertEqual(arrangement.syllabification.appliedMethod, "kokosznicka")
        self.assertIsNone(arrangement.syllabification.fallbackReason)

    def test_kokosznicka_unsupported_language_falls_back_to_heuristic(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("Panie")],
            [],
            syllabification_settings=SyllabificationSettings(method="kokosznicka"),
            language="en",
            language_source="detected",
        )

        self.assertEqual([token.text for token in arrangement.tokens], ["Pan", "i", "e"])
        self.assertEqual(arrangement.syllabification.requestedMethod, "kokosznicka")
        self.assertEqual(arrangement.syllabification.appliedMethod, "heuristic")
        self.assertIn("Kokosznicka", arrangement.syllabification.fallbackReason)

    def test_pyphen_uses_supported_dictionary(self):
        fake_pyphen = fake_pyphen_module({"Panie": [2]}, {"pl_PL": object()})

        with patch.dict(sys.modules, {"pyphen": fake_pyphen}):
            arrangement = build_arrangement(
                "job_1",
                [segment_with_word("Panie")],
                [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)],
                syllabification_settings=SyllabificationSettings(method="pyphen"),
                language="pl",
                language_source="forced",
            )

        self.assertEqual([token.text for token in arrangement.tokens], ["Pa", "nie"])
        self.assertEqual(arrangement.syllabification.appliedMethod, "pyphen")

    def test_pyphen_missing_dictionary_falls_back_to_heuristic(self):
        fake_pyphen = fake_pyphen_module({"Panie": [2]}, {"en_US": object()})

        with patch.dict(sys.modules, {"pyphen": fake_pyphen}):
            arrangement = build_arrangement(
                "job_1",
                [segment_with_word("Panie")],
                [],
                syllabification_settings=SyllabificationSettings(method="pyphen"),
                language="zz",
                language_source="detected",
            )

        self.assertEqual([token.text for token in arrangement.tokens], ["Pan", "i", "e"])
        self.assertEqual(arrangement.syllabification.requestedMethod, "pyphen")
        self.assertEqual(arrangement.syllabification.appliedMethod, "heuristic")
        self.assertIn("Pyphen", arrangement.syllabification.fallbackReason)

    def test_arrangement_syllabification_records_requested_applied_and_fallback(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("Panie")],
            [],
            syllabification_settings=SyllabificationSettings(method="kokosznicka"),
            language="en",
            language_source="detected",
        )

        self.assertEqual(arrangement.syllabification.requestedMethod, "kokosznicka")
        self.assertEqual(arrangement.syllabification.appliedMethod, "heuristic")
        self.assertEqual(arrangement.syllabification.language, "en")
        self.assertEqual(arrangement.syllabification.languageSource, "detected")
        self.assertTrue(arrangement.syllabification.fallbackReason)


if __name__ == "__main__":
    unittest.main()
