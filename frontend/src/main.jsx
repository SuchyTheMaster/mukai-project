import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import WaveSurfer from "wavesurfer.js";
import {
  Download,
  FileAudio,
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

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [profiles, setProfiles] = useState({ separationModel: "htdemucs_ft", transcriptionModel: "large-v3", pitch: "default" });
  const [transcriptionSettings, setTranscriptionSettings] = useState(defaultTranscription);
  const [pitchSettings, setPitchSettings] = useState(defaultPitch);
  const [useEmbeddedCover, setUseEmbeddedCover] = useState(true);
  const [job, setJob] = useState(null);
  const [arrangement, setArrangement] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/brand/mukai-logo.png" alt="MUKAI - Music to Karaoke AI Creator" />
          <div className="brand-copy">
            <strong>MUKAI</strong>
            <span>Music to Karaoke AI Creator</span>
          </div>
        </div>
      </header>

      <aside className="left-rail panel">
        <section>
          <div className="section-title">Upload audio</div>
          <label className="dropzone">
            <UploadCloud size={22} />
            <span>{audioFile ? audioFile.name : "Wybierz WAV, MP3, MP4, M4A, OGG albo FLAC"}</span>
            <input type="file" accept=".wav,.mp3,.mp4,.m4a,.ogg,.flac,audio/*,video/mp4" onChange={(event) => event.target.files?.[0] && inspect(event.target.files[0])} />
          </label>
          {inspection && <AudioSummary audio={inspection.audio} filename={inspection.originalFilename} />}
          <div className="cover-box">
            {coverPreview ? <img src={coverPreview} alt="" /> : <FileAudio size={42} />}
          </div>
        </section>

        <section>
          <div className="section-title">Aktualny etap</div>
          <div className="current-stage">
            <strong>{job ? job.status : "Brak zadania"}</strong>
            <small>{activeStage ? stageLabel(activeStage) : "Najpierw wybierz plik audio"}</small>
          </div>
          {job?.metadata && <MetadataSummary metadata={job.metadata} profiles={job.profiles} transcriptionSettings={job.transcriptionSettings} pitchSettings={job.pitchSettings} />}
        </section>
      </aside>

      <main className="workspace">
        {error && <div className="error-banner">{error}</div>}
        {isReview ? (
          <ReviewEditor job={job} arrangement={arrangement} setArrangement={setArrangement} onSave={saveArrangement} saving={saving} onResetStage={resetStage} />
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
              inspection={inspection}
              coverFile={coverFile}
              setCoverFile={setCoverFile}
              setUseEmbeddedCover={setUseEmbeddedCover}
              createJob={createJob}
              busy={busy}
            />
            {job && <StatusPanel job={job} />}
          </>
        )}
      </main>

      <aside className="right-rail panel">
        <section className="side-actions">
          <button className="button primary full" disabled={!inspection || busy || isReview} onClick={createJob}>
            <Play size={16} /> {busy ? "Przetwarzanie..." : "Start zadania"}
          </button>
          <button className="button secondary full" disabled={!job} onClick={() => resetStage(activeStage?.stage ?? "preprocessing")}>
            <RefreshCcw size={16} /> Reset etapu
          </button>
        </section>
        <div className="section-title">Pipeline</div>
        <StageRail job={job} />
      </aside>
    </div>
  );
}

function UploadWorkspace({ metadata, setMetadata, profiles, setProfiles, transcriptionSettings, setTranscriptionSettings, pitchSettings, setPitchSettings, inspection, coverFile, setCoverFile, setUseEmbeddedCover, createJob, busy }) {
  return (
    <section className="workspace-panel">
      <div className="workspace-header">
        <div>
          <h1>Import i przygotowanie audio</h1>
        </div>
      </div>
      <div className="form-grid">
        <TextField label="Tytuł" value={metadata.title ?? ""} onChange={(value) => setMetadata({ ...metadata, title: value })} />
        <TextField label="Artysta" value={metadata.artist ?? ""} onChange={(value) => setMetadata({ ...metadata, artist: value })} />
        <TextField label="Album" value={metadata.album ?? ""} onChange={(value) => setMetadata({ ...metadata, album: value })} />
        <TextField label="Rok" value={metadata.year ?? ""} onChange={(value) => setMetadata({ ...metadata, year: value })} />
        <TextField label="Gatunek" value={metadata.genre ?? ""} onChange={(value) => setMetadata({ ...metadata, genre: value })} />
        <TextField label="Język" value={metadata.language ?? ""} onChange={(value) => setMetadata({ ...metadata, language: value })} placeholder="Puste = auto" />
      </div>

      <div className="controls-row">
        <Select label="Separacja" value={profiles.separationModel} onChange={(value) => setProfiles({ ...profiles, separationModel: value })} options={[["htdemucs_ft", "htdemucs_ft dokładniejszy"], ["htdemucs", "htdemucs szybszy"]]} />
        <Select label="Transkrypcja" value={profiles.transcriptionModel} onChange={(value) => setProfiles({ ...profiles, transcriptionModel: value })} options={[["large-v3", "large-v3 dokładniejszy"], ["large-v3-turbo", "large-v3-turbo szybszy"]]} />
      </div>

      <details className="advanced">
        <summary>Zaawansowane ustawienia transkrypcji</summary>
        <div className="form-grid compact">
          <Select label="VAD" value={transcriptionSettings.vadMethod} onChange={(value) => setTranscriptionSettings({ ...transcriptionSettings, vadMethod: value })} options={[["silero", "Silero"], ["pyannote", "pyannote"]]} />
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

      <div className="cover-actions">
        <label className="button secondary">
          <UploadCloud size={16} /> Cover
          <input type="file" accept="image/png,image/jpeg" onChange={(event) => event.target.files?.[0] && (setCoverFile(event.target.files[0]), setUseEmbeddedCover(false))} />
        </label>
        <button className="button ghost" type="button" onClick={() => (setCoverFile(null), setUseEmbeddedCover(Boolean(inspection?.embeddedCover)))}>
          <RotateCcw size={16} /> Przywróć domyślny
        </button>
      </div>
      <button className="button primary" disabled={!inspection || busy} onClick={createJob}>
        <Play size={16} /> {busy ? "Przetwarzanie..." : "Start zadania"}
      </button>
    </section>
  );
}

function ReviewEditor({ job, arrangement, setArrangement, onSave, saving, onResetStage }) {
  const waveformRef = useRef(null);
  const waveSurferRef = useRef(null);
  const resumeAfterTrackChange = useRef(false);
  const [waveformReady, setWaveformReady] = useState(false);
  const [track, setTrack] = useState("vocals");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState({ type: "line", id: null });
  const [zoomSec, setZoomSec] = useState(EDITOR_WINDOW_SEC);
  const [viewportStart, setViewportStart] = useState(0);
  const [snapNoteEdges, setSnapNoteEdges] = useState(true);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const assets = useMemo(() => Object.fromEntries((job.artifacts ?? []).map((asset) => [asset.type, asset])), [job.artifacts]);
  const selectedContext = useMemo(() => selectionContext(arrangement, selected), [arrangement, selected]);
  const selectedLineId = selected.type === "line" ? selected.id : selectedContext.lineIds[0];
  const selectedLine = arrangement?.lines.find((line) => line.lineId === selectedLineId) ?? arrangement?.lines[0] ?? null;
  const selectedToken = selected.type === "token" ? arrangement?.tokens.find((token) => token.tokenId === selected.id) : null;
  const selectedNote = selected.type === "note" ? arrangement?.noteEvents.find((note) => note.noteId === selected.id) : arrangement?.noteEvents.find((note) => note.noteId === (selectedToken?.noteId ?? selectedContext.noteIds[0])) ?? null;
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
    const unsubTime = waveSurfer.on("timeupdate", (time) => setCurrentTime(time));
    const unsubInteraction = waveSurfer.on("interaction", (time) => setCurrentTime(time));
    const unsubPlay = waveSurfer.on("play", () => setPlaying(true));
    const unsubPause = waveSurfer.on("pause", () => setPlaying(false));
    const unsubFinish = waveSurfer.on("finish", () => setPlaying(false));
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
    if (!waveSurferRef.current) return;
    waveSurferRef.current.playPause();
  }

  function seek(nextTime) {
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

  function setGraphViewport(nextStart) {
    const bounded = Math.max(0, Math.min(Number(nextStart), maxViewportStart));
    setViewportStart(bounded);
    syncWaveformViewport(waveSurferRef.current, waveformRef.current, bounded, zoomSec);
  }

  function startGraphDrag(kind, id, mode, event, windowStart, windowEnd, pitchRange = null) {
    event.preventDefault();
    event.stopPropagation();
    const graph = event.currentTarget.closest(".waveform-overlay, .piano-roll");
    const graphWidth = graph?.clientWidth ?? 1;
    const graphHeight = graph?.clientHeight ?? 1;
    const range = Math.max(windowEnd - windowStart, 0.001);
    const startX = event.clientX;
    const startY = event.clientY;
    const before = clone(arrangement);
    let moved = false;
    let finalTime = graphItemStart(arrangement, kind, id);
    selectAndSeek(kind === "note" ? "note" : "token", id, graphItemStart(arrangement, kind, id));

    const onMove = (moveEvent) => {
      const deltaSec = ((moveEvent.clientX - startX) / graphWidth) * range;
      const deltaMidi = pitchRange ? -((moveEvent.clientY - startY) / graphHeight) * Math.max(pitchRange.maxMidi - pitchRange.minMidi, 1) : 0;
      if (Math.abs(deltaSec) < 0.001 && Math.abs(deltaMidi) < 0.1) return;
      moved = true;
      const next = normalizeArrangement(updateGraphItem(clone(before), kind, id, mode, deltaSec, deltaMidi, { snapNoteEdges }));
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
            <span>{arrangement.lines.length} fraz</span>
            <span>{arrangement.noteEvents.length} nut</span>
          </div>
        </div>
        <div className="editor-actions">
          <button className="icon-button" type="button" title="Undo" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={16} /></button>
          <button className="icon-button" type="button" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={16} /></button>
          <button className="button secondary" type="button" onClick={() => onResetStage("aligning")}><RefreshCcw size={16} /> Reset szkicu</button>
          <button className="button primary" type="button" disabled={saving} onClick={onSave}><Save size={16} /> {saving ? "Zapis..." : "Zapisz"}</button>
        </div>
      </div>

      <div className="transport">
        <div className="track-switch" role="group" aria-label="Źródło audio">
          {[
            ["source_audio", "Oryginał"],
            ["vocals", "Wokal"],
            ["instrumental", "Instrumental"],
          ].map(([key, label]) => (
            <button key={key} className={effectiveTrack === key ? "active" : ""} type="button" disabled={!assets[key]} onClick={() => changeTrack(key)}>{label}</button>
          ))}
        </div>
        <button className="button secondary transport-play" type="button" disabled={!audioUrl} onClick={togglePlay}>
          {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pauza" : "Play"}
        </button>
        <input className="time-slider" type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(event) => seek(event.target.value)} />
        <span className="time-readout">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>

      <div className="quality-strip">
        {qualityBadges(arrangement).map(([flag, count]) => (
          <span key={flag} className={`quality-badge ${count ? "warning" : "ok"}`}>{FLAG_LABELS[flag] ?? flag}: {count}</span>
        ))}
      </div>

      <div className="zoom-bar">
        <span><SlidersHorizontal size={15} /> Okno {zoomSec}s</span>
        <button className="icon-button" type="button" title="Oddal" aria-label="Oddal" onClick={() => zoom(10)}><ZoomOut size={16} /></button>
        <button className="icon-button" type="button" title="Przybliż" aria-label="Przybliż" onClick={() => zoom(-10)}><ZoomIn size={16} /></button>
        <label className="snap-toggle">
          <input type="checkbox" checked={snapNoteEdges} onChange={(event) => setSnapNoteEdges(event.target.checked)} />
          Snap nut do sylab
        </label>
      </div>

      <Timeline bindWaveform={bindWaveform} arrangement={arrangement} selectedContext={selectedContext} selectAndSeek={selectAndSeek} startGraphDrag={startGraphDrag} currentTime={currentTime} seek={seek} windowStart={windowStart} windowEnd={windowEnd} />
      <PianoRoll arrangement={arrangement} selectedContext={selectedContext} selectAndSeek={selectAndSeek} startGraphDrag={startGraphDrag} currentTime={currentTime} windowStart={windowStart} windowEnd={windowEnd} />
      <GraphScrollbar duration={duration} windowStart={windowStart} zoomSec={zoomSec} onChange={setGraphViewport} />

      <div className="editor-grid">
        <PhraseList arrangement={arrangement} selected={selected} selectedContext={selectedContext} selectAndSeek={selectAndSeek} commit={commit} />
        <PropertiesPanel
          arrangement={arrangement}
          selected={selected}
          selectAndSeek={selectAndSeek}
          selectedLine={selectedLine}
          selectedToken={selectedToken}
          selectedNote={selectedNote}
          commit={commit}
        />
      </div>
    </section>
  );
}

function Timeline({ bindWaveform, arrangement, selectedContext, selectAndSeek, startGraphDrag, currentTime, seek, windowStart, windowEnd }) {
  const range = Math.max(windowEnd - windowStart, 0.001);
  const visibleLines = arrangement.lines.filter((line) => line.endSec >= windowStart && line.startSec <= windowEnd);
  const visibleTokens = arrangement.tokens.filter((token) => token.endSec >= windowStart && token.startSec <= windowEnd);
  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <span>{formatTime(windowStart)}</span>
        <strong>Waveform / frazy / słowa</strong>
        <span>{formatTime(windowEnd)}</span>
      </div>
      <div className="waveform-shell">
        <div ref={bindWaveform} className="waveform-canvas" />
        <div className="waveform-overlay" onPointerDown={(event) => seek(windowStart + (event.nativeEvent.offsetX / event.currentTarget.clientWidth) * range)}>
          <div className="playhead" style={{ left: `${percent(currentTime, windowStart, windowEnd)}%` }} />
          {visibleLines.map((line) => (
            <button
              key={line.lineId}
              className={`phrase-marker ${selectedContext.lineIds.includes(line.lineId) ? "selected" : ""} ${line.requiresReview ? "review" : ""}`}
              style={{ left: `${percent(line.startSec, windowStart, windowEnd)}%`, width: `${spanPercent(line.startSec, line.endSec, windowStart, windowEnd)}%` }}
              type="button"
              title={lineText(arrangement, line)}
              onClick={(event) => {
                event.stopPropagation();
                selectAndSeek("line", line.lineId, line.startSec);
              }}
            />
          ))}
          {visibleTokens.map((token) => (
            <div
              key={token.tokenId}
              className={`word-marker ${selectedContext.tokenIds.includes(token.tokenId) ? "selected" : ""} ${token.requiresReview ? "review" : ""}`}
              style={{ left: `${percent(token.startSec, windowStart, windowEnd)}%`, width: `${spanPercent(token.startSec, token.endSec, windowStart, windowEnd)}%` }}
              role="button"
              tabIndex={0}
              title={token.text || "Przedłużenie"}
              onPointerDown={(event) => startGraphDrag("token", token.tokenId, "move", event, windowStart, windowEnd)}
              onClick={(event) => {
                event.stopPropagation();
                selectAndSeek("token", token.tokenId, token.startSec);
              }}
            >
              <span className="drag-handle start" onPointerDown={(event) => startGraphDrag("token", token.tokenId, "resize-start", event, windowStart, windowEnd)} />
              <span className="marker-label">{token.text || "..."}</span>
              <span className="drag-handle end" onPointerDown={(event) => startGraphDrag("token", token.tokenId, "resize-end", event, windowStart, windowEnd)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PianoRoll({ arrangement, selectedContext, selectAndSeek, startGraphDrag, currentTime, windowStart, windowEnd }) {
  const visibleNotes = arrangement.noteEvents.filter((note) => note.endSec >= windowStart && note.startSec <= windowEnd);
  const midis = visibleNotes.map((note) => note.midi);
  const minMidi = Math.max(24, Math.min(...midis, 48) - 2);
  const maxMidi = Math.min(96, Math.max(...midis, 72) + 2);
  return (
    <div className="piano-panel">
      <div className="piano-roll">
        <div className="playhead" style={{ left: `${percent(currentTime, windowStart, windowEnd)}%` }} />
        {visibleNotes.map((note) => (
          <div
            key={note.noteId}
            className={`note-block ${selectedContext.noteIds.includes(note.noteId) ? "selected" : ""} ${note.requiresReview ? "review" : ""}`}
            style={{
              left: `${percent(note.startSec, windowStart, windowEnd)}%`,
              width: `${spanPercent(note.startSec, note.endSec, windowStart, windowEnd)}%`,
              bottom: `${percent(note.midi, minMidi, maxMidi)}%`,
            }}
            role="button"
            tabIndex={0}
            title={`${note.noteId} MIDI ${note.midi}`}
            onPointerDown={(event) => startGraphDrag("note", note.noteId, "move", event, windowStart, windowEnd, { minMidi, maxMidi })}
            onClick={() => selectAndSeek("note", note.noteId, note.startSec)}
          >
            <span className="drag-handle start" onPointerDown={(event) => startGraphDrag("note", note.noteId, "resize-start", event, windowStart, windowEnd)} />
            <span className="marker-label">{note.midi}</span>
            <span className="drag-handle end" onPointerDown={(event) => startGraphDrag("note", note.noteId, "resize-end", event, windowStart, windowEnd)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphScrollbar({ duration, windowStart, zoomSec, onChange }) {
  const max = Math.max(0, duration - zoomSec);
  return (
    <div className="graph-scrollbar">
      <span>{formatTime(windowStart)}</span>
      <input
        type="range"
        min="0"
        max={max}
        step="0.01"
        value={Math.min(windowStart, max)}
        disabled={max <= 0}
        onChange={(event) => onChange(event.target.value)}
      />
      <span>{formatTime(Math.min(duration, windowStart + zoomSec))}</span>
    </div>
  );
}

function PhraseList({ arrangement, selected, selectedContext, selectAndSeek, commit }) {
  return (
    <div className="phrase-list">
      <div className="panel-heading">
        <strong>Frazy</strong>
        <small>{arrangement.lines.length}</small>
      </div>
      {arrangement.lines.map((line) => (
        <article key={line.lineId} className={`phrase-row ${selectedContext.lineIds.includes(line.lineId) ? "selected" : ""}`}>
          <button type="button" onClick={() => selectAndSeek("line", line.lineId, line.startSec)}>
            <span>{formatTime(line.startSec)} - {formatTime(line.endSec)}</span>
            <strong>{lineText(arrangement, line) || "(pusta fraza)"}</strong>
          </button>
          <textarea value={lineText(arrangement, line)} rows={2} onChange={(event) => commit((draft) => updateLineText(draft, line.lineId, event.target.value))} />
          <div className="token-list">
            {tokensForLine(arrangement, line).map((token) => (
              <button key={token.tokenId} className={`token-chip ${token.requiresReview ? "review" : ""} ${selectedContext.tokenIds.includes(token.tokenId) ? "selected" : ""}`} type="button" onClick={() => selectAndSeek("token", token.tokenId, token.startSec)}>
                {token.text || "..." }
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function PropertiesPanel({ arrangement, selected, selectAndSeek, selectedLine, selectedToken, selectedNote, commit }) {
  if (!selectedLine) {
    return <div className="properties-panel"><div className="panel-heading"><strong>Właściwości</strong></div></div>;
  }

  return (
    <div className="properties-panel">
      <div className="panel-heading">
        <strong>Właściwości</strong>
        <small>{selected.type}</small>
      </div>

      {selected.type === "line" && (
        <div className="property-stack">
          <TextField label="Start frazy" type="number" value={selectedLine.startSec} onChange={(value) => commit((draft) => updateLine(draft, selectedLine.lineId, { startSec: Number(value) }))} />
          <TextField label="Koniec frazy" type="number" value={selectedLine.endSec} onChange={(value) => commit((draft) => updateLine(draft, selectedLine.lineId, { endSec: Number(value) }))} />
          <div className="property-actions">
            <button className="button secondary" type="button" onClick={() => commit((draft) => splitLine(draft, selectedLine.lineId))}><Scissors size={16} /> Podziel frazę</button>
            <button className="button secondary" type="button" onClick={() => commit((draft) => mergeLineWithNext(draft, selectedLine.lineId))}><Merge size={16} /> Scal z następną</button>
          </div>
          <QualityFlags flags={selectedLine.qualityFlags} />
        </div>
      )}

      {selected.type === "token" && selectedToken && (
        <div className="property-stack">
          <TextField label="Sylaba / słowo" value={selectedToken.text} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { text: value, isExtension: value ? false : selectedToken.isExtension }))} />
          <TextField label="Start" type="number" value={selectedToken.startSec} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { startSec: Number(value) }))} />
          <TextField label="Koniec" type="number" value={selectedToken.endSec} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { endSec: Number(value) }))} />
          <Select label="Typ nuty" value={selectedToken.noteType} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { noteType: value }))} options={NOTE_TYPES} />
          <div className="property-actions">
            <button className="button secondary" type="button" onClick={() => commit((draft) => splitToken(draft, selectedToken.tokenId))}><Scissors size={16} /> Podziel sylaby</button>
            <button className="button secondary" type="button" onClick={() => commit((draft) => mergeTokenWithNext(draft, selectedToken.tokenId))}><Merge size={16} /> Scal w słowo</button>
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
  return <label className="field"><span>{label}</span>{helper && <small>{helper}</small>}<input type={type} value={value} step={step ?? (type === "number" ? "0.01" : undefined)} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function AudioSummary({ audio, filename }) {
  return <dl className="summary"><dt>Plik</dt><dd>{filename}</dd><dt>Format</dt><dd>{audio.container ?? "-"}</dd><dt>Kodek</dt><dd>{audio.codec ?? "-"}</dd><dt>Kanały</dt><dd>{audio.channels ?? "-"}</dd><dt>Hz</dt><dd>{audio.sampleRate ?? "-"}</dd><dt>Czas</dt><dd>{audio.durationSec ? `${audio.durationSec.toFixed(2)} s` : "-"}</dd></dl>;
}

function MetadataSummary({ metadata, profiles, transcriptionSettings, pitchSettings }) {
  return (
    <dl className="summary">
      <dt>Tytuł</dt><dd>{metadata.title || "-"}</dd>
      <dt>Artysta</dt><dd>{metadata.artist || "-"}</dd>
      <dt>Modele</dt><dd>{profiles.separationModel} / {profiles.transcriptionModel}</dd>
      <dt>VAD</dt><dd>{transcriptionSettings?.vadMethod ?? "silero"}</dd>
      <dt>Pitch</dt><dd>{pitchSettings.frameStepMs} ms, {pitchSettings.periodicityThreshold}</dd>
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

  return <section className="workspace-panel status-panel">{stages.map((stage) => {
    const key = stageDomKey(stage);
    const artifactIds = displayArtifactIdsForStage(stage, job, artifactsById);
    return <article key={key} ref={(node) => { if (node) rowRefs.current[key] = node; }} className={`status-row ${stage.status}`}><div><strong>{stageLabel(stage)}</strong><small>{stage.workerRole}</small>{stage.logExcerpt && <pre>{stage.logExcerpt}</pre>}</div><div className="status-actions"><Progress stage={stage} /><div className="artifact-buttons">{artifactIds.map((assetId) => {
      const asset = artifactsById[assetId];
      const filename = artifactFilename(asset, assetId);
      return <a className="icon-button" key={assetId} href={`${API_BASE}/api/jobs/${job.jobId}/artifacts/${assetId}`} title={filename} aria-label={filename} download><Download size={16} /></a>;
    })}</div></div></article>;
  })}</section>;
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
    lineTokens[0].text = "";
    lineTokens.slice(1).forEach((token) => {
      token.text = "";
      token.isExtension = true;
      token.extendsTokenId = lineTokens[0].tokenId;
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
    token.text = "";
    token.isExtension = true;
    token.extendsTokenId = lineTokens[0].tokenId;
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
  if (token) Object.assign(token, cleanTiming(changes, token));
  return draft;
}

function updateNote(draft, noteId, changes) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (note) Object.assign(note, cleanTiming(changes, note));
  return draft;
}

function updateGraphItem(draft, kind, id, mode, deltaSec, deltaMidi = 0, options = {}) {
  const item = kind === "note" ? draft.noteEvents.find((note) => note.noteId === id) : draft.tokens.find((token) => token.tokenId === id);
  if (!item || !Number.isFinite(deltaSec)) return draft;
  const minLength = 0.02;
  const originalStart = item.startSec;
  const originalEnd = item.endSec;
  if (mode === "resize-start") {
    const nextStart = Math.max(0, Math.min(originalEnd - minLength, originalStart + deltaSec));
    const snappedStart = kind === "note" && options.snapNoteEdges ? snapNoteEdge(draft, item, nextStart, "start") : nextStart;
    item.startSec = roundTime(Math.max(0, Math.min(originalEnd - minLength, snappedStart)));
  } else if (mode === "resize-end") {
    const nextEnd = Math.max(originalStart + minLength, originalEnd + deltaSec);
    const snappedEnd = kind === "note" && options.snapNoteEdges ? snapNoteEdge(draft, item, nextEnd, "end") : nextEnd;
    item.endSec = roundTime(Math.max(originalStart + minLength, snappedEnd));
  } else {
    const length = Math.max(originalEnd - originalStart, minLength);
    const nextStart = Math.max(0, originalStart + deltaSec);
    item.startSec = roundTime(nextStart);
    item.endSec = roundTime(nextStart + length);
    if (kind === "note" && Number.isFinite(deltaMidi) && Math.abs(deltaMidi) >= 0.1) {
      setNoteMidi(draft, item, item.midi + Math.round(deltaMidi));
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
  note.midi = Math.max(24, Math.min(96, Math.round(value)));
  note.frequencyHz = Number((440 * 2 ** ((note.midi - 69) / 12)).toFixed(4));
  draft.tokens.filter((token) => token.noteId === note.noteId).forEach((token) => {
    token.midi = note.midi;
  });
}

function snapNoteEdge(draft, note, value, edge) {
  const candidates = draft.tokens
    .filter((token) => token.noteId === note.noteId || overlaps(token, note))
    .flatMap((token) => (edge === "start" ? [token.startSec] : [token.endSec]));
  if (!candidates.length) return value;
  const nearest = candidates.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), candidates[0]);
  return Math.abs(nearest - value) <= 0.08 ? nearest : value;
}

function splitLine(draft, lineId) {
  const index = draft.lines.findIndex((line) => line.lineId === lineId);
  if (index === -1) return draft;
  const line = draft.lines[index];
  const midpoint = line.startSec + (line.endSec - line.startSec) / 2;
  let leftTokens = line.tokenIds.filter((tokenId) => {
    const token = draft.tokens.find((item) => item.tokenId === tokenId);
    return token && token.startSec < midpoint;
  });
  let rightTokens = line.tokenIds.filter((tokenId) => !leftTokens.includes(tokenId));
  if (!leftTokens.length || !rightTokens.length) {
    const splitAt = Math.max(1, Math.floor(line.tokenIds.length / 2));
    leftTokens = line.tokenIds.slice(0, splitAt);
    rightTokens = line.tokenIds.slice(splitAt);
  }
  if (!rightTokens.length) return draft;
  const originalEnd = line.endSec;
  line.endSec = midpoint;
  line.tokenIds = leftTokens;
  draft.lines.splice(index + 1, 0, { ...line, lineId: nextId("line", draft.lines), startSec: midpoint, endSec: Math.max(midpoint + 0.01, originalEnd), tokenIds: rightTokens });
  return draft;
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

function splitToken(draft, tokenId) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  const line = draft.lines.find((item) => item.tokenIds.includes(tokenId));
  if (!token || !line) return draft;
  const tokenIndex = line.tokenIds.indexOf(tokenId);
  const splitAt = Math.max(1, Math.ceil((token.text || "").length / 2));
  const leftText = (token.text || "").slice(0, splitAt);
  const rightText = (token.text || "").slice(splitAt);
  const midpoint = token.startSec + (token.endSec - token.startSec) / 2;
  const originalEnd = token.endSec;
  const linkedNote = token.noteId ? draft.noteEvents.find((note) => note.noteId === token.noteId) : null;
  let nextNoteId = null;
  token.text = leftText;
  token.endSec = midpoint;
  if (linkedNote && linkedNote.endSec - linkedNote.startSec > 0.03) {
    const noteMidpoint = Math.max(linkedNote.startSec + 0.01, Math.min(midpoint, linkedNote.endSec - 0.01));
    const originalNoteEnd = linkedNote.endSec;
    nextNoteId = nextId("note", draft.noteEvents);
    linkedNote.endSec = noteMidpoint;
    draft.noteEvents.push({
      ...linkedNote,
      noteId: nextNoteId,
      startSec: noteMidpoint,
      endSec: Math.max(noteMidpoint + 0.01, originalNoteEnd),
      requiresReview: true,
      qualityFlags: [...new Set([...(linkedNote.qualityFlags ?? []), "needs_syllable_review"])],
    });
  }
  const next = {
    ...token,
    tokenId: nextId("tok", draft.tokens),
    text: rightText || token.text,
    startSec: midpoint,
    endSec: Math.max(midpoint + 0.01, originalEnd),
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
  line.tokenIds.splice(index + 1, 1);
  draft.tokens = draft.tokens.filter((item) => item.tokenId !== next.tokenId);
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
  const midpoint = note.startSec + (note.endSec - note.startSec) / 2;
  const originalEnd = note.endSec;
  note.endSec = midpoint;
  draft.noteEvents.push({ ...note, noteId: nextId("note", draft.noteEvents), startSec: midpoint, endSec: Math.max(midpoint + 0.01, originalEnd), requiresReview: true, qualityFlags: [...new Set([...(note.qualityFlags ?? []), "unassigned_note"])] });
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
  target.frequencyHz = Number((440 * 2 ** ((target.midi - 69) / 12)).toFixed(4));
  target.qualityFlags = [...new Set([...(target.qualityFlags ?? []), ...(source.qualityFlags ?? [])])];
  draft.tokens.filter((token) => token.noteId === sourceNoteId).forEach((token) => {
    token.noteId = targetNoteId;
    token.midi = target.midi;
  });
  draft.noteEvents = draft.noteEvents.filter((note) => note.noteId !== sourceNoteId);
  return draft;
}

function normalizeArrangement(arrangement) {
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

function roundTime(value) {
  return Number(Math.max(0, value).toFixed(3));
}

function waveformPixelsPerSecond(container, zoomSec) {
  return Math.max(24, Math.round((container?.clientWidth || 900) / Math.max(zoomSec, 1)));
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
