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
  Music2,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCcw,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  UploadCloud,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APP_STORAGE_KEY = "mukai.processingState.v1";
let latestResetContext = { jobId: null, uploadDraftId: null, hasState: false };
const EDITOR_WINDOW_SEC = 30;
const MIN_EDITOR_WINDOW_SEC = 0.1;
const MAX_EDITOR_WINDOW_SEC = 120;
const DEFAULT_SNAP_MS = 20;
const GRAPH_PAN_THRESHOLD_PX = 4;
const DEFAULT_TOKEN_MIDI = 60;
const MIN_EDITOR_MIDI = 24;
const MAX_EDITOR_MIDI = 96;
const PITCH_TOP_MIN_PCT = 42;
const PITCH_TOP_MAX_PCT = 85;
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
  sileroThreshold: 0.3,
  sileroNegThreshold: 0.15,
  sileroMinSpeechDurationMs: 80,
  sileroMinSilenceDurationMs: 100,
  sileroSpeechPadMs: 100,
  pyannoteVadOnset: 0.45,
  pyannoteVadOffset: 0.25,
  vadChunkSizeSec: 30,
  sentenceGapMs: "",
  sentencePaddingMs: 80,
  positioning: "words_and_syllables",
};

const defaultSyllabification = {
  method: "pyphen",
};

const SYLLABIFICATION_OPTIONS = [
  ["kokosznicka", "Kokosznicka"],
  ["pyphen", "Pyphen"],
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

const TRANSCRIPTION_POSITIONING_OPTIONS = [
  ["words_and_syllables", "słowa i sylaby"],
  ["words_only", "tylko słowa"],
];

const TRANSCRIPTION_POSITIONING_LABELS = Object.fromEntries(TRANSCRIPTION_POSITIONING_OPTIONS);

const PITCH_PROFILE_OPTIONS = [
  ["fast", "Szybki"],
  ["default", "Dokładny"],
];

const PITCH_PROFILE_LABELS = Object.fromEntries(PITCH_PROFILE_OPTIONS);

const WHISPER_LANGUAGE_OPTIONS = [
  ["", "Auto"],
  ...[
    ["af", "Afrikaans"],
    ["sq", "Albański"],
    ["am", "Amharski"],
    ["en", "Angielski"],
    ["ar", "Arabski"],
    ["as", "Asamski"],
    ["az", "Azerbejdżański"],
    ["eu", "Baskijski"],
    ["bn", "Bengalski"],
    ["be", "Białoruski"],
    ["bs", "Bośniacki"],
    ["br", "Bretoński"],
    ["bg", "Bułgarski"],
    ["yue", "Cantoński"],
    ["zh", "Chiński"],
    ["hr", "Chorwacki"],
    ["cs", "Czeski"],
    ["da", "Duński"],
    ["et", "Estoński"],
    ["fo", "Farerski"],
    ["fi", "Fiński"],
    ["fr", "Francuski"],
    ["gl", "Galicyjski"],
    ["ka", "Gruziński"],
    ["el", "Grecki"],
    ["gu", "Gudżarati"],
    ["ht", "Haitański kreolski"],
    ["ha", "Hausa"],
    ["haw", "Hawajski"],
    ["he", "Hebrajski"],
    ["hi", "Hindi"],
    ["es", "Hiszpański"],
    ["id", "Indonezyjski"],
    ["is", "Islandzki"],
    ["ja", "Japoński"],
    ["jw", "Jawajski"],
    ["yi", "Jidysz"],
    ["kn", "Kannada"],
    ["ca", "Kataloński"],
    ["kk", "Kazachski"],
    ["km", "Khmerski"],
    ["ko", "Koreański"],
    ["lo", "Laotański"],
    ["ln", "Lingala"],
    ["lt", "Litewski"],
    ["lb", "Luksemburski"],
    ["la", "Łaciński"],
    ["lv", "Łotewski"],
    ["mk", "Macedoński"],
    ["ml", "Malajalam"],
    ["ms", "Malajski"],
    ["mg", "Malgaski"],
    ["mt", "Maltański"],
    ["mi", "Maoryski"],
    ["mr", "Marathi"],
    ["mn", "Mongolski"],
    ["my", "Myanmar"],
    ["nl", "Niderlandzki"],
    ["de", "Niemiecki"],
    ["no", "Norweski"],
    ["nn", "Norweski nynorsk"],
    ["oc", "Oksytański"],
    ["hy", "Ormiański"],
    ["ps", "Paszto"],
    ["fa", "Perski"],
    ["pl", "Polski"],
    ["pt", "Portugalski"],
    ["pa", "Pendżabski"],
    ["ru", "Rosyjski"],
    ["ro", "Rumuński"],
    ["sa", "Sanskryt"],
    ["sr", "Serbski"],
    ["sd", "Sindhi"],
    ["si", "Syngaleski"],
    ["sk", "Słowacki"],
    ["sl", "Słoweński"],
    ["so", "Somalijski"],
    ["sw", "Suahili"],
    ["su", "Sundajski"],
    ["sn", "Shona"],
    ["sv", "Szwedzki"],
    ["tg", "Tadżycki"],
    ["tl", "Tagalski"],
    ["th", "Tajski"],
    ["ta", "Tamilski"],
    ["tt", "Tatarski"],
    ["te", "Telugu"],
    ["bo", "Tybetański"],
    ["tk", "Turkmeński"],
    ["tr", "Turecki"],
    ["uk", "Ukraiński"],
    ["ur", "Urdu"],
    ["uz", "Uzbecki"],
    ["vi", "Wietnamski"],
    ["hu", "Węgierski"],
    ["it", "Włoski"],
    ["cy", "Walijski"],
    ["yo", "Joruba"],
    ["ne", "Nepalski"],
    ["ba", "Baszkirski"],
  ].sort((left, right) => left[1].localeCompare(right[1], "pl")),
];

const TRANSCRIPTION_SETTING_FIELDS = [
  ["sileroThreshold", { methods: ["silero"], helper: "threshold", label: "Czułość wykrywania Silero", step: "0.01", tooltip: "Próg rozpoczęcia wokalu w Silero. Niższa wartość lepiej zachowuje cichy, oddechowy i śpiewany wokal, ale może przepuścić więcej szumu lub przesłuchów instrumentów." }],
  ["sileroNegThreshold", { methods: ["silero"], helper: "neg_threshold", label: "Próg zakończenia Silero", step: "0.01", tooltip: "Próg, poniżej którego Silero zaczyna uznawać fragment za ciszę. Powinien być niższy od progu rozpoczęcia. Niższa wartość lepiej zachowuje wybrzmienia końcówek słów." }],
  ["sileroMinSpeechDurationMs", { methods: ["silero"], helper: "min_speech_duration_ms", label: "Najkrótszy fragment wokalu (ms)", step: "10", tooltip: "Fragmenty wykryte jako wokal, które są krótsze od tej wartości, zostaną odrzucone. Niska wartość pomaga zachować szybkie sylaby, ale może dodać krótkie zakłócenia." }],
  ["sileroMinSilenceDurationMs", { methods: ["silero"], helper: "min_silence_duration_ms", label: "Cisza kończąca fragment (ms)", step: "10", tooltip: "Minimalny czas ciszy potrzebny Silero do zakończenia aktywnego fragmentu. Większa wartość scala wokal przez krótkie pauzy, a mniejsza częściej dzieli frazy." }],
  ["sileroSpeechPadMs", { methods: ["silero"], helper: "speech_pad_ms", label: "Margines wokalu Silero (ms)", step: "10", tooltip: "Dodaje zapas audio przed i po każdym fragmencie wykrytym przez Silero. Chroni miękkie początki i wybrzmienia, ale zbyt duża wartość może dołączyć przesłuchy lub ciszę." }],
  ["pyannoteVadOnset", { methods: ["pyannote"], helper: "vad_onset", label: "Próg startu pyannote", step: "0.01", tooltip: "Próg rozpoczęcia wokalu w pyannote. Niższa wartość zwiększa kompletność cichego śpiewu, ale może skierować do transkrypcji więcej zakłóceń." }],
  ["pyannoteVadOffset", { methods: ["pyannote"], helper: "vad_offset", label: "Próg końca pyannote", step: "0.01", tooltip: "Próg zakończenia wokalu w pyannote. Powinien być niższy od progu startu. Niższa wartość dłużej utrzymuje aktywną frazę i lepiej zachowuje wybrzmienia." }],
  ["vadChunkSizeSec", { helper: "chunk_size", label: "Okno VAD/ASR (s)", step: "1", tooltip: "Maksymalna długość fragmentu przekazywanego do Whispera po wykrywaniu i łączeniu wokalu. Wartość 30 s odpowiada oknu kontekstowemu modelu i jest zalecana dla obu VAD." }],
  ["sentenceGapMs", { label: "Ms między sentencjami", step: "1", nullable: true, placeholder: "auto", tooltip: "Minimalna przerwa, po której tekst jest dzielony na osobne frazy. Większa wartość łączy więcej słów w dłuższe linie karaoke. Mniejsza wartość częściej rozdziela tekst na krótsze linie." }],
  ["sentencePaddingMs", { helper: "sentencePaddingMs", label: "Padding frazy (ms)", step: "10", tooltip: "Dodatkowy margines czasu finalnej frazy karaoke, stosowany po alignacji słów. Nie wpływa na samą detekcję VAD; zabezpiecza granice frazy bez nakładania jej na sąsiadów." }],
];

const PITCH_SETTING_FIELDS = [
  ["silenceThresholdDb", { label: "Czułość na cichy wokal (dB)", step: "1", tooltip: "Próg głośności używany przy analizie tonu. Większa wartość ignoruje więcej cichych fragmentów i szumu, ale może pominąć delikatny wokal. Mniejsza wartość analizuje cichsze dźwięki, ale częściej łapie tło jako wokal." }],
  ["periodicityThreshold", { label: "Minimalna pewność tonu (0-1)", step: "0.01", tooltip: "Minimalna pewność, że wykryty dźwięk ma stabilną wysokość. Większa wartość zostawia tylko pewniejsze nuty, ale może tworzyć braki. Mniejsza wartość wykrywa więcej nut, ale częściej przepuszcza błędne wysokości." }],
  ["frameStepMs", { label: "Dokładność czasu analizy (ms)", step: "1", tooltip: "Odstęp między kolejnymi pomiarami tonu. Większa wartość jest szybsza, ale mniej dokładna czasowo. Mniejsza wartość daje gęstszy pomiar i lepsze granice nut, kosztem dłuższej analizy." }],
  ["minNoteLengthMs", { label: "Najkrótsza nuta karaoke (ms)", step: "1", tooltip: "Minimalny czas trwania nuty w szkicu karaoke. Większa wartość usuwa krótkie ozdobniki i przypadkowe skoki, ale może zgubić szybkie sylaby. Mniejsza wartość zachowuje krótkie nuty, ale wynik może być bardziej poszarpany." }],
  ["mergeGapMs", { label: "Scalanie krótkich przerw (ms)", step: "1", tooltip: "Maksymalna przerwa, którą można złączyć między sąsiednimi nutami. Większa wartość wygładza linię melodyczną, ale może zlewać oddzielne sylaby. Mniejsza wartość zostawia więcej przerw, ale może rozbić jedną nutę na kilka części." }],
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
  "detecting_pitch.pitch_detection": "Detekcja tonów",
  "aligning.draft": "Wstępne dopasowanie",
};

const PREPROCESSING_DISPLAY_ARTIFACT_TYPES = new Set(["whisperx_input", "torchcrepe_input"]);

const FLAG_LABELS = {
  uncertain_pitch: "Niska pewność tonu",
  missing_note: "Brak nuty dla tekstu",
  uncertain_text: "Niska pewność tekstu",
  needs_syllable_review: "Sylaby do sprawdzenia",
  contains_review_items: "Elementy do recenzji",
  too_short_note: "Zbyt krótka nuta",
  overlapping_line: "Nachodzące sentencje",
};

const NOTE_TYPES = [
  ["normal", "Normal"],
  ["golden", "Golden"],
  ["freestyle", "Freestyle"],
  ["rap", "Rap"],
  ["rap_golden", "Rap golden"],
];

const MODEL_TOOLTIPS = {
  separation: "Separacja rozdziela utwór na wokal i instrumental. htdemucs_ft jest dokładniejszy, a htdemucs szybszy.",
  vad: "Wykrywanie mowy wskazuje fragmenty z wokalem przed transkrypcją. Ma wpływ na pominięcie ciszy, oddechów i nieśpiewanych fragmentów.",
  transcription: "Transkrypcja zamienia wokal na tekst. large-v3 jest dokładniejszy, a large-v3-turbo szybszy.",
  positioning: "Pozycjonowanie wybiera szczegółowość danych czasowych z WhisperX. Opcja słowa i sylaby włącza return_char_alignments, więc sylaby mogą dostać dokładniejsze początki, ale przetwarzanie jest cięższe. Opcja tylko słowa jest prostsza i szybsza, ale daje mniej precyzji dla sylab.",
  syllabification: 'Dla polskich piosenek zalecany sylabizator to "Kokosznicka", ale czasami może lepiej sprawdzić się "Pyphen". Dla zagranicznych tylko "Pyphen". Jeżeli jakiś język nie jest obsługiwany przez wybraną metodę, to zostanie użyta metoda heurystyczna. Jeżeli całe słowa piosenki są śpiewane w jednym tonie, to lepiej sprawdzi się tryb bez podziału na sylaby.',
};

const initialUiState = {
  inspection: null,
  metadata: emptyMetadata,
  profiles: { separationModel: "htdemucs_ft", transcriptionModel: "large-v3", pitch: "fast" },
  transcriptionSettings: defaultTranscription,
  pitchSettings: defaultPitch,
  syllabificationSettings: defaultSyllabification,
  syllabificationTouched: false,
  useEmbeddedCover: true,
  job: null,
  reviewOpen: false,
  stageWorkingState: {},
  editorWorkspace: null,
};

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("MUKAI render error", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const canReset = latestResetContext.hasState || hasStoredProjectState();
    return (
      <div className="reset-fallback-shell">
        <div className="reset-fallback-panel">
          <div className="brand">
            <img src="/brand/mukai-logo.png" alt="MUKAI - Music to Karaoke AI Creator" />
            <div className="brand-copy"><strong>MUKAI</strong><span>Music to Karaoke AI Creator</span></div>
          </div>
          <p>Interfejs napotkał błąd JavaScript.</p>
          {canReset && (
            <button className="button ghost danger full" type="button" onClick={() => confirmAndResetApplication(latestResetContext)}>
              <RotateCcw size={16} /> Od nowa
            </button>
          )}
        </div>
      </div>
    );
  }
}

function App() {
  const persisted = useMemo(readPersistedUiState, []);
  const [audioFile, setAudioFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const coverInputRef = useRef(null);
  const [inspection, setInspection] = useState(persisted.inspection);
  const [metadata, setMetadata] = useState(persisted.metadata);
  const [profiles, setProfiles] = useState(persisted.profiles);
  const [transcriptionSettings, setTranscriptionSettings] = useState(persisted.transcriptionSettings);
  const [pitchSettings, setPitchSettings] = useState(persisted.pitchSettings);
  const [syllabificationSettings, setSyllabificationSettings] = useState(persisted.syllabificationSettings);
  const [syllabificationTouched, setSyllabificationTouched] = useState(persisted.syllabificationTouched);
  const [useEmbeddedCover, setUseEmbeddedCover] = useState(persisted.useEmbeddedCover);
  const [job, setJob] = useState(persisted.job);
  const [arrangement, setArrangement] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sourceUpload, setSourceUpload] = useState(() => ({
    status: persisted.inspection || persisted.job ? "completed" : "pending",
    progressPercent: persisted.inspection || persisted.job ? 100 : 0,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(persisted.reviewOpen);
  const [stageWorkingState, setStageWorkingState] = useState(persisted.stageWorkingState ?? {});
  const [editorWorkspace, setEditorWorkspace] = useState(persisted.editorWorkspace ?? null);
  const [savingProject, setSavingProject] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetInProgress = useRef(false);

  useEffect(() => {
    if (!job?.jobId) return undefined;
    let ignore = false;
    apiJson(`/api/jobs/${job.jobId}`)
      .then((refreshed) => {
        if (!ignore) setJob(refreshed);
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (resetInProgress.current) return;
    persistUiState({
      inspection,
      metadata,
      profiles,
      transcriptionSettings,
      pitchSettings,
      syllabificationSettings,
      syllabificationTouched,
      useEmbeddedCover,
      job,
      reviewOpen,
      stageWorkingState,
      editorWorkspace,
    });
  }, [inspection, metadata, profiles, transcriptionSettings, pitchSettings, syllabificationSettings, syllabificationTouched, useEmbeddedCover, job, reviewOpen, stageWorkingState, editorWorkspace]);

  useEffect(() => {
    if (!job || ["failed", "awaiting_review", "cancelled"].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      const refreshed = await apiJson(`/api/jobs/${job.jobId}`);
      setJob(refreshed);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.jobId, job?.status]);

  useEffect(() => {
    if (job?.status !== "awaiting_review" || !reviewOpen) return;
    let ignore = false;
    apiJson(`/api/jobs/${job.jobId}/arrangement`)
      .then((next) => {
        if (!ignore) setArrangement(toEditorArrangement(next));
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      });
    return () => {
      ignore = true;
    };
  }, [job?.jobId, job?.status, reviewOpen]);

  const activeStage = useMemo(() => currentStage(job), [job]);
  const jobCreated = Boolean(job);
  const jobCoverAsset = job?.artifacts?.find((asset) => asset.type === "cover");
  const importedCover = inspection?.projectCovers?.[inspection?.selectedCoverKind];
  const coverPreview = jobCreated
    ? jobCoverAsset ? `${API_BASE}/api/jobs/${job.jobId}/artifacts/${jobCoverAsset.assetId}` : null
    : coverFile ? URL.createObjectURL(coverFile) : importedCover ? `${API_BASE}${importedCover.previewUrl}` : inspection?.embeddedCover && useEmbeddedCover ? `${API_BASE}${inspection.embeddedCover.previewUrl}` : null;
  const isReview = job?.status === "awaiting_review" && reviewOpen;
  const showRestart = hasMeaningfulProjectState({ audioFile, coverFile, inspection, metadata, job, arrangement, reviewOpen });
  latestResetContext = {
    jobId: job?.jobId ?? null,
    uploadDraftId: inspection?.uploadDraftId ?? null,
    hasState: showRestart,
  };

  useEffect(() => {
    if (syllabificationTouched) return;
    setSyllabificationSettings(defaultSyllabificationForLanguage(metadata.language));
  }, [metadata.language, syllabificationTouched]);

  useEffect(() => {
    if (syllabificationSettings.method !== "none" || transcriptionSettings.positioning === "words_only") return;
    setTranscriptionSettings((current) => ({ ...current, positioning: "words_only" }));
  }, [syllabificationSettings.method, transcriptionSettings.positioning]);

  async function selectSourceFile(file) {
    setAudioFile(file);
    if (file.name.toLowerCase().endsWith(".zip")) {
      await importProject(file);
      return;
    }
    await inspect(file);
  }

  async function inspect(file) {
    setError(null);
    setBusy(true);
    setSourceUpload({ status: "running", progressPercent: 0 });
    setInspection(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiFormWithUploadProgress("/api/uploads/inspect", form, (progressPercent) => {
        setSourceUpload({ status: "running", progressPercent });
      });
      setInspection(result);
      setSourceUpload({ status: "completed", progressPercent: 100 });
      setMetadata({ ...emptyMetadata, ...result.metadata, language: "", languageMode: "auto" });
      setTranscriptionSettings(defaultTranscription);
      setSyllabificationTouched(false);
      setSyllabificationSettings(defaultSyllabificationForLanguage(""));
      setUseEmbeddedCover(Boolean(result.embeddedCover));
      setCoverFile(null);
      setJob(null);
      setArrangement(null);
      setReviewOpen(false);
      setStageWorkingState({});
      setEditorWorkspace(null);
    } catch (err) {
      setAudioFile(null);
      setSourceUpload({ status: "pending", progressPercent: 0 });
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function importProject(file) {
    setError(null);
    setBusy(true);
    setSourceUpload({ status: "running", progressPercent: 0 });
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiFormWithUploadProgress("/api/projects/import", form, (progressPercent) => {
        setSourceUpload({ status: "running", progressPercent });
      });
      const working = result.workingState ?? {};
      setAudioFile(null);
      setSourceUpload({ status: "completed", progressPercent: 100 });
      setCoverFile(null);
      setInspection(result.inspection ?? null);
      setMetadata({ ...emptyMetadata, ...(working.metadata ?? result.inspection?.metadata ?? result.job?.metadata ?? {}) });
      setProfiles({ ...initialUiState.profiles, ...(working.profiles ?? result.job?.profiles ?? {}) });
      setTranscriptionSettings(normalizeTranscriptionSettings(working.transcriptionSettings ?? result.job?.transcriptionSettings ?? {}));
      setPitchSettings({ ...defaultPitch, ...(working.pitchSettings ?? result.job?.pitchSettings ?? {}) });
      setSyllabificationSettings({ ...defaultSyllabification, ...(working.syllabificationSettings ?? result.job?.syllabificationSettings ?? {}) });
      setSyllabificationTouched(Boolean(working.syllabificationTouched));
      setUseEmbeddedCover(working.useEmbeddedCover ?? true);
      setStageWorkingState(working.stageForms ?? {});
      setEditorWorkspace(result.editorWorkspace ?? null);
      setJob(result.job ?? null);
      setArrangement(null);
      setReviewOpen(result.phase === "review");
    } catch (err) {
      setAudioFile(null);
      setSourceUpload({ status: "pending", progressPercent: 0 });
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
        transcriptionSettings: serializeTranscriptionSettings(transcriptionSettings, syllabificationSettings),
        pitchSettings,
        syllabificationSettings,
        useEmbeddedCover: useEmbeddedCover && !coverFile,
        draftCoverKind: inspection?.selectedCoverKind ?? (useEmbeddedCover ? "tag" : null),
      };
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      if (coverFile) form.append("cover", coverFile);
      const created = await apiForm("/api/jobs/uploads", form);
      setJob(created);
      setReviewOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function projectWorkingState() {
    return {
      inspection,
      metadata,
      profiles,
      transcriptionSettings,
      pitchSettings,
      syllabificationSettings,
      syllabificationTouched,
      useEmbeddedCover,
      selectedCoverKind: coverFile ? "manual" : inspection?.selectedCoverKind ?? (inspection?.embeddedCover && useEmbeddedCover ? "tag" : null),
      stageForms: stageWorkingState,
      activeView: isReview ? "review" : job ? "processing" : "draft",
    };
  }

  async function saveProjectArchive() {
    if (!inspection && !job) return;
    setError(null);
    setSavingProject(true);
    try {
      if (isReview && arrangement) await saveArrangement(arrangement.approved);
      const state = { workingState: projectWorkingState(), editorWorkspace };
      let result;
      if (job) {
        result = await apiJson(`/api/jobs/${job.jobId}/exports/project`, {
          method: "POST",
          body: JSON.stringify(state),
          headers: { "Content-Type": "application/json" },
        });
      } else {
        const form = new FormData();
        form.append("state", JSON.stringify(state));
        if (coverFile) form.append("cover", coverFile);
        result = await apiForm(`/api/projects/drafts/${inspection.uploadDraftId}/export`, form);
      }
      triggerUrlDownload(result.archive.downloadUrl, result.archive.filename);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingProject(false);
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
      setReviewOpen(false);
      setJob(await apiJson(`/api/jobs/${job.jobId}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function resumeStage(stage) {
    if (!job) return;
    setError(null);
    setBusy(true);
    try {
      await apiJson(`/api/jobs/${job.jobId}/stages/${stage}/resume`, {
        method: "POST",
        body: JSON.stringify({ reason: "user_requested" }),
        headers: { "Content-Type": "application/json" },
      });
      setArrangement(null);
      setReviewOpen(false);
      setJob(await apiJson(`/api/jobs/${job.jobId}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveStageSettings(stage, payload) {
    if (!job) return false;
    setError(null);
    setBusy(true);
    try {
      const result = await apiJson(`/api/jobs/${job.jobId}/stages/${stage}/settings`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
      setArrangement(null);
      setReviewOpen(false);
      setJob(result.job ?? result);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSourceSettings(form) {
    if (!job) return false;
    setError(null);
    setBusy(true);
    try {
      const result = await apiForm(`/api/jobs/${job.jobId}/source`, form);
      setArrangement(null);
      setReviewOpen(false);
      setJob(result.job ?? result);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveArrangement(approved = false) {
    if (!job || !arrangement) return;
    setError(null);
    setSaving(true);
    try {
      const payloadArrangement = fromEditorArrangement({ ...arrangement, approved });
      const saved = await apiJson(`/api/jobs/${job.jobId}/arrangement`, {
        method: "PUT",
        body: JSON.stringify({ revision: arrangement.revision, arrangement: payloadArrangement }),
        headers: { "Content-Type": "application/json" },
      });
      setArrangement(toEditorArrangement(saved));
      return saved;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function refreshJob() {
    if (!job) return null;
    const refreshed = await apiJson(`/api/jobs/${job.jobId}`);
    setJob(refreshed);
    return refreshed;
  }

  async function resegmentArrangement(sentenceGapMs) {
    if (!job) return;
    setError(null);
    setSaving(true);
    try {
      const saved = await apiJson(`/api/jobs/${job.jobId}/arrangement/resegment`, {
        method: "POST",
        body: JSON.stringify({ sentenceGapMs: nullableNumber(sentenceGapMs) }),
        headers: { "Content-Type": "application/json" },
      });
      setArrangement(toEditorArrangement(saved));
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
    if (inspection) setInspection({ ...inspection, selectedCoverKind: "manual" });
  }

  function resetCover() {
    setCoverFile(null);
    setUseEmbeddedCover(Boolean(inspection?.embeddedCover));
    if (inspection?.projectCovers?.tag) setInspection({ ...inspection, selectedCoverKind: "tag", embeddedCover: inspection.projectCovers.tag });
  }

  function clearLocalProjectState() {
    setAudioFile(null);
    setCoverFile(null);
    setInspection(null);
    setSourceUpload({ status: "pending", progressPercent: 0 });
    setMetadata(emptyMetadata);
    setProfiles(initialUiState.profiles);
    setTranscriptionSettings(defaultTranscription);
    setPitchSettings(defaultPitch);
    setSyllabificationSettings(defaultSyllabification);
    setSyllabificationTouched(false);
    setUseEmbeddedCover(true);
    setJob(null);
    setArrangement(null);
    setReviewOpen(false);
    setStageWorkingState({});
    setEditorWorkspace(null);
    clearBrowserProjectState();
  }

  async function restartProject() {
    const resetContext = { ...latestResetContext };
    resetInProgress.current = true;
    setResetting(true);
    setRestartOpen(false);
    clearLocalProjectState();
    try {
      await resetApplicationData(resetContext);
    } finally {
      reloadInitialApplication();
    }
  }

  return (
    <div className={`app-shell ${isReview ? "review-expanded" : ""}`}>
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

        {showRestart && (
          <section className="restart-section project-actions">
            <button className="button ghost danger full restart-button" type="button" onClick={() => setRestartOpen(true)}>
              <RotateCcw size={16} /> Od nowa
            </button>
            <button className="button primary full" type="button" disabled={savingProject || busy || (!inspection && !job)} onClick={saveProjectArchive}>
              <Save size={16} /> {savingProject ? "Zapisywanie..." : "Zapisz"}
            </button>
          </section>
        )}

        <section>
          <div className="section-title">{jobCreated ? "WGRANE AUDIO" : "UPLOAD AUDIO/PROJEKTU"}</div>
          {!jobCreated && (
            <label className="dropzone">
              <UploadCloud size={22} />
              <span>{audioFile?.name ?? inspection?.originalFilename ?? "Wybierz WAV, MP3, MP4, M4A, OGG, FLAC lub wgraj ZIP z projektem"}</span>
              <input type="file" accept=".wav,.mp3,.mp4,.m4a,.ogg,.flac,.zip,audio/*,video/mp4,application/zip" onChange={(event) => event.target.files?.[0] && selectSourceFile(event.target.files[0])} />
            </label>
          )}
          {(inspection || job?.audio) && <AudioSummary audio={inspection?.audio ?? job.audio} filename={inspection?.originalFilename ?? job?.artifacts?.find((asset) => asset.type === "source_audio")?.originalFilename} />}
          {jobCreated ? (
            <div className="cover-box" aria-label="Podgląd okładki">
              {coverPreview ? <img src={coverPreview} alt="" /> : <CoverPlaceholder />}
            </div>
          ) : (
            <>
              <button className="cover-box cover-box-button" type="button" disabled={!inspection} onClick={() => coverInputRef.current?.click()}>
                {coverPreview ? <img src={coverPreview} alt="" /> : <CoverPlaceholder />}
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
            </>
          )}
        </section>

        {job?.metadata && <section>
          <div className="section-title">Ustawienia zadania</div>
          {job?.metadata && <MetadataSummary job={job} />}
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
            onResegment={resegmentArrangement}
            saving={saving}
            onResetStage={resetStage}
            onJobRefresh={refreshJob}
            initialWorkspace={editorWorkspace}
            onWorkspaceChange={setEditorWorkspace}
          />
        ) : (
          <>
            <UploadWorkspace
              metadata={metadata}
              setMetadata={setMetadata}
              inspection={inspection}
              job={job}
              createJob={createJob}
              onStageSettings={saveStageSettings}
              onSourceSettings={saveSourceSettings}
              onResumeStage={resumeStage}
              onOpenReview={() => setReviewOpen(true)}
              busy={busy}
              stageWorkingState={stageWorkingState}
              onStageWorkingStateChange={setStageWorkingState}
            />
          </>
        )}
      </main>

      {!isReview && (
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
            <StageRail job={job} sourceUpload={sourceUpload} />
          </section>
        </aside>
      )}
      {restartOpen && (
        <ConfirmDialog
          title="Zacząć od nowa?"
          message="Ta operacja wyczyści lokalny stan przeglądarki oraz artefakty bieżącego zadania i wróci do pierwszego kroku."
          confirmLabel="Od nowa"
          busy={resetting}
          onCancel={() => setRestartOpen(false)}
          onConfirm={restartProject}
        />
      )}
    </div>
  );
}

function UploadWorkspace({ metadata, setMetadata, inspection, job, createJob, onStageSettings, onSourceSettings, onResumeStage, onOpenReview, busy, stageWorkingState, onStageWorkingStateChange }) {
  return (
    <section className="workspace-panel">
      <div className="workspace-header">
        <div>
          <h1>Źródło i processing audio</h1>
        </div>
      </div>
      {job?.status === "awaiting_review" ? (
        <ProcessingSummary job={job} busy={busy} onSubmit={onStageSettings} onSourceSubmit={onSourceSettings} onResumeStage={onResumeStage} onOpenReview={onOpenReview} stageWorkingState={stageWorkingState} onStageWorkingStateChange={onStageWorkingStateChange} />
      ) : job ? (
        <ProcessingSummary job={job} busy={busy} onSubmit={onStageSettings} onSourceSubmit={onSourceSettings} onResumeStage={onResumeStage} stageWorkingState={stageWorkingState} onStageWorkingStateChange={onStageWorkingStateChange} />
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); createJob(); }}>
          <div className="form-grid">
            <TextField label="Tytuł" name="title" required value={metadata.title ?? ""} onChange={(value) => setMetadata({ ...metadata, title: value })} />
            <TextField label="Artysta" name="artist" required value={metadata.artist ?? ""} onChange={(value) => setMetadata({ ...metadata, artist: value })} />
            <TextField label="Album" value={metadata.album ?? ""} onChange={(value) => setMetadata({ ...metadata, album: value })} />
            <TextField label="Rok" value={metadata.year ?? ""} onChange={(value) => setMetadata({ ...metadata, year: value })} />
            <TextField label="Gatunek" value={metadata.genre ?? ""} onChange={(value) => setMetadata({ ...metadata, genre: value })} />
            <LanguageSelect label="Język" value={metadata.language ?? ""} onChange={(value) => setMetadata({ ...metadata, language: value })} options={WHISPER_LANGUAGE_OPTIONS} />
          </div>

          <button className="button primary import-submit" type="submit" disabled={!inspection || busy}>
            <Play size={16} /> {busy ? "Przetwarzanie..." : "Przetwarzaj audio"}
          </button>
        </form>
      )}
    </section>
  );
}

const TRANSCRIPTION_STAGE_FIELDS = TRANSCRIPTION_SETTING_FIELDS.filter(([key]) => key !== "sentenceGapMs");
const PITCH_DETECTION_FIELDS = PITCH_SETTING_FIELDS.filter(([key]) => !["minNoteLengthMs", "mergeGapMs"].includes(key));
const ALIGNMENT_PITCH_FIELDS = PITCH_SETTING_FIELDS.filter(([key]) => ["minNoteLengthMs", "mergeGapMs"].includes(key));

function StageSettingsPanel({ job, stage, busy, onSubmit, onSourceSubmit, embedded = false, stageWorkingState = {}, onStageWorkingStateChange }) {
  const targetStage = stage ?? sortedStages(job.processing).find((item) => item.actionRequired);
  if (!targetStage) return null;
  const form = targetStage.settingsForm ?? settingsFormForStage(targetStage.stage);
  const draft = stageWorkingState[targetStage.stage] ?? {};
  const report = (value) => onStageWorkingStateChange?.((current) => ({ ...current, [targetStage.stage]: value }));
  if (form === "source") return <SourceStageForm job={job} busy={busy} onSubmit={onSourceSubmit} embedded={embedded} draft={draft} onDraftChange={report} />;
  if (form === "separation") return <SeparationStageForm job={job} busy={busy} onSubmit={onSubmit} embedded={embedded} draft={draft} onDraftChange={report} />;
  if (form === "transcription") return <TranscriptionStageForm job={job} busy={busy} onSubmit={onSubmit} embedded={embedded} draft={draft} onDraftChange={report} />;
  if (form === "pitch") return <PitchStageForm job={job} busy={busy} onSubmit={onSubmit} embedded={embedded} draft={draft} onDraftChange={report} />;
  if (form === "alignment") return <AlignmentStageForm job={job} busy={busy} onSubmit={onSubmit} embedded={embedded} draft={draft} onDraftChange={report} />;
  return null;
}

function settingsFormForStage(stage) {
  return {
    uploaded: "source",
    separating_vocals: "separation",
    transcribing: "transcription",
    detecting_pitch: "pitch",
    aligning: "alignment",
  }[stage] ?? null;
}

function StageFormShell({ title, embedded, children }) {
  const Tag = embedded ? "div" : "section";
  return <Tag className={embedded ? "stage-settings-inline" : "stage-settings-card"}>{!embedded && <h2>{title}</h2>}{children}</Tag>;
}

function SourceStageForm({ job, busy, onSubmit, embedded = false, draft = {}, onDraftChange }) {
  const [metadata, setMetadata] = useState({ ...emptyMetadata, ...(job.metadata ?? {}), ...(draft.metadata ?? {}) });
  const [sourceInspection, setSourceInspection] = useState(draft.sourceInspection ?? null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [coverFile, setCoverFile] = useState(null);
  const [useEmbeddedCover, setUseEmbeddedCover] = useState(draft.useEmbeddedCover ?? true);
  const [localError, setLocalError] = useState(null);
  const sourceInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const sourceReady = Boolean((metadata.title ?? "").trim() && (metadata.artist ?? "").trim());
  const coverPreview = coverFile
    ? URL.createObjectURL(coverFile)
    : sourceInspection?.embeddedCover && useEmbeddedCover ? `${API_BASE}${sourceInspection.embeddedCover.previewUrl}` : null;

  useEffect(() => {
    onDraftChange?.({ metadata, sourceInspection, useEmbeddedCover, manualCoverFilename: coverFile?.name ?? draft.manualCoverFilename ?? null });
  }, [metadata, sourceInspection, useEmbeddedCover, coverFile]);

  async function inspectSource(file) {
    if (!file) return;
    setLocalError(null);
    setSourceBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiForm("/api/uploads/inspect", form);
      setSourceInspection(result);
      setMetadata((current) => ({ ...current, ...result.metadata, language: current.language ?? "" }));
      setCoverFile(null);
      setUseEmbeddedCover(Boolean(result.embeddedCover));
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSourceBusy(false);
    }
  }

  async function chooseCover(file) {
    if (!file) return;
    setCoverFile(file);
    setUseEmbeddedCover(false);
    if (sourceInspection?.uploadDraftId) {
      try {
        const form = new FormData();
        form.append("cover", file);
        const manual = await apiForm(`/api/uploads/drafts/${sourceInspection.uploadDraftId}/manual-cover`, form);
        setSourceInspection((current) => ({
          ...current,
          embeddedCover: manual,
          selectedCoverKind: "manual",
          projectCovers: { ...(current?.projectCovers ?? {}), manual },
        }));
      } catch (err) {
        setLocalError(err.message);
      }
    }
  }

  async function submitSource() {
    const language = (metadata.language ?? "").trim();
    const payload = {
      uploadDraftId: sourceInspection?.uploadDraftId ?? null,
      metadata: { ...metadata, language: language || null, languageMode: language ? "forced" : "auto" },
      useEmbeddedCover: useEmbeddedCover && !coverFile,
      draftCoverKind: sourceInspection?.selectedCoverKind ?? (useEmbeddedCover ? "tag" : null),
    };
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    if (coverFile) form.append("cover", coverFile);
    return onSubmit(form);
  }

  return (
    <StageFormShell title="Źródło" embedded={embedded}>
      {localError && <div className="error-banner compact">{localError}</div>}
      <div className="form-grid">
        <TextField label="Tytuł" value={metadata.title ?? ""} onChange={(value) => setMetadata({ ...metadata, title: value })} />
        <TextField label="Artysta" value={metadata.artist ?? ""} onChange={(value) => setMetadata({ ...metadata, artist: value })} />
        <TextField label="Album" value={metadata.album ?? ""} onChange={(value) => setMetadata({ ...metadata, album: value })} />
        <TextField label="Rok" value={metadata.year ?? ""} onChange={(value) => setMetadata({ ...metadata, year: value })} />
        <TextField label="Gatunek" value={metadata.genre ?? ""} onChange={(value) => setMetadata({ ...metadata, genre: value })} />
        <LanguageSelect label="Język" value={metadata.language ?? ""} onChange={(value) => setMetadata({ ...metadata, language: value })} options={WHISPER_LANGUAGE_OPTIONS} />
      </div>
      <div className="source-change-actions">
        <button className="button secondary" type="button" disabled={busy || sourceBusy} onClick={() => sourceInputRef.current?.click()}>
          <UploadCloud size={16} /> {sourceInspection ? sourceInspection.originalFilename : "Zmień plik"}
        </button>
        <input
          ref={sourceInputRef}
          className="cover-input"
          type="file"
          accept=".wav,.mp3,.mp4,.m4a,.ogg,.flac,audio/*,video/mp4"
          onChange={(event) => {
            inspectSource(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button className="button secondary" type="button" disabled={busy || sourceBusy} onClick={() => coverInputRef.current?.click()}>
          <UploadCloud size={16} /> Zmień cover
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
        {sourceInspection?.embeddedCover && (
          <button className="button ghost" type="button" disabled={busy || sourceBusy} onClick={() => { setCoverFile(null); setUseEmbeddedCover(true); }}>
            <RotateCcw size={16} /> Cover z tagów
          </button>
        )}
      </div>
      {sourceInspection && <AudioSummary audio={sourceInspection.audio} filename={sourceInspection.originalFilename} />}
      {coverPreview && <div className="cover-box source-cover-preview" aria-label="Nowy podgląd okładki"><img src={coverPreview} alt="" /></div>}
      <button className="button primary" type="button" disabled={busy || sourceBusy || !sourceReady} onClick={submitSource}>
        <Save size={16} /> Zapisz źródło
      </button>
    </StageFormShell>
  );
}

function SeparationStageForm({ job, busy, onSubmit, embedded = false, draft = {}, onDraftChange }) {
  const [separationModel, setSeparationModel] = useState(draft.separationModel ?? job.profiles?.separationModel ?? "htdemucs_ft");
  useEffect(() => onDraftChange?.({ separationModel }), [separationModel]);
  return (
    <StageFormShell title="Separacja wokalu" embedded={embedded}>
      <div className="controls-row">
        <Select label="Mechanizm separacji" tooltip={MODEL_TOOLTIPS.separation} value={separationModel} onChange={setSeparationModel} options={[["htdemucs_ft", "htdemucs_ft"], ["htdemucs", "htdemucs"]]} />
      </div>
      <button className="button primary" type="button" disabled={busy} onClick={() => onSubmit("separating_vocals", { profiles: { ...job.profiles, separationModel } })}>
        <Play size={16} /> Uruchom separację
      </button>
    </StageFormShell>
  );
}

function TranscriptionStageForm({ job, busy, onSubmit, embedded = false, draft = {}, onDraftChange }) {
  const [transcriptionModel, setTranscriptionModel] = useState(draft.transcriptionModel ?? job.profiles?.transcriptionModel ?? "large-v3");
  const [settings, setSettings] = useState(normalizeTranscriptionSettings(draft.settings ?? job.transcriptionSettings));
  const [syllabification, setSyllabification] = useState({ ...defaultSyllabification, ...(job.syllabificationSettings ?? {}), ...(draft.syllabification ?? {}) });
  const positioningDisabled = syllabification.method === "none";
  const positioningValue = positioningDisabled ? "words_only" : settings.positioning ?? defaultTranscription.positioning;

  useEffect(() => onDraftChange?.({ transcriptionModel, settings, syllabification }), [transcriptionModel, settings, syllabification]);

  function changeSyllabification(method) {
    setSyllabification({ method });
    if (method === "none") setSettings((current) => ({ ...current, positioning: "words_only" }));
  }

  return (
    <StageFormShell title="Transkrypcja" embedded={embedded}>
      <div className="controls-row">
        <Select label="Wykrywanie mowy" tooltip={MODEL_TOOLTIPS.vad} value={settings.vadMethod} onChange={(value) => setSettings((current) => ({ ...current, vadMethod: value }))} options={[["silero", "Silero"], ["pyannote", "pyannote"]]} />
        <Select label="Transkrypcja" tooltip={MODEL_TOOLTIPS.transcription} value={transcriptionModel} onChange={setTranscriptionModel} options={[["large-v3", "large-v3"], ["large-v3-turbo", "large-v3-turbo"]]} />
        <Select label="Sylabizacja" tooltip={MODEL_TOOLTIPS.syllabification} value={syllabification.method} onChange={changeSyllabification} options={SYLLABIFICATION_OPTIONS} />
      </div>
      <div className="advanced">
        <div className="form-grid compact transcription-settings-grid">
          <Select label="Pozycjonowanie" helper="return_char_alignments" tooltip={MODEL_TOOLTIPS.positioning} value={positioningValue} disabled={positioningDisabled} onChange={(value) => setSettings({ ...settings, positioning: value })} options={TRANSCRIPTION_POSITIONING_OPTIONS} />
          {TRANSCRIPTION_STAGE_FIELDS.filter(([, field]) => !field.methods || field.methods.includes(settings.vadMethod)).map(([key, field]) => (
            <TextField key={key} label={field.label} helper={field.helper ?? key} tooltip={field.tooltip} type="number" step={field.step} value={settings[key] ?? ""} onChange={(next) => setSettings((current) => ({ ...current, [key]: Number(next) }))} />
          ))}
        </div>
      </div>
      <button className="button primary" type="button" disabled={busy} onClick={() => onSubmit("transcribing", { profiles: { ...job.profiles, transcriptionModel }, transcriptionSettings: serializeTranscriptionSettings(settings, syllabification), syllabificationSettings: syllabification })}>
        <Play size={16} /> Uruchom transkrypcję
      </button>
    </StageFormShell>
  );
}

function PitchStageForm({ job, busy, onSubmit, embedded = false, draft = {}, onDraftChange }) {
  const [settings, setSettings] = useState({ ...defaultPitch, ...(job.pitchSettings ?? {}), ...(draft.settings ?? {}) });
  const [pitchProfile, setPitchProfile] = useState(draft.pitchProfile ?? job.profiles?.pitch ?? "fast");
  useEffect(() => onDraftChange?.({ settings, pitchProfile }), [settings, pitchProfile]);
  return (
    <StageFormShell title="Detekcja tonów" embedded={embedded}>
      <div className="advanced">
        <div className="form-grid compact pitch-settings-grid">
          <Select label="Profil analizy" helper="torchcrepe" value={pitchProfile} onChange={setPitchProfile} options={PITCH_PROFILE_OPTIONS} />
          {PITCH_DETECTION_FIELDS.map(([key, field]) => (
            <TextField key={key} label={field.label} helper={key} tooltip={field.tooltip} type="number" step={field.step} value={settings[key]} onChange={(next) => setSettings({ ...settings, [key]: Number(next) })} />
          ))}
        </div>
      </div>
      <button className="button primary" type="button" disabled={busy} onClick={() => onSubmit("detecting_pitch", { profiles: { ...job.profiles, pitch: pitchProfile }, pitchSettings: settings })}>
        <Play size={16} /> Uruchom detekcję tonów
      </button>
    </StageFormShell>
  );
}

function AlignmentStageForm({ job, busy, onSubmit, embedded = false, draft = {}, onDraftChange }) {
  const [sentenceGapMs, setSentenceGapMs] = useState(draft.sentenceGapMs ?? job.transcriptionSettings?.sentenceGapMs ?? "");
  const [settings, setSettings] = useState({ ...defaultPitch, ...(job.pitchSettings ?? {}), ...(draft.settings ?? {}) });
  useEffect(() => onDraftChange?.({ sentenceGapMs, settings }), [sentenceGapMs, settings]);
  return (
    <StageFormShell title="Wstępne dopasowanie" embedded={embedded}>
      <div className="form-grid compact pitch-settings-grid">
        <TextField label="Ms między sentencjami" helper="sentenceGapMs" tooltip="Minimalna przerwa, po której tekst jest dzielony na osobne frazy. Puste pole oznacza tryb auto." type="number" step="1" placeholder="auto" value={sentenceGapMs} onChange={setSentenceGapMs} />
        {ALIGNMENT_PITCH_FIELDS.map(([key, field]) => (
          <TextField key={key} label={field.label} helper={key} tooltip={field.tooltip} type="number" step={field.step} value={settings[key]} onChange={(next) => setSettings({ ...settings, [key]: Number(next) })} />
        ))}
      </div>
      <button className="button primary" type="button" disabled={busy} onClick={() => onSubmit("aligning", { transcriptionSettings: { ...job.transcriptionSettings, sentenceGapMs: nullableNumber(sentenceGapMs) }, pitchSettings: settings })}>
        <Play size={16} /> Wykonaj dopasowanie
      </button>
    </StageFormShell>
  );
}

function ProcessingSummary({ job, busy, onSubmit, onSourceSubmit, onResumeStage, onOpenReview, stageWorkingState = {}, onStageWorkingStateChange }) {
  const artifactsById = Object.fromEntries((job.artifacts ?? []).map((asset) => [asset.assetId, asset]));
  const stages = sortedStages(job.processing).filter((stage) => stage.status !== "pending" || stage.actionRequired);
  const jobRunning = sortedStages(job.processing).some((stage) => stage.status === "running");
  const stageRefs = useRef({});
  const previousStatuses = useRef({});
  const [editingStage, setEditingStage] = useState(stageWorkingState.__activeStage ?? null);
  const [previewAsset, setPreviewAsset] = useState(null);

  useEffect(() => {
    const previous = previousStatuses.current;
    const completed = sortedStages(job.processing).find((stage) => previous[stageDomKey(stage)] && previous[stageDomKey(stage)] !== "completed" && stage.status === "completed");
    previousStatuses.current = Object.fromEntries(sortedStages(job.processing).map((stage) => [stageDomKey(stage), stage.status]));
    if (!completed) return;
    const allStages = sortedStages(job.processing);
    const nextStage = allStages[stageIndex(completed) + 1];
    const targetKey = nextStage ? stageDomKey(nextStage) : stageDomKey(completed);
    window.requestAnimationFrame(() => {
      stageRefs.current[targetKey]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [job.processing]);

  useEffect(() => {
    if (!editingStage) return;
    const stage = sortedStages(job.processing).find((item) => item.stage === editingStage);
    if (!stage || stage.status !== "completed") setEditingStage(null);
  }, [editingStage, job.processing]);

  function changeStage(stage) {
    setEditingStage(stage.stage);
    onStageWorkingStateChange?.((current) => ({ ...current, __activeStage: stage.stage }));
  }

  function cancelChange() {
    setEditingStage(null);
    onStageWorkingStateChange?.((current) => ({ ...current, __activeStage: null }));
  }

  async function submitStageSettings(stage, payload) {
    const saved = stage === "uploaded" ? await onSourceSubmit(payload) : await onSubmit(stage, payload);
    if (saved) setEditingStage(null);
    if (saved) onStageWorkingStateChange?.((current) => ({ ...current, __activeStage: null }));
    return saved;
  }

  return (
    <section className="processing-summary">
      <div className="summary-stage-list">
        {stages.map((stage) => {
          const artifactIds = displayArtifactIdsForStage(stage, job, artifactsById);
          const transcriptAsset = transcriptPreviewAsset(stage, job);
          const isEditing = editingStage === stage.stage && stage.status === "completed";
          return (
            <article key={stageDomKey(stage)} ref={(node) => { if (node) stageRefs.current[stageDomKey(stage)] = node; }} className="summary-stage">
              <div className="summary-stage-header">
                <div>
                  <h2>{stageLabel(stage)}</h2>
                  <small>{stage.actionRequired ? "oczekuje na ustawienia" : stage.status} · {stageDuration(stage)}</small>
                </div>
                {isConfigurableStage(stage) && stage.status === "completed" && (
                  <button className="button ghost" type="button" disabled={busy || jobRunning} onClick={() => (isEditing ? cancelChange() : changeStage(stage))}>{isEditing ? "Anuluj" : "Zmień"}</button>
                )}
                {stage.status === "failed" && (
                  <button className="button secondary" type="button" disabled={busy || jobRunning} onClick={() => onResumeStage?.(stage.stage)}>Kontynuuj</button>
                )}
              </div>
              <div className={transcriptAsset ? "summary-with-preview" : undefined}>
                <dl className="summary">{stageSettingsSummary(job, stage).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
                {transcriptAsset && <TranscriptionTextPreview jobId={job.jobId} asset={transcriptAsset} />}
              </div>
              {stage.logExcerpt && <pre className="stage-log">{stage.logExcerpt}</pre>}
              <div className="artifact-links">
                {artifactIds.map((assetId) => {
                  const asset = artifactsById[assetId];
                  return <ArtifactPreviewButton key={assetId} asset={asset} fallback={assetId} onOpen={setPreviewAsset} />;
                })}
              </div>
              {(stage.actionRequired || isEditing) && <StageSettingsPanel job={job} stage={stage} busy={busy} onSubmit={submitStageSettings} onSourceSubmit={(form) => submitStageSettings("uploaded", form)} embedded stageWorkingState={stageWorkingState} onStageWorkingStateChange={onStageWorkingStateChange} />}
            </article>
          );
        })}
      </div>
      {job.status === "awaiting_review" && (
        <button className="button primary summary-editor-button" type="button" onClick={onOpenReview}>
          <Music2 size={16} /> Edytor dopasowania
        </button>
      )}
      {previewAsset && <ArtifactPreviewModal jobId={job.jobId} asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
    </section>
  );
}

function ArtifactPreviewButton({ asset, fallback, onOpen, iconOnly = false }) {
  const filename = artifactFilename(asset, fallback);
  if (!asset) return null;
  if (iconOnly) {
    return (
      <button className="icon-button" type="button" title={`Podgląd: ${filename}`} aria-label={`Podgląd: ${filename}`} onClick={() => onOpen(asset)}>
        <Download size={16} />
      </button>
    );
  }
  return <button className="artifact-link" type="button" onClick={() => onOpen(asset)}>{filename}</button>;
}

function TranscriptionTextPreview({ jobId, asset }) {
  const artifactUrl = `${API_BASE}/api/jobs/${jobId}/artifacts/${asset.assetId}`;
  const [preview, setPreview] = useState({ loading: true, error: null, segments: [] });

  useEffect(() => {
    const controller = new AbortController();
    setPreview({ loading: true, error: null, segments: [] });
    fetch(artifactUrl, { signal: controller.signal })
      .then(async (response) => {
        const raw = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = JSON.parse(raw);
        if (!Array.isArray(payload?.segments)) throw new Error("invalid_transcript");
        return transcriptPreviewSegments(payload.segments);
      })
      .then((segments) => setPreview({ loading: false, error: null, segments }))
      .catch((error) => {
        if (error.name !== "AbortError") {
          setPreview({ loading: false, error: "Nie udało się wczytać rozpoznanego tekstu.", segments: [] });
        }
      });
    return () => controller.abort();
  }, [artifactUrl]);

  return (
    <section className="transcription-preview" aria-label="Podgląd rozpoznanego tekstu">
      <div className="transcription-preview-text">
        {preview.loading && <span className="preview-state">Wczytywanie tekstu...</span>}
        {preview.error && <span className="preview-state error">{preview.error}</span>}
        {!preview.loading && !preview.error && preview.segments.length === 0 && <span className="preview-state">Brak rozpoznanego tekstu.</span>}
        {!preview.loading && !preview.error && preview.segments.map((segment, segmentIndex) => (
          <p key={segment.key ?? segmentIndex}>
            {segment.words.map((word, wordIndex) => (
              <span
                className={`transcript-word ${confidenceClassName(word.confidence)}`}
                key={`${segment.key ?? segmentIndex}-${wordIndex}`}
                title={confidenceTitle(word.confidence)}
              >
                {word.text}
              </span>
            ))}
          </p>
        ))}
      </div>
    </section>
  );
}

function ArtifactPreviewModal({ jobId, asset, onClose }) {
  const filename = artifactFilename(asset, asset.assetId);
  const artifactUrl = `${API_BASE}/api/jobs/${jobId}/artifacts/${asset.assetId}`;
  const previewKind = artifactPreviewKind(asset, filename);
  const isJsonPreview = isJsonArtifact(asset, filename);
  const [textPreview, setTextPreview] = useState({ loading: previewKind === "text", error: null, text: "", json: false });

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (previewKind !== "text") return undefined;
    const controller = new AbortController();
    setTextPreview({ loading: true, error: null, text: "", json: false });
    fetch(artifactUrl, { signal: controller.signal })
      .then(async (response) => {
        const raw = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!isJsonPreview) return { text: raw, json: false };
        try {
          return { text: JSON.stringify(JSON.parse(raw), null, 2), json: true };
        } catch {
          return { text: raw, json: false };
        }
      })
      .then(({ text, json }) => setTextPreview({ loading: false, error: null, text, json }))
      .catch((error) => {
        if (error.name !== "AbortError") {
          setTextPreview({ loading: false, error: "Nie udało się wczytać podglądu tekstu.", text: "", json: false });
        }
      });
    return () => controller.abort();
  }, [artifactUrl, isJsonPreview, previewKind]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="artifact-preview-modal" role="dialog" aria-modal="true" aria-labelledby="artifact-preview-title">
        <div className="modal-header">
          <strong id="artifact-preview-title">{filename}</strong>
          <button className="icon-button" type="button" title="Zamknij" aria-label="Zamknij" onClick={onClose}><X size={18} /></button>
        </div>
        <div className={`artifact-preview-content ${previewKind}`}>
          {previewKind === "image" && <img src={artifactUrl} alt={`Podgląd artefaktu ${filename}`} />}
          {previewKind === "audio" && <audio src={artifactUrl} controls autoPlay />}
          {previewKind === "text" && textPreview.loading && <p className="preview-state">Wczytywanie podglądu...</p>}
          {previewKind === "text" && textPreview.error && <p className="preview-state error">{textPreview.error}</p>}
          {previewKind === "text" && !textPreview.loading && !textPreview.error && (
            <pre className={textPreview.json ? "json-preview" : "text-preview"}>
              {textPreview.json ? renderJsonSyntax(textPreview.text) : textPreview.text}
            </pre>
          )}
          {previewKind === "unsupported" && <p className="preview-state">Brak podglądu dla tego typu pliku.</p>}
        </div>
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>Zamknij</button>
          <button className="button primary" type="button" onClick={() => triggerArtifactDownload(jobId, asset)}><Download size={16} /> Pobierz</button>
        </div>
      </section>
    </div>
  );
}

function ReviewEditor({ job, arrangement, setArrangement, onSave, onResegment, saving, onResetStage, onJobRefresh, initialWorkspace = null, onWorkspaceChange }) {
  const waveformRef = useRef(null);
  const waveSurferRef = useRef(null);
  const resumeAfterTrackChange = useRef(false);
  const activePlaybackRangeRef = useRef(null);
  const viewportSyncRef = useRef({ viewportStart: 0, zoomSec: EDITOR_WINDOW_SEC });
  const loopPlaybackRef = useRef(false);
  const [waveformReady, setWaveformReady] = useState(false);
  const [track, setTrack] = useState(initialWorkspace?.track ?? "vocals");
  const [currentTime, setCurrentTime] = useState(initialWorkspace?.currentTime ?? 0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(initialWorkspace?.selected ?? { type: "line", id: null });
  const [zoomSec, setZoomSec] = useState(initialWorkspace?.zoomSec ?? EDITOR_WINDOW_SEC);
  const [viewportStart, setViewportStart] = useState(initialWorkspace?.viewportStart ?? 0);
  const [snapToExisting, setSnapToExisting] = useState(initialWorkspace?.snapToExisting ?? true);
  const [snapThresholdMs, setSnapThresholdMs] = useState(initialWorkspace?.snapThresholdMs ?? DEFAULT_SNAP_MS);
  const [dragGuideTime, setDragGuideTime] = useState(null);
  const [loopPlayback, setLoopPlayback] = useState(initialWorkspace?.loopPlayback ?? false);
  const [limitPlaybackToWindow, setLimitPlaybackToWindow] = useState(initialWorkspace?.limitPlaybackToWindow ?? false);
  const [showNotes, setShowNotes] = useState(initialWorkspace?.showNotes ?? false);
  const [timelinePinningEnabled, setTimelinePinningEnabled] = useState(initialWorkspace?.timelinePinningEnabled ?? true);
  const [editorNotice, setEditorNotice] = useState(null);
  const [validationModal, setValidationModal] = useState(null);
  const [activeQualityFlag, setActiveQualityFlag] = useState(null);
  const [past, setPast] = useState(initialWorkspace?.past ?? []);
  const [future, setFuture] = useState(initialWorkspace?.future ?? []);

  useEffect(() => {
    onWorkspaceChange?.({
      past,
      future,
      selected,
      currentTime,
      track,
      zoomSec,
      viewportStart,
      snapToExisting,
      snapThresholdMs,
      loopPlayback,
      limitPlaybackToWindow,
      showNotes,
      timelinePinningEnabled,
    });
  }, [past, future, selected, currentTime, track, zoomSec, viewportStart, snapToExisting, snapThresholdMs, loopPlayback, limitPlaybackToWindow, showNotes, timelinePinningEnabled]);

  const assets = useMemo(() => Object.fromEntries((job.artifacts ?? []).map((asset) => [asset.type, asset])), [job.artifacts]);
  const selectedContext = useMemo(() => selectionContext(arrangement, selected), [arrangement, selected]);
  const selectedLineId = selected.type === "line" ? selected.id : selectedContext.lineIds[0];
  const selectedLine = arrangement?.lines.find((line) => line.lineId === selectedLineId) ?? arrangement?.lines[0] ?? null;
  const selectedWord = selected.type === "word" ? findWordById(arrangement, selected.id)?.word ?? null : null;
  const selectedToken = selected.type === "token" ? arrangement?.tokens.find((token) => token.tokenId === selected.id) : null;
  const qualityIssues = useMemo(() => qualityIssuesForArrangement(arrangement, job), [arrangement, job.tempo?.acceptedSongBpm]);
  const syllabificationIssue = useMemo(() => syllabificationIssueForArrangement(arrangement), [arrangement]);
  const syllabificationWarning = hasSyllabificationWarning(arrangement?.syllabification);
  const activeQualityIssue = activeQualityFlag === "syllabification" && syllabificationWarning
    ? syllabificationIssue
    : qualityIssues.find((issue) => issue.flag === activeQualityFlag && issue.count > 0) ?? null;
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
    viewportSyncRef.current = { viewportStart: windowStart, zoomSec };
  }, [windowStart, zoomSec]);

  useEffect(() => {
    loopPlaybackRef.current = loopPlayback;
  }, [loopPlayback]);

  useEffect(() => {
    if (!selected.id && arrangement?.lines[0]) setSelected({ type: "line", id: arrangement.lines[0].lineId });
  }, [arrangement?.arrangementId, selected.id]);

  useEffect(() => {
    if (activeQualityFlag && !activeQualityIssue) setActiveQualityFlag(null);
  }, [activeQualityFlag, activeQualityIssue]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Delete" || !selected.id) return;
      const target = event.target;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      event.preventDefault();
      deleteSelected();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, arrangement]);

  useEffect(() => {
    if (!audioUrl || !waveformReady || !waveformRef.current) return undefined;
    const resume = resumeAfterTrackChange.current;
    resumeAfterTrackChange.current = false;
    const targetTime = currentTime;
    const waveSurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: audioUrl,
      height: Math.max(1, waveformRef.current.clientHeight),
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
    const syncWaveformHeight = () => {
      const height = Math.max(1, waveformRef.current?.clientHeight ?? 1);
      waveSurfer.setOptions({ height });
    };
    const waveformResizeObserver = new ResizeObserver(syncWaveformHeight);
    waveformResizeObserver.observe(waveformRef.current);
    const unsubReady = waveSurfer.on("ready", () => {
      const viewport = viewportSyncRef.current;
      waveSurfer.setTime(Math.min(targetTime, duration || targetTime));
      waveSurfer.setOptions({ minPxPerSec: waveformPixelsPerSecond(waveformRef.current, viewport.zoomSec) });
      syncWaveformViewport(waveSurfer, waveformRef.current, viewport.viewportStart, viewport.zoomSec);
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
      waveformResizeObserver.disconnect();
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
    if (loopPlayback) {
      const startSec = currentTime < duration ? currentTime : 0;
      playRange(startSec, duration, { returnToStart: false });
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

  function seekTokenEdge(direction) {
    const edge = nearestTokenEdge(arrangement, currentTime, direction);
    if (edge != null) seek(edge);
  }

  function seekSentenceEdge(direction) {
    const edge = nearestLineEdge(arrangement, currentTime, direction);
    seek(edge ?? (direction === "previous" ? 0 : duration));
  }

  function selectAndSeek(type, id, timeSec) {
    setSelected({ type, id });
    if (Number.isFinite(timeSec)) seek(timeSec);
  }

  function playRange(startSec, endSec, { lockViewport = false, returnToStart = true, allowLoop = true } = {}) {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) return;
    const safeStart = Math.max(0, Math.min(Number(startSec), duration || 0));
    const safeEnd = Math.max(safeStart, Math.min(Number(endSec), duration || safeStart));
    if (safeEnd <= safeStart) {
      seek(safeStart);
      return;
    }
    activePlaybackRangeRef.current = { startSec: safeStart, endSec: safeEnd, lockViewport, returnToStart, allowLoop };
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
    if (range.allowLoop && loopPlaybackRef.current && waveSurfer) {
      setCurrentTime(range.startSec);
      waveSurfer.setTime(range.startSec);
      waveSurfer.play().catch(() => setPlaying(false));
      return true;
    }
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

  function playWordRange(word) {
    if (!word) return;
    selectAndSeek("word", word.wordId, word.startSec);
    playRange(word.startSec, word.endSec, { returnToStart: true });
  }

  function playLineRange(line) {
    if (!line) return;
    selectAndSeek("line", line.lineId, line.startSec);
    playRange(line.startSec, line.endSec, { returnToStart: true });
  }

  function zoomToRange(item) {
    if (!item) return;
    const length = Math.max(item.endSec - item.startSec, 0.02);
    const margin = Math.max(0.05, length * 0.15);
    const nextZoom = Math.max(MIN_EDITOR_WINDOW_SEC, Math.min(MAX_EDITOR_WINDOW_SEC, length + margin * 2));
    const nextMaxStart = Math.max((duration || nextZoom) - nextZoom, 0);
    const nextStart = Math.max(0, Math.min(item.startSec - margin, nextMaxStart));
    setZoomSec(nextZoom);
    setViewportStart(nextStart);
    syncWaveformViewport(waveSurferRef.current, waveformRef.current, nextStart, nextZoom);
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

  function zoom(factor) {
    setZoomSec((value) => Math.max(MIN_EDITOR_WINDOW_SEC, Math.min(MAX_EDITOR_WINDOW_SEC, value * factor)));
  }

  function zoomFromPointer(event, factor) {
    event.preventDefault();
    zoom(factor);
  }

  function zoomFromClick(event, factor) {
    if (event.detail === 0) zoom(factor);
  }

  function zoomToLine(line) {
    zoomToRange(line);
  }

  function zoomToToken(token) {
    zoomToRange(token);
  }

  function deleteSelected() {
    if (!selected.id) return;
    if (!window.confirm("Usunąć zaznaczony element?")) return;
    commit((draft) => {
      if (selected.type === "line") return deleteLine(draft, selected.id);
      if (selected.type === "word") return deleteWord(draft, selected.id);
      if (selected.type === "token") return deleteToken(draft, selected.id);
      return draft;
    });
    setSelected({ type: "line", id: null });
  }

  function setGraphViewport(nextStart) {
    const bounded = Math.max(0, Math.min(Number(nextStart), maxViewportStart));
    setViewportStart(bounded);
    syncWaveformViewport(waveSurferRef.current, waveformRef.current, bounded, zoomSec);
  }

  function setSnapThresholdInput(value) {
    const next = Number(value);
    setSnapThresholdMs(Number.isFinite(next) ? Math.max(0, next) : 0);
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
    const snapThresholdSec = Math.max(0, Number(snapThresholdMs) || 0) / 1000;
    let moved = false;
    let finalTime = graphItemStart(arrangement, kind, id);
    selectAndSeek(kind === "note" ? "note" : "token", id, graphItemStart(arrangement, kind, id));
    if (kind === "token") setDragGuideTime(graphGuideTime(arrangement, kind, id, mode));

    const onMove = (moveEvent) => {
      const deltaSec = ((moveEvent.clientX - startX) / graphWidth) * range;
      const deltaMidi = pitchRange ? -((moveEvent.clientY - startY) / pitchHeight) * Math.max(pitchRange.maxMidi - pitchRange.minMidi, 1) : 0;
      if (Math.abs(deltaSec) < 0.001 && Math.abs(deltaMidi) < 0.1) return;
      moved = true;
      const next = normalizeArrangement(updateGraphItem(clone(before), kind, id, mode, deltaSec, deltaMidi, { snapToExisting, snapThresholdSec }));
      finalTime = graphItemStart(next, kind, id);
      if (kind === "token") setDragGuideTime(graphGuideTime(next, kind, id, mode));
      setArrangement(next);
    };

    const stopDrag = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      if (kind === "token") setDragGuideTime(null);
      if (moved) {
        setPast((items) => [...items.slice(-49), before]);
        setFuture([]);
        seek(finalTime);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
    window.addEventListener("pointercancel", stopDrag, { once: true });
  }

  function startGraphBackgroundDrag(event, windowStart, windowEnd) {
    if (event.button !== 0) return;
    event.preventDefault();
    const graph = event.currentTarget;
    const rect = graph.getBoundingClientRect();
    const graphWidth = graph.clientWidth || 1;
    const range = Math.max(windowEnd - windowStart, 0.001);
    const startX = event.clientX;
    const startOffsetX = Math.max(0, Math.min(graphWidth, startX - rect.left));
    const startViewport = windowStart;
    let didPan = false;

    const onMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      if (!didPan && Math.abs(deltaPx) < GRAPH_PAN_THRESHOLD_PX) return;
      didPan = true;
      const deltaSec = (deltaPx / graphWidth) * range;
      setGraphViewport(startViewport - deltaSec);
    };

    const stopDrag = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      if (!didPan) seek(windowStart + (startOffsetX / graphWidth) * range);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
    window.addEventListener("pointercancel", stopDrag, { once: true });
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
    <section className={`workspace-panel editor-shell ${timelinePinningEnabled ? "timeline-pinning-enabled" : ""}`}>
      <div className="editor-top">
        <div>
          <h1>Dopasowanie</h1>
          <div className="editor-meta">
            <span>Revision {arrangement.revision}</span>
            <span>{arrangement.lines.length} sentencji</span>
            <span>Odstęp sentencji: {sentenceGapLabel(arrangement)}</span>
            <span>{arrangement.noteEvents.length} nut</span>
          </div>
        </div>
        <div className="editor-actions">
          <button className="icon-button" type="button" title="Undo" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={16} /></button>
          <button className="icon-button" type="button" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={16} /></button>
          <button className="button secondary" type="button" onClick={() => onResetStage("aligning")}><Workflow size={16} /> Wróć do audio</button>
          <ExportKaraokeButton job={job} saving={saving} onSave={onSave} onJobRefresh={onJobRefresh} onValidationError={setValidationModal} />
        </div>
      </div>

      {editorNotice && (
        <div className="editor-notice" role="alert">
          <span>{editorNotice}</span>
          <button className="button ghost" type="button" onClick={() => setEditorNotice(null)}>OK</button>
        </div>
      )}

      <CombinedEditorGraph bindWaveform={bindWaveform} arrangement={arrangement} selectedContext={selectedContext} highlightedTokenIds={activeQualityIssue?.tokenIds ?? []} selectAndSeek={selectAndSeek} playTokenRange={playTokenRange} playLineRange={playLineRange} startGraphDrag={startGraphDrag} startGraphBackgroundDrag={startGraphBackgroundDrag} dragGuideTime={dragGuideTime} currentTime={currentTime} duration={duration} windowStart={windowStart} windowEnd={windowEnd} zoomSec={zoomSec} onViewportChange={setGraphViewport} assets={assets} effectiveTrack={effectiveTrack} changeTrack={changeTrack} zoomToLine={zoomToLine} zoomToToken={zoomToToken} audioReady={Boolean(audioUrl)} playing={playing} togglePlay={togglePlay} seekPreviousTokenEdge={() => seekTokenEdge("previous")} seekNextTokenEdge={() => seekTokenEdge("next")} seekPreviousSentenceEdge={() => seekSentenceEdge("previous")} seekNextSentenceEdge={() => seekSentenceEdge("next")} loopPlayback={loopPlayback} setLoopPlayback={setLoopPlayback} seek={seek} zoomFromPointer={zoomFromPointer} zoomFromClick={zoomFromClick} limitPlaybackToWindow={limitPlaybackToWindow} setLimitPlaybackToWindow={setLimitPlaybackToWindow} snapToExisting={snapToExisting} setSnapToExisting={setSnapToExisting} snapThresholdMs={snapThresholdMs} setSnapThresholdInput={setSnapThresholdInput} showNotes={showNotes} setShowNotes={setShowNotes} timelinePinningEnabled={timelinePinningEnabled} setTimelinePinningEnabled={setTimelinePinningEnabled} />

      <div className="quality-strip">
        <SyllabificationBadge
          info={arrangement.syllabification}
          active={activeQualityFlag === "syllabification"}
          onToggle={() => setActiveQualityFlag((current) => current === "syllabification" ? null : "syllabification")}
        />
        {qualityIssues.map(({ flag, count }) => count ? (
          <button
            key={flag}
            className={`quality-badge warning quality-filter ${activeQualityFlag === flag ? "quality-highlight" : ""}`}
            type="button"
            aria-pressed={activeQualityFlag === flag}
            onClick={() => setActiveQualityFlag((current) => current === flag ? null : flag)}
          >
            {FLAG_LABELS[flag] ?? flag}: {count}
          </button>
        ) : <span key={flag} className="quality-badge ok">{FLAG_LABELS[flag] ?? flag}: 0</span>)}
      </div>

      <div className="editor-grid">
        <PhraseList arrangement={arrangement} selected={selected} selectedContext={selectedContext} highlightedTokenIds={activeQualityIssue?.tokenIds ?? []} highlightedWordIds={activeQualityIssue?.wordIds ?? []} acceptedSongBpm={job.tempo?.acceptedSongBpm} selectAndSeek={selectAndSeek} playTokenRange={playTokenRange} playWordRange={playWordRange} playLineRange={playLineRange} commit={commit} zoomToLine={zoomToLine} zoomToToken={zoomToToken} />
        <PropertiesPanel
          arrangement={arrangement}
          selected={selected}
          selectAndSeek={selectAndSeek}
          selectedLine={selectedLine}
          selectedWord={selectedWord}
          selectedToken={selectedToken}
          acceptedSongBpm={job.tempo?.acceptedSongBpm}
          commit={commit}
          onSplitLine={splitSelectedLineAtPlayhead}
        />
      </div>
      {validationModal && <ValidationModal report={validationModal} onClose={() => setValidationModal(null)} />}
    </section>
  );
}

function ExportKaraokeButton({ job, saving, onSave, onJobRefresh, onValidationError }) {
  const [busy, setBusy] = useState(false);

  async function exportKaraoke() {
    setBusy(true);
    try {
      await onSave(true);
      const selection = exportSelectionForJob(job);
      const report = await apiJson(`/api/jobs/${job.jobId}/exports/validate`, {
        method: "POST",
        body: JSON.stringify(selection),
        headers: { "Content-Type": "application/json" },
      });
      if (!report.valid) {
        onValidationError(report);
        return;
      }
      const result = await apiJson(`/api/jobs/${job.jobId}/exports/karaoke`, {
        method: "POST",
        body: JSON.stringify(selection),
        headers: { "Content-Type": "application/json" },
      });
      await onJobRefresh?.();
      const asset = result.exports?.[0];
      if (asset) triggerArtifactDownload(job.jobId, asset);
    } catch (err) {
      const report = err.details?.report;
      if (report) {
        onValidationError(report);
      } else {
        onValidationError({
          valid: false,
          errors: [{ code: "export_failed", message: err.message, severity: "error" }],
          warnings: [],
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const pending = saving || busy;

  return (
    <button className="button primary save-menu-trigger" type="button" disabled={pending} onClick={exportKaraoke}>
      <Download size={16} /> {pending ? "Eksportowanie..." : "Eksportuj"}
    </button>
  );
}

function ValidationModal({ report, onClose }) {
  const errors = report?.errors ?? [];
  const warnings = report?.warnings ?? [];
  const issues = errors.length ? errors : warnings;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="validation-modal" role="dialog" aria-modal="true" aria-labelledby="validation-modal-title">
        <div className="modal-header">
          <strong id="validation-modal-title">Eksport zablokowany</strong>
          <button className="icon-button" type="button" title="Zamknij" aria-label="Zamknij" onClick={onClose}>×</button>
        </div>
        <p>Projekt nie przeszedł walidacji eksportu. Popraw poniższe problemy i uruchom eksport ponownie.</p>
        <ul>
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <strong>{issue.code}</strong>
              <span>{issue.message}</span>
              <ValidationIssueSyllableDetails details={issue.details} />
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="button primary" type="button" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}

function ValidationIssueSyllableDetails({ details = {} }) {
  if (!details.syllableId) return null;
  const text = typeof details.text === "string" && details.text.trim() ? details.text : "[brak tekstu]";
  const midi = details.midi == null ? "[brak midi]" : details.midi;
  return (
    <dl className="validation-issue-details">
      <div><dt>Tekst sylaby</dt><dd>{text}</dd></div>
      <div><dt>Początek</dt><dd>{formatValidationStart(details.startSec)}</dd></div>
      <div><dt>Czas trwania</dt><dd>{formatValidationDuration(details.durationMs)}</dd></div>
      <div><dt>MIDI</dt><dd>{midi}</dd></div>
    </dl>
  );
}

function formatValidationStart(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? `${seconds.toFixed(3)} s` : "—";
}

function formatValidationDuration(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? `${Math.round(milliseconds)} ms` : "—";
}

function CombinedEditorGraph({ bindWaveform, arrangement, selectedContext, highlightedTokenIds, selectAndSeek, playTokenRange, playLineRange, startGraphDrag, startGraphBackgroundDrag, dragGuideTime, currentTime, duration, windowStart, windowEnd, zoomSec, onViewportChange, assets, effectiveTrack, changeTrack, zoomToLine, zoomToToken, audioReady, playing, togglePlay, seekPreviousTokenEdge, seekNextTokenEdge, seekPreviousSentenceEdge, seekNextSentenceEdge, loopPlayback, setLoopPlayback, seek, zoomFromPointer, zoomFromClick, limitPlaybackToWindow, setLimitPlaybackToWindow, snapToExisting, setSnapToExisting, snapThresholdMs, setSnapThresholdInput, showNotes, setShowNotes, timelinePinningEnabled, setTimelinePinningEnabled }) {
  const timelinePanelRef = useRef(null);
  const [isSticky, setIsSticky] = useState(false);
  const range = Math.max(windowEnd - windowStart, 0.001);
  const visibleLines = arrangement.lines.filter((line) => line.endSec >= windowStart && line.startSec <= windowEnd);
  const visibleTokens = arrangement.tokens.filter((token) => token.endSec >= windowStart && token.startSec <= windowEnd);
  const visibleGhostNotes = showNotes ? arrangement.noteEvents.filter((note) => note.endSec >= windowStart && note.startSec <= windowEnd) : [];
  const noteById = new Map(arrangement.noteEvents.map((note) => [note.noteId, note]));
  const pitchRange = pitchRangeForWindow(arrangement, visibleTokens, visibleGhostNotes, noteById);

  useEffect(() => {
    let animationFrame = null;
    const panel = timelinePanelRef.current;
    const editorShell = panel?.closest(".editor-shell");

    const syncTimelinePanelHeight = () => {
      if (!panel || !editorShell) return;
      editorShell.style.setProperty("--timeline-panel-height", `${panel.getBoundingClientRect().height}px`);
    };

    const updateStickyState = () => {
      animationFrame = null;
      if (!panel) return;
      const panelTop = panel.getBoundingClientRect().top;
      const nextIsSticky = timelinePinningEnabled && panelTop <= 1;
      setIsSticky((current) => current === nextIsSticky ? current : nextIsSticky);
    };

    const scheduleStickyUpdate = () => {
      if (animationFrame != null) return;
      animationFrame = window.requestAnimationFrame(updateStickyState);
    };

    updateStickyState();
    syncTimelinePanelHeight();
    const resizeObserver = panel ? new ResizeObserver(syncTimelinePanelHeight) : null;
    resizeObserver?.observe(panel);
    window.addEventListener("scroll", scheduleStickyUpdate, true);
    window.addEventListener("resize", scheduleStickyUpdate);

    return () => {
      resizeObserver?.disconnect();
      editorShell?.style.removeProperty("--timeline-panel-height");
      window.removeEventListener("scroll", scheduleStickyUpdate, true);
      window.removeEventListener("resize", scheduleStickyUpdate);
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
    };
  }, [timelinePinningEnabled]);

  return (
    <div ref={timelinePanelRef} className={`timeline-panel ${timelinePinningEnabled && isSticky ? "is-sticky" : ""}`}>
      <div className="timeline-header">
        <div className="track-switch subtle" role="group" aria-label="Źródło audio">
          {[
            ["source_audio", "Oryginał"],
            ["vocals", "Wokal"],
            ["instrumental", "Instrumental"],
          ].map(([key, label]) => (
            <button key={key} className={effectiveTrack === key ? "active" : ""} type="button" disabled={!assets[key]} onClick={() => changeTrack(key)}>{label}</button>
          ))}
        </div>
        <div className="timeline-tools">
          <button className="icon-button" type="button" title="poprzedni element" aria-label="poprzedni element" onClick={seekPreviousTokenEdge} onContextMenu={(event) => { event.preventDefault(); seekPreviousSentenceEdge(); }}><SkipBack size={14} /></button>
          <button className="icon-button" type="button" title="następny element" aria-label="następny element" onClick={seekNextTokenEdge} onContextMenu={(event) => { event.preventDefault(); seekNextSentenceEdge(); }}><SkipForward size={14} /></button>
          <button className={`button secondary transport-play ${playing ? "active" : ""}`} type="button" disabled={!audioReady} onClick={togglePlay}>
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pauza" : "Play"}
          </button>
          <button className={`icon-button toggle-button ${loopPlayback ? "active" : ""}`} type="button" title="Zapętl odtwarzanie" aria-label="Zapętl odtwarzanie" aria-pressed={loopPlayback} onClick={() => setLoopPlayback((value) => !value)}><RefreshCcw size={14} /></button>
          <input className="time-slider" type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(event) => seek(event.target.value)} />
          <span className="time-readout">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <button className="icon-button" type="button" title="Oddal" aria-label="Oddal" onPointerDown={(event) => zoomFromPointer(event, 1.25)} onClick={(event) => zoomFromClick(event, 1.25)}><ZoomOut size={14} /></button>
          <button className="icon-button" type="button" title="Przybliż" aria-label="Przybliż" onPointerDown={(event) => zoomFromPointer(event, 0.75)} onClick={(event) => zoomFromClick(event, 0.75)}><ZoomIn size={14} /></button>
          <button className={`icon-button toggle-button ${limitPlaybackToWindow ? "active" : ""}`} type="button" title="ogranicz odtwarzanie do widocznego zakresu" aria-label="ogranicz odtwarzanie do widocznego zakresu" aria-pressed={limitPlaybackToWindow} onClick={() => setLimitPlaybackToWindow((value) => !value)}><Lock size={14} /></button>
          <button className={`icon-button toggle-button ${showNotes ? "active" : ""}`} type="button" title="pokaż nuty diagnostyczne" aria-label="pokaż nuty diagnostyczne" aria-pressed={showNotes} onClick={() => setShowNotes((value) => !value)}><Music2 size={14} /></button>
          <button className={`icon-button toggle-button ${snapToExisting ? "active" : ""}`} type="button" title="przyciągaj elementy na wykresie" aria-label="przyciągaj elementy na wykresie" aria-pressed={snapToExisting} onClick={() => setSnapToExisting((value) => !value)}><Magnet size={14} /></button>
          <label className="snap-threshold-field">
            <input type="number" min="0" step="10" value={snapThresholdMs} onChange={(event) => setSnapThresholdInput(event.target.value)} />
            <span>ms</span>
          </label>
          <button className={`icon-button toggle-button ${timelinePinningEnabled ? "active" : ""}`} type="button" title="przypinanie wykresu" aria-label="przypinanie wykresu" aria-pressed={timelinePinningEnabled} onClick={() => setTimelinePinningEnabled((value) => !value)}>
            {timelinePinningEnabled ? <Pin size={14} fill="currentColor" /> : <PinOff size={14} />}
          </button>
        </div>
      </div>
      <div className="combined-editor-shell">
        <div ref={bindWaveform} className="waveform-canvas" />
        <div className="combined-editor-overlay" onPointerDown={(event) => startGraphBackgroundDrag(event, windowStart, windowEnd)}>
          <div className="playhead" style={{ left: `${percent(currentTime, windowStart, windowEnd)}%` }} />
          {Number.isFinite(dragGuideTime) && dragGuideTime >= windowStart && dragGuideTime <= windowEnd && (
            <div className="drag-guide-line" style={{ left: `${percent(dragGuideTime, windowStart, windowEnd)}%` }} />
          )}
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
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                playLineRange(line);
              }}
            />
          ))}
          {visibleGhostNotes.map((note) => (
            <div
              key={note.noteId}
              className={`ghost-note-block ${note.requiresReview ? "review" : ""}`}
              style={{
                left: `${percent(note.startSec, windowStart, windowEnd)}%`,
                width: `${spanPercent(note.startSec, note.endSec, windowStart, windowEnd)}%`,
                top: `${pitchTopPercent(note.midi, pitchRange.minMidi, pitchRange.maxMidi)}%`,
              }}
              title={`${note.noteId} MIDI ${note.midi}`}
            />
          ))}
          {visibleTokens.map((token) => {
            const midi = tokenAssignedMidi(token, noteById);
            const visualMidi = visualMidiForToken(arrangement, token, noteById);
            return (
              <div
                key={token.tokenId}
                className={`syllable-block note-type-${token.noteType ?? "normal"} ${midi == null ? "missing-note" : ""} ${token.isExtension ? "extension" : ""} ${selectedContext.tokenIds.includes(token.tokenId) ? "selected" : ""} ${token.requiresReview ? "review" : ""} ${highlightedTokenIds.includes(token.tokenId) ? "quality-highlight" : ""}`}
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
                  zoomToToken(token);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
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
      <GraphScrollbar duration={duration} windowStart={windowStart} zoomSec={zoomSec} onChange={onViewportChange} />
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

function PhraseList({ arrangement, selected, selectedContext, highlightedTokenIds, highlightedWordIds, acceptedSongBpm, selectAndSeek, playTokenRange, playWordRange, playLineRange, commit, zoomToLine, zoomToToken }) {
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
            <button
              type="button"
              onClick={() => selectAndSeek("line", line.lineId, line.startSec)}
              onDoubleClick={() => zoomToLine(line)}
              onContextMenu={(event) => {
                event.preventDefault();
                playLineRange(line);
              }}
            >
              <span>{formatTime(line.startSec)} - {formatTime(line.endSec)}</span>
            </button>
            <div className="word-list">
              {wordsForLine(arrangement, line).map((word) => {
                const hasWarnings = propertyQualityFlags(word.tokens, acceptedSongBpm).length > 0;
                return (
                  <div
                    key={word.wordId}
                    className={`word-block ${hasWarnings ? "review" : ""} ${selectedContext.wordIds.includes(word.wordId) ? "selected" : ""} ${highlightedWordIds.includes(word.wordId) ? "quality-highlight" : ""}`}
                    draggable
                    onDragStart={(event) => startWordDrag(event, word.wordId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropWord(event, commit, line.lineId, word.wordId)}
                  >
                    <button
                      className="word-chip"
                      type="button"
                      onClick={() => selectAndSeek("word", word.wordId, word.startSec)}
                      onDoubleClick={() => zoomToToken(word)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        playWordRange(word);
                      }}
                    >
                      {word.text || "..."}
                    </button>
                    <div className="syllable-chip-list">
                      {word.tokens.map((token) => (
                        <input
                          key={token.tokenId}
                          className={`token-chip syllable-inline-input note-type-${token.noteType ?? "normal"} ${token.midi == null ? "missing-note" : ""} ${token.requiresReview ? "review" : ""} ${selectedContext.tokenIds.includes(token.tokenId) ? "selected" : ""} ${highlightedTokenIds.includes(token.tokenId) ? "quality-highlight" : ""}`}
                          draggable
                          value={token.text || ""}
                          aria-label="Treść sylaby"
                          onDragStart={(event) => startSyllableDrag(event, token.tokenId)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => dropSyllable(event, commit, token.tokenId)}
                          onFocus={() => selectAndSeek("token", token.tokenId, token.startSec)}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectAndSeek("token", token.tokenId, token.startSec);
                          }}
                          onChange={(event) => commit((draft) => updateToken(draft, token.tokenId, { text: event.target.value || "~", isExtension: false, extendsTokenId: null }))}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            zoomToToken(token);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            playTokenRange(token);
                          }}
                        />
                      ))}
                      <button
                        className="mini-add"
                        type="button"
                        title="Dodaj sylabę"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => dropSyllableToEnd(event, commit, word.wordId)}
                        onClick={() => addSyllableFromPrompt(commit, word.tokens.at(-1)?.tokenId)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                className="mini-add word-insert"
                type="button"
                title="Dodaj wyraz"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropWordToEnd(event, commit, line.lineId)}
                onClick={() => addWordFromPrompt(commit, line.lineId, wordsForLine(arrangement, line).at(-1)?.wordId ?? null)}
              >
                +
              </button>
            </div>
          </article>
          {renderInsertControl(index + 1)}
        </React.Fragment>
      ))}
    </div>
  );
}

function PropertiesPanel({ arrangement, selected, selectAndSeek, selectedLine, selectedWord, selectedToken, acceptedSongBpm, commit, onSplitLine }) {
  if (!selectedLine) {
    return <div className="properties-panel"><div className="panel-heading"><strong>Właściwości</strong></div></div>;
  }
  const heading = selected.type === "word" ? "Wyraz" : selected.type === "token" ? "Sylaba" : "Sentencja";
  const sortedLines = [...arrangement.lines].sort((left, right) => left.startSec - right.startSec);
  const selectedLineIndex = sortedLines.findIndex((line) => line.lineId === selectedLine.lineId);
  const previousLine = selectedLineIndex > 0 ? sortedLines[selectedLineIndex - 1] : null;
  const lineInsertIndex = selectedLineIndex === -1 ? sortedLines.length : selectedLineIndex + 1;
  const selectedLineText = lineText(arrangement, selectedLine) || "...";
  const selectedWordQualityFlags = propertyQualityFlags(selectedWord?.tokens ?? [], acceptedSongBpm);
  const selectedTokenQualityFlags = propertyQualityFlags(selectedToken ? [selectedToken] : [], acceptedSongBpm);

  return (
    <div className="properties-panel">
      <div className="panel-heading">
        <strong>{heading}</strong>
      </div>

      {selected.type === "line" && (
        <div className="property-stack">
          <PropertyReadout label="Treść sentencji" value={selectedLineText} />
          <PropertyTimeRow startSec={selectedLine.startSec} endSec={selectedLine.endSec} />
          <div className="property-actions">
            <PropertyIconButton title="Scal w lewo" disabled={!previousLine} onClick={() => commit((draft) => mergeLineWithPrevious(draft, selectedLine.lineId))}><Merge size={16} /><SkipBack size={12} /></PropertyIconButton>
            <PropertyIconButton title="Scal w prawo" disabled={selectedLineIndex === -1 || selectedLineIndex >= sortedLines.length - 1} onClick={() => commit((draft) => mergeLineWithNext(draft, selectedLine.lineId))}><Merge size={16} /><SkipForward size={12} /></PropertyIconButton>
            <PropertyIconButton title="Dodaj sentencję" onClick={() => addLineFromPrompt(commit, lineInsertIndex)}><Plus size={16} /></PropertyIconButton>
            <PropertyIconButton title="Podziel sentencję" onClick={onSplitLine}><Scissors size={16} /></PropertyIconButton>
            <PropertyIconButton title="Usuń sentencję" danger onClick={() => commit((draft) => deleteLine(draft, selectedLine.lineId))}><Trash2 size={16} /></PropertyIconButton>
          </div>
          <QualityFlags flags={selectedLine.qualityFlags} />
        </div>
      )}

      {selected.type === "word" && selectedWord && (
        <div className="property-stack">
          <PropertyReadout label="Treść wyrazu" value={selectedWord.text || "..."} />
          <PropertyTimeRow startSec={selectedWord.startSec} endSec={selectedWord.endSec} />
          <div className="property-actions">
            <PropertyIconButton title="Scal w lewo" onClick={() => commit((draft) => mergeWordWithPrevious(draft, selectedWord.wordId))}><Merge size={16} /><SkipBack size={12} /></PropertyIconButton>
            <PropertyIconButton title="Scal w prawo" onClick={() => commit((draft) => mergeWordWithNext(draft, selectedWord.wordId))}><Merge size={16} /><SkipForward size={12} /></PropertyIconButton>
            <PropertyIconButton title="Dodaj wyraz" onClick={() => addWordFromPrompt(commit, selectedLine.lineId, selectedWord.wordId)}><Plus size={16} /></PropertyIconButton>
            <PropertyIconButton title="Podziel wyraz" onClick={() => commit((draft) => splitWord(draft, selectedWord.wordId))}><Scissors size={16} /></PropertyIconButton>
            <PropertyIconButton title="Usuń wyraz" danger onClick={() => commit((draft) => deleteWord(draft, selectedWord.wordId))}><Trash2 size={16} /></PropertyIconButton>
          </div>
          <QualityFlags
            flags={selectedWordQualityFlags}
            onAcceptFlag={(flag) => commit((draft) => acceptWordQualityFlag(draft, selectedWord.wordId, flag))}
          />
        </div>
      )}

      {selected.type === "token" && selectedToken && (
        <div className="property-stack">
          <div className="property-inline-row property-inline-row-token">
            <InlineField label="Sylaba" value={selectedToken.text} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { text: value || "~", isExtension: false, extendsTokenId: null }))} />
            <InlineField label="MIDI" type="number" step="1" value={selectedToken.midi ?? ""} placeholder="brak" onChange={(value) => commit((draft) => updateTokenMidi(draft, selectedToken.tokenId, value))} />
            <InlineSelect label="Typ" value={selectedToken.noteType} onChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { noteType: value }))} options={NOTE_TYPES} />
          </div>
          <EditableTimeRow
            startSec={selectedToken.startSec}
            endSec={selectedToken.endSec}
            onStartChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { startSec: Number(value) }))}
            onDurationChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { endSec: selectedToken.startSec + Number(value) }))}
            onEndChange={(value) => commit((draft) => updateToken(draft, selectedToken.tokenId, { endSec: Number(value) }))}
          />
          <div className="property-actions">
            <PropertyIconButton title="Scal w lewo" onClick={() => commit((draft) => mergeTokenWithPrevious(draft, selectedToken.tokenId))}><Merge size={16} /><SkipBack size={12} /></PropertyIconButton>
            <PropertyIconButton title="Scal w prawo" onClick={() => commit((draft) => mergeTokenWithNext(draft, selectedToken.tokenId))}><Merge size={16} /><SkipForward size={12} /></PropertyIconButton>
            <PropertyIconButton title="Dodaj sylabę" onClick={() => addSyllableFromPrompt(commit, selectedToken.tokenId)}><Plus size={16} /></PropertyIconButton>
            <PropertyIconButton title="Podziel sylabę" onClick={() => commit((draft) => splitToken(draft, selectedToken.tokenId))}><Scissors size={16} /></PropertyIconButton>
            <PropertyIconButton title="Usuń sylabę" danger onClick={() => commit((draft) => deleteToken(draft, selectedToken.tokenId))}><Trash2 size={16} /></PropertyIconButton>
          </div>
          <QualityFlags
            flags={selectedTokenQualityFlags}
            onAcceptFlag={(flag) => commit((draft) => acceptTokenQualityFlag(draft, selectedToken.tokenId, flag))}
          />
        </div>
      )}

    </div>
  );
}

function PropertyReadout({ label, value }) {
  return (
    <div className="property-readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PropertyTimeRow({ startSec, endSec }) {
  return (
    <div className="property-inline-row property-time-row">
      <PropertyReadout label="Start" value={formatPropertyTime(startSec)} />
      <PropertyReadout label="Czas" value={formatPropertyTime(endSec - startSec)} />
      <PropertyReadout label="Koniec" value={formatPropertyTime(endSec)} />
    </div>
  );
}

function EditableTimeRow({ startSec, endSec, onStartChange, onDurationChange, onEndChange }) {
  return (
    <div className="property-inline-row property-time-row">
      <InlineField label="Start" type="number" value={startSec} onChange={onStartChange} />
      <InlineField label="Czas" type="number" value={roundTime(endSec - startSec)} onChange={onDurationChange} />
      <InlineField label="Koniec" type="number" value={endSec} onChange={onEndChange} />
    </div>
  );
}

function InlineField({ label, value, onChange, type = "text", placeholder = "", step }) {
  return (
    <label className="property-inline-field">
      <span>{label}</span>
      <input type={type} value={value} step={step ?? (type === "number" ? "0.01" : undefined)} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function InlineSelect({ label, value, onChange, options }) {
  return (
    <label className="property-inline-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
    </label>
  );
}

function PropertyIconButton({ title, onClick, children, danger = false, disabled = false }) {
  return (
    <button className={`icon-button property-icon-action ${danger ? "danger" : ""}`} type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function formatPropertyTime(value) {
  return `${roundTime(value)} s`;
}

function QualityFlags({ flags = [], onAcceptFlag }) {
  if (!flags.length) return null;
  return (
    <div className="flag-list">
      {flags.map((flag) => ["uncertain_text", "uncertain_pitch", "needs_syllable_review"].includes(flag) && onAcceptFlag ? (
        <button key={flag} className="quality-badge warning quality-accept" type="button" title={qualityAcceptTooltip(flag)} onClick={() => onAcceptFlag(flag)}>
          {FLAG_LABELS[flag] ?? flag}
        </button>
      ) : <span key={flag} className="quality-badge warning">{FLAG_LABELS[flag] ?? flag}</span>)}
    </div>
  );
}

function qualityAcceptTooltip(flag) {
  if (flag === "uncertain_pitch") return "kliknij aby uznać za pewny ton";
  if (flag === "needs_syllable_review") return "Kliknij aby potwierdzić, jeśli sylaba jest ok";
  return "kliknij by oznaczyć jako prawidłowy";
}

function propertyQualityFlags(tokens, acceptedSongBpm) {
  const flags = new Set(tokens.flatMap((token) => (token.qualityFlags ?? []).filter((flag) => flag !== "too_short_note")));
  if (tokens.some((token) => isTooShortForUltraStar(token, acceptedSongBpm))) flags.add("too_short_note");
  return [...flags];
}

function TextField({ label, helper, tooltip, value, onChange, type = "text", placeholder = "", step, name, required = false }) {
  return <label className="field"><FieldLabel label={label} tooltip={tooltip} />{helper && <small>{helper}</small>}<input type={type} name={name} required={required} value={value} step={step ?? (type === "number" ? "0.01" : undefined)} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function LanguageSelect({ label, value, onChange, options }) {
  const rootRef = useRef(null);
  const optionRefs = useRef([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find(([code]) => code === value) ?? [value, value || "Auto"];
  const normalizedQuery = normalizeSearchText(query);
  const visibleOptions = [
    options[0],
    ...options.slice(1).filter(([code, text]) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText(text).includes(normalizedQuery) || normalizeSearchText(code).includes(normalizedQuery);
    }),
  ];

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = visibleOptions.findIndex(([code]) => code === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, query, value, visibleOptions.length]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function chooseLanguage(code) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  function moveActiveOption(delta) {
    setActiveIndex((current) => {
      const lastIndex = visibleOptions.length - 1;
      if (lastIndex < 0) return 0;
      return Math.min(Math.max(current + delta, 0), lastIndex);
    });
  }

  function handleLanguageKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery("");
        return;
      }
      moveActiveOption(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery("");
        return;
      }
      moveActiveOption(-1);
      return;
    }

    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(visibleOptions.length - 1, 0));
      return;
    }

    if (event.key === "Enter" && open) {
      event.preventDefault();
      const activeOption = visibleOptions[activeIndex];
      if (activeOption) chooseLanguage(activeOption[0]);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="field language-field" ref={rootRef}>
      <FieldLabel label={label} />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="language-options"
        aria-activedescendant={open && visibleOptions[activeIndex] ? `language-option-${visibleOptions[activeIndex][0] || "auto"}` : undefined}
        value={open ? query : selected[1]}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleLanguageKeyDown}
      />
      {open && (
        <div className="language-options" id="language-options" role="listbox">
          {visibleOptions.map(([code, text], index) => (
            <button
              key={code || "auto"}
              ref={(node) => { optionRefs.current[index] = node; }}
              id={`language-option-${code || "auto"}`}
              className={`${code === value ? "selected" : ""} ${index === activeIndex ? "active" : ""}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseLanguage(code)}
            >
              <span>{text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Select({ label, helper, value, onChange, options, tooltip, disabled = false }) {
  return <label className="field"><FieldLabel label={label} tooltip={tooltip} />{helper && <small>{helper}</small>}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
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

function ConfirmDialog({ title, message, confirmLabel, busy, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-header">
          <h2 id="confirm-title">{title}</h2>
        </div>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="button ghost" type="button" disabled={busy} onClick={onCancel}>Anuluj</button>
          <button className="button ghost danger" type="button" disabled={busy} onClick={onConfirm}>
            <Trash2 size={16} /> {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AudioSummary({ audio, filename }) {
  return <dl className="summary"><dt>Plik</dt><dd>{filename}</dd><dt>Format</dt><dd>{audio.container ?? "-"}</dd><dt>Kodek</dt><dd>{audio.codec ?? "-"}</dd><dt>Kanały</dt><dd>{audio.channels ?? "-"}</dd><dt>Hz</dt><dd>{audio.sampleRate ?? "-"}</dd><dt>Czas</dt><dd>{audio.durationSec ? `${audio.durationSec.toFixed(2)} s` : "-"}</dd></dl>;
}

function CoverPlaceholder() {
  return <span className="cover-placeholder"><FileAudio size={42} /><span>brak okładki</span></span>;
}

function MetadataSummary({ job }) {
  const confirmedStages = sortedStages(job.processing).filter((stage) => isConfigurableStage(stage) && isSettingsConfirmed(stage));
  if (!confirmedStages.length) return <p className="empty-summary">Brak zatwierdzonych ustawień.</p>;

  return (
    <div className="settings-summary-groups">
      {confirmedStages.map((stage) => (
        <div className="settings-summary-group" key={stageDomKey(stage)}>
          <strong>{stageLabel(stage)}</strong>
          <dl className="summary">
            {stageSettingsSummary(job, stage).map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt><dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function StageRail({ job, sourceUpload }) {
  const stages = job?.processing ? sortedStages(job.processing) : defaultStages(sourceUpload);
  return <div className="stage-list">{stages.map((stage) => <div key={`${stage.stage}.${stage.substep}`} className={`stage ${stage.status} ${stage.actionRequired || stage.attention ? "action-required" : ""}`}><span /> <div><strong>{stageLabel(stage)}</strong><small>{stage.actionRequired ? "oczekuje na ustawienia" : stage.status}</small>{!stage.hideProgress && <Progress stage={stage} />}</div></div>)}</div>;
}

function StatusPanel({ job, onResetStage }) {
  const rowRefs = useRef({});
  const artifactsById = Object.fromEntries((job.artifacts ?? []).map((asset) => [asset.assetId, asset]));
  const stages = sortedStages(job.processing).filter((stage) => stage.status !== "pending" || stage.actionRequired);
  const jobRunning = sortedStages(job.processing).some((stage) => stage.status === "running");
  const runningKey = stageDomKey(stages.find((stage) => stage.status === "running"));
  const [previewAsset, setPreviewAsset] = useState(null);

  useEffect(() => {
    if (!runningKey || !rowRefs.current[runningKey]) return;
    rowRefs.current[runningKey].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [runningKey]);

  return (
    <div className="status-panel">
      {stages.map((stage) => {
        const key = stageDomKey(stage);
        const artifactIds = displayArtifactIdsForStage(stage, job, artifactsById);
        return (
          <article key={key} ref={(node) => { if (node) rowRefs.current[key] = node; }} className={`status-row ${stage.status}`}>
            <div>
              <strong>{stageLabel(stage)}</strong>
              <small>{stage.actionRequired ? "oczekuje na ustawienia" : stage.workerRole}</small>
              {stage.logExcerpt && <pre>{stage.logExcerpt}</pre>}
            </div>
            <div className="status-actions">
              <Progress stage={stage} />
              <div className="artifact-buttons">
                {isConfigurableStage(stage) && stage.status === "completed" && <button className="button ghost" type="button" disabled={jobRunning} onClick={() => onResetStage?.(stage.stage)}>Zmień</button>}
                {artifactIds.map((assetId) => <ArtifactPreviewButton key={assetId} asset={artifactsById[assetId]} fallback={assetId} onOpen={setPreviewAsset} iconOnly />)}
              </div>
            </div>
          </article>
        );
      })}
      {previewAsset && <ArtifactPreviewModal jobId={job.jobId} asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
    </div>
  );
}

function isConfigurableStage(stage) {
  return ["uploaded", "separating_vocals", "transcribing", "detecting_pitch", "aligning"].includes(stage?.stage);
}

function isSettingsConfirmed(stage) {
  return Boolean(stage?.settingsConfirmedAt || stage?.status === "completed");
}

function formatSettingValue(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return String(value);
}

function formatTranscriptionSettingValue(key, value) {
  return formatSettingValue(value);
}

function stageDuration(stage) {
  if (!stage.startedAt || !stage.finishedAt) return "czas niedostępny";
  const start = new Date(stage.startedAt).getTime();
  const end = new Date(stage.finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "czas niedostępny";
  return `${((end - start) / 1000).toFixed(1)} s`;
}

function stageSettingsSummary(job, stage) {
  const transcription = { ...defaultTranscription, ...(job.transcriptionSettings ?? {}) };
  const pitch = { ...defaultPitch, ...(job.pitchSettings ?? {}) };
  const syllabification = { ...defaultSyllabification, ...(job.syllabificationSettings ?? {}) };
  if (stage.stage === "uploaded") return [["Tytuł", job.metadata?.title || "-"], ["Artysta", job.metadata?.artist || "-"], ["Album", job.metadata?.album || "-"], ["Rok", job.metadata?.year || "-"], ["Gatunek", job.metadata?.genre || "-"], ["Język", job.metadata?.language || "auto"]];
  if (stage.stage === "detecting_bpm") return [["Rozpoznane BPM", formatSettingValue(job.tempo?.detectedSongBpm)]];
  if (stage.stage === "separating_vocals") return [["Model", job.profiles?.separationModel ?? "-"]];
  if (stage.stage === "transcribing") return [["Model", job.profiles?.transcriptionModel ?? "-"], ["VAD", transcription.vadMethod], ["Pozycjonowanie", TRANSCRIPTION_POSITIONING_LABELS[transcription.positioning] ?? transcription.positioning], ["Sylabizacja", SYLLABIFICATION_SELECT_LABELS[syllabification.method] ?? syllabification.method]];
  if (stage.stage === "detecting_pitch") return [["Profil", PITCH_PROFILE_LABELS[job.profiles?.pitch] ?? job.profiles?.pitch ?? "Dokładny"], ["Czułość dB", formatSettingValue(pitch.silenceThresholdDb)], ["Periodicity", formatSettingValue(pitch.periodicityThreshold)], ["Krok ramek", `${pitch.frameStepMs} ms`]];
  if (stage.stage === "aligning") return [["Ms między sentencjami", transcription.sentenceGapMs == null ? "auto" : `${transcription.sentenceGapMs} ms`], ["Najkrótsza nuta", `${pitch.minNoteLengthMs} ms`], ["Scalanie przerw", `${pitch.mergeGapMs} ms`]];
  return [["Ustawienia", "-"]];
}

function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function Progress({ stage }) {
  const width = stage.progressPercent ?? (stage.status === "completed" ? 100 : stage.status === "pending" ? 0 : 35);
  return <div className={`progress ${stage.progressMode} ${stage.status}`}><span style={{ width: `${width}%` }} /></div>;
}

function serializeTranscriptionSettings(settings, syllabificationSettings = defaultSyllabification) {
  const normalized = normalizeTranscriptionSettings(settings);
  const positioning = syllabificationSettings.method === "none" ? "words_only" : normalized.positioning ?? defaultTranscription.positioning;
  return {
    ...normalized,
    positioning,
    sentenceGapMs: nullableNumber(normalized.sentenceGapMs),
  };
}

function normalizeTranscriptionSettings(settings = {}) {
  const normalized = { ...defaultTranscription, ...(settings ?? {}) };
  if (settings?.vadOnset != null) {
    if (normalized.vadMethod === "pyannote" && settings.pyannoteVadOnset == null) normalized.pyannoteVadOnset = Number(settings.vadOnset);
    if (normalized.vadMethod === "silero" && settings.sileroThreshold == null) {
      normalized.sileroThreshold = Number(settings.vadOnset);
      if (settings.sileroNegThreshold == null) normalized.sileroNegThreshold = Math.max(Number(settings.vadOnset) - 0.15, 0.01);
    }
  }
  if (settings?.vadOffset != null) {
    if (normalized.vadMethod === "pyannote" && settings.pyannoteVadOffset == null) normalized.pyannoteVadOffset = Number(settings.vadOffset);
  }
  delete normalized.vadOnset;
  delete normalized.vadOffset;
  return normalized;
}

function toEditorArrangement(arrangement) {
  if (!arrangement || arrangement.lines || arrangement.tokens) return arrangement;
  const tokens = [];
  const lines = (arrangement.sentences ?? []).map((sentence) => {
    const tokenIds = [];
    (sentence.words ?? []).forEach((word) => {
      (word.syllables ?? []).forEach((syllable) => {
        const tokenId = syllable.syllableId;
        tokenIds.push(tokenId);
        tokens.push({
          tokenId,
          text: syllable.text,
          wordId: word.wordId,
          syllableIndex: syllable.syllableIndex,
          noteId: null,
          startSec: syllable.startSec,
          endSec: syllable.endSec,
          midi: syllable.midi,
          noteType: syllable.noteType ?? "normal",
          isExtension: false,
          extendsTokenId: null,
          requiresReview: syllable.requiresReview,
          qualityFlags: syllable.qualityFlags ?? [],
        });
      });
    });
    return {
      lineId: sentence.sentenceId,
      startSec: sentence.startSec,
      endSec: sentence.endSec,
      tokenIds,
      requiresReview: sentence.requiresReview,
      qualityFlags: sentence.qualityFlags ?? [],
      requestedSentenceGapMs: sentence.requestedSentenceGapMs,
      detectedSentenceGapMs: sentence.detectedSentenceGapMs,
      effectiveSentenceGapMs: sentence.effectiveSentenceGapMs,
    };
  });
  return { ...arrangement, lines, tokens };
}

function fromEditorArrangement(arrangement) {
  const sentences = (arrangement.lines ?? []).map((line, lineIndex) => {
    const lineTokens = tokensForLine(arrangement, line);
    const wordGroups = [];
    lineTokens.forEach((token, tokenIndex) => {
      const groupId = token.wordId || `word_client_${lineIndex}_${tokenIndex}`;
      const previous = wordGroups[wordGroups.length - 1];
      if (previous && previous.wordId === groupId) {
        previous.tokens.push(token);
      } else {
        wordGroups.push({ wordId: groupId, tokens: [token] });
      }
    });
    const words = wordGroups.map((group) => {
      const syllables = group.tokens.map((token, syllableIndex) => ({
        syllableId: token.tokenId,
        text: token.text || "~",
        syllableIndex,
        startSec: roundTime(token.startSec),
        endSec: roundTime(token.endSec),
        midi: Number.isFinite(token.midi) ? token.midi : null,
        noteType: token.noteType ?? "normal",
        requiresReview: Boolean(token.requiresReview),
        qualityFlags: token.qualityFlags ?? [],
      }));
      return {
        wordId: group.wordId,
        startSec: roundTime(Math.min(...syllables.map((syllable) => syllable.startSec))),
        endSec: roundTime(Math.max(...syllables.map((syllable) => syllable.endSec))),
        text: syllables.map((syllable) => syllable.text).join(""),
        confidence: null,
        requiresReview: syllables.some((syllable) => syllable.requiresReview),
        qualityFlags: [...new Set(syllables.flatMap((syllable) => syllable.qualityFlags ?? []))],
        syllables,
      };
    });
    return {
      sentenceId: line.lineId,
      startSec: roundTime(line.startSec),
      endSec: roundTime(line.endSec),
      text: words.map((word) => word.text).join(" "),
      effectiveSentenceGapMs: line.effectiveSentenceGapMs ?? null,
      requestedSentenceGapMs: line.requestedSentenceGapMs ?? null,
      detectedSentenceGapMs: line.detectedSentenceGapMs ?? null,
      requiresReview: Boolean(line.requiresReview),
      qualityFlags: line.qualityFlags ?? [],
      words,
    };
  });
  const { lines, tokens, ...rest } = arrangement;
  return { ...rest, sentences };
}

function addWordFromPrompt(commit, lineId, afterWordId = null) {
  const text = window.prompt("Nowy wyraz");
  if (!text?.trim()) return;
  commit((draft) => insertWordAfter(draft, lineId, afterWordId, text.trim()));
}

function addLineFromPrompt(commit, insertIndex) {
  const text = window.prompt("Nowa sentencja");
  if (!text?.trim()) return;
  commit((draft) => insertLineAtBoundary(draft, insertIndex, text.trim()));
}

function addSyllableFromPrompt(commit, afterTokenId) {
  if (!afterTokenId) return;
  const text = window.prompt("Nowa sylaba");
  if (!text?.trim()) return;
  commit((draft) => insertSyllableAfter(draft, afterTokenId, text.trim()));
}

function startWordDrag(event, wordId) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-mukai-word", wordId);
}

function dropWord(event, commit, lineId, targetWordId) {
  const sourceWordId = event.dataTransfer.getData("application/x-mukai-word");
  if (!sourceWordId || sourceWordId === targetWordId) return;
  event.preventDefault();
  commit((draft) => moveWordBefore(draft, lineId, sourceWordId, targetWordId));
}

function dropWordToEnd(event, commit, lineId) {
  const sourceWordId = event.dataTransfer.getData("application/x-mukai-word");
  if (!sourceWordId) return;
  event.preventDefault();
  commit((draft) => moveWordToEnd(draft, lineId, sourceWordId));
}

function startSyllableDrag(event, tokenId) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-mukai-syllable", tokenId);
}

function dropSyllable(event, commit, targetTokenId) {
  const sourceTokenId = event.dataTransfer.getData("application/x-mukai-syllable");
  if (!sourceTokenId || sourceTokenId === targetTokenId) return;
  event.preventDefault();
  event.stopPropagation();
  commit((draft) => moveSyllableBefore(draft, sourceTokenId, targetTokenId));
}

function dropSyllableToEnd(event, commit, wordId) {
  const sourceTokenId = event.dataTransfer.getData("application/x-mukai-syllable");
  if (!sourceTokenId) return;
  event.preventDefault();
  event.stopPropagation();
  commit((draft) => moveSyllableToEnd(draft, sourceTokenId, wordId));
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
  const textWasChanged = Object.prototype.hasOwnProperty.call(changes, "text") && changes.text !== token.text;
  const cleaned = cleanTiming(changes, token);
  Object.assign(token, cleaned);
  if (textWasChanged) clearQualityFlag(token, "uncertain_text");
  return draft;
}

function acceptTokenQualityFlag(draft, tokenId, flag) {
  if (!["uncertain_text", "uncertain_pitch", "needs_syllable_review"].includes(flag)) return draft;
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (token) clearQualityFlag(token, flag);
  return draft;
}

function acceptWordQualityFlag(draft, wordId, flag) {
  if (!["uncertain_text", "uncertain_pitch", "needs_syllable_review"].includes(flag)) return draft;
  const found = findWordById(draft, wordId);
  found?.word.tokens.forEach((token) => clearQualityFlag(token, flag));
  return draft;
}

function updateNote(draft, noteId, changes) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note) return draft;
  const cleaned = cleanTiming(changes, note);
  Object.assign(note, cleaned);
  return draft;
}

function updateGraphItem(draft, kind, id, mode, deltaSec, deltaMidi = 0, options = {}) {
  if (kind === "note") return draft;
  return updateTokenGraphItem(draft, id, mode, deltaSec, deltaMidi, options);
}

function updateTokenGraphItem(draft, tokenId, mode, deltaSec, deltaMidi = 0, options = {}) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (!token || !Number.isFinite(deltaSec)) return draft;
  const minLength = 0.02;
  const originalStart = token.startSec;
  const originalEnd = token.endSec;
  const exclude = { tokenId };
  if (mode === "resize-start") {
    const nextStart = Math.max(0, Math.min(originalEnd - minLength, originalStart + deltaSec));
    const snappedStart = options.snapToExisting ? snapTimeEdge(draft, nextStart, exclude, options.snapThresholdSec) : nextStart;
    token.startSec = roundTime(Math.max(0, Math.min(originalEnd - minLength, snappedStart)));
  } else if (mode === "resize-end") {
    const nextEnd = Math.max(originalStart + minLength, originalEnd + deltaSec);
    const snappedEnd = options.snapToExisting ? snapTimeEdge(draft, nextEnd, exclude, options.snapThresholdSec) : nextEnd;
    token.endSec = roundTime(Math.max(originalStart + minLength, snappedEnd));
  } else {
    const length = Math.max(originalEnd - originalStart, minLength);
    const proposedStart = Math.max(0, originalStart + deltaSec);
    const nextStart = options.snapToExisting ? snapTimeRangeStart(draft, proposedStart, proposedStart + length, exclude, options.snapThresholdSec) : proposedStart;
    token.startSec = roundTime(Math.max(0, nextStart));
    token.endSec = roundTime(token.startSec + length);
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
    const snappedStart = options.snapToExisting ? snapTimeEdge(draft, nextStart, exclude, options.snapThresholdSec) : nextStart;
    note.startSec = roundTime(Math.max(0, Math.min(originalEnd - minLength, snappedStart)));
  } else if (mode === "resize-end") {
    const nextEnd = Math.max(originalStart + minLength, originalEnd + deltaSec);
    const snappedEnd = options.snapToExisting ? snapTimeEdge(draft, nextEnd, exclude, options.snapThresholdSec) : nextEnd;
    note.endSec = roundTime(Math.max(originalStart + minLength, snappedEnd));
  } else {
    const length = Math.max(originalEnd - originalStart, minLength);
    const proposedStart = Math.max(0, originalStart + deltaSec);
    const nextStart = options.snapToExisting ? snapTimeRangeStart(draft, proposedStart, proposedStart + length, exclude, options.snapThresholdSec) : proposedStart;
    note.startSec = roundTime(Math.max(0, nextStart));
    note.endSec = roundTime(note.startSec + length);
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

function updateTokenMidi(draft, tokenId, value) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (!token) return draft;
  if (value === "" || value == null) {
    token.midi = null;
    token.requiresReview = true;
    token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "missing_note"])];
    return draft;
  }
  setTokenMidi(draft, token, Number(value));
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
}

function setTokenMidi(draft, token, value) {
  token.midi = clampMidi(value);
  clearMissingNoteFlag(token);
  clearQualityFlag(token, "uncertain_pitch");
}

function snapTimeEdge(draft, value, exclude = {}, thresholdSec = 0) {
  const candidates = collectTimeSnapCandidates(draft, exclude);
  if (!candidates.length) return value;
  const nearest = candidates.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), candidates[0]);
  return Math.abs(nearest - value) <= Math.max(0, Number(thresholdSec) || 0) ? nearest : value;
}

function snapTimeRangeStart(draft, start, end, exclude = {}, thresholdSec = 0) {
  const candidates = collectTimeSnapCandidates(draft, exclude);
  if (!candidates.length) return start;
  const threshold = Math.max(0, Number(thresholdSec) || 0);
  const startSnap = nearestSnapDelta(candidates, start, threshold);
  const endSnap = nearestSnapDelta(candidates, end, threshold);
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
    if (token.startSec < splitTime && token.endSec > splitTime) return (token.text ?? "").length >= 2;
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
  const nextTokenId = nextId("tok", draft.tokens);
  const [leftText, rightText] = splitTokenTextAtTime(token, splitTime);
  const tokenSplitTime = splitTimeForRange(token.startSec, token.endSec, splitTime);
  token.text = leftText || "~";
  token.endSec = tokenSplitTime;
  token.isExtension = false;
  token.extendsTokenId = null;
  const next = {
    ...token,
    tokenId: nextTokenId,
    text: rightText || "~",
    startSec: tokenSplitTime,
    endSec: Math.max(tokenSplitTime + MIN_TOKEN_NOTE_SEC, originalEnd),
    noteId: null,
    midi: token.midi,
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])],
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

function mergeLineWithPrevious(draft, lineId) {
  const index = draft.lines.findIndex((line) => line.lineId === lineId);
  if (index <= 0) return draft;
  return mergeLineWithNext(draft, draft.lines[index - 1].lineId);
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
  const wordId = nextId("word", draft.tokens);
  draft.tokens.push({
    tokenId,
    text: trimmed,
    wordId,
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
  token.text = leftText;
  token.endSec = midpoint;
  token.isExtension = false;
  token.extendsTokenId = null;
  const next = {
    ...token,
    tokenId: nextId("tok", draft.tokens),
    text: rightText,
    startSec: midpoint,
    endSec: Math.max(midpoint + MIN_TOKEN_NOTE_SEC, originalEnd),
    noteId: null,
    midi: token.midi,
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])],
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
  if ((token.wordId || token.tokenId) !== (next.wordId || next.tokenId)) return draft;
  token.text = `${token.text ?? ""}${next.text ?? ""}` || "~";
  token.endSec = Math.max(token.endSec, next.endSec);
  token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), ...(next.qualityFlags ?? [])])];
  if (Number.isFinite(token.midi) && Number.isFinite(next.midi)) {
    token.midi = Math.round((token.midi + next.midi) / 2);
  } else if (!Number.isFinite(token.midi) && Number.isFinite(next.midi)) {
    token.midi = next.midi;
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
    wordId: previous?.wordId ?? nextId("word", draft.tokens),
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

function insertWordAfter(draft, lineId, afterWordId, text) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (!line || !text.trim()) return draft;
  const words = wordsForLine(draft, line);
  const afterIndex = afterWordId ? words.findIndex((word) => word.wordId === afterWordId) : -1;
  const insertIndex = Math.max(0, afterIndex + 1);
  const previous = words[insertIndex - 1] ?? null;
  const next = words[insertIndex] ?? null;
  const fallbackLength = Math.max(previous ? previous.endSec - previous.startSec : 0.25, 0.2);
  const startSec = roundTime(previous ? previous.endSec : line.startSec);
  const boundedEnd = next ? Math.min(next.startSec, startSec + Math.max((next.startSec - startSec) / 2, 0.02)) : startSec + fallbackLength;
  const token = {
    tokenId: nextId("tok", draft.tokens),
    text: text.trim(),
    wordId: nextId("word", draft.tokens),
    syllableIndex: 0,
    noteId: null,
    startSec,
    endSec: roundTime(Math.max(startSec + 0.02, boundedEnd)),
    midi: null,
    noteType: "normal",
    isExtension: false,
    extendsTokenId: null,
    requiresReview: true,
    qualityFlags: ["missing_note", "needs_syllable_review"],
  };
  draft.tokens.push(token);
  if (previous?.tokens?.length) {
    const previousLastId = previous.tokens.at(-1).tokenId;
    line.tokenIds.splice(line.tokenIds.indexOf(previousLastId) + 1, 0, token.tokenId);
  } else {
    line.tokenIds.unshift(token.tokenId);
  }
  return draft;
}

function insertSyllableAfter(draft, afterTokenId, text) {
  const line = draft.lines.find((item) => item.tokenIds.includes(afterTokenId));
  const after = draft.tokens.find((item) => item.tokenId === afterTokenId);
  if (!line || !after || !text.trim()) return draft;
  const lineTokens = tokensForLine(draft, line);
  const tokenIndex = line.tokenIds.indexOf(afterTokenId);
  const next = lineTokens.find((token) => line.tokenIds.indexOf(token.tokenId) > tokenIndex);
  const fallbackLength = Math.max(after.endSec - after.startSec, 0.2);
  const startSec = roundTime(after.endSec);
  const boundedEnd = next ? Math.min(next.startSec, startSec + Math.max((next.startSec - startSec) / 2, 0.02)) : startSec + fallbackLength;
  const token = {
    ...after,
    tokenId: nextId("tok", draft.tokens),
    text: text.trim(),
    wordId: after.wordId || after.tokenId,
    syllableIndex: (after.syllableIndex ?? 0) + 1,
    noteId: null,
    startSec,
    endSec: roundTime(Math.max(startSec + 0.02, boundedEnd)),
    midi: null,
    requiresReview: true,
    qualityFlags: ["missing_note", "needs_syllable_review"],
  };
  if (!after.wordId) after.wordId = token.wordId;
  draft.tokens.push(token);
  line.tokenIds.splice(tokenIndex + 1, 0, token.tokenId);
  renumberWordSyllables(draft, token.wordId);
  return draft;
}

function updateWordText(draft, wordId, text) {
  const found = findWordById(draft, wordId);
  if (!found) return draft;
  const nextText = text.trim() || "~";
  const totalLength = found.word.tokens.reduce((sum, token) => sum + Math.max((token.text || "").length, 1), 0);
  let offset = 0;
  found.word.tokens.forEach((token, index) => {
    if (index === found.word.tokens.length - 1) {
      token.text = nextText.slice(offset) || "~";
      return;
    }
    const ratio = Math.max((token.text || "").length, 1) / Math.max(totalLength, 1);
    const length = Math.max(1, Math.round(nextText.length * ratio));
    token.text = nextText.slice(offset, offset + length) || "~";
    offset += length;
  });
  return draft;
}

function updateWordTiming(draft, wordId, changes) {
  const found = findWordById(draft, wordId);
  if (!found) return draft;
  const tokens = found.word.tokens;
  const start = "startSec" in changes ? Number(changes.startSec) : found.word.startSec;
  const end = "endSec" in changes ? Number(changes.endSec) : found.word.endSec;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return draft;
  const spans = distributeSpans(start, end, tokens.length);
  tokens.forEach((token, index) => {
    token.startSec = spans[index][0];
    token.endSec = spans[index][1];
  });
  return draft;
}

function splitWord(draft, wordId) {
  const found = findWordById(draft, wordId);
  if (!found || found.word.tokens.length < 2) return draft;
  const splitAt = Math.ceil(found.word.tokens.length / 2);
  const newWordId = nextId("word", draft.tokens);
  found.word.tokens.slice(splitAt).forEach((token, index) => {
    token.wordId = newWordId;
    token.syllableIndex = index;
    token.requiresReview = true;
    token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])];
  });
  renumberWordSyllables(draft, wordId);
  return draft;
}

function mergeWordWithPrevious(draft, wordId) {
  const found = findWordById(draft, wordId);
  if (!found) return draft;
  const words = wordsForLine(draft, found.line);
  const index = words.findIndex((word) => word.wordId === wordId);
  if (index <= 0) return draft;
  return mergeWords(draft, words[index - 1].wordId, wordId);
}

function mergeWordWithNext(draft, wordId) {
  const found = findWordById(draft, wordId);
  if (!found) return draft;
  const words = wordsForLine(draft, found.line);
  const index = words.findIndex((word) => word.wordId === wordId);
  if (index === -1 || index >= words.length - 1) return draft;
  return mergeWords(draft, wordId, words[index + 1].wordId);
}

function mergeWords(draft, targetWordId, sourceWordId) {
  draft.tokens.forEach((token) => {
    if ((token.wordId || token.tokenId) === sourceWordId) token.wordId = targetWordId;
    if ((token.wordId || token.tokenId) === targetWordId) {
      token.requiresReview = token.requiresReview || false;
      token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "needs_syllable_review"])];
    }
  });
  renumberWordSyllables(draft, targetWordId);
  return draft;
}

function mergeTokenWithPrevious(draft, tokenId) {
  const line = draft.lines.find((item) => item.tokenIds.includes(tokenId));
  if (!line) return draft;
  const index = line.tokenIds.indexOf(tokenId);
  if (index <= 0) return draft;
  return mergeTokenWithNext(draft, line.tokenIds[index - 1]);
}

function moveWordBefore(draft, lineId, sourceWordId, targetWordId) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (!line || sourceWordId === targetWordId) return draft;
  const words = wordsForLine(draft, line);
  const source = words.find((word) => word.wordId === sourceWordId);
  const target = words.find((word) => word.wordId === targetWordId);
  if (!source || !target) return draft;
  const sourceIds = new Set(source.tokens.map((token) => token.tokenId));
  const targetFirstId = target.tokens[0]?.tokenId;
  const withoutSource = line.tokenIds.filter((tokenId) => !sourceIds.has(tokenId));
  const targetIndex = withoutSource.indexOf(targetFirstId);
  if (targetIndex === -1) return draft;
  line.tokenIds = [
    ...withoutSource.slice(0, targetIndex),
    ...source.tokens.map((token) => token.tokenId),
    ...withoutSource.slice(targetIndex),
  ];
  return draft;
}

function moveWordToEnd(draft, lineId, sourceWordId) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (!line) return draft;
  const words = wordsForLine(draft, line);
  const source = words.find((word) => word.wordId === sourceWordId);
  if (!source) return draft;
  const sourceIds = new Set(source.tokens.map((token) => token.tokenId));
  line.tokenIds = [
    ...line.tokenIds.filter((tokenId) => !sourceIds.has(tokenId)),
    ...source.tokens.map((token) => token.tokenId),
  ];
  return draft;
}

function moveSyllableBefore(draft, sourceTokenId, targetTokenId) {
  const line = draft.lines.find((item) => item.tokenIds.includes(sourceTokenId) && item.tokenIds.includes(targetTokenId));
  const source = draft.tokens.find((token) => token.tokenId === sourceTokenId);
  const target = draft.tokens.find((token) => token.tokenId === targetTokenId);
  if (!line || !source || !target) return draft;
  const sourceWordId = source.wordId || source.tokenId;
  const targetWordId = target.wordId || target.tokenId;
  if (sourceWordId !== targetWordId) return draft;
  line.tokenIds = line.tokenIds.filter((tokenId) => tokenId !== sourceTokenId);
  const targetIndex = line.tokenIds.indexOf(targetTokenId);
  if (targetIndex === -1) return draft;
  line.tokenIds.splice(targetIndex, 0, sourceTokenId);
  renumberWordSyllables(draft, sourceWordId);
  return draft;
}

function moveSyllableToEnd(draft, sourceTokenId, wordId) {
  const line = draft.lines.find((item) => item.tokenIds.includes(sourceTokenId));
  const source = draft.tokens.find((token) => token.tokenId === sourceTokenId);
  if (!line || !source || (source.wordId || source.tokenId) !== wordId) return draft;
  const word = wordsForLine(draft, line).find((item) => item.wordId === wordId);
  if (!word) return draft;
  const sourceIndex = line.tokenIds.indexOf(sourceTokenId);
  line.tokenIds.splice(sourceIndex, 1);
  const lastRemaining = [...word.tokens.map((token) => token.tokenId)].filter((tokenId) => tokenId !== sourceTokenId).at(-1);
  if (lastRemaining && line.tokenIds.includes(lastRemaining)) {
    line.tokenIds.splice(line.tokenIds.indexOf(lastRemaining) + 1, 0, sourceTokenId);
  } else {
    line.tokenIds.push(sourceTokenId);
  }
  renumberWordSyllables(draft, wordId);
  return draft;
}

function deleteToken(draft, tokenId) {
  const token = draft.tokens.find((item) => item.tokenId === tokenId);
  if (!token) return draft;
  draft.lines.forEach((line) => {
    line.tokenIds = line.tokenIds.filter((item) => item !== tokenId);
  });
  draft.tokens = draft.tokens.filter((item) => item.tokenId !== tokenId);
  draft.lines = draft.lines.filter((line) => line.tokenIds.length > 0);
  return draft;
}

function deleteWord(draft, wordId) {
  const found = findWordById(draft, wordId);
  if (!found) return draft;
  const ids = new Set(found.word.tokens.map((token) => token.tokenId));
  found.line.tokenIds = found.line.tokenIds.filter((tokenId) => !ids.has(tokenId));
  draft.tokens = draft.tokens.filter((token) => !ids.has(token.tokenId));
  draft.lines = draft.lines.filter((line) => line.tokenIds.length > 0);
  return draft;
}

function deleteLine(draft, lineId) {
  const line = draft.lines.find((item) => item.lineId === lineId);
  if (!line) return draft;
  const tokenIds = new Set(line.tokenIds);
  draft.tokens = draft.tokens.filter((token) => !tokenIds.has(token.tokenId));
  draft.lines = draft.lines.filter((item) => item.lineId !== lineId);
  return draft;
}

function deleteNote(draft, noteId) {
  draft.noteEvents = draft.noteEvents.filter((note) => note.noteId !== noteId);
  return draft;
}

function splitNote(draft, noteId) {
  const note = draft.noteEvents.find((item) => item.noteId === noteId);
  if (!note) return draft;
  const midpoint = splitTimeForRange(note.startSec, note.endSec, note.startSec + (note.endSec - note.startSec) / 2);
  const originalEnd = note.endSec;
  const nextNoteId = nextId("note", draft.noteEvents);
  note.endSec = midpoint;
  const nextNote = {
    ...note,
    noteId: nextNoteId,
    startSec: midpoint,
    endSec: Math.max(midpoint + MIN_TOKEN_NOTE_SEC, originalEnd),
    requiresReview: true,
    qualityFlags: [...new Set([...(note.qualityFlags ?? []), "uncertain_pitch"])],
  };
  draft.noteEvents.push(nextNote);
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
  draft.noteEvents = draft.noteEvents.filter((item) => item.noteId !== next.noteId);
  return draft;
}

function normalizeArrangement(arrangement) {
  normalizeWordIds(arrangement);
  normalizeTokenTexts(arrangement);
  syncAssignmentQualityFlags(arrangement);
  syncTextConfidenceQualityFlags(arrangement);
  arrangement.lines.forEach((line) => {
    const tokens = tokensForLine(arrangement, line);
    if (!tokens.length) return;
    line.startSec = roundTime(Math.min(...tokens.map((token) => token.startSec)));
    line.endSec = roundTime(Math.max(...tokens.map((token) => token.endSec)));
  });
  arrangement.lines.sort((left, right) => left.startSec - right.startSec);
  arrangement.noteEvents.sort((left, right) => left.startSec - right.startSec);
  syncOverlapQualityFlags(arrangement);
  arrangement.updatedAt = new Date().toISOString();
  arrangement.qualitySummary = {
    syllablesRequiringReview: arrangement.tokens.filter((token) => token.requiresReview).length,
    notesRequiringReview: arrangement.noteEvents.filter((note) => note.requiresReview).length,
    missingNoteSyllables: arrangement.tokens.filter((token) => token.qualityFlags?.includes("missing_note")).length,
    uncertainPitchNotes: arrangement.noteEvents.filter((note) => note.qualityFlags?.includes("uncertain_pitch")).length,
    overlappingLineItems: countFlaggedItems(arrangement, "overlapping_line"),
  };
  return arrangement;
}

function normalizeWordIds(arrangement) {
  arrangement.lines.forEach((line) => {
    wordsForLine(arrangement, line).forEach((word) => {
      const stableWordId = word.wordId || word.tokens[0]?.tokenId || nextId("word", arrangement.tokens);
      word.tokens.forEach((token, index) => {
        token.wordId = stableWordId;
        token.syllableIndex = index;
      });
    });
  });
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

function syncAssignmentQualityFlags(arrangement) {
  arrangement.tokens.forEach((token) => {
    if (Number.isFinite(token.midi)) {
      clearMissingNoteFlag(token);
      return;
    }
    token.requiresReview = true;
    token.qualityFlags = [...new Set([...(token.qualityFlags ?? []), "missing_note"])];
  });
  arrangement.noteEvents.forEach((note) => {
    note.qualityFlags = withoutFlags(note.qualityFlags, ["unassigned_note"]);
    note.requiresReview = note.qualityFlags.length > 0;
  });
}

function syncTextConfidenceQualityFlags(arrangement) {
  arrangement.lines.forEach((line) => {
    if (tokensForLine(arrangement, line).some((token) => token.qualityFlags?.includes("uncertain_text"))) {
      markQualityFlag(line, "uncertain_text");
    } else {
      clearQualityFlag(line, "uncertain_text");
    }
  });
}

function syncOverlapQualityFlags(arrangement) {
  [...(arrangement.lines ?? []), ...(arrangement.tokens ?? [])].forEach((item) => clearQualityFlag(item, "overlapping_line"));
  flagOverlaps(arrangement.lines ?? [], (line) => {
    markQualityFlag(line, "overlapping_line");
    tokensForLine(arrangement, line).forEach((token) => markQualityFlag(token, "overlapping_line"));
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

function graphGuideTime(arrangement, kind, id, mode) {
  if (kind !== "token") return null;
  const token = arrangement?.tokens.find((item) => item.tokenId === id);
  if (!token) return null;
  return mode === "resize-end" ? token.endSec : token.startSec;
}

function nearestTokenEdge(arrangement, timeSec, direction) {
  if (!arrangement?.tokens?.length || !Number.isFinite(timeSec)) return null;
  const edgeSet = new Set();
  arrangement.tokens.forEach((token) => {
    if (Number.isFinite(token.startSec)) edgeSet.add(roundTime(token.startSec));
    if (Number.isFinite(token.endSec)) edgeSet.add(roundTime(token.endSec));
  });
  const edges = [...edgeSet].sort((left, right) => left - right);
  const epsilon = 0.001;
  if (direction === "previous") {
    for (let index = edges.length - 1; index >= 0; index -= 1) {
      if (edges[index] < timeSec - epsilon) return edges[index];
    }
    return null;
  }
  return edges.find((edge) => edge > timeSec + epsilon) ?? null;
}

function nearestLineEdge(arrangement, timeSec, direction) {
  if (!arrangement?.lines?.length || !Number.isFinite(timeSec)) return null;
  const edgeSet = new Set();
  arrangement.lines.forEach((line) => {
    if (Number.isFinite(line.startSec)) edgeSet.add(roundTime(line.startSec));
    if (Number.isFinite(line.endSec)) edgeSet.add(roundTime(line.endSec));
  });
  const edges = [...edgeSet].sort((left, right) => left - right);
  const epsilon = 0.001;
  if (direction === "previous") {
    for (let index = edges.length - 1; index >= 0; index -= 1) {
      if (edges[index] < timeSec - epsilon) return edges[index];
    }
    return null;
  }
  return edges.find((edge) => edge > timeSec + epsilon) ?? null;
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

function markQualityFlag(item, flag) {
  item.qualityFlags = [...new Set([...(item.qualityFlags ?? []), flag])];
  item.requiresReview = true;
}

function clearQualityFlag(item, flag) {
  item.qualityFlags = withoutFlags(item.qualityFlags, [flag]);
  item.requiresReview = item.qualityFlags.length > 0;
}

function clearMissingNoteFlag(token) {
  clearQualityFlag(token, "missing_note");
}

function nullableNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function waveformPixelsPerSecond(container, zoomSec) {
  return Math.max(24, Math.round((container?.clientWidth || 900) / Math.max(zoomSec, 1)));
}

function SyllabificationBadge({ info, active = false, onToggle }) {
  if (!info) {
    return onToggle
      ? <button className={`quality-badge warning quality-filter ${active ? "quality-highlight" : ""}`} type="button" aria-pressed={active} onClick={onToggle}>Sylabizacja: brak danych</button>
      : <span className="quality-badge warning">Sylabizacja: brak danych</span>;
  }
  const requested = info.requestedMethod;
  const applied = info.appliedMethod;
  const warning = requested && applied && requested !== applied;
  const appliedLabel = syllabificationBadgeLabel(applied);
  const requestedLabel = syllabificationBadgeLabel(requested);
  const text = warning ? `Sylabizacja: ${appliedLabel} (wybrano ${requestedLabel})` : `Sylabizacja: ${appliedLabel}`;
  if (warning && onToggle) {
    return <button className={`quality-badge warning quality-filter ${active ? "quality-highlight" : ""}`} type="button" title={info.fallbackReason ?? ""} aria-pressed={active} onClick={onToggle}>{text}</button>;
  }
  return <span className={`quality-badge ${warning ? "warning" : "ok"}`} title={info.fallbackReason ?? ""}>{text}</span>;
}

function hasSyllabificationWarning(info) {
  return !info || Boolean(info.requestedMethod && info.appliedMethod && info.requestedMethod !== info.appliedMethod);
}

function syllabificationIssueForArrangement(arrangement) {
  const tokens = arrangement?.tokens ?? [];
  return {
    flag: "syllabification",
    count: tokens.length,
    lineIds: (arrangement?.lines ?? []).map((line) => line.lineId),
    wordIds: [...new Set(tokens.map((token) => token.wordId || token.tokenId))],
    tokenIds: tokens.map((token) => token.tokenId),
  };
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

function qualityIssuesForArrangement(arrangement, job) {
  const flags = ["uncertain_text", "uncertain_pitch", "missing_note", "needs_syllable_review", "too_short_note", "overlapping_line"];
  const contexts = Object.fromEntries(flags.map((flag) => [flag, {
    flag,
    sources: new Set(),
    lineIds: new Set(),
    wordIds: new Set(),
    tokenIds: new Set(),
  }]));
  if (!arrangement) return flags.map((flag) => ({ flag, count: 0, lineIds: [], wordIds: [], tokenIds: [] }));

  const addToken = (flag, token, source = `token:${token.tokenId}`) => {
    const context = contexts[flag];
    if (!context || !token) return;
    context.sources.add(source);
    context.tokenIds.add(token.tokenId);
    context.wordIds.add(token.wordId || token.tokenId);
    arrangement.lines.filter((line) => line.tokenIds.includes(token.tokenId)).forEach((line) => context.lineIds.add(line.lineId));
  };
  const addLine = (flag, line) => {
    const context = contexts[flag];
    if (!context || !line) return;
    context.sources.add(`line:${line.lineId}`);
    context.lineIds.add(line.lineId);
    tokensForLine(arrangement, line).forEach((token) => addToken(flag, token, `line:${line.lineId}`));
  };

  arrangement.tokens.forEach((token) => {
    if (token.qualityFlags?.includes("uncertain_text")) addToken("uncertain_text", token);
    if (token.qualityFlags?.includes("uncertain_pitch")) addToken("uncertain_pitch", token);
    if (token.midi == null) addToken("missing_note", token);
    if (token.qualityFlags?.includes("needs_syllable_review")) addToken("needs_syllable_review", token);
    if (isTooShortForUltraStar(token, job?.tempo?.acceptedSongBpm)) addToken("too_short_note", token);
  });
  arrangement.lines.forEach((line) => {
    const tokens = tokensForLine(arrangement, line);
    if (line.qualityFlags?.includes("uncertain_text") && !tokens.some((token) => token.qualityFlags?.includes("uncertain_text"))) addLine("uncertain_text", line);
  });
  const sortedLines = [...arrangement.lines].sort((left, right) => left.startSec - right.startSec);
  sortedLines.forEach((line, index) => {
    const next = sortedLines[index + 1];
    if (next && line.endSec > next.startSec) {
      addLine("overlapping_line", line);
      addLine("overlapping_line", next);
    }
  });

  return flags.map((flag) => {
    const context = contexts[flag];
    return {
      flag,
      count: context.sources.size,
      lineIds: [...context.lineIds],
      wordIds: [...context.wordIds],
      tokenIds: [...context.tokenIds],
    };
  });
}

function isTooShortForUltraStar(token, acceptedSongBpm) {
  const bpm = Number(acceptedSongBpm);
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(token.startSec) || !Number.isFinite(token.endSec)) return false;
  const ultrastarBeatMs = 60000 / (bpm * 4);
  const rawLengthBeats = ((token.endSec - token.startSec) * 1000) / ultrastarBeatMs;
  return rawLengthBeats <= 0.5;
}

function countFlaggedItems(arrangement, flag) {
  return [...(arrangement.lines ?? []), ...(arrangement.tokens ?? [])].filter((item) => item.qualityFlags?.includes(flag)).length;
}

function flagOverlaps(items, mark) {
  const sorted = [...items].filter((item) => Number.isFinite(item.startSec) && Number.isFinite(item.endSec)).sort((left, right) => left.startSec - right.startSec);
  sorted.forEach((item, index) => {
    const next = sorted[index + 1];
    if (next && item.endSec > next.startSec) {
      mark(item);
      mark(next);
    }
  });
}

function sentenceGapLabel(arrangement) {
  const line = arrangement?.lines?.[0];
  const effective = line?.effectiveSentenceGapMs;
  const requested = line?.requestedSentenceGapMs;
  if (Number.isFinite(requested)) return `${requested} ms`;
  if (Number.isFinite(effective)) return `${effective} ms auto`;
  return "auto";
}

function selectionContext(arrangement, selected) {
  if (!arrangement || !selected?.id) return { lineIds: [], wordIds: [], tokenIds: [], noteIds: [] };
  const lineIds = new Set();
  const wordIds = new Set();
  const tokenIds = new Set();
  const noteIds = new Set();
  const addToken = (token) => {
    if (!token) return;
    tokenIds.add(token.tokenId);
    wordIds.add(token.wordId || token.tokenId);
    arrangement.lines.filter((line) => line.tokenIds.includes(token.tokenId)).forEach((line) => lineIds.add(line.lineId));
  };
  const addWord = (word) => {
    if (!word) return;
    wordIds.add(word.wordId);
    word.tokens.forEach(addToken);
    arrangement.lines.filter((line) => line.tokenIds.includes(word.tokens[0]?.tokenId)).forEach((line) => lineIds.add(line.lineId));
  };
  const addNote = (note) => {
    if (!note) return;
    noteIds.add(note.noteId);
    arrangement.tokens
      .filter((token) => overlaps(token, note))
      .forEach(addToken);
  };

  if (selected.type === "line") {
    const line = arrangement.lines.find((item) => item.lineId === selected.id);
    if (line) {
      lineIds.add(line.lineId);
      wordsForLine(arrangement, line).forEach(addWord);
      arrangement.noteEvents.filter((note) => overlaps(line, note)).forEach(addNote);
    }
  }
  if (selected.type === "word") {
    addWord(findWordById(arrangement, selected.id)?.word);
  }
  if (selected.type === "token") {
    const token = arrangement.tokens.find((item) => item.tokenId === selected.id);
    addToken(token);
    if (token) arrangement.noteEvents.filter((note) => overlaps(token, note)).forEach(addNote);
  }
  return { lineIds: [...lineIds], wordIds: [...wordIds], tokenIds: [...tokenIds], noteIds: [...noteIds] };
}

function overlaps(left, right) {
  return Math.min(left.endSec, right.endSec) - Math.max(left.startSec, right.startSec) > 0;
}

function currentStage(job) {
  if (!job?.processing) return null;
  const stages = sortedStages(job.processing);
  return stages.find((stage) => stage.status === "running") ?? stages.find((stage) => stage.status === "failed") ?? stages.find((stage) => stage.status === "pending") ?? stages.at(-1);
}

function readPersistedUiState() {
  if (typeof window === "undefined") return initialUiState;
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return initialUiState;
    const parsed = JSON.parse(raw);
    return {
      ...initialUiState,
      ...parsed,
      metadata: { ...emptyMetadata, ...(parsed.metadata ?? {}) },
      profiles: { ...initialUiState.profiles, ...(parsed.profiles ?? {}) },
      transcriptionSettings: normalizeTranscriptionSettings(parsed.transcriptionSettings),
      pitchSettings: { ...defaultPitch, ...(parsed.pitchSettings ?? {}) },
      syllabificationSettings: { ...defaultSyllabification, ...(parsed.syllabificationSettings ?? {}) },
      syllabificationTouched: Boolean(parsed.syllabificationTouched),
      useEmbeddedCover: parsed.useEmbeddedCover ?? true,
      reviewOpen: Boolean(parsed.reviewOpen),
      stageWorkingState: parsed.stageWorkingState ?? {},
      editorWorkspace: parsed.editorWorkspace ?? null,
    };
  } catch {
    window.localStorage.removeItem(APP_STORAGE_KEY);
    return initialUiState;
  }
}

function persistUiState(state) {
  if (typeof window === "undefined") return;
  try {
    if (!state.inspection && !state.job) {
      window.localStorage.removeItem(APP_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      APP_STORAGE_KEY,
      JSON.stringify({
        inspection: state.inspection,
        metadata: state.metadata,
        profiles: state.profiles,
        transcriptionSettings: state.transcriptionSettings,
        pitchSettings: state.pitchSettings,
        syllabificationSettings: state.syllabificationSettings,
        syllabificationTouched: state.syllabificationTouched,
        useEmbeddedCover: state.useEmbeddedCover,
        job: state.job,
        reviewOpen: state.reviewOpen,
        stageWorkingState: state.stageWorkingState,
        editorWorkspace: state.editorWorkspace,
      }),
    );
  } catch {
    // Brak miejsca lub tryb prywatny nie powinien blokować pracy nad projektem.
  }
}

function hasMeaningfulProjectState({ audioFile, coverFile, inspection, metadata, job, arrangement, reviewOpen }) {
  const hasMetadata = ["title", "artist", "album", "year", "genre", "language"].some((key) => Boolean(metadata?.[key]));
  return Boolean(
    audioFile
    || coverFile
    || inspection
    || job
    || arrangement
    || reviewOpen
    || hasMetadata
    || hasStoredProjectState()
  );
}

function hasStoredProjectState() {
  try {
    return Boolean(window.localStorage.getItem(APP_STORAGE_KEY));
  } catch {
    return false;
  }
}

function storedResetContext() {
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return {};
    const state = JSON.parse(raw);
    return {
      jobId: state.job?.jobId ?? null,
      uploadDraftId: state.inspection?.uploadDraftId ?? null,
    };
  } catch {
    return {};
  }
}

function clearBrowserProjectState() {
  try {
    window.localStorage.clear();
  } catch {
    // Reset pamięci aplikacji nie może zależeć od dostępności localStorage.
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // Nie każda przeglądarka udostępnia sessionStorage w każdym trybie.
  }
}

async function resetApplicationData(context = {}) {
  const stored = storedResetContext();
  const resetContext = {
    jobId: context.jobId ?? stored.jobId ?? null,
    uploadDraftId: context.uploadDraftId ?? stored.uploadDraftId ?? null,
  };
  clearBrowserProjectState();

  const cleanupTasks = [clearApplicationCaches()];
  if (resetContext.jobId || resetContext.uploadDraftId) {
    cleanupTasks.push(requestServerReset(resetContext));
  }
  await Promise.allSettled(cleanupTasks);
}

async function requestServerReset(context) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${API_BASE}/api/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: context.jobId, uploadDraftId: context.uploadDraftId }),
      keepalive: true,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function clearApplicationCaches() {
  if (!("caches" in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}

function reloadInitialApplication() {
  window.location.replace(window.location.pathname);
}

function confirmAndResetApplication(context) {
  if (!window.confirm("Zacząć od nowa? Wszystkie dane bieżącego projektu zostaną usunięte.")) return;
  resetApplicationData(context).finally(reloadInitialApplication);
}

function defaultStages(sourceUpload = { status: "pending", progressPercent: 0 }) {
  return [
    ["uploaded", "source", "Źródło"],
    ["preprocessing", "ffmpeg", "Preprocessing audio"],
    ["detecting_bpm", "essentia", "Rozpoznawanie BPM"],
    ["separating_vocals", "demucs", "Separacja wokalu"],
    ["transcribing", "whisperx", "Transkrypcja"],
    ["detecting_pitch", "pitch_detection", "Detekcja tonów"],
    ["aligning", "draft", "Wstępne dopasowanie"],
  ].map(([stage, substep, message], index) => index === 0 ? {
    stage,
    substep,
    message,
    status: sourceUpload.status,
    progressMode: "determinate",
    progressPercent: sourceUpload.progressPercent,
    attention: sourceUpload.status === "pending",
    hideProgress: sourceUpload.status === "pending",
  } : ({ stage, substep, message, status: "pending" }));
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

function exportSelectionForJob(job) {
  const baseFilename = defaultExportBaseFilename(job);
  const cover = (job.artifacts ?? []).find((asset) => asset.type === "cover");
  return {
    packageName: baseFilename,
    internalDirectoryName: baseFilename,
    baseFilename,
    zipNamePattern: "{baseFilename} [karaoke].zip",
    audioFilenames: {
      audio: `${baseFilename} [FULL].mp3`,
      instrumental: `${baseFilename} [INSTR].mp3`,
      vocals: `${baseFilename} [VOC].mp3`,
    },
    coverAssetId: cover?.assetId ?? null,
  };
}

function triggerArtifactDownload(jobId, asset) {
  const link = document.createElement("a");
  link.href = `${API_BASE}/api/jobs/${jobId}/artifacts/${asset.assetId}`;
  link.download = asset.filename ?? "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function triggerUrlDownload(url, filename = "") {
  const link = document.createElement("a");
  link.href = `${API_BASE}${url}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function defaultExportBaseFilename(job) {
  const title = job?.metadata?.title?.trim();
  const artist = job?.metadata?.artist?.trim();
  if (artist && title) return `${artist} - ${title}`;
  if (title) return title;
  const source = (job?.artifacts ?? []).find((asset) => asset.type === "source_audio");
  const filename = source?.originalFilename || source?.path?.split("/").at(-1) || "Mukai Export";
  return filename.replace(/\.[^.]+$/, "") || "Mukai Export";
}

function artifactFilename(asset, fallback) {
  if (!asset) return fallback;
  if (asset.originalFilename) return asset.originalFilename;
  if (asset.path) return asset.path.split("/").at(-1);
  return asset.type ?? fallback;
}

function transcriptPreviewAsset(stage, job) {
  if (stageDomKey(stage) !== "transcribing.whisperx") return null;
  return (job.artifacts ?? []).find((asset) => asset.type === "transcript_aligned") ?? null;
}

function transcriptPreviewSegments(segments) {
  return segments.map((segment, segmentIndex) => {
    const segmentConfidence = finiteConfidence(segment.confidence);
    const words = Array.isArray(segment.words)
      ? segment.words
        .map((word) => ({
          text: String(word.word ?? word.text ?? "").trim(),
          confidence: finiteConfidence(word.confidence) ?? segmentConfidence,
        }))
        .filter((word) => word.text)
      : [];
    if (words.length) return { key: segment.id ?? segmentIndex, words };
    const fallbackText = String(segment.text ?? "").trim();
    return fallbackText
      ? { key: segment.id ?? segmentIndex, words: [{ text: fallbackText, confidence: segmentConfidence }] }
      : null;
  }).filter(Boolean);
}

function finiteConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? confidence : null;
}

function confidenceClassName(confidence) {
  if (confidence == null || confidence < 0.55) return "confidence-low";
  if (confidence < 0.8) return "confidence-medium";
  return "confidence-high";
}

function confidenceTitle(confidence) {
  return confidence == null ? "Pewność: brak" : `Pewność: ${confidence.toFixed(3)}`;
}

function artifactPreviewKind(asset, filename) {
  const mimeType = String(asset?.mimeType ?? "").toLowerCase().split(";", 1)[0].trim();
  const extension = artifactExtension(filename);
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (mimeType.startsWith("audio/") || ["wav", "mp3", "flac", "m4a", "ogg", "aac"].includes(extension)) return "audio";
  if (mimeType === "application/json" || mimeType.startsWith("text/") || ["json", "txt", "log", "csv", "md", "yaml", "yml", "xml"].includes(extension)) return "text";
  return "unsupported";
}

function isJsonArtifact(asset, filename) {
  const mimeType = String(asset?.mimeType ?? "").toLowerCase().split(";", 1)[0].trim();
  return mimeType === "application/json" || artifactExtension(filename) === "json";
}

function artifactExtension(filename) {
  const match = String(filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function renderJsonSyntax(text) {
  const tokenPattern = /"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const rendered = [];
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) rendered.push(text.slice(cursor, index));
    const token = match[0];
    const remainder = text.slice(index + token.length);
    let tokenClass = "json-number";
    if (token.startsWith("\"") && /^\s*:/.test(remainder)) tokenClass = "json-key";
    else if (token.startsWith("\"")) tokenClass = "json-string";
    else if (token === "true" || token === "false") tokenClass = "json-boolean";
    else if (token === "null") tokenClass = "json-null";
    rendered.push(<span className={tokenClass} key={`${index}-${token.length}`}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < text.length) rendered.push(text.slice(cursor));
  return rendered;
}

function tokensForLine(arrangement, line) {
  const byId = Object.fromEntries(arrangement.tokens.map((token) => [token.tokenId, token]));
  return line.tokenIds.map((tokenId) => byId[tokenId]).filter(Boolean);
}

function wordsForLine(arrangement, line) {
  const groups = [];
  tokensForLine(arrangement, line).forEach((token, index) => {
    const wordId = token.wordId || token.tokenId || `word_${index}`;
    const previous = groups[groups.length - 1];
    if (previous && previous.wordId === wordId) {
      previous.tokens.push(token);
      previous.text += token.text || "";
      previous.startSec = Math.min(previous.startSec, token.startSec);
      previous.endSec = Math.max(previous.endSec, token.endSec);
      previous.requiresReview = previous.requiresReview || token.requiresReview;
      previous.qualityFlags = [...new Set([...(previous.qualityFlags ?? []), ...(token.qualityFlags ?? [])])];
      return;
    }
    groups.push({
      wordId,
      tokens: [token],
      text: token.text || "",
      startSec: token.startSec,
      endSec: token.endSec,
      requiresReview: Boolean(token.requiresReview),
      qualityFlags: token.qualityFlags ?? [],
    });
  });
  return groups;
}

function findWordById(arrangement, wordId) {
  if (!arrangement || !wordId) return null;
  for (const line of arrangement.lines ?? []) {
    const word = wordsForLine(arrangement, line).find((item) => item.wordId === wordId);
    if (word) return { line, word };
  }
  return null;
}

function lineText(arrangement, line) {
  return wordsForLine(arrangement, line).map((word) => word.text).filter(Boolean).join(" ");
}

function makeToken(line, index, text) {
  const start = line.startSec + ((line.endSec - line.startSec) / Math.max(index + 2, 2)) * index;
  const end = Math.min(line.endSec, start + Math.max((line.endSec - line.startSec) / Math.max(index + 2, 2), 0.01));
  return {
    tokenId: `tok_client_${Date.now()}_${index}`,
    text,
    wordId: `word_client_${Date.now()}_${index}`,
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

function renumberWordSyllables(arrangement, wordId) {
  arrangement.lines.forEach((line) => {
    tokensForLine(arrangement, line).filter((token) => (token.wordId || token.tokenId) === wordId).forEach((token, index) => {
      token.wordId = wordId;
      token.syllableIndex = index;
    });
  });
}

function distributeSpans(startSec, endSec, count) {
  const safeCount = Math.max(1, count);
  const start = roundTime(Math.max(0, startSec));
  const end = roundTime(Math.max(start + 0.01, endSec));
  const step = (end - start) / safeCount;
  return Array.from({ length: safeCount }, (_, index) => [
    roundTime(start + step * index),
    roundTime(index === safeCount - 1 ? end : start + step * (index + 1)),
  ]);
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

function apiFormWithUploadProgress(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE}${path}`);
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      const payload = request.response;
      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }
      const error = new Error(payload?.error?.message ?? `HTTP ${request.status}`);
      error.details = payload?.error?.details ?? {};
      reject(error);
    });
    request.addEventListener("error", () => reject(new Error("Nie udało się wysłać pliku.")));
    request.addEventListener("abort", () => reject(new Error("Wysyłanie pliku zostało anulowane.")));
    request.send(form);
  });
}

async function apiJson(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, init);
  return parseResponse(response);
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`);
    error.details = payload?.error?.details ?? {};
    throw error;
  }
  return payload;
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App /></AppErrorBoundary>);
