import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import WaveSurfer from "wavesurfer.js";
import {
  Download,
  FileAudio,
  Info,
  Lock,
  Magnet,
  Merge,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Undo2,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const EDITOR_WINDOW_SEC = 30;
const MIN_EDITOR_WINDOW_SEC = 5;
const MAX_EDITOR_WINDOW_SEC = 120;
const DEFAULT_TOKEN_MIDI = 60;
const MIN_EDITOR_MIDI = 24;
const MAX_EDITOR_MIDI = 96;
const PITCH_TOP_MIN_PCT = 42;
const PITCH_TOP_MAX_PCT = 85;
const SNAP_TIME_SEC = 0.08;
const SNAP_MIDI = 1;
const INSERTED_SENTENCE_LENGTH_SEC = 0.6;
const MIN_TOKEN_NOTE_SEC = 0.02;

const emptyMetadata = {
  title: "",
  artist: "",
  album: "",
  year: "",
  genre: "",
  language: "",
  languageMode: "auto",
  source: "manual",
  tagEncoding: "unknown",
  missingFields: [],
};

const defaultPitch = {
  silenceThresholdDb: -42,
  periodicityThreshold: 0.55,
  frameStepMs: 10,
  minNoteLengthMs: 120,
  mergeGapMs: 90,
};

const defaultTranscription = {
  vadMethod: "silero",
  vadOnset: 0.5,
  vadOffset: 0.363,
  vadChunkSizeSec: 30,
  sentencePauseMs: 700,
  sentencePaddingMs: 80,
};

const defaultSyllabification = {
  method: "pyphen",
};

const SYLLABIFICATION_OPTIONS = [
  ["kokosznicka", "Kokosznicka (tylko dla PL)"],
  ["pyphen", "Pyphen (multijęzyczny)"],
  ["heuristic", "Heurystyka"],
  ["none", "Bez podziału"],
];

const SYLLABIFICATION_SELECT_LABELS = Object.fromEntries(SYLLABIFICATION_OPTIONS);
const SYLLABIFICATION_BADGE_LABELS = {
  kokosznicka: "Kokosznicka",
  pyphen: "Pyphen",
  heuristic: "Heurystyka",
  none: "Bez podziału",
};

const TRANSCRIPTION_SETTING_FIELDS = [
  ["vadOnset", { label: "Próg startu VAD", step: "0.001" }],
  ["vadOffset", { label: "Próg końca VAD", step: "0.001" }],
  ["vadChunkSizeSec", { label: "Okno VAD/ASR (s)", step: "1" }],
  ["sentencePauseMs", { label: "Pauza dzieląca frazy (ms)", step: "10" }],
  ["sentencePaddingMs", { label: "Padding frazy (ms)", step: "10" }],
];

const PITCH_SETTING_FIELDS = [
  ["silenceThresholdDb", { label: "Czułość na cichy wokal (dB)", step: "1" }],
  ["periodicityThreshold", { label: "Minimalna pewność tonu (0-1)", step: "0.01" }],
  ["frameStepMs", { label: "Dokładność czasu analizy (ms)", step: "1" }],
  ["minNoteLengthMs", { label: "Najkrótsza nuta karaoke (ms)", step: "1" }],
  ["mergeGapMs", { label: "Scalanie krótkich przerw (ms)", step: "1" }],
];

const PIPELINE_ORDER = [
  "uploaded.source",
  "preprocessing.ffmpeg",
  "detecting_bpm.essentia",
  "separating_vocals.demucs",
  "transcribing.whisperx",
  "detecting_pitch.pitch_detection",
  "aligning.draft",
];

const STAGE_LABELS = {
  "uploaded.source": "Źródło",
  "preprocessing.ffmpeg": "Preprocessing audio",
  "detecting_bpm.essentia": "Rozpoznawanie BPM",
  "separating_vocals.demucs": "Separacja wokalu",
  "transcribing.whisperx": "Transkrypcja",
  "detecting_pitch.pitch_detection": "Detekcja pitch",
  "aligning.draft": "Wstępne dopasowanie",
};

const PREPROCESSING_DISPLAY_ARTIFACT_TYPES = new Set(["whisperx_input", "torchcrepe_input"]);

const FLAG_LABELS = {
  uncertain_pitch: "Niska periodicity",
  missing_note: "Brak nuty dla tekstu",
  unassigned_note: "Nuta bez tekstu",
  uncertain_text: "Niska pewność tekstu",
  needs_syllable_review: "Sylaby do sprawdzenia",
  contains_review_items: "Elementy do recenzji",
  too_short_note: "Zbyt krótka nuta",
  overlapping_line: "Nachodzące frazy",
};

const NOTE_TYPES = [
  ["normal", "Normal"],
  ["golden", "Golden"],
  ["freestyle", "Freestyle"],
  ["rap", "Rap"],
  ["rap_golden", "Rap golden"],
];

const MODEL_TOOLTIPS = {
  separation: "Separacja rozdziela utwór na wokal i instrumental. Dokładniejszy model zwykle daje czystszy wokal, ale działa dłużej.",
  vad: "Wykrywanie mowy wskazuje fragmenty z wokalem przed transkrypcją. Ma wpływ na pominięcie ciszy, oddechów i nieśpiewanych fragmentów.",
  transcription: "Transkrypcja zamienia wokal na tekst. Większy model zwykle lepiej radzi sobie z językiem i wymową, ale potrzebuje więcej czasu.",
  syllabification: 'Dla polskich piosenek zalecany sylabizator to "Kokosznicka", ale czasami może lepiej sprawdzić się "Pyphen". Dla zagranicznych tylko "Pyphen". Jeżeli jakiś język nie jest obsługiwany przez wybraną metodę, to zostanie użyta metoda heurustyczna. Jeżeli całe słowa piosenki są śpiewane w jednym tonie, to lepiej sprawdzi się tryb bez podziału na sylaby.',
};

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const coverInputRef = useRef(null);
  const [inspection, setInspection] = useState(null);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [profiles, setProfiles] = useState({ separationModel: "htdemucs_ft", transcriptionModel: "large-v3", pitch: "default" });
  const [transcriptionSettings, setTranscriptionSettings] = useState(defaultTranscription);
  const [pitchSettings, setPitchSettings] = useState(defaultPitch);
  const [syllabificationSettings, setSyllabificationSettings] = useState(defaultSyllabification);
  const [syllabificationTouched, setSyllabificationTouched] = useState(false);
  const [useEmbeddedCover, setUseEmbeddedCover] = useState(true);
  const [job, setJob] = useState(null);
  const [arrangement, setArrangement] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [reviewRailVisible, setReviewRailVisible] = useState(false);

  useEffect(() => {
    if (!job || ["failed", "awaiting_review", "cancelled"].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      const refreshed = await apiJson(`/api/jobs/${job.jobId}`);
      setJob(refreshed);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.jobId, job?.status]);

  useEffect(() => {
    if (job?.status !== "awaiting_review") return;
    let ignore = false;
    apiJson(`/api/jobs/${job.jobId}/arrangement`)
      .then((next) => {
        if (!ignore) setArrangement(next);
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      });
    return () => {
      ignore = true;
    };
  }, [job?.jobId, job?.status]);

  const activeStage = useMemo(() => currentStage(job), [job]);
  const coverPreview = coverFile ? URL.createObjectURL(coverFile) : inspection?.embeddedCover && useEmbeddedCover ? `${API_BASE}${inspection.embeddedCover.previewUrl}` : null;
  const isReview = job?.status === "awaiting_review";

  useEffect(() => {
    if (!isReview) setReviewRailVisible(false);
  }, [isReview]);

  useEffect(() => {
    if (syllabificationTouched) return;
    setSyllabificationSettings(defaultSyllabificationForLanguage(metadata.language));
  }, [metadata.language, syllabificationTouched]);

  async function inspect(file) {
    setError(null);
    setBusy(true);
    setAudioFile(file);
    setInspection(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiForm("/api/uploads/inspect", form);
      setInspection(result);
      setMetadata({ ...emptyMetadata, ...result.metadata, language: "", languageMode: "auto" });
      setTranscriptionSettings(defaultTranscription);
      setSyllabificationTouched(false);
      setSyllabificationSettings(defaultSyllabificationForLanguage(""));
      setUseEmbeddedCover(Boolean(result.embeddedCover));
      setCoverFile(null);
      setJob(null);
      setArrangement(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    if (!inspection) return;
    setError(null);
    setBusy(true);
    try {
      const language = metadata.language.trim();
      const payload = {
        uploadDraftId: inspection.uploadDraftId,
        metadata: { ...metadata, language: language || null, languageMode: language ? "forced" : "auto" },
        profiles,
        transcriptionSettings,
        pitchSettings,
        syllabificationSettings,
        useEmbeddedCover: useEmbeddedCover && !coverFile,
      };
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      if (coverFile) form.append("cover", coverFile);
      const created = await apiForm("/api/jobs/uploads", form);
      setJob(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetStage(stage) {
    if (!job) return;
    setError(null);
    try {
      await apiJson(`/api/jobs/${job.jobId}/stages/${stage}/reset`, {
        method: "POST",
        body: JSON.stringify({ reason: "user_requested" }),
        headers: { "Content-Type": "application/json" },
      });
      setArrangement(null);
      setJob(await apiJson(`/api/jobs/${job.jobId}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveArrangement() {
    if (!job || !arrangement) return;
    setError(null);
    setSaving(true);
    try {
      const saved = await apiJson(`/api/jobs/${job.jobId}/arrangement`, {
        method: "PUT",
        body: JSON.stringify({ revision: arrangement.revision, arrangement }),
        headers: { "Content-Type": "application/json" },
      });
      setArrangement(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function chooseCover(file) {
    if (!file) return;
    setCoverFile(file);
    setUseEmbeddedCover(false);
  }

  function resetCover() {
    setCoverFile(null);
    setUseEmbeddedCover(Boolean(inspection?.embeddedCover));
  }

  return (
    <div className={`app-shell ${isReview && !reviewRailVisible ? "review-expanded" : ""}`}>
      <aside className="left-rail panel">
        <section className="brand-section">
          <div className="brand">
            <img src="/brand/mukai-logo.png" alt="MUKAI - Music to Karaoke AI Creator" />
            <div className="brand-copy">
              <strong>MUKAI</strong>
              <span>Music to Karaoke AI Creator</span>
            </div>
          </div>
        </section>

        <section>
          <div className="section-title">Upload audio</div>
          <label className="dropzone">
            <UploadCloud size={22} />
            <span>{audioFile ? audioFile.name : "Wybierz WAV, MP3, MP4, M4A, OGG albo FLAC"}</span>
            <input type="file" accept=".wav,.mp3,.mp4,.m4a,.ogg,.flac,audio/*,video/mp4" onChange={(event) => event.target.files?.[0] && inspect(event.target.files[0])} />
          </label>
          {inspection && <AudioSummary audio={inspection.audio} filename={inspection.originalFilename} />}
          <button className="cover-box cover-box-button" type="button" disabled={!inspection} onClick={() => coverInputRef.current?.click()}>
            {coverPreview ? <img src={coverPreview} alt="" /> : <FileAudio size={42} />}
          </button>
          <input
            ref={coverInputRef}
            className="cover-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              chooseCover(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="cover-actions">
            <button className="button secondary" type="button" disabled={!inspection} onClick={() => coverInputRef.current?.click()}>
              <UploadCloud size={16} /> Z dysku
            </button>
            <button className="button ghost" type="button" disabled={!inspection} onClick={resetCover}>
              <RotateCcw size={16} /> Z tagów
            </button>
          </div>
        </section>

        {job?.metadata && <section>
          <div className="section-title">Ustawienia zadania</div>
          {job?.metadata && <MetadataSummary metadata={job.metadata} profiles={job.profiles} transcriptionSettings={job.transcriptionSettings} pitchSettings={job.pitchSettings} syllabificationSettings={job.syllabificationSettings} />}
        </section>}
      </aside>

      <main className="workspace">
        {error && <div className="error-banner">{error}</div>}
        {isReview ? (
          <ReviewEditor
            job={job}
            arrangement={arrangement}
            setArrangement={setArrangement}
            onSave={saveArrangement}
            saving={saving}
            onResetStage={resetStage}
            railVisible={reviewRailVisible}
            onToggleRail={() => setReviewRailVisible((visible) => !visible)}
          />
        ) : (
          <>
            <UploadWorkspace
              metadata={metadata}
              setMetadata={setMetadata}
              profiles={profiles}
              setProfiles={setProfiles}
              transcriptionSettings={transcriptionSettings}
              setTranscriptionSettings={setTranscriptionSettings}
              pitchSettings={pitchSettings}
              setPitchSettings={setPitchSettings}
              syllabificationSettings={syllabificationSettings}
              setSyllabificationSettings={setSyllabificationSettings}
              setSyllabificationTouched={setSyllabificationTouched}
              inspection={inspection}
              job={job}
              createJob={createJob}
              busy={busy}
            />
          </>
        )}
      </main>

      {(!isReview || reviewRailVisible) && (
        <aside className="right-rail panel">
          <section>
            <div className="section-title">Aktualny etap</div>
            <div className="current-stage">
              <strong>{job ? job.status : "Brak zadania"}</strong>
              <small>{activeStage ? stageLabel(activeStage) : "Najpierw wybierz plik audio"}</small>
            </div>
          </section>
          <section>
            <div className="section-title">Pipeline</div>
            <StageRail job={job} />
          </section>
        </aside>
      )}
    </div>
  );
}

function UploadWorkspace({ metadata, setMetadata, profiles, setProfiles, transcriptionSettings, setTranscriptionSettings, pitchSettings, setPitchSettings, syllabificationSettings, setSyllabificationSettings, setSyllabificationTouched, inspection, job, createJob, busy }) {
  return (
    <section className="workspace-panel">
      <div className="workspace-header">
        <div>
          <h1>Import i przygotowanie audio</h1>
        </div>
      </div>
      {job ? (
        <StatusPanel job={job} />
      ) : (
        <>
          <div className="form-grid">
            <TextField label="Tytuł" value={metadata.title ?? ""} onChange={(value) => setMetadata({ ...metadata, title: value })} />
            <TextField label="Artysta" value={metadata.artist ?? ""} onChange={(value) => setMetadata({ ...metadata, artist: value })} />
            <TextField label="Album" value={metadata.album ?? ""} onChange={(value) => setMetadata({ ...metadata, album: value })} />
            <TextField label="Rok" value={metadata.year ?? ""} onChange={(value) => setMetadata({ ...metadata, year: value })} />
            <TextField label="Gatunek" value={metadata.genre ?? ""} onChange={(value) => setMetadata({ ...metadata, genre: value })} />
            <TextField label="Język" value={metadata.language ?? ""} onChange={(value) => setMetadata({ ...metadata, language: value })} placeholder="Puste = auto" />
          </div>

          <div className="controls-row">
            <Select label="Separacja" tooltip={MODEL_TOOLTIPS.separation} value={profiles.separationModel} onChange={(value) => setProfiles({ ...profiles, separationModel: value })} options={[["htdemucs_ft", "htdemucs_ft dokładniejszy"], ["htdemucs", "htdemucs szybszy"]]} />
            <Select label="Wykrywanie mowy" tooltip={MODEL_TOOLTIPS.vad} value={transcriptionSettings.vadMethod} onChange={(value) => setTranscriptionSettings({ ...transcriptionSettings, vadMethod: value })} options={[["silero", "Silero"], ["pyannote", "pyannote"]]} />
            <Select label="Transkrypcja" tooltip={MODEL_TOOLTIPS.transcription} value={profiles.transcriptionModel} onChange={(value) => setProfiles({ ...profiles, transcriptionModel: value })} options={[["large-v3", "large-v3 dokładniejszy"], ["large-v3-turbo", "large-v3-turbo szybszy"]]} />
            <Select label="Sylabizacja" tooltip={MODEL_TOOLTIPS.syllabification} value={syllabificationSettings.method} onChange={(value) => { setSyllabificationTouched(true); setSyllabificationSettings({ method: value }); }} options={SYLLABIFICATION_OPTIONS} />
          </div>

          <details className="advanced">
            <summary>Zaawansowane ustawienia transkrypcji</summary>
            <div className="form-grid compact">
              {TRANSCRIPTION_SETTING_FIELDS.map(([key, field]) => (
                <TextField key={key} label={field.label} helper={key} type="number" step={field.step} value={transcriptionSettings[key]} onChange={(next) => setTranscriptionSettings({ ...transcriptionSettings, [key]: Number(next) })} />
              ))}
            </div>
          </details>

          <details className="advanced">
            <summary>Zaawansowane ustawienia pitch</summary>
            <div className="form-grid compact">
              {PITCH_SETTING_FIELDS.map(([key, field]) => (
                <TextField key={key} label={field.label} helper={key} type="number" step={field.step} value={pitchSettings[key]} onChange={(next) => setPitchSettings({ ...pitchSettings, [key]: Number(next) })} />
              ))}
            </div>
          </details>

          <button className="button primary import-submit" disabled={!inspection || busy} onClick={createJob}>
            <Play size={16} /> {busy ? "Przetwarzanie..." : "Przetwarzaj audio"}
          </button>
        </>
      )}
    </section>
  );
}

function ReviewEditor({ job, arrangement, setArrangement, onSave, saving, onResetStage, railVisible, onToggleRail }) {
  const waveformRef = useRef(null);
  const waveSurferRef = useRef(null);
  const resumeAfterTrackChange = useRef(false);
  const activePlaybackRangeRef = useRef(null);
  const [waveformReady, setWaveformReady] = useState(false);
  const [track, setTrack] = useState("vocals");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState({ type: "line", id: null });
  const [zoomSec, setZoomSec] = useState(EDITOR_WINDOW_SEC);
  const [viewportStart, setViewportStart] = useState(0);
  const [snapToExisting, setSnapToExisting] = useState(true);
  const [limitPlaybackToWindow, setLimitPlaybackToWindow] = useState(false);
  const [editorNotice, setEditorNotice] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const assets = useMemo(() => Object.fromEntries((job.artifacts ?? []).map((asset) => [asset.type, asset])), [job.artifacts]);
  const selectedContext = useMemo(() => selectionContext(arrangement, selected), [arrangement, selected]);
  const selectedLineId = selected.type === "line" ? selected.id : selectedContext.lineIds[0];
  const selectedLine = arrangement?.lines.find((line) => line.lineId === selectedLineId) ?? arrangement?.lines[0] ?? null;
  const selectedToken = selected.type === "token" ? arrangement?.tokens.find((token) => token.tokenId === selected.id) : null;
  const selectedNote = selected.type === "note"
    ? arrangement?.noteEvents.find((note) => note.noteId === selected.id)
    : selected.type === "token"
      ? selectedToken?.noteId
        ? arrangement?.noteEvents.find((note) => note.noteId === selectedToken.noteId)
        : null
      : arrangement?.noteEvents.find((note) => note.noteId === selectedContext.noteIds[0]) ?? null;
  const duration = job.audio?.durationSec ?? arrangementDuration(arrangement);
  const maxViewportStart = Math.max(duration - zoomSec, 0);
  const windowStart = Math.max(0, Math.min(viewportStart, maxViewportStart));
  const windowEnd = Math.min(duration || zoomSec, windowStart + zoomSec);
  const effectiveTrack = assets[track] ? track : assets.vocals ? "vocals" : assets.source_audio ? "source_audio" : "mix";
  const audioAsset = assets[effectiveTrack] ?? assets.source_audio ?? assets.mix;
  const audioUrl = audioAsset ? `${API_BASE}/api/jobs/${job.jobId}/artifacts/${audioAsset.assetId}` : null;
  const bindWaveform = useCallback((node) => {
    waveformRef.current = node;
    setWaveformReady(Boolean(node));
  }, []);

  useEffect(() => {
    if (!selected.id && arrangement?.lines[0]) setSelected({ type: "line", id: arrangement.lines[0].lineId });
  }, [arrangement?.arrangementId, selected.id]);

  useEffect(() => {
    if (!audioUrl || !waveformReady || !waveformRef.current) return undefined;
    const resume = resumeAfterTrackChange.current;
    resumeAfterTrackChange.current = false;
    const targetTime = currentTime;
    const waveSurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: audioUrl,
      height: 104,
      normalize: true,
      waveColor: "rgba(58, 134, 255, 0.48)",
      progressColor: "rgba(255, 0, 110, 0.72)",
      cursorColor: "#FFD700",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      minPxPerSec: waveformPixelsPerSecond(waveformRef.current, zoomSec),
      autoScroll: false,
      autoCenter: false,
      cursorWidth: 0,
    });
    waveSurferRef.current = waveSurfer;
    const unsubReady = waveSurfer.on("ready", () => {
      waveSurfer.setTime(Math.min(targetTime, duration || targetTime));
      syncWaveformViewport(waveSurfer, waveformRef.current, viewportStart, zoomSec);
      if (resume) {
        waveSurfer.play().catch(() => setPlaying(false));
      }
    });
    const unsubTime = waveSurfer.on("timeupdate", (time) => {
      const range = activePlaybackRangeRef.current;
      if (range && time >= range.endSec - 0.01) {
        completeActivePlaybackRange(waveSurfer);
        return;
      }
      setCurrentTime(time);
    });
    const unsubInteraction = waveSurfer.on("interaction", (time) => {
      activePlaybackRangeRef.current = null;
      setCurrentTime(time);
    });
    const unsubPlay = waveSurfer.on("play", () => setPlaying(true));
    const unsubPause = waveSurfer.on("pause", () => setPlaying(false));
    const unsubFinish = waveSurfer.on("finish", () => {
      if (!completeActivePlaybackRange(waveSurfer)) setPlaying(false);
    });
    return () => {
      unsubReady();
      unsubTime();
      unsubInteraction();
      unsubPlay();
      unsubPause();
      unsubFinish();
      waveSurfer.destroy();
      if (waveSurferRef.current === waveSurfer) waveSurferRef.current = null;
    };
  }, [audioUrl, waveformReady]);

  useEffect(() => {
    if (!waveSurferRef.current || !waveformRef.current) return;
    waveSurferRef.current.setOptions({ minPxPerSec: waveformPixelsPerSecond(waveformRef.current, zoomSec) });
    syncWaveformViewport(waveSurferRef.current, waveformRef.current, windowStart, zoomSec);
  }, [zoomSec, windowStart]);

  useEffect(() => {
    if (viewportStart <= maxViewportStart) return;
    setViewportStart(maxViewportStart);
  }, [maxViewportStart, viewportStart]);

  useEffect(() => {
    if (!playing) return;
    if (activePlaybackRangeRef.current?.lockViewport) return;
    const centerThreshold = windowStart + zoomSec * 0.5;
    if (currentTime < windowStart || currentTime >= centerThreshold) {
      setGraphViewport(Math.max(0, Math.min(currentTime - zoomSec * 0.5, maxViewportStart)));
    }
  }, [currentTime, playing, windowStart, windowEnd, zoomSec, maxViewportStart]);

  function commit(updater) {
    setArrangement((current) => {
      if (!current) return current;
      const before = clone(current);
      const next = normalizeArrangement(updater(clone(current)));
      setPast((items) => [...items.slice(-49), before]);
      setFuture([]);
      return next;
    });
  }

  function undo() {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => (arrangement ? [clone(arrangement), ...items].slice(0, 50) : items));
    setArrangement(previous);
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => (arrangement ? [...items.slice(-49), clone(arrangement)] : items));
    setArrangement(next);
  }

  function togglePlay() {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) return;
    if (waveSurfer.isPlaying()) {
      activePlaybackRangeRef.current = null;
      waveSurfer.pause();
      return;
    }
    if (limitPlaybackToWindow) {
      const startSec = currentTime >= windowStart && currentTime < windowEnd ? currentTime : windowStart;
      playRange(startSec, windowEnd, { lockViewport: true, returnToStart: true });
      return;
    }
    waveSurfer.play().catch(() => setPlaying(false));
  }

  function seek(nextTime, { preservePlaybackRange = false } = {}) {
    if (!preservePlaybackRange) activePlaybackRangeRef.current = null;
    const bounded = Math.max(0, Math.min(Number(nextTime), duration || 0));
    setCurrentTime(bounded);
    if (waveSurferRef.current) waveSurferRef.current.setTime(bounded);
    if (bounded < windowStart || bounded > windowEnd) {
      setGraphViewport(Math.max(0, Math.min(bounded - zoomSec * 0.2, maxViewportStart)));
    }
  }

  function selectAndSeek(type, id, timeSec) {
    setSelected({ type, id });
    if (Number.isFinite(timeSec)) seek(timeSec);
  }

  function playRange(startSec, endSec, { lockViewport = false, returnToStart = true } = {}) {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) return;
    const safeStart = Math.max(0, Math.min(Number(startSec), duration || 0));
    const safeEnd = Math.max(safeStart, Math.min(Number(endSec), duration || safeStart));
    if (safeEnd <= safeStart) {
      seek(safeStart);
      return;
    }
    activePlaybackRangeRef.current = { startSec: safeStart, endSec: safeEnd, lockViewport, returnToStart };
    setCurrentTime(safeStart);
    waveSurfer.setTime(safeStart);
    waveSurfer.play().catch(() => {
      activePlaybackRangeRef.current = null;
      setPlaying(false);
    });
  }

  function completeActivePlaybackRange(waveSurfer = waveSurferRef.current) {
    const range = activePlaybackRangeRef.current;
    if (!range) return false;
    activePlaybackRangeRef.current = null;
    const nextTime = range.returnToStart ? range.startSec : range.endSec;
    if (waveSurfer?.isPlaying()) waveSurfer.pause();
    if (waveSurfer) waveSurfer.setTime(nextTime);
    setCurrentTime(nextTime);
    return true;
  }

  function playTokenRange(token) {
    if (!token) return;
    selectAndSeek("token", token.tokenId, token.startSec);
    playRange(token.startSec, token.endSec, { returnToStart: true });
  }

  function splitSelectedLineAtPlayhead() {
    if (!selectedLine || !arrangement) return;
    if (!canSplitLineAtTime(arrangement, selectedLine, currentTime)) {
      setEditorNotice("Przewiń wskaźnik do miejsca podziału wewnątrz dzielonej sentencji.");
      return;
    }
    setEditorNotice(null);
    commit((draft) => splitLine(draft, selectedLine.lineId, currentTime));
  }

  function changeTrack(nextTrack) {
    if (nextTrack === effectiveTrack) return;
    const waveSurfer = waveSurferRef.current;
    const nextTime = waveSurfer ? waveSurfer.getCurrentTime() : currentTime;
    resumeAfterTrackChange.current = waveSurfer ? waveSurfer.isPlaying() : playing;
    setCurrentTime(nextTime);
    setTrack(nextTrack);
  }

  function zoom(delta) {
    setZoomSec((value) => Math.max(MIN_EDITOR_WINDOW_SEC, Math.min(MAX_EDITOR_WINDOW_SEC, value + delta)));
  }

  function zoomToLine(line) {
    if (!line) return;
    const lineLength = Math.max(line.endSec - line.startSec, 0.02);
    const margin = Math.max(0.25, lineLength * 0.12);
    const nextZoom = Math.max(MIN_EDITOR_WINDOW_SEC, Math.min(MAX_EDITOR_WINDOW_SEC, lineLength + margin * 2));
    const nextMaxStart = Math.max((duration || nextZoom) - nextZoom, 0);
    const nextStart = Math.max(0, Math.min(line.startSec - margin, nextMaxStart));
    setZoomSec(nextZoom);
    setViewportStart(nextStart);
    syncWaveformViewport(waveSurferRef.current, waveformRef.current, nextStart, nextZoom);
  }

  function setGraphViewport(nextStart) {
    const bounded = Math.max(0, Math.min(Number(nextStart), maxViewportStart));
    setViewportStart(bounded);
    syncWaveformViewport(waveSurferRef.current, waveformRef.current, bounded, zoomSec);
  }

  function startGraphDrag(kind, id, mode, event, windowStart, windowEnd, pitchRange = null) {
    event.preventDefault();
    event.stopPropagation();
    const graph = event.currentTarget.closest(".combined-editor-overlay");
    const graphWidth = graph?.clientWidth ?? 1;
    const graphHeight = graph?.clientHeight ?? 1;
    const pitchHeight = Math.max(graphHeight * ((PITCH_TOP_MAX_PCT - PITCH_TOP_MIN_PCT) / 100), 1);
    const range = Math.max(windowEnd - windowStart, 0.001);
    const startX = event.clientX;
    const startY = event.clientY;
    const before = clone(arrangement);
    let moved = false;
    let finalTime = graphItemStart(arrangement, kind, id);
    selectAndSeek(kind === "note" ? "note" : "token", id, graphItemStart(arrangement, kind, id));

    const onMove = (moveEvent) => {
      const deltaSec = ((moveEvent.clientX - startX) / graphWidth) * range;
      const deltaMidi = pitchRange ? -((moveEvent.clientY - startY) / pitchHeight) * Math.max(pitchRange.maxMidi - pitchRange.minMidi, 1) : 0;
      if (Math.abs(deltaSec) < 0.001 && Math.abs(deltaMidi) < 0.1) return;
      moved = true;
      const next = normalizeArrangement(updateGraphItem(clone(before), kind, id, mode, deltaSec, deltaMidi, { snapToExisting }));
      finalTime = graphItemStart(next, kind, id);
      setArrangement(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        setPast((items) => [...items.slice(-49), before]);
        setFuture([]);
        seek(finalTime);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  if (!arrangement) {
    return (
      <section className="workspace-panel editor-shell loading-editor">
        <h1>Dopasowanie</h1>
        <p>Ładowanie arrangementu...</p>
      </section>
    );
  }

  return (
    <section className="workspace-panel editor-shell">
      <div className="editor-top">
        <div>
          <h1>Dopasowanie</h1>
          <div className="editor-meta">
            <span>Revision {arrangement.revision}</span>
            <span>{arrangement.lines.length} sentencji</span>
            <span>{arrangement.noteEvents.length} nut</span>
          </div>
        </div>
        <div className="editor-actions">
          <button className="icon-button" type="button" title="Undo" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={16} /></button>
          <button className="icon-button" type="button" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={16} /></button>
          <button className="button secondary" type="button" onClick={onToggleRail}><SlidersHorizontal size={16} /> {railVisible ? "Ukryj pipeline" : "Pokaż pipeline"}</button>
          <button className="button secondary" type="button" onClick={() => onResetStage("aligning")}><RefreshCcw size={16} /> Reset szkicu</button>
          <button className="button primary" type="button" disabled={saving} onClick={onSave}><Save size={16} /> {saving ? "Zapis..." : "Zapisz"}</button>
        </div>
      </div>

      <div className="quality-strip">
        <SyllabificationBadge info={arrangement.syllabification} />
        {qualityBadges(arrangement).map(([flag, count]) => (
          <span key={flag} className={`quality-badge ${count ? "warning" : "ok"}`}>{FLAG_LABELS[flag] ?? flag}: {count}</span>
        ))}
      </div>

      {editorNotice && (
        <div className="editor-notice" role="alert">
          <span>{editorNotice}</span>
          <button className="button ghost" type="button" onClick={() => setEditorNotice(null)}>OK</button>
        </div>
      )}

      <div className="zoom-bar editor-control-bar">
        <button className="button secondary transport-play" type="button" disabled={!audioUrl} onClick={togglePlay}>
          {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pauza" : "Play"}
        </button>
        <input className="time-slider" type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(event) => seek(event.target.value)} />
        <span className="time-readout">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <button className="icon-button" type="button" title="Oddal" aria-label="Oddal" onClick={() => zoom(10)}><ZoomOut size={16} /></button>
        <button className="icon-button" type="button" title="Przybliż" aria-label="Przybliż" onClick={() => zoom(-10)}><ZoomIn size={16} /></button>
        <button className={`icon-button toggle-button ${snapToExisting ? "active" : ""}`} type="button" title="przyciągaj elementy na wykresie" aria-label="przyciągaj elementy na wykresie" aria-pressed={snapToExisting} onClick={() => setSnapToExisting((value) => !value)}><Magnet size={16} /></button>
        <button className={`icon-button toggle-button ${limitPlaybackToWindow ? "active" : ""}`} type="button" title="ogranicz odtwarzanie do widocznego zakresu" aria-label="ogranicz odtwarzanie do widocznego zakresu" aria-pressed={limitPlaybackToWindow} onClick={() => setLimitPlaybackToWindow((value) => !value)}><Lock size={16} /></button>
      </div>

      <GraphScrollbar duration={duration} windowStart={windowStart} zoomSec={zoomSec} onChange={setGraphViewport} />
      <CombinedEditorGraph bindWaveform={bindWaveform} arrangement={arrangement} selectedContext={selectedContext} selectAndSeek={selectAndSeek} playTokenRange={playTokenRange} startGraphDrag={startGraphDrag} currentTime={currentTime} seek={seek} windowStart={windowStart} windowEnd={windowEnd} assets={assets} effectiveTrack={effectiveTrack} changeTrack={changeTrack} zoomToLine={zoomToLine} />

      <div className="editor-grid">
        <PhraseList arrangement={arrangement} selected={selected} selectedContext={selectedContext} selectAndSeek={selectAndSeek} playTokenRange={playTokenRange} commit={commit} zoomToLine={zoomToLine} />
        <PropertiesPanel
          arrangement={arrangement}
          selected={selected}
          selectAndSeek={selectAndSeek}
          selectedLine={selectedLine}
          selectedToken={selectedToken}
          selectedNote={selectedNote}
          commit={commit}
          onSplitLine={splitSelectedLineAtPlayhead}
        />
      </div>
    </section>
  );
}

function CombinedEditorGraph({ bindWaveform, arrangement, selectedContext, selectAndSeek, playTokenRange, startGraphDrag, currentTime, seek, windowStart, windowEnd, assets, effectiveTrack, changeTrack, zoomToLine }) {
  const range = Math.max(windowEnd - windowStart, 0.001);
  const visibleLines = arrangement.lines.filter((line) => line.endSec >= windowStart && line.startSec <= windowEnd);
  const visibleTokens = arrangement.tokens.filter((token) => token.endSec >= windowStart && token.startSec <= windowEnd);
  const linkedNoteIds = new Set(arrangement.tokens.map((token) => token.noteId).filter(Boolean));
  const visibleGhostNotes = arrangement.noteEvents.filter((note) => !linkedNoteIds.has(note.noteId) && note.endSec >= windowStart && note.startSec <= windowEnd);
  const noteById = new Map(arrangement.noteEvents.map((note) => [note.noteId, note]));
  const pitchRange = pitchRangeForWindow(arrangement, visibleTokens, visibleGhostNotes, noteById);
  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <span>{formatTime(windowStart)}</span>
        <div className="track-switch subtle" role="group" aria-label="Źródło audio">
          {[
            ["source_audio", "Oryginał"],
            ["vocals", "Wokal"],
            ["instrumental", "Instrumental"],
          ].map(([key, label]) => (
            <button key={key} className={effectiveTrack === key ? "active" : ""} type="button" disabled={!assets[key]} onClick={() => changeTrack(key)}>{label}</button>
          ))}
        </div>
        <span>{formatTime(windowEnd)}</span>
      </div>
      <div className="combined-editor-shell">
        <div ref={bindWaveform} className="waveform-canvas" />
        <div className="combined-editor-overlay" onPointerDown={(event) => seek(windowStart + (event.nativeEvent.offsetX / event.currentTarget.clientWidth) * range)}>
          <div className="playhead" style={{ left: `${percent(currentTime, windowStart, windowEnd)}%` }} />
          {visibleLines.map((line) => (
            <button
              key={line.lineId}
              className={`phrase-span ${selectedContext.lineIds.includes(line.lineId) ? "selected" : ""} ${line.requiresReview ? "review" : ""}`}
              style={{ left: `${percent(line.startSec, windowStart, windowEnd)}%`, width: `${spanPercent(line.startSec, line.endSec, windowStart, windowEnd)}%` }}
              type="button"
              title={lineText(arrangement, line)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                selectAndSeek("line", line.lineId, line.startSec);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                zoomToLine(line);
              }}
            />
          ))}
          {visibleGhostNotes.map((note) => (
            <div
              key={note.noteId}
              className={`ghost-note-block ${selectedContext.noteIds.includes(note.noteId) ? "selected" : ""} ${note.requiresReview ? "review" : ""}`}
              style={{
                left: `${percent(note.startSec, windowStart, windowEnd)}%`,
                width: `${spanPercent(note.startSec, note.endSec, windowStart, windowEnd)}%`,
                top: `${pitchTopPercent(note.midi, pitchRange.minMidi, pitchRange.maxMidi)}%`,
              }}
              role="button"
              tabIndex={0}
              title={`${note.noteId} MIDI ${note.midi}`}
              onPointerDown={(event) => startGraphDrag("note", note.noteId, "move", event, windowStart, windowEnd, pitchRange)}
              onClick={(event) => {
                event.stopPropagation();
                selectAndSeek("note", note.noteId, note.startSec);
              }}
            >
              <span className="drag-handle start" onPointerDown={(event) => startGraphDrag("note", note.noteId, "resize-start", event, windowStart, windowEnd)} />
              <span className="marker-label">MIDI {note.midi}</span>
              <span className="drag-handle end" onPointerDown={(event) => startGraphDrag("note", note.noteId, "resize-end", event, windowStart, windowEnd)} />
            </div>
          ))}
          {visibleTokens.map((token) => {
            const midi = tokenAssignedMidi(token, noteById);
            const visualMidi = visualMidiForToken(arrangement, token, noteById);
            return (
              <div
                key={token.tokenId}
                className={`syllable-block ${midi == null ? "missing-note" : ""} ${token.isExtension ? "extension" : ""} ${selectedContext.tokenIds.includes(token.tokenId) ? "selected" : ""} ${token.requiresReview ? "review" : ""}`}
                style={{
                  left: `${percent(token.startSec, windowStart, windowEnd)}%`,
                  width: `${spanPercent(token.startSec, token.endSec, windowStart, windowEnd)}%`,
                  top: `${pitchTopPercent(visualMidi, pitchRange.minMidi, pitchRange.maxMidi)}%`,
                }}
                role="button"
                tabIndex={0}
                title={`${token.text || "Przedłużenie"} (${midi == null ? "brak nuty" : `MIDI ${midi}`})`}
                onPointerDown={(event) => startGraphDrag("token", token.tokenId, "move", event, windowStart, windowEnd, pitchRange)}
                onClick={(event) => {
                  event.stopPropagation();
                  selectAndSeek("token", token.tokenId, token.startSec);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  playTokenRange(token);
                }}
              >
                <span className="drag-handle start" onPointerDown={(event) => startGraphDrag("token", token.tokenId, "resize-start", event, windowStart, windowEnd)} />
                <span className="syllable-text">{token.text || "..."}</span>
                <span className="syllable-note">{midi == null ? "brak" : midi}</span>
                <span className="drag-handle end" onPointerDown={(event) => startGraphDrag("token", token.tokenId, "resize-end", event, windowStart, windowEnd)} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GraphScrollbar({ duration, windowStart, zoomSec, onChange }) {
  const trackRef = useRef(null);
  const max = Math.max(0, duration - zoomSec);
  const safeDuration = Math.max(duration || 0, 0);
  const thumbWidthPct = safeDuration > 0 ? Math.min(100, Math.max(4, (Math.min(zoomSec, safeDuration) / safeDuration) * 100)) : 100;
  const thumbLeftPct = safeDuration > 0 ? Math.min(100 - thumbWidthPct, (Math.min(windowStart, max) / safeDuration) * 100) : 0;

  function updateFromClientX(clientX) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || max <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextStart = Math.max(0, Math.min(safeDuration * ratio - zoomSec / 2, max));
    onChange(nextStart);
  }

  function startScrub(event) {
    if (max <= 0) return;
    event.preventDefault();
    updateFromClientX(event.clientX);
    const onMove = (moveEvent) => updateFromClientX(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function handleKeyDown(event) {
    if (max <= 0) return;
    const step = Math.max(0.25, zoomSec * 0.1);
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(Math.max(0, windowStart - step));
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange(Math.min(max, windowStart + step));
    }
  }

  return (
    <div className="graph-scrollbar">
      <span>{formatTime(windowStart)}</span>
      <div
        ref={trackRef}
        className={`graph-scroll-track ${max <= 0 ? "disabled" : ""}`}
        role="slider"
        tabIndex={max <= 0 ? -1 : 0}
        aria-label="Pozycja okna wykresu"
        aria-valuemin={0}
        aria-valuemax={Number(max.toFixed(2))}
        aria-valuenow={Number(Math.min(windowStart, max).toFixed(2))}
        onPointerDown={startScrub}
        onKeyDown={handleKeyDown}
      >
        <span className="graph-scroll-thumb" style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }} />
      </div>
      <span>{formatTime(Math.min(duration, windowStart + zoomSec))}</span>
    </div>
  );
}

function PhraseList({ arrangement, selected, selectedContext, selectAndSeek, playTokenRange, commit, zoomToLine }) {
  const [insertIndex, setInsertIndex] = useState(null);
  const [insertText, setInsertText] = useState("");
  const trimmedInsertText = insertText.trim();

  function openInsert(index) {
    setInsertIndex(index);
    setInsertText("");
  }

  function submitInsert(event, index) {
    event.preventDefault();
    if (!trimmedInsertText) return;
    commit((draft) => insertLineAtBoundary(draft, index, trimmedInsertText));
    setInsertIndex(null);
    setInsertText("");
  }

  function cancelInsert() {
    setInsertIndex(null);
    setInsertText("");
  }

  function renderInsertControl(index) {
    return (
      <div className={`sentence-separator ${insertIndex === index ? "editing" : ""}`}>
        <span />
        {insertIndex === index ? (
          <form className="sentence-insert-form" onSubmit={(event) => submitInsert(event, index)}>
            <input autoFocus value={insertText} placeholder="Nowa sentencja" onChange={(event) => setInsertText(event.target.value)} />
            <button className="icon-button" type="submit" title="Wstaw sentencję" aria-label="Wstaw sentencję" disabled={!trimmedInsertText}><Plus size={16} /></button>
            <button className="button ghost" type="button" onClick={cancelInsert}>Anuluj</button>
          </form>
        ) : (
          <button className="icon-button sentence-add" type="button" title="Dodaj sentencję" aria-label="Dodaj sentencję" onClick={() => openInsert(index)}><Plus size={12} /></button>
        )}
        <span />
      </div>
    );
  }

  return (
    <div className="phrase-list">
      <div className="panel-heading">
        <strong>Sentencje</strong>
        <small>{arrangement.lines.length}</small>
      </div>
      {renderInsertControl(0)}
      {arrangement.lines.map((line, index) => (
        <React.Fragment key={line.lineId}>
          <article className={`phrase-row ${selectedContext.lineIds.includes(line.lineId) ? "selected" : ""}`}>
            <button type="button" onClick={() => selectAndSeek("line", line.lineId, line.startSec)} onDoubleClick={() => zoomToLine(line)}>
              <span>{formatTime(line.startSec)} - {formatTime(line.endSec)}</span>
              <strong>{lineText(arrangement, line) || "(pusta sentencja)"}</strong>
            </button>
            <textarea value={lineText(arrangement, line)} rows={2} onChange={(event) => commit((draft) => updateLineText(draft, line.lineId, event.target.value))} />
            <div className="token-list">
              {tokensForLine(arrangement, line).map((token) => (
                <button
                  key={token.tokenId}
                  className={`token-chip ${token.requiresReview ? "review" : ""} ${selectedContext.tokenIds.includes(token.tokenId) ? "selected" : ""}`}
                  type="button"
                  onClick={() => selectAndSeek("token", token.tokenId, token.startSec)}
                  onDoubleClick={() => playTokenRange(token)}
                >
                  {token.text || "..." }
                </button>
              ))}
            </div>
          </article>
          {renderInsertControl(index + 1)}
        </React.Fragment>
      ))}
    </div>
  );
}

function PropertiesPanel({ arrangement, selected, selectAndSeek, selectedLine, selectedToken, selectedNote, commit, onSplitLine }) {
  if (!selectedLine) {
    return <div className="properties-panel"><div className="panel-heading"><strong>Właściwości</strong></div></div>;
  }
  const heading = selected.type === "token" ? "Sylaba/wyraz" : selected.type === "note" ? "Nuta" : "Sentencja";

  return (
    <div className="properties-panel">
      <div className="panel-heading">
        <strong>{heading}</strong>
      </div>

      {selected.type === "line" && (
        <div className="property-stack">
          <TextField label="Start frazy" type="number" value={selectedLine.startSec} onChange={(value) => commit((draft) => updateLine(draft, selectedLine.lineId, { startSec: Number(value) }))} />
          <TextField label="Koniec frazy" type="number" value={selectedLine.endSec} onChange={(value) => commit((draft) => updateLine(draft, selectedLine.lineId, { endSec: Number(value) }))} />
          <div className="property-actions">
            <button className="button secondary" type="button" onClick={onSplitLine}><Scissors size={16} /> podziel</button>
            <button className="button secondary" type="button" onClick={() => commit((draft) => mergeLineWithNext(draft, selectedLine.lineId))}><Merge size={16} /> scal</button>
          </div>
          <QualityFlags flags={selectedLine.qualityFlags} />
        </div>
      )}

      {selected.type === "token" && selectedToken && (
        <div className="property-stack">
          <TextField label="Sylaba / słowo" value={selectedToken.text} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { text: value || "~", isExtension: false, extendsTokenId: null }))} />
          <TextField label="Start" type="number" value={selectedToken.startSec} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { startSec: Number(value) }))} />
          <TextField label="Koniec" type="number" value={selectedToken.endSec} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { endSec: Number(value) }))} />
          <Select label="Typ nuty" value={selectedToken.noteType} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { noteType: value }))} options={NOTE_TYPES} />
          <div className="property-actions">
            <button className="button secondary" type="button" onClick={() => commit((draft) => splitToken(draft, selectedToken.tokenId))}><Scissors size={16} /> Podziel</button>
            <button className="button secondary" type="button" onClick={() => commit((draft) => mergeTokenWithNext(draft, selectedToken.tokenId))}><Merge size={16} /> Scal</button>
            <button className="button ghost danger" type="button" onClick={() => commit((draft) => deleteToken(draft, selectedToken.tokenId))}><Trash2 size={16} /> Usuń</button>
          </div>
          <QualityFlags flags={selectedToken.qualityFlags} />
          {selectedNote && <button className="button ghost" type="button" onClick={() => selectAndSeek("note", selectedNote.noteId, selectedNote.startSec)}><Music2 size={16} /> Pokaż nutę</button>}
        </div>
      )}

      {selected.type === "note" && selectedNote && (
        <div className="property-stack">
          <TextField label="Start nuty" type="number" value={selectedNote.startSec} onChange={(value) => commit((draft) => updateNote(draft, selectedNote.noteId, { startSec: Number(value) }))} />
          <TextField label="Koniec nuty" type="number" value={selectedNote.endSec} onChange={(value) => commit((draft) => updateNote(draft, selectedNote.noteId, { endSec: Number(value) }))} />
          <TextField label="MIDI" type="number" step="1" value={selectedNote.midi} onChange={(value) => commit((draft) => updateNoteMidi(draft, selectedNote.noteId, value))} />
          <div className="property-actions compact-actions">
            <button className="icon-button" type="button" title="Pitch w dół" aria-label="Pitch w dół" onClick={() => commit((draft) => updateNotePitch(draft, selectedNote.noteId, -1))}><Minus size={16} /></button>
            <button className="icon-button" type="button" title="Pitch w górę" aria-label="Pitch w górę" onClick={() => commit((draft) => updateNotePitch(draft, selectedNote.noteId, 1))}><Plus size={16} /></button>
            <button className="button secondary" type="button" onClick={() => commit((draft) => splitNote(draft, selectedNote.noteId))}><Scissors size={16} /> Podziel</button>
            <button className="button secondary" type="button" onClick={() => commit((draft) => mergeNoteWithNext(draft, selectedNote.noteId))}><Merge size={16} /> Scal</button>
          </div>
          <QualityFlags flags={selectedNote.qualityFlags} />
        </div>
      )}
    </div>
  );
}

function QualityFlags({ flags = [] }) {
  if (!flags.length) return <span className="quality-badge ok">Bez flag jakości</span>;
  return <div className="flag-list">{flags.map((flag) => <span key={flag} className="quality-badge warning">{FLAG_LABELS[flag] ?? flag}</span>)}</div>;
}

function TextField({ label, helper, value, onChange, type = "text", placeholder = "", step }) {
  return <label className="field"><FieldLabel label={label} />{helper && <small>{helper}</small>}<input type={type} value={value} step={step ?? (type === "number" ? "0.01" : undefined)} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options, tooltip }) {
  return <label className="field"><FieldLabel label={label} tooltip={tooltip} /><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function FieldLabel({ label, tooltip }) {
  return (
    <span className="field-label">
      <span>{label}</span>
      {tooltip && <InfoTooltip text={tooltip} />}
    </span>
  );
}

function InfoTooltip({ text }) {
  return (
    <button className="info-tooltip" type="button" aria-label={text} onClick={(event) => event.preventDefault()}>
      <Info size={14} />
      <span role="tooltip">{text}</span>
    </button>
  );
}

function AudioSummary({ audio, filename }) {
  return <dl className="summary"><dt>Plik</dt><dd>{filename}</dd><dt>Format</dt><dd>{audio.container ?? "-"}</dd><dt>Kodek</dt><dd>{audio.codec ?? "-"}</dd><dt>Kanały</dt><dd>{audio.channels ?? "-"}</dd><dt>Hz</dt><dd>{audio.sampleRate ?? "-"}</dd><dt>Czas</dt><dd>{audio.durationSec ? `${audio.durationSec.toFixed(2)} s` : "-"}</dd></dl>;
}

function MetadataSummary({ metadata, profiles, transcriptionSettings, pitchSettings, syllabificationSettings }) {
  const transcription = { ...defaultTranscription, ...(transcriptionSettings ?? {}) };
  const pitch = { ...defaultPitch, ...(pitchSettings ?? {}) };
  const syllabification = { ...defaultSyllabification, ...(syllabificationSettings ?? {}) };

  return (
    <dl className="summary">
      <dt>Tytuł</dt><dd>{metadata.title || "-"}</dd>
      <dt>Artysta</dt><dd>{metadata.artist || "-"}</dd>
      <dt>Album</dt><dd>{metadata.album || "-"}</dd>
      <dt>Rok</dt><dd>{metadata.year || "-"}</dd>
      <dt>Gatunek</dt><dd>{metadata.genre || "-"}</dd>
      <dt>Język</dt><dd>{metadata.language || "auto"}</dd>
      <dt>Separacja</dt><dd>{profiles?.separationModel ?? "-"}</dd>
      <dt>Transkrypcja</dt><dd>{profiles?.transcriptionModel ?? "-"}</dd>
      <dt>Wykrywanie mowy</dt><dd>{transcription.vadMethod}</dd>
      {TRANSCRIPTION_SETTING_FIELDS.map(([key, field]) => (
        <React.Fragment key={`transcription-${key}`}>
          <dt>{field.label}</dt><dd>{formatSettingValue(transcription[key])}</dd>
        </React.Fragment>
      ))}
      {PITCH_SETTING_FIELDS.map(([key, field]) => (
        <React.Fragment key={`pitch-${key}`}>
          <dt>{field.label}</dt><dd>{formatSettingValue(pitch[key])}</dd>
        </React.Fragment>
      ))}
      <dt>Sylabizacja</dt><dd>{SYLLABIFICATION_SELECT_LABELS[syllabification.method] ?? syllabification.method}</dd>
    </dl>
  );
}

function StageRail({ job }) {
  const stages = job?.processing ? sortedStages(job.processing) : defaultStages();
  return <div className="stage-list">{stages.map((stage) => <div key={`${stage.stage}.${stage.substep}`} className={`stage ${stage.status}`}><span /> <div><strong>{stageLabel(stage)}</strong><small>{stage.status}</small></div></div>)}</div>;
}

function StatusPanel({ job }) {
  const rowRefs = useRef({});
  const artifactsById = Object.fromEntries((job.artifacts ?? []).map((asset) => [asset.assetId, asset]));
  const stages = sortedStages(job.processing).filter((stage) => stage.status !== "pending");
  const runningKey = stageDomKey(stages.find((stage) => stage.status === "running"));

  useEffect(() => {
    if (!runningKey || !rowRefs.current[runningKey]) return;
    rowRefs.current[runningKey].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [runningKey]);

  return <div className="status-panel">{stages.map((stage) => {
    const key = stageDomKey(stage);
    const artifactIds = displayArtifactIdsForStage(stage, job, artifactsById);
    return <article key={key} ref={(node) => { if (node) rowRefs.current[key] = node; }} className={`status-row ${stage.status}`}><div><strong>{stageLabel(stage)}</strong><small>{stage.workerRole}</small>{stage.logExcerpt && <pre>{stage.logExcerpt}</pre>}</div><div className="status-actions"><Progress stage={stage} /><div className="artifact-buttons">{artifactIds.map((assetId) => {
      const asset = artifactsById[assetId];
      const filename = artifactFilename(asset, assetId);
      return <a className="icon-button" key={assetId} href={`${API_BASE}/api/jobs/${job.jobId}/artifacts/${assetId}`} title={filename} aria-label={filename} download><Download size={16} /></a>;
    })}</div></div></article>;
  })}</div>;
}

function formatSettingValue(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return String(value);
}

function Progress({ stage }) {
  const width = stage.progressPercent ?? (stage.status === "completed" ? 100 : 35);
  return <div className={`progress ${stage.progressMode} ${stage.status}`}><span style={{ width: `${width}%` }} /></div>;
}

function updateLineText(draft, lineId, text) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (!line) return draft;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lineTokens = tokensForLine(draft, line);
  if (!lineTokens.length) return draft;
  if (!words.length) {
    lineTokens.forEach((token) => {
      token.text = "~";
      token.isExtension = false;
      token.extendsTokenId = null;
      token.requiresReview = true;
      token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])];
    });
    return draft;
  }
  words.forEach((word, index) => {
    let token = lineTokens[index];
    if (!token) {
      token = makeToken(line, index, word);
      draft.tokens.push(token);
      line.tokenIds.push(token.tokenId);
    }
    token.text = word;
    token.isExtension = false;
    token.extendsTokenId = null;
  });
  lineTokens.slice(words.length).forEach((token) => {
    token.text = "~";
    token.isExtension = false;
    token.extendsTokenId = null;
    token.requiresReview = true;
    token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])];
  });
  return draft;
}

function updateLine(draft, lineId, changes) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (line) Object.assign(line, cleanTiming(changes, line));
  return draft;
}

function updateToken(draft, tokenId, changes) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (!token) return draft;
  const cleaned = cleanTiming(changes, token);
  Object.assign(token, cleaned);
  syncLinkedNoteFromToken(draft, token, cleaned);
  return draft;
}

function updateNote(draft, noteId, changes) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note) return draft;
  const cleaned = cleanTiming(changes, note);
  Object.assign(note, cleaned);
  syncLinkedTokensFromNote(draft, note, cleaned);
  return draft;
}

function updateGraphItem(draft, kind, id, mode, deltaSec, deltaMidi = 0, options = {}) {
  if (kind === "note") return updateNoteGraphItem(draft, id, mode, deltaSec, deltaMidi, options);
  return updateTokenGraphItem(draft, id, mode, deltaSec, deltaMidi, options);
}

function updateTokenGraphItem(draft, tokenId, mode, deltaSec, deltaMidi = 0, options = {}) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (!token || !Number.isFinite(deltaSec)) return draft;
  const minLength = 0.02;
  const originalStart = token.startSec;
  const originalEnd = token.endSec;
  const exclude = { tokenId, noteId: token.noteId };
  if (mode === "resize-start") {
    const nextStart = Math.max(0, Math.min(originalEnd - minLength, originalStart + deltaSec));
    const snappedStart = options.snapToExisting ? snapTimeEdge(draft, nextStart, exclude) : nextStart;
    token.startSec = roundTime(Math.max(0, Math.min(originalEnd - minLength, snappedStart)));
    syncLinkedNoteFromToken(draft, token, { startSec: token.startSec, endSec: token.endSec });
  } else if (mode === "resize-end") {
    const nextEnd = Math.max(originalStart + minLength, originalEnd + deltaSec);
    const snappedEnd = options.snapToExisting ? snapTimeEdge(draft, nextEnd, exclude) : nextEnd;
    token.endSec = roundTime(Math.max(originalStart + minLength, snappedEnd));
    syncLinkedNoteFromToken(draft, token, { startSec: token.startSec, endSec: token.endSec });
  } else {
    const length = Math.max(originalEnd - originalStart, minLength);
    const proposedStart = Math.max(0, originalStart + deltaSec);
    const nextStart = options.snapToExisting ? snapTimeRangeStart(draft, proposedStart, proposedStart + length, exclude) : proposedStart;
    token.startSec = roundTime(Math.max(0, nextStart));
    token.endSec = roundTime(token.startSec + length);
    syncLinkedNoteFromToken(draft, token, { startSec: token.startSec, endSec: token.endSec });
    if (Number.isFinite(deltaMidi) && Math.abs(deltaMidi) >= 0.5) {
      const noteById = new Map(draft.noteEvents.map((note) => [note.noteId, note]));
      const baseMidi = tokenAssignedMidi(token, noteById) ?? visualMidiForToken(draft, token, noteById);
      setTokenMidi(draft, token, snapMidi(draft, baseMidi + Math.round(deltaMidi), exclude, options));
    }
  }
  return draft;
}

function updateNoteGraphItem(draft, noteId, mode, deltaSec, deltaMidi = 0, options = {}) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note || !Number.isFinite(deltaSec)) return draft;
  const minLength = 0.02;
  const originalStart = note.startSec;
  const originalEnd = note.endSec;
  const exclude = { noteId };
  if (mode === "resize-start") {
    const nextStart = Math.max(0, Math.min(originalEnd - minLength, originalStart + deltaSec));
    const snappedStart = options.snapToExisting ? snapTimeEdge(draft, nextStart, exclude) : nextStart;
    note.startSec = roundTime(Math.max(0, Math.min(originalEnd - minLength, snappedStart)));
    syncLinkedTokensFromNote(draft, note, { startSec: note.startSec, endSec: note.endSec });
  } else if (mode === "resize-end") {
    const nextEnd = Math.max(originalStart + minLength, originalEnd + deltaSec);
    const snappedEnd = options.snapToExisting ? snapTimeEdge(draft, nextEnd, exclude) : nextEnd;
    note.endSec = roundTime(Math.max(originalStart + minLength, snappedEnd));
    syncLinkedTokensFromNote(draft, note, { startSec: note.startSec, endSec: note.endSec });
  } else {
    const length = Math.max(originalEnd - originalStart, minLength);
    const proposedStart = Math.max(0, originalStart + deltaSec);
    const nextStart = options.snapToExisting ? snapTimeRangeStart(draft, proposedStart, proposedStart + length, exclude) : proposedStart;
    note.startSec = roundTime(Math.max(0, nextStart));
    note.endSec = roundTime(note.startSec + length);
    syncLinkedTokensFromNote(draft, note, { startSec: note.startSec, endSec: note.endSec });
    if (Number.isFinite(deltaMidi) && Math.abs(deltaMidi) >= 0.5) {
      setNoteMidi(draft, note, snapMidi(draft, note.midi + Math.round(deltaMidi), exclude, options));
    }
  }
  return draft;
}

function updateNoteMidi(draft, noteId, value) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note) return draft;
  setNoteMidi(draft, note, Number(value));
  return draft;
}

function updateNotePitch(draft, noteId, delta) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note || !Number.isFinite(delta)) return draft;
  setNoteMidi(draft, note, note.midi + delta);
  return draft;
}

function setNoteMidi(draft, note, value) {
  if (!Number.isFinite(value)) return;
  note.midi = clampMidi(value);
  note.frequencyHz = midiToFrequency(note.midi);
  draft.tokens.filter((token) => token.noteId === note.noteId).forEach((token) => {
    token.midi = note.midi;
    clearMissingNoteFlag(token);
  });
}

function setTokenMidi(draft, token, value) {
  const midi = clampMidi(value);
  if (token.noteId) {
    const note = draft.noteEvents.find((item) => item.noteId === token.noteId);
    if (note) {
      setNoteMidi(draft, note, midi);
      clearMissingNoteFlag(token);
      return;
    }
  }
  const note = createManualNoteForToken(draft, token, midi);
  token.noteId = note.noteId;
  token.midi = note.midi;
  clearMissingNoteFlag(token);
}

function createManualNoteForToken(draft, token, midi) {
  const clampedMidi = clampMidi(midi);
  const note = {
    noteId: nextId("note", draft.noteEvents),
    startSec: roundTime(token.startSec),
    endSec: roundTime(Math.max(token.startSec + 0.02, token.endSec)),
    midi: clampedMidi,
    frequencyHz: midiToFrequency(clampedMidi),
    confidence: null,
    source: "manual",
    requiresReview: false,
    qualityFlags: [],
  };
  draft.noteEvents.push(note);
  return note;
}

function syncLinkedNoteFromToken(draft, token, changes) {
  if (!token.noteId) return;
  const note = draft.noteEvents.find((item) => item.noteId === token.noteId);
  if (!note) return;
  if ("startSec" in changes || "endSec" in changes) {
    note.startSec = roundTime(token.startSec);
    note.endSec = roundTime(Math.max(note.startSec + 0.02, token.endSec));
  }
  if ("midi" in changes && Number.isFinite(token.midi)) setNoteMidi(draft, note, token.midi);
}

function syncLinkedTokensFromNote(draft, note, changes) {
  draft.tokens.filter((token) => token.noteId === note.noteId).forEach((token) => {
    if ("startSec" in changes || "endSec" in changes) {
      token.startSec = roundTime(note.startSec);
      token.endSec = roundTime(Math.max(token.startSec + 0.02, note.endSec));
    }
    if ("midi" in changes || Number.isFinite(note.midi)) token.midi = note.midi;
    clearMissingNoteFlag(token);
  });
}

function snapTimeEdge(draft, value, exclude = {}) {
  const candidates = collectTimeSnapCandidates(draft, exclude);
  if (!candidates.length) return value;
  const nearest = candidates.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), candidates[0]);
  return Math.abs(nearest - value) <= SNAP_TIME_SEC ? nearest : value;
}

function snapTimeRangeStart(draft, start, end, exclude = {}) {
  const candidates = collectTimeSnapCandidates(draft, exclude);
  if (!candidates.length) return start;
  const startSnap = nearestSnapDelta(candidates, start, SNAP_TIME_SEC);
  const endSnap = nearestSnapDelta(candidates, end, SNAP_TIME_SEC);
  if (startSnap == null && endSnap == null) return start;
  if (startSnap == null) return start + endSnap;
  if (endSnap == null) return start + startSnap;
  return Math.abs(startSnap) <= Math.abs(endSnap) ? start + startSnap : start + endSnap;
}

function snapMidi(draft, value, exclude = {}, options = {}) {
  const rounded = clampMidi(value);
  if (!options.snapToExisting) return rounded;
  const candidates = collectMidiSnapCandidates(draft, exclude);
  if (!candidates.length) return rounded;
  const nearest = candidates.reduce((best, candidate) => (Math.abs(candidate - rounded) < Math.abs(best - rounded) ? candidate : best), candidates[0]);
  return Math.abs(nearest - rounded) <= SNAP_MIDI ? clampMidi(nearest) : rounded;
}

function nearestSnapDelta(candidates, value, threshold) {
  const nearest = candidates.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), candidates[0]);
  const delta = nearest - value;
  return Math.abs(delta) <= threshold ? delta : null;
}

function canSplitLineAtTime(arrangement, line, splitSec) {
  const splitTime = Number(splitSec);
  if (!arrangement || !line || !Number.isFinite(splitTime) || splitTime <= line.startSec || splitTime >= line.endSec) return false;
  let hasLeft = false;
  let hasRight = false;
  for (const token of tokensForLine(arrangement, line)) {
    if (token.startSec < splitTime && token.endSec > splitTime) return (token.text ?? "").length >= 2 || Boolean(token.noteId);
    if (token.endSec <= splitTime) hasLeft = true;
    if (token.startSec >= splitTime) hasRight = true;
  }
  return hasLeft && hasRight;
}

function collectTimeSnapCandidates(draft, exclude = {}) {
  const candidates = [];
  draft.tokens.forEach((token) => {
    if (token.tokenId === exclude.tokenId) return;
    candidates.push(token.startSec, token.endSec);
  });
  draft.noteEvents.forEach((note) => {
    if (note.noteId === exclude.noteId) return;
    candidates.push(note.startSec, note.endSec);
  });
  draft.lines.forEach((line) => {
    if (line.lineId === exclude.lineId) return;
    candidates.push(line.startSec, line.endSec);
  });
  return candidates.filter(Number.isFinite);
}

function collectMidiSnapCandidates(draft, exclude = {}) {
  const candidates = [];
  draft.noteEvents.forEach((note) => {
    if (note.noteId !== exclude.noteId && Number.isFinite(note.midi)) candidates.push(note.midi);
  });
  draft.tokens.forEach((token) => {
    if (token.tokenId !== exclude.tokenId && Number.isFinite(token.midi)) candidates.push(token.midi);
  });
  return candidates;
}

function splitLine(draft, lineId, splitSec) {
  const index = draft.lines.findIndex((line) => line.lineId === lineId);
  if (index === -1) return draft;
  const line = draft.lines[index];
  const splitTime = roundTime(Number(splitSec));
  if (!Number.isFinite(splitTime) || splitTime <= line.startSec || splitTime >= line.endSec) return draft;
  if (!canSplitLineAtTime(draft, line, splitTime)) return draft;
  const leftTokens = [];
  const rightTokens = [];
  for (const tokenId of line.tokenIds) {
    const token = draft.tokens.find((item) => item.tokenId === tokenId);
    if (!token) continue;
    if (token.endSec <= splitTime) {
      leftTokens.push(token.tokenId);
    } else if (token.startSec >= splitTime) {
      rightTokens.push(token.tokenId);
    } else {
      const nextTokenId = splitTokenAtTime(draft, token, splitTime);
      if (!nextTokenId) return draft;
      leftTokens.push(token.tokenId);
      if (nextTokenId) rightTokens.push(nextTokenId);
    }
  }
  if (!leftTokens.length || !rightTokens.length) return draft;
  const originalEnd = line.endSec;
  line.endSec = splitTime;
  line.tokenIds = leftTokens;
  draft.lines.splice(index + 1, 0, { ...line, lineId: nextId("line", draft.lines), startSec: splitTime, endSec: Math.max(splitTime + 0.01, originalEnd), tokenIds: rightTokens });
  return draft;
}

function splitTokenAtTime(draft, token, splitTime) {
  if (!token || splitTime <= token.startSec || splitTime >= token.endSec) return null;
  const originalEnd = token.endSec;
  const linkedNote = token.noteId ? draft.noteEvents.find((note) => note.noteId === token.noteId) : null;
  const nextTokenId = nextId("tok", draft.tokens);
  const [leftText, rightText] = splitTokenTextAtTime(token, splitTime);
  let nextNoteId = null;
  const tokenSplitTime = splitTimeForRange(token.startSec, token.endSec, splitTime);
  token.text = leftText || "~";
  token.endSec = tokenSplitTime;
  token.isExtension = false;
  token.extendsTokenId = null;
  if (linkedNote && linkedNote.endSec - linkedNote.startSec > MIN_TOKEN_NOTE_SEC) {
    const noteSplitTime = splitTimeForRange(linkedNote.startSec, linkedNote.endSec, splitTime);
    const originalNoteEnd = linkedNote.endSec;
    nextNoteId = nextId("note", draft.noteEvents);
    linkedNote.endSec = noteSplitTime;
    draft.noteEvents.push({
      ...linkedNote,
      noteId: nextNoteId,
      startSec: noteSplitTime,
      endSec: Math.max(noteSplitTime + MIN_TOKEN_NOTE_SEC, originalNoteEnd),
      requiresReview: true,
      qualityFlags: [...new Set([...(linkedNote.qualityFlags ?? []), "needs_syllable_review"])],
    });
  }
  const next = {
    ...token,
    tokenId: nextTokenId,
    text: rightText || "~",
    startSec: tokenSplitTime,
    endSec: Math.max(tokenSplitTime + MIN_TOKEN_NOTE_SEC, originalEnd),
    noteId: nextNoteId,
    midi: nextNoteId ? linkedNote?.midi ?? token.midi : null,
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: [...new Set([...(token.qualityFlags ?? []), nextNoteId ? "needs_syllable_review" : "missing_note", "needs_syllable_review"])],
  };
  draft.tokens.push(next);
  return next.tokenId;
}

function splitTokenTextAtTime(token, splitTime) {
  const text = token.text ?? "";
  if (text.length < 2) return [text || "~", "~"];
  const ratio = Math.max(0, Math.min(1, (splitTime - token.startSec) / Math.max(token.endSec - token.startSec, 0.001)));
  const splitAt = Math.max(1, Math.min(text.length - 1, Math.round(text.length * ratio)));
  return [text.slice(0, splitAt), text.slice(splitAt)];
}

function mergeLineWithNext(draft, lineId) {
  const index = draft.lines.findIndex((line) => line.lineId === lineId);
  if (index === -1 || index >= draft.lines.length - 1) return draft;
  const line = draft.lines[index];
  const next = draft.lines[index + 1];
  line.endSec = Math.max(line.endSec, next.endSec);
  line.tokenIds = [...line.tokenIds, ...next.tokenIds];
  line.qualityFlags = [...new Set([...(line.qualityFlags ?? []), ...(next.qualityFlags ?? [])])];
  draft.lines.splice(index + 1, 1);
  return draft;
}

function insertLineAtBoundary(draft, insertIndex, text) {
  const trimmed = text.trim();
  if (!trimmed) return draft;
  const lines = [...draft.lines].sort((left, right) => left.startSec - right.startSec);
  const safeIndex = Math.max(0, Math.min(Number(insertIndex), lines.length));
  const previous = lines[safeIndex - 1] ?? null;
  const next = lines[safeIndex] ?? null;
  const timing = insertedLineTiming(previous, next);
  const lineId = nextId("line", draft.lines);
  const tokenId = nextId("tok", draft.tokens);
  draft.tokens.push({
    tokenId,
    text: trimmed,
    wordId: null,
    syllableIndex: 0,
    noteId: null,
    startSec: timing.startSec,
    endSec: timing.endSec,
    midi: null,
    noteType: "normal",
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: ["missing_note", "needs_syllable_review"],
  });
  draft.lines.push({
    lineId,
    startSec: timing.startSec,
    endSec: timing.endSec,
    tokenIds: [tokenId],
    requiresReview: true,
    qualityFlags: ["contains_review_items"],
  });
  return draft;
}

function insertedLineTiming(previous, next) {
  if (previous && next) {
    const gapStart = Math.max(0, previous.endSec);
    const gapEnd = Math.max(gapStart, next.startSec);
    const gap = gapEnd - gapStart;
    if (gap >= 0.08) {
      const length = Math.max(0.02, Math.min(INSERTED_SENTENCE_LENGTH_SEC, gap));
      return { startSec: roundTime(gapStart), endSec: roundTime(gapStart + length) };
    }
    return { startSec: roundTime(gapStart), endSec: roundTime(gapStart + INSERTED_SENTENCE_LENGTH_SEC) };
  }
  if (previous) {
    const startSec = Math.max(0, previous.endSec);
    return { startSec: roundTime(startSec), endSec: roundTime(startSec + INSERTED_SENTENCE_LENGTH_SEC) };
  }
  if (next) {
    const endSec = Math.max(INSERTED_SENTENCE_LENGTH_SEC, next.startSec);
    const startSec = Math.max(0, endSec - INSERTED_SENTENCE_LENGTH_SEC);
    return { startSec: roundTime(startSec), endSec: roundTime(Math.max(startSec + 0.02, endSec)) };
  }
  return { startSec: 0, endSec: INSERTED_SENTENCE_LENGTH_SEC };
}

function splitToken(draft, tokenId) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  const line = draft.lines.find((item) => item.tokenIds.includes(tokenId));
  if (!token || !line) return draft;
  const tokenIndex = line.tokenIds.indexOf(tokenId);
  const splitAt = Math.max(1, Math.ceil((token.text || "").length / 2));
  const leftText = (token.text || "~").slice(0, splitAt) || "~";
  const rightText = (token.text || "").slice(splitAt) || "~";
  const midpoint = splitTimeForRange(token.startSec, token.endSec, token.startSec + (token.endSec - token.startSec) / 2);
  const originalEnd = token.endSec;
  const linkedNote = token.noteId ? draft.noteEvents.find((note) => note.noteId === token.noteId) : null;
  let nextNoteId = null;
  token.text = leftText;
  token.endSec = midpoint;
  token.isExtension = false;
  token.extendsTokenId = null;
  if (linkedNote && linkedNote.endSec - linkedNote.startSec > MIN_TOKEN_NOTE_SEC) {
    const noteMidpoint = splitTimeForRange(linkedNote.startSec, linkedNote.endSec, midpoint);
    const originalNoteEnd = linkedNote.endSec;
    nextNoteId = nextId("note", draft.noteEvents);
    linkedNote.endSec = noteMidpoint;
    draft.noteEvents.push({
      ...linkedNote,
      noteId: nextNoteId,
      startSec: noteMidpoint,
      endSec: Math.max(noteMidpoint + MIN_TOKEN_NOTE_SEC, originalNoteEnd),
      requiresReview: true,
      qualityFlags: [...new Set([...(linkedNote.qualityFlags ?? []), "needs_syllable_review"])],
    });
  }
  const next = {
    ...token,
    tokenId: nextId("tok", draft.tokens),
    text: rightText,
    startSec: midpoint,
    endSec: Math.max(midpoint + MIN_TOKEN_NOTE_SEC, originalEnd),
    noteId: nextNoteId,
    midi: nextNoteId ? token.midi : null,
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: [...new Set([...(token.qualityFlags ?? []), nextNoteId ? "needs_syllable_review" : "missing_note", "needs_syllable_review"])],
  };
  draft.tokens.push(next);
  line.tokenIds.splice(tokenIndex + 1, 0, next.tokenId);
  return draft;
}

function mergeTokenWithNext(draft, tokenId) {
  const line = draft.lines.find((item) => item.tokenIds.includes(tokenId));
  if (!line) return draft;
  const index = line.tokenIds.indexOf(tokenId);
  if (index === -1 || index >= line.tokenIds.length - 1) return draft;
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  const next = draft.tokens.find((item) => item.tokenId === line.tokenIds[index + 1]);
  if (!token || !next) return draft;
  token.text = `${token.text}${next.text ? ` ${next.text}` : ""}`.trim();
  token.endSec = Math.max(token.endSec, next.endSec);
  token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), ...(next.qualityFlags ?? [])])];
  if (token.noteId && next.noteId && token.noteId !== next.noteId) {
    mergeNotesById(draft, token.noteId, next.noteId);
  } else if (!token.noteId && next.noteId) {
    token.noteId = next.noteId;
    token.midi = next.midi;
  }
  if (token.noteId) {
    clearMissingNoteFlag(token);
    syncLinkedNoteFromToken(draft, token, { startSec: token.startSec, endSec: token.endSec, midi: token.midi });
  }
  line.tokenIds.splice(index + 1, 1);
  draft.tokens = draft.tokens.filter((item) => item.tokenId !== next.tokenId);
  return draft;
}

function insertTokenAfterSelection(draft, lineId, afterTokenId, text) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (!line || !text.trim()) return draft;
  const lineTokens = tokensForLine(draft, line).sort((left, right) => left.startSec - right.startSec);
  const afterIndex = afterTokenId ? lineTokens.findIndex((token) => token.tokenId === afterTokenId) : lineTokens.length - 1;
  const insertIndex = Math.max(0, afterIndex + 1);
  const previous = lineTokens[insertIndex - 1] ?? null;
  const next = lineTokens[insertIndex] ?? null;
  const fallbackLength = Math.max(previous ? previous.endSec - previous.startSec : 0.25, 0.2);
  const startSec = roundTime(previous ? previous.endSec : line.startSec);
  const boundedEnd = next ? Math.min(next.startSec, startSec + Math.max((next.startSec - startSec) / 2, 0.02)) : startSec + fallbackLength;
  const token = {
    tokenId: nextId("tok", draft.tokens),
    text: text.trim(),
    wordId: null,
    syllableIndex: insertIndex,
    noteId: null,
    startSec,
    endSec: roundTime(Math.max(startSec + 0.02, boundedEnd)),
    midi: null,
    noteType: "normal",
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: ["missing_note"],
  };
  draft.tokens.push(token);
  if (afterTokenId && line.tokenIds.includes(afterTokenId)) {
    line.tokenIds.splice(line.tokenIds.indexOf(afterTokenId) + 1, 0, token.tokenId);
  } else {
    line.tokenIds.push(token.tokenId);
  }
  tokensForLine(draft, line).forEach((item, index) => {
    item.syllableIndex = index;
  });
  return draft;
}

function deleteToken(draft, tokenId) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (!token) return draft;
  draft.lines.forEach((line) => {
    line.tokenIds = line.tokenIds.filter((item) => item !== tokenId);
  });
  if (token.noteId) {
    const note = draft.noteEvents.find((item) => item.noteId === token.noteId);
    if (note) {
      note.requiresReview = true;
      note.qualityFlags = [...new Set([...(note.qualityFlags ?? []), "unassigned_note"])];
    }
  }
  draft.tokens = draft.tokens.filter((item) => item.tokenId !== tokenId);
  draft.lines = draft.lines.filter((line) => line.tokenIds.length > 0);
  return draft;
}

function splitNote(draft, noteId) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note) return draft;
  const midpoint = splitTimeForRange(note.startSec, note.endSec, note.startSec + (note.endSec - note.startSec) / 2);
  const originalEnd = note.endSec;
  const nextNoteId = nextId("note", draft.noteEvents);
  const linkedToken = draft.tokens.find((token) => token.noteId === noteId);
  note.endSec = midpoint;
  const nextNote = {
    ...note,
    noteId: nextNoteId,
    startSec: midpoint,
    endSec: Math.max(midpoint + MIN_TOKEN_NOTE_SEC, originalEnd),
    requiresReview: true,
    qualityFlags: [...new Set([...(note.qualityFlags ?? []), linkedToken ? "needs_syllable_review" : "unassigned_note"])],
  };
  draft.noteEvents.push(nextNote);
  if (linkedToken) {
    const line = draft.lines.find((item) => item.tokenIds.includes(linkedToken.tokenId));
    const tokenIndex = line ? line.tokenIds.indexOf(linkedToken.tokenId) : -1;
    linkedToken.startSec = roundTime(note.startSec);
    linkedToken.endSec = roundTime(midpoint);
    linkedToken.midi = note.midi;
    linkedToken.isExtension = false;
    linkedToken.extendsTokenId = null;
    linkedToken.qualityFlags = [...new Set([...(linkedToken.qualityFlags ?? []), "needs_syllable_review"])];
    linkedToken.requiresReview = true;
    const nextToken = {
      ...linkedToken,
      tokenId: nextId("tok", draft.tokens),
      text: "~",
      noteId: nextNoteId,
      startSec: roundTime(midpoint),
      endSec: roundTime(Math.max(midpoint + MIN_TOKEN_NOTE_SEC, originalEnd)),
      midi: nextNote.midi,
      isExtension: false,
      extendsTokenId: null,
      requiresReview: true,
      qualityFlags: [...new Set([...(linkedToken.qualityFlags ?? []), "needs_syllable_review"])],
    };
    draft.tokens.push(nextToken);
    if (line && tokenIndex !== -1) line.tokenIds.splice(tokenIndex + 1, 0, nextToken.tokenId);
  }
  return draft;
}

function mergeNoteWithNext(draft, noteId) {
  const sorted = [...draft.noteEvents].sort((left, right) => left.startSec - right.startSec);
  const index = sorted.findIndex((note) => note.noteId === noteId);
  if (index === -1 || index >= sorted.length - 1) return draft;
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  const next = sorted[index + 1];
  if (!note) return draft;
  note.endSec = Math.max(note.endSec, next.endSec);
  note.midi = Math.round((note.midi + next.midi) / 2);
  note.frequencyHz = midiToFrequency(note.midi);
  note.qualityFlags = [...new Set([...(note.qualityFlags ?? []), ...(next.qualityFlags ?? [])])];
  draft.tokens.filter((token) => token.noteId === next.noteId).forEach((token) => {
    token.noteId = note.noteId;
    token.midi = note.midi;
  });
  draft.noteEvents = draft.noteEvents.filter((item) => item.noteId !== next.noteId);
  return draft;
}

function mergeNotesById(draft, targetNoteId, sourceNoteId) {
  const target = draft.noteEvents.find((note) => note.noteId === targetNoteId);
  const source = draft.noteEvents.find((note) => note.noteId === sourceNoteId);
  if (!target || !source) return draft;
  target.startSec = Math.min(target.startSec, source.startSec);
  target.endSec = Math.max(target.endSec, source.endSec);
  target.midi = Math.round((target.midi + source.midi) / 2);
  target.frequencyHz = midiToFrequency(target.midi);
  target.qualityFlags = [...new Set([...(target.qualityFlags ?? []), ...(source.qualityFlags ?? [])])];
  draft.tokens.filter((token) => token.noteId === sourceNoteId).forEach((token) => {
    token.noteId = targetNoteId;
    token.midi = target.midi;
  });
  draft.noteEvents = draft.noteEvents.filter((note) => note.noteId !== sourceNoteId);
  return draft;
}

function normalizeArrangement(arrangement) {
  normalizeTokenTexts(arrangement);
  ensureUniqueNoteAssignments(arrangement);
  syncAssignmentQualityFlags(arrangement);
  arrangement.lines.forEach((line) => {
    const tokens = tokensForLine(arrangement, line);
    if (!tokens.length) return;
    line.startSec = roundTime(Math.min(...tokens.map((token) => token.startSec)));
    line.endSec = roundTime(Math.max(...tokens.map((token) => token.endSec)));
  });
  arrangement.lines.sort((left, right) => left.startSec - right.startSec);
  arrangement.noteEvents.sort((left, right) => left.startSec - right.startSec);
  arrangement.updatedAt = new Date().toISOString();
  arrangement.qualitySummary = {
    tokensRequiringReview: arrangement.tokens.filter((token) => token.requiresReview).length,
    notesRequiringReview: arrangement.noteEvents.filter((note) => note.requiresReview).length,
    missingNoteTokens: arrangement.tokens.filter((token) => token.qualityFlags?.includes("missing_note")).length,
    unassignedNotes: arrangement.noteEvents.filter((note) => note.qualityFlags?.includes("unassigned_note")).length,
    uncertainPitchNotes: arrangement.noteEvents.filter((note) => note.qualityFlags?.includes("uncertain_pitch")).length,
  };
  return arrangement;
}

function normalizeTokenTexts(arrangement) {
  arrangement.tokens.forEach((token) => {
    if (token.text && token.isExtension) {
      token.isExtension = false;
      token.extendsTokenId = null;
    }
    if (!token.text && !token.isExtension) {
      token.text = "~";
      token.requiresReview = true;
      token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])];
    }
  });
}

function ensureUniqueNoteAssignments(arrangement) {
  const noteById = new Map(arrangement.noteEvents.map((note) => [note.noteId, note]));
  const tokensByNoteId = new Map();
  arrangement.tokens.forEach((token) => {
    if (!token.noteId) return;
    if (!noteById.has(token.noteId)) {
      token.noteId = null;
      token.midi = null;
      return;
    }
    const tokens = tokensByNoteId.get(token.noteId) ?? [];
    tokens.push(token);
    tokensByNoteId.set(token.noteId, tokens);
  });

  tokensByNoteId.forEach((tokens, noteId) => {
    if (tokens.length <= 1) return;
    const sourceNote = noteById.get(noteId);
    if (!sourceNote) return;
    const sortedTokens = [...tokens].sort((left, right) => left.startSec - right.startSec);
    sortedTokens.forEach((token, index) => {
      if (index === 0) {
        sourceNote.startSec = roundTime(token.startSec);
        sourceNote.endSec = roundTime(Math.max(token.startSec + MIN_TOKEN_NOTE_SEC, token.endSec));
        token.midi = sourceNote.midi;
        return;
      }
      const copiedNote = {
        ...sourceNote,
        noteId: nextId("note", arrangement.noteEvents),
        startSec: roundTime(token.startSec),
        endSec: roundTime(Math.max(token.startSec + MIN_TOKEN_NOTE_SEC, token.endSec)),
        requiresReview: true,
        qualityFlags: [...new Set([...(sourceNote.qualityFlags ?? []), "needs_syllable_review"])],
      };
      arrangement.noteEvents.push(copiedNote);
      noteById.set(copiedNote.noteId, copiedNote);
      token.noteId = copiedNote.noteId;
      token.midi = copiedNote.midi;
      token.isExtension = false;
      token.extendsTokenId = null;
      token.requiresReview = true;
      token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])];
    });
  });
}

function syncAssignmentQualityFlags(arrangement) {
  const assignedNoteIds = new Set(arrangement.tokens.map((token) => token.noteId).filter(Boolean));
  arrangement.tokens.forEach((token) => {
    if (token.noteId) {
      clearMissingNoteFlag(token);
      return;
    }
    if (!token.isExtension) {
      token.requiresReview = true;
      token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "missing_note"])];
    }
  });
  arrangement.noteEvents.forEach((note) => {
    if (assignedNoteIds.has(note.noteId)) {
      note.qualityFlags = withoutFlags(note.qualityFlags, ["unassigned_note"]);
      note.requiresReview = note.qualityFlags.length > 0;
      return;
    }
    note.requiresReview = true;
    note.qualityFlags = [...new Set([...(note.qualityFlags ?? []), "unassigned_note"])];
  });
}

function cleanTiming(changes, current) {
  const next = { ...changes };
  if ("startSec" in next && Number.isFinite(next.startSec)) next.startSec = roundTime(Math.max(0, Number(next.startSec)));
  if ("endSec" in next && Number.isFinite(next.endSec)) next.endSec = roundTime(Math.max((next.startSec ?? current.startSec) + 0.01, Number(next.endSec)));
  return next;
}

function graphItemStart(arrangement, kind, id) {
  const item = kind === "note" ? arrangement?.noteEvents.find((note) => note.noteId === id) : arrangement?.tokens.find((token) => token.tokenId === id);
  return item?.startSec ?? 0;
}

function pitchRangeForWindow(arrangement, visibleTokens, visibleNotes, noteById) {
  const midis = [
    ...visibleTokens.map((token) => visualMidiForToken(arrangement, token, noteById)),
    ...visibleNotes.map((note) => note.midi),
  ].filter(Number.isFinite);
  if (!midis.length) return { minMidi: 48, maxMidi: 72 };
  let minMidi = Math.min(...midis);
  let maxMidi = Math.max(...midis);
  if (maxMidi - minMidi < 6) {
    minMidi -= 3;
    maxMidi += 3;
  }
  minMidi = Math.max(MIN_EDITOR_MIDI, Math.floor(minMidi) - 2);
  maxMidi = Math.min(MAX_EDITOR_MIDI, Math.ceil(maxMidi) + 2);
  if (maxMidi <= minMidi) maxMidi = Math.min(MAX_EDITOR_MIDI, minMidi + 1);
  return { minMidi, maxMidi };
}

function pitchTopPercent(midi, minMidi, maxMidi) {
  const safeMidi = Number.isFinite(midi) ? midi : DEFAULT_TOKEN_MIDI;
  const range = Math.max(maxMidi - minMidi, 1);
  const normalized = Math.max(0, Math.min(1, (safeMidi - minMidi) / range));
  return PITCH_TOP_MAX_PCT - normalized * (PITCH_TOP_MAX_PCT - PITCH_TOP_MIN_PCT);
}

function tokenAssignedMidi(token, noteById) {
  const note = token.noteId ? noteById.get(token.noteId) : null;
  if (Number.isFinite(note?.midi)) return note.midi;
  if (Number.isFinite(token.midi)) return token.midi;
  return null;
}

function visualMidiForToken(arrangement, token, noteById) {
  const assignedMidi = tokenAssignedMidi(token, noteById);
  if (assignedMidi != null) return assignedMidi;
  const sortedTokens = [...arrangement.tokens].sort((left, right) => left.startSec - right.startSec);
  const index = sortedTokens.findIndex((item) => item.tokenId === token.tokenId);
  for (let offset = index - 1; offset >= 0; offset -= 1) {
    const midi = tokenAssignedMidi(sortedTokens[offset], noteById);
    if (midi != null) return midi;
  }
  for (let offset = index + 1; offset < sortedTokens.length; offset += 1) {
    const midi = tokenAssignedMidi(sortedTokens[offset], noteById);
    if (midi != null) return midi;
  }
  const previousNote = [...arrangement.noteEvents]
    .filter((note) => Number.isFinite(note.midi) && note.endSec <= token.startSec)
    .sort((left, right) => right.endSec - left.endSec)[0];
  if (previousNote) return previousNote.midi;
  const nextNote = [...arrangement.noteEvents]
    .filter((note) => Number.isFinite(note.midi) && note.startSec >= token.endSec)
    .sort((left, right) => left.startSec - right.startSec)[0];
  return nextNote?.midi ?? DEFAULT_TOKEN_MIDI;
}

function roundTime(value) {
  return Number(Math.max(0, value).toFixed(3));
}

function splitTimeForRange(startSec, endSec, preferredSec) {
  const start = Number(startSec);
  const end = Number(endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return roundTime((Number.isFinite(start) ? start : 0) + MIN_TOKEN_NOTE_SEC);
  const preferred = Number.isFinite(preferredSec) ? preferredSec : start + (end - start) / 2;
  if (end - start <= MIN_TOKEN_NOTE_SEC * 2) return roundTime(start + (end - start) / 2);
  return roundTime(Math.max(start + MIN_TOKEN_NOTE_SEC, Math.min(preferred, end - MIN_TOKEN_NOTE_SEC)));
}

function clampMidi(value) {
  return Math.max(MIN_EDITOR_MIDI, Math.min(MAX_EDITOR_MIDI, Math.round(value)));
}

function midiToFrequency(midi) {
  return Number((440 * 2 ** ((midi - 69) / 12)).toFixed(4));
}

function withoutFlags(flags = [], blocked = []) {
  return flags.filter((flag) => !blocked.includes(flag));
}

function clearMissingNoteFlag(token) {
  token.qualityFlags = withoutFlags(token.qualityFlags, ["missing_note"]);
  token.requiresReview = token.qualityFlags.length > 0;
}

function waveformPixelsPerSecond(container, zoomSec) {
  return Math.max(24, Math.round((container?.clientWidth || 900) / Math.max(zoomSec, 1)));
}

function SyllabificationBadge({ info }) {
  if (!info) {
    return <span className="quality-badge warning">Sylabizacja: brak danych</span>;
  }
  const requested = info.requestedMethod;
  const applied = info.appliedMethod;
  const warning = requested && applied && requested !== applied;
  const appliedLabel = syllabificationBadgeLabel(applied);
  const requestedLabel = syllabificationBadgeLabel(requested);
  const text = warning ? `Sylabizacja: ${appliedLabel} (wybrano ${requestedLabel})` : `Sylabizacja: ${appliedLabel}`;
  return <span className={`quality-badge ${warning ? "warning" : "ok"}`} title={info.fallbackReason ?? ""}>{text}</span>;
}

function syllabificationBadgeLabel(method) {
  return SYLLABIFICATION_BADGE_LABELS[method] ?? method ?? "brak danych";
}

function defaultSyllabificationForLanguage(language) {
  return { method: isPolishLanguage(language) ? "kokosznicka" : "pyphen" };
}

function isPolishLanguage(language) {
  const normalized = (language ?? "").trim().toLowerCase().replace("_", "-");
  return normalized === "pl" || normalized.startsWith("pl-");
}

function syncWaveformViewport(waveSurfer, container, startSec, zoomSec) {
  if (!waveSurfer || !container) return;
  if (typeof waveSurfer.setScrollTime === "function") {
    waveSurfer.setScrollTime(startSec);
    return;
  }
  const pixelsPerSecond = waveformPixelsPerSecond(container, zoomSec);
  const scrollTarget =
    container.querySelector("[part='scroll']") ??
    container.querySelector(".scroll") ??
    container.firstElementChild;
  if (scrollTarget && "scrollLeft" in scrollTarget) {
    scrollTarget.scrollLeft = startSec * pixelsPerSecond;
  }
}

function qualityBadges(arrangement) {
  const flags = ["uncertain_text", "uncertain_pitch", "missing_note", "unassigned_note", "too_short_note", "overlapping_line"];
  const counts = Object.fromEntries(flags.map((flag) => [flag, 0]));
  arrangement.tokens.forEach((token) => token.qualityFlags?.forEach((flag) => counts[flag] = (counts[flag] ?? 0) + 1));
  arrangement.noteEvents.forEach((note) => note.qualityFlags?.forEach((flag) => counts[flag] = (counts[flag] ?? 0) + 1));
  arrangement.noteEvents.forEach((note) => {
    if (note.endSec - note.startSec < 0.08) counts.too_short_note += 1;
  });
  arrangement.lines.forEach((line, index) => {
    const next = arrangement.lines[index + 1];
    if (next && line.endSec > next.startSec) counts.overlapping_line += 1;
  });
  return flags.map((flag) => [flag, counts[flag] ?? 0]);
}

function selectionContext(arrangement, selected) {
  if (!arrangement || !selected?.id) return { lineIds: [], tokenIds: [], noteIds: [] };
  const lineIds = new Set();
  const tokenIds = new Set();
  const noteIds = new Set();
  const addToken = (token) => {
    if (!token) return;
    tokenIds.add(token.tokenId);
    if (token.noteId) noteIds.add(token.noteId);
    arrangement.lines.filter((line) => line.tokenIds.includes(token.tokenId)).forEach((line) => lineIds.add(line.lineId));
  };
  const addNote = (note) => {
    if (!note) return;
    noteIds.add(note.noteId);
    arrangement.tokens
      .filter((token) => token.noteId === note.noteId || overlaps(token, note))
      .forEach(addToken);
  };

  if (selected.type === "line") {
    const line = arrangement.lines.find((item) => item.lineId === selected.id);
    if (line) {
      lineIds.add(line.lineId);
      tokensForLine(arrangement, line).forEach(addToken);
      arrangement.noteEvents.filter((note) => overlaps(line, note)).forEach(addNote);
    }
  }
  if (selected.type === "token") {
    const token = arrangement.tokens.find((item) => item.tokenId === selected.id);
    addToken(token);
    if (token) arrangement.noteEvents.filter((note) => token.noteId === note.noteId || overlaps(token, note)).forEach(addNote);
  }
  if (selected.type === "note") {
    const note = arrangement.noteEvents.find((item) => item.noteId === selected.id);
    addNote(note);
  }

  return { lineIds: [...lineIds], tokenIds: [...tokenIds], noteIds: [...noteIds] };
}

function overlaps(left, right) {
  return Math.min(left.endSec, right.endSec) - Math.max(left.startSec, right.startSec) > 0;
}

function currentStage(job) {
  if (!job?.processing) return null;
  const stages = sortedStages(job.processing);
  return stages.find((stage) => stage.status === "running") ?? stages.find((stage) => stage.status === "failed") ?? stages.find((stage) => stage.status === "pending") ?? stages.at(-1);
}

function defaultStages() {
  return [
    ["uploaded", "source", "Źródło"],
    ["preprocessing", "ffmpeg", "Preprocessing audio"],
    ["detecting_bpm", "essentia", "Rozpoznawanie BPM"],
    ["separating_vocals", "demucs", "Separacja wokalu"],
    ["transcribing", "whisperx", "Transkrypcja"],
    ["detecting_pitch", "pitch_detection", "Detekcja pitch"],
    ["aligning", "draft", "Wstępne dopasowanie"],
  ].map(([stage, substep, message], index) => ({ stage, substep, message, status: index === 0 ? "running" : "pending" }));
}

function sortedStages(processing) {
  return Object.values(processing).sort((left, right) => stageIndex(left) - stageIndex(right));
}

function stageIndex(stage) {
  const index = PIPELINE_ORDER.indexOf(`${stage.stage}.${stage.substep}`);
  return index === -1 ? PIPELINE_ORDER.length : index;
}

function stageLabel(stage) {
  return STAGE_LABELS[stageDomKey(stage)] ?? stage?.message ?? "";
}

function stageDomKey(stage) {
  return stage ? `${stage.stage}.${stage.substep}` : null;
}

function displayArtifactIdsForStage(stage, job, artifactsById) {
  const ownIds = stage.artifactIds ?? [];
  if (stageDomKey(stage) === "separating_vocals.demucs") {
    return ownIds.filter((assetId) => !PREPROCESSING_DISPLAY_ARTIFACT_TYPES.has(artifactsById[assetId]?.type));
  }
  if (stageDomKey(stage) !== "preprocessing.ffmpeg") {
    return ownIds;
  }
  const movedIds = (job.artifacts ?? [])
    .filter((asset) => PREPROCESSING_DISPLAY_ARTIFACT_TYPES.has(asset.type))
    .map((asset) => asset.assetId);
  return [...new Set([...ownIds, ...movedIds])];
}

function artifactFilename(asset, fallback) {
  if (!asset) return fallback;
  if (asset.originalFilename) return asset.originalFilename;
  if (asset.path) return asset.path.split("/").at(-1);
  return asset.type ?? fallback;
}

function tokensForLine(arrangement, line) {
  const byId = Object.fromEntries(arrangement.tokens.map((token) => [token.tokenId, token]));
  return line.tokenIds.map((tokenId) => byId[tokenId]).filter(Boolean);
}

function lineText(arrangement, line) {
  return tokensForLine(arrangement, line).map((token) => token.text).filter(Boolean).join(" ");
}

function makeToken(line, index, text) {
  const start = line.startSec + ((line.endSec - line.startSec) / Math.max(index + 2, 2)) * index;
  const end = Math.min(line.endSec, start + Math.max((line.endSec - line.startSec) / Math.max(index + 2, 2), 0.01));
  return {
    tokenId: `tok_client_${Date.now()}_${index}`,
    text,
    wordId: null,
    syllableIndex: index,
    noteId: null,
    startSec: start,
    endSec: Math.max(start + 0.01, end),
    midi: null,
    noteType: "normal",
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: ["missing_note"],
  };
}

function nextId(prefix, items) {
  const number = items.length + 1;
  return `${prefix}_${String(number).padStart(4, "0")}_${Date.now().toString(36)}`;
}

function arrangementDuration(arrangement) {
  if (!arrangement) return 0;
  return Math.max(0, ...arrangement.lines.map((line) => line.endSec), ...arrangement.noteEvents.map((note) => note.endSec));
}

function percent(value, start, end) {
  if (end <= start) return 0;
  return Math.max(0, Math.min(100, ((value - start) / (end - start)) * 100));
}

function spanPercent(start, end, windowStart, windowEnd) {
  const clippedStart = Math.max(start, windowStart);
  const clippedEnd = Math.min(end, windowEnd);
  return Math.max(0.5, percent(clippedEnd, windowStart, windowEnd) - percent(clippedStart, windowStart, windowEnd));
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00.00";
  const minutes = Math.floor(value / 60);
  const seconds = (value % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function apiForm(path, form) {
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  return parseResponse(response);
}

async function apiJson(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, init);
  return parseResponse(response);
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

createRoot(document.getElementById("root")).render(<App />);
