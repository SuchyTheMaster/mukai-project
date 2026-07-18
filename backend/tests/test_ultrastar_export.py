import os
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app.core.config import get_settings
from app.domain.contracts import (
    Arrangement,
    ArrangementSentence,
    ArrangementSyllable,
    ArrangementWord,
    AudioAsset,
    AudioInfo,
    ExportSelection,
    Job,
    JobStatus,
    ModelProfiles,
    SourceMetadata,
    Tempo,
    TranscriptionSettings,
)
from app.services.ultrastar_export import (
    build_ultrastar_text,
    generate_karaoke_exports,
    midi_to_ultrastar_pitch,
    seconds_to_ultrastar_beats,
    validate_export,
)


def word(word_id: str, syllables: list[ArrangementSyllable]) -> ArrangementWord:
    return ArrangementWord(
        wordId=word_id,
        startSec=min(item.startSec for item in syllables),
        endSec=max(item.endSec for item in syllables),
        text="".join(item.text for item in syllables),
        syllables=syllables,
    )


def syllable(syllable_id: str, text: str, start: float, end: float, midi: int | None = 60, note_type: str = "normal") -> ArrangementSyllable:
    return ArrangementSyllable(
        syllableId=syllable_id,
        text=text,
        startSec=start,
        endSec=end,
        midi=midi,
        noteType=note_type,
    )


def arrangement(approved: bool = True, missing_midi: bool = False) -> Arrangement:
    first = word(
        "word_1",
        [
            syllable("syl_1", "Pierw", 1.0, 1.5, 57),
            syllable("syl_2", "sza", 1.5, 2.0, None if missing_midi else 59),
        ],
    )
    second = word("word_2", [syllable("syl_3", "fraza", 2.2, 2.8, 60)])
    return Arrangement(
        arrangementId="arr_1",
        jobId="job_1",
        approved=approved,
        sentences=[
            ArrangementSentence(
                sentenceId="sent_1",
                startSec=1.0,
                endSec=3.0,
                text="Pierwsza fraza",
                words=[first, second],
            )
        ],
    )


def job(artifacts: list[AudioAsset] | None = None) -> Job:
    now = datetime.now(timezone.utc)
    return Job(
        jobId="job_1",
        status=JobStatus.awaiting_review,
        createdAt=now,
        updatedAt=now,
        metadata=SourceMetadata(title="Song Title", artist="Artist", language="pl"),
        profiles=ModelProfiles(),
        transcriptionSettings=TranscriptionSettings(),
        tempo=Tempo(detectedSongBpm=120, acceptedSongBpm=120, ultrastarBpm=120, gapMs=1000),
        audio=AudioInfo(durationSec=180),
        artifacts=artifacts or [],
    )


def selection() -> ExportSelection:
    return ExportSelection(
        internalDirectoryName="Artist - Song Title",
        baseFilename="Artist - Song Title",
        audioFilenames={
            "audio": "Artist - Song Title [FULL].mp3",
            "instrumental": "Artist - Song Title [INSTR].mp3",
            "vocals": "Artist - Song Title [VOC].mp3",
        },
    )


class UltraStarExportTest(unittest.TestCase):
    def test_seconds_to_ultrastar_beats_uses_accepted_bpm_and_gap(self):
        self.assertEqual(seconds_to_ultrastar_beats(1.0, 1.5, 120, 1000), (0, 4, 4))

    def test_midi_to_ultrastar_pitch(self):
        self.assertEqual(midi_to_ultrastar_pitch(60), 0)
        self.assertEqual(midi_to_ultrastar_pitch(57), -3)
        self.assertEqual(midi_to_ultrastar_pitch(64), 4)

    def test_build_text_generates_tags_spaces_and_end_marker(self):
        text = build_ultrastar_text(job(), arrangement(), selection())

        self.assertIn("#AUDIO:Artist - Song Title [FULL].mp3\n", text)
        self.assertIn("#MP3:Artist - Song Title [FULL].mp3\n", text)
        self.assertIn("#INSTRUMENTAL:Artist - Song Title [INSTR].mp3\n", text)
        self.assertIn("#VOCALS:Artist - Song Title [VOC].mp3\n", text)
        self.assertIn("#BPM:120\n", text)
        self.assertNotIn("#BPM:480\n", text)
        self.assertIn(": 0 4 -3 Pierw\n", text)
        self.assertIn(": 10 5 0  fraza\n", text)
        self.assertTrue(text.endswith("E\n"))
        self.assertNotEqual(text.encode("utf-8")[:3], b"\xef\xbb\xbf")

    def test_exported_bpm_and_note_grid_reconstruct_original_duration_in_usdx(self):
        text = build_ultrastar_text(job(), arrangement(), selection())
        header_bpm = float(next(line.split(":", 1)[1] for line in text.splitlines() if line.startswith("#BPM:")))
        first_note = next(line for line in text.splitlines() if line.startswith(": "))
        _, _, length_beats, _, _ = first_note.split(" ", 4)

        usdx_internal_bpm = header_bpm * 4
        reconstructed_duration_sec = int(length_beats) * 60 / usdx_internal_bpm

        self.assertEqual(reconstructed_duration_sec, 0.5)

    def test_validation_requires_all_three_audio_assets(self):
        report = validate_export(job([asset("source_audio", "jobs/job_1/source/source.wav")]), arrangement(), selection())

        self.assertFalse(report.valid)
        self.assertIn("missing_instrumental", [item.code for item in report.errors])
        self.assertIn("missing_vocals", [item.code for item in report.errors])

    def test_validation_requires_midi_for_scored_notes(self):
        report = validate_export(job(audio_assets()), arrangement(missing_midi=True), selection())

        self.assertFalse(report.valid)
        issue = next(item for item in report.errors if item.code == "missing_midi")
        self.assertEqual(
            issue.details,
            {
                "syllableId": "syl_2",
                "text": "sza",
                "startSec": 1.5,
                "durationMs": 500,
                "midi": None,
                "noteType": "normal",
            },
        )

    def test_validation_allows_freestyle_without_midi_as_warning(self):
        free = arrangement()
        free.sentences[0].words[0].syllables[0].noteType = "freestyle"
        free.sentences[0].words[0].syllables[0].midi = None
        report = validate_export(job(audio_assets()), free, selection())

        self.assertTrue(report.valid)
        self.assertIn("freestyle_missing_midi", [item.code for item in report.warnings])

    def test_validation_rejects_note_shorter_than_half_an_ultrastar_beat(self):
        too_short = arrangement()
        too_short.sentences[0].words[0].syllables[0].endSec = 1.05
        report = validate_export(job(audio_assets()), too_short, selection())

        self.assertFalse(report.valid)
        issue = next(item for item in report.errors if item.code == "note_too_short")
        self.assertEqual(issue.details["syllableId"], "syl_1")

    def test_validation_rejects_overlapping_sentences(self):
        overlapping = arrangement()
        overlap_word = word("word_3", [syllable("syl_4", "druga", 2.9, 3.4, 62)])
        overlapping.sentences.append(
            ArrangementSentence(
                sentenceId="sent_2",
                startSec=2.9,
                endSec=3.4,
                text="druga",
                words=[overlap_word],
            )
        )
        report = validate_export(job(audio_assets()), overlapping, selection())

        self.assertFalse(report.valid)
        issue = next(item for item in report.errors if item.code == "overlapping_line")
        self.assertEqual(issue.details, {"sentenceId": "sent_2", "previousSentenceId": "sent_1"})

    def test_zip_export_contains_song_files_without_project_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            get_settings.cache_clear()
            with patch.dict(os.environ, {"ARTIFACT_ROOT": tmp}):
                root = Path(tmp)
                source = root / "jobs/job_1/source/source.wav"
                source.parent.mkdir(parents=True)
                source.write_bytes(b"source")
                cover = root / "jobs/job_1/assets/cover.jpg"
                cover.parent.mkdir(parents=True)
                cover.write_bytes(b"cover")
                export_selection = selection()
                export_selection.coverAssetId = "asset_cover"
                test_job = job(
                    [
                        asset("source_audio", "jobs/job_1/source/source.wav", "asset_source"),
                        asset("instrumental", "jobs/job_1/stems/instrumental.wav", "asset_instrumental"),
                        asset("vocals", "jobs/job_1/stems/vocals.wav", "asset_vocals"),
                        asset("cover", "jobs/job_1/assets/cover.jpg", "asset_cover", mime_type="image/jpeg"),
                    ]
                )
                instrumental = root / "jobs/job_1/stems/instrumental.wav"
                vocals = root / "jobs/job_1/stems/vocals.wav"
                instrumental.parent.mkdir(parents=True)
                instrumental.write_bytes(b"instrumental")
                vocals.write_bytes(b"vocals")

                with patch("app.services.ultrastar_export._convert_mp3", side_effect=lambda _source, destination: Path(destination).write_bytes(b"mp3")):
                    exports = generate_karaoke_exports(test_job, arrangement(), export_selection)

                zip_path = root / exports[0].path
                with zipfile.ZipFile(zip_path) as archive:
                    names = archive.namelist()

                self.assertIn("Artist - Song Title/Artist - Song Title.txt", names)
                self.assertIn("Artist - Song Title/Artist - Song Title [FULL].mp3", names)
                self.assertIn("Artist - Song Title/Artist - Song Title [INSTR].mp3", names)
                self.assertIn("Artist - Song Title/Artist - Song Title [VOC].mp3", names)
                self.assertIn("Artist - Song Title/cover.jpg", names)
                self.assertNotIn("mukai-project.json", names)
                self.assertEqual(exports[0].originalFilename, "Artist - Song Title [karaoke].zip")
            get_settings.cache_clear()


def audio_assets() -> list[AudioAsset]:
    return [
        asset("source_audio", "jobs/job_1/source/source.wav", "asset_source"),
        asset("instrumental", "jobs/job_1/stems/instrumental.wav", "asset_instrumental"),
        asset("vocals", "jobs/job_1/stems/vocals.wav", "asset_vocals"),
    ]


def asset(asset_type: str, path: str, asset_id: str | None = None, mime_type: str | None = None) -> AudioAsset:
    return AudioAsset(
        assetId=asset_id or f"asset_{asset_type}",
        type=asset_type,
        path=path,
        originalFilename=Path(path).name,
        mimeType=mime_type,
        producedByStage="test",
        producedBySubstep="test",
    )
