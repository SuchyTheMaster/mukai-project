import sys
import types
import unittest
from unittest.mock import patch

from app.domain.contracts import NoteEvent, PitchFrame, PitchSettings, SyllabificationSettings, TranscriptChar, TranscriptSegment, TranscriptWord
from app.workers.pitch import build_arrangement


def segment_with_word(text: str, chars: list[TranscriptChar] | None = None, end_sec: float = 1.0) -> TranscriptSegment:
    return TranscriptSegment(
        segmentId="seg_0001",
        startSec=0.0,
        endSec=end_sec,
        text=text,
        confidence=0.9,
        words=[
            TranscriptWord(
                wordId="word_0001_001",
                startSec=0.0,
                endSec=end_sec,
                text=text,
                confidence=0.9,
                chars=chars or [],
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


def syllables(arrangement):
    return [
        syllable
        for sentence in arrangement.sentences
        for word in sentence.words
        for syllable in word.syllables
    ]


def pitch_frames(*values: tuple[float, float | None]) -> list[PitchFrame]:
    return [PitchFrame(timeSec=time_sec, loudnessDb=loudness_db) for time_sec, loudness_db in values]


def fake_pyphen_module(positions_by_word: dict[str, list[int]] | None = None, languages: dict[str, object] | None = None):
    positions_by_word = positions_by_word or {}

    class FakePyphenDictionary:
        def __init__(self, lang):
            self.lang = lang

        def positions(self, word):
            return positions_by_word.get(word, [])

    return types.SimpleNamespace(LANGUAGES=languages or {"pl_PL": object(), "en_US": object()}, Pyphen=FakePyphenDictionary)


class SyllableNoteMappingTest(unittest.TestCase):
    def test_syllables_have_midi_without_note_assignment(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [note("n1", 0.0, 0.45), note("n2", 0.55, 1.0, 62)])

        self.assertEqual([item.text for item in syllables(arrangement)], ["a", "a"])
        self.assertEqual([item.midi for item in syllables(arrangement)], [60, 62])
        self.assertFalse(hasattr(syllables(arrangement)[0], "noteId"))
        self.assertEqual([item.noteId for item in arrangement.noteEvents], ["n1", "n2"])

    def test_syllable_midi_is_weighted_average_of_overlapping_notes(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a")],
            [
                note("n1", 0.0, 0.25, 60),
                note("n2", 0.25, 1.0, 64),
            ],
        )

        self.assertEqual([item.text for item in syllables(arrangement)], ["a"])
        self.assertEqual(syllables(arrangement)[0].midi, 63)
        self.assertEqual([item.noteId for item in arrangement.noteEvents], ["n1", "n2"])

    def test_adjacent_syllables_with_same_midi_merge_inside_word(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("aa")],
            [note("n1", 0.0, 1.0, 64)],
        )

        self.assertEqual([item.text for item in syllables(arrangement)], ["aa"])
        self.assertEqual(syllables(arrangement)[0].startSec, 0.0)
        self.assertEqual(syllables(arrangement)[0].endSec, 1.0)
        self.assertEqual(syllables(arrangement)[0].midi, 64)
        self.assertEqual([item.noteId for item in arrangement.noteEvents], ["n1"])

    def test_syllables_use_character_timings_when_available(self):
        chars = [
            TranscriptChar(char="a", startSec=0.05, endSec=0.4),
            TranscriptChar(char="a", startSec=0.52, endSec=0.95),
        ]
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("aa", chars)],
            [note("n1", 0.0, 0.45), note("n2", 0.5, 1.0, 62)],
            prefer_char_timings=True,
        )

        self.assertEqual([(item.startSec, item.endSec) for item in syllables(arrangement)], [(0.05, 0.4), (0.52, 0.95)])
        self.assertFalse(any("needs_syllable_review" in item.qualityFlags for item in syllables(arrangement)))

    def test_character_syllable_timings_are_clamped_to_word_bounds(self):
        chars = [
            TranscriptChar(char="a", startSec=-0.05, endSec=0.4),
            TranscriptChar(char="a", startSec=0.52, endSec=1.2),
        ]
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("aa", chars)],
            [note("n1", 0.0, 0.45), note("n2", 0.5, 1.0, 62)],
            prefer_char_timings=True,
        )

        self.assertEqual([(item.startSec, item.endSec) for item in syllables(arrangement)], [(0.0, 0.4), (0.52, 1.0)])

    def test_incomplete_character_timings_fall_back_to_equal_spans_for_review(self):
        chars = [TranscriptChar(char="a", startSec=0.05, endSec=0.4)]
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("aa", chars)],
            [note("n1", 0.0, 0.45), note("n2", 0.5, 1.0, 62)],
            prefer_char_timings=True,
        )

        self.assertEqual([(item.startSec, item.endSec) for item in syllables(arrangement)], [(0.0, 0.5), (0.5, 1.0)])
        self.assertTrue(all("needs_syllable_review" in item.qualityFlags for item in syllables(arrangement)))

    def test_missing_notes_only_mark_missing_note(self):
        arrangement = build_arrangement("job_1", [segment_with_word("aa")], [])

        self.assertEqual([item.text for item in syllables(arrangement)], ["a", "a"])
        self.assertTrue(all(item.midi is None for item in syllables(arrangement)))
        self.assertTrue(all("missing_note" in item.qualityFlags for item in syllables(arrangement)))
        self.assertFalse(any("needs_syllable_review" in item.qualityFlags for item in syllables(arrangement)))

    def test_syllable_at_long_duration_threshold_is_not_corrected(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("aa")],
            [note("n1", 0.0, 1.0)],
            pitch_frames=pitch_frames((0.0, -20.0), (0.4, -20.0), (0.9, -80.0)),
            pitch_settings=PitchSettings(frameStepMs=100, checkNoteLongerThan=1000),
        )

        self.assertEqual(syllables(arrangement)[0].endSec, 1.0)
        self.assertEqual(arrangement.qualitySummary["correctedLongSyllableCount"], 0)

    def test_long_merged_syllable_is_trimmed_at_trailing_silence(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("aa")],
            [note("n1", 0.0, 1.0)],
            pitch_frames=pitch_frames((0.0, -20.0), (0.4, -20.0), (0.5, -80.0), (0.9, -80.0)),
            pitch_settings=PitchSettings(frameStepMs=100, checkNoteLongerThan=400),
        )

        self.assertEqual([item.text for item in syllables(arrangement)], ["aa"])
        self.assertEqual(syllables(arrangement)[0].endSec, 0.5)
        self.assertEqual(arrangement.noteEvents[0].endSec, 1.0)
        self.assertEqual(arrangement.qualitySummary["correctedLongSyllableCount"], 1)

    def test_separate_note_checking_threshold_preserves_quiet_vocal_tail(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a", end_sec=4.4)],
            [note("n1", 0.0, 4.4)],
            pitch_frames=pitch_frames(
                (0.0, -20.0),
                (0.4, -20.0),
                (0.5, -50.0),
                (1.3, -50.0),
                (1.4, -80.0),
                (4.2, -80.0),
                (4.3, -15.0),
            ),
            pitch_settings=PitchSettings(
                frameStepMs=100,
                checkNoteLongerThan=400,
                silenceThresholdDb=-42.0,
                silenceTresholdForNoteChecking=-60.0,
            ),
        )

        self.assertEqual(syllables(arrangement)[0].endSec, 1.4)
        self.assertEqual(arrangement.noteEvents[0].endSec, 4.4)
        self.assertEqual(arrangement.qualitySummary["correctedLongSyllableCount"], 1)

    def test_long_syllable_with_short_internal_silence_and_audible_end_is_unchanged(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a")],
            [note("n1", 0.0, 1.0)],
            pitch_frames=pitch_frames((0.0, -20.0), (0.4, -80.0), (0.41, -80.0), (0.9, -20.0)),
            pitch_settings=PitchSettings(frameStepMs=10, mergeGapMs=90, checkNoteLongerThan=400),
        )

        self.assertEqual(syllables(arrangement)[0].endSec, 1.0)
        self.assertEqual(arrangement.qualitySummary["correctedLongSyllableCount"], 0)

    def test_long_syllable_fully_in_silence_is_marked_for_review(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("a")],
            [note("n1", 0.0, 1.0)],
            pitch_frames=pitch_frames((0.0, None), (0.4, -80.0), (0.9, -80.0)),
            pitch_settings=PitchSettings(frameStepMs=100, checkNoteLongerThan=400),
        )

        result = syllables(arrangement)[0]
        self.assertEqual(result.endSec, 1.0)
        self.assertTrue(result.requiresReview)
        self.assertIn("needs_syllable_review", result.qualityFlags)
        self.assertEqual(arrangement.qualitySummary["correctedLongSyllableCount"], 0)

    def test_unoverlapped_note_stays_diagnostic_without_unassigned_flag(self):
        arrangement = build_arrangement("job_1", [segment_with_word("a")], [note("n1", 1.1, 1.4)])

        self.assertIsNone(syllables(arrangement)[0].midi)
        self.assertEqual([item.noteId for item in arrangement.noteEvents], ["n1"])
        self.assertNotIn("unassigned_note", arrangement.noteEvents[0].qualityFlags)

    def test_none_syllabification_uses_whole_words(self):
        arrangement = build_arrangement(
            "job_1",
            [segment_with_word("Panie")],
            [note("n1", 0.0, 1.0)],
            syllabification_settings=SyllabificationSettings(method="none"),
            language="pl",
            language_source="forced",
        )

        self.assertEqual([item.text for item in syllables(arrangement)], ["Panie"])
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

        self.assertEqual([item.text for item in syllables(arrangement)], ["Pa", "nie"])
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

        self.assertEqual([item.text for item in syllables(arrangement)], ["Pan", "i", "e"])
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

        self.assertEqual([item.text for item in syllables(arrangement)], ["Pa", "nie"])
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

        self.assertEqual([item.text for item in syllables(arrangement)], ["Pan", "i", "e"])
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
