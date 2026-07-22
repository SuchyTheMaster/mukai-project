import { catalogs, LOCALE_CODES } from "./catalog.js";

export const INTERFACE_LANGUAGE_STORAGE_KEY = "mukai.interfaceLanguage.v1";
export const DEFAULT_INTERFACE_LANGUAGE = "en";
export const AVAILABLE_LANGUAGES = [
  { code: "pl", locale: "pl", name: "Polski", flagSrc: "/flags/pl.svg" },
  { code: "de", locale: "de", name: "Deutsch", flagSrc: "/flags/de.svg" },
  { code: "en", locale: "en", name: "English", flagSrc: "/flags/gb.svg" },
  { code: "fr", locale: "fr", name: "Français", flagSrc: "/flags/fr.svg" },
  { code: "it", locale: "it", name: "Italiano", flagSrc: "/flags/it.svg" },
  { code: "pt", locale: "pt-PT", name: "Português", flagSrc: "/flags/pt.svg" },
  { code: "es", locale: "es", name: "Español", flagSrc: "/flags/es.svg" },
  { code: "ja", locale: "ja", name: "日本語", flagSrc: "/flags/jp.svg" },
];

const supported = new Set(LOCALE_CODES);
let activeLanguage = DEFAULT_INTERFACE_LANGUAGE;

export function normalizeLanguageCode(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return normalized === "jp" ? "ja" : normalized;
}

export function resolvePreferredLanguage({ storage, browserLanguage } = {}) {
  let stored = null;
  try {
    stored = storage?.getItem?.(INTERFACE_LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored !== null) {
    const normalizedStored = normalizeLanguageCode(stored);
    return supported.has(normalizedStored) ? normalizedStored : DEFAULT_INTERFACE_LANGUAGE;
  }
  const normalizedBrowser = normalizeLanguageCode(browserLanguage);
  return supported.has(normalizedBrowser) ? normalizedBrowser : DEFAULT_INTERFACE_LANGUAGE;
}

export function resolveBrowserLanguage() {
  if (typeof window === "undefined") return DEFAULT_INTERFACE_LANGUAGE;
  return resolvePreferredLanguage({ storage: window.localStorage, browserLanguage: window.navigator?.language });
}

export function setActiveLanguage(language) {
  const normalized = normalizeLanguageCode(language);
  activeLanguage = supported.has(normalized) ? normalized : DEFAULT_INTERFACE_LANGUAGE;
  return activeLanguage;
}

export function getActiveLanguage() {
  return activeLanguage;
}

export function translate(language, key, params = {}) {
  const normalized = supported.has(normalizeLanguageCode(language)) ? normalizeLanguageCode(language) : DEFAULT_INTERFACE_LANGUAGE;
  const settingHelpFallback = key.startsWith("setting.") && key.endsWith(".help") ? catalogs[normalized]?.["setting.parameterHelp"] : null;
  const template = catalogs[normalized]?.[key] ?? settingHelpFallback ?? catalogs[DEFAULT_INTERFACE_LANGUAGE]?.[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

export function tx(key, params = {}) {
  return translate(activeLanguage, key, params);
}

export function translatePlural(language, key, count, params = {}) {
  const locale = localeFor(language);
  const category = new Intl.PluralRules(locale).select(Number(count));
  const categoryKey = `${key}.${category}`;
  const fallbackKey = `${key}.other`;
  const chosenKey = catalogs[normalizeLanguageCode(language)]?.[categoryKey] ? categoryKey : fallbackKey;
  return translate(language, chosenKey, { ...params, count });
}

export function txp(key, count, params = {}) {
  return translatePlural(activeLanguage, key, count, params);
}

export function persistInterfaceLanguage(storage, language) {
  const normalized = setActiveLanguage(language);
  try {
    storage?.setItem?.(INTERFACE_LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // Niedostępny localStorage nie może blokować zmiany języka w bieżącej sesji.
  }
  return normalized;
}

export function localeFor(language = activeLanguage) {
  return AVAILABLE_LANGUAGES.find((item) => item.code === normalizeLanguageCode(language))?.locale ?? "en";
}

export function localizedLanguageOptions(codes, language = activeLanguage) {
  const locale = localeFor(language);
  let names;
  try {
    names = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    names = new Intl.DisplayNames(["en"], { type: "language" });
  }
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return codes.map((code) => [code, code ? (names.of(code) ?? code) : translate(language, "common.auto")])
    .sort((left, right) => left[0] ? (right[0] ? collator.compare(left[1], right[1]) : 1) : -1);
}

export function formatNumber(value, options, language = activeLanguage) {
  return new Intl.NumberFormat(localeFor(language), options).format(value);
}

const API_ERROR_GROUPS = [
  ["error.invalidAudio", new Set(["unsupported_extension", "unsupported_mime", "ffprobe_rejected", "no_audio_stream"])],
  ["error.fileTooLarge", new Set(["upload_too_large", "project_archive_too_large", "project_unpacked_too_large"])],
  ["error.notFound", new Set(["job_not_found", "draft_not_found", "cover_not_found", "artifact_not_found", "artifact_missing", "arrangement_not_found"])],
  ["error.metadataRequired", new Set(["metadata_required", "missing_settings"])],
  ["error.configuration", new Set(["configuration_preset_not_found", "configuration_preset_invalid", "configuration_preset_read_only", "configuration_preset_create_conflict"])],
  ["error.jobRunning", new Set(["job_running", "job_not_editable"])],
  ["error.invalidProject", new Set(["invalid_project_zip", "project_manifest_missing", "project_manifest_invalid", "project_schema_unsupported", "project_file_missing", "project_hash_mismatch", "project_unsafe_path"])],
  ["validation.export_failed", new Set(["export_validation_failed", "missing_arrangement"])],
];

export function apiErrorTranslationKey(code) {
  return API_ERROR_GROUPS.find(([, codes]) => codes.has(code))?.[0] ?? null;
}

export function translateApiError(error, language = activeLanguage) {
  const code = error?.code || (Number.isFinite(error?.status) ? `http_${error.status}` : "unexpected");
  const key = apiErrorTranslationKey(code) ?? `error.${code}`;
  const localized = translate(language, key);
  return localized === key ? translate(language, "error.generic", { code }) : localized;
}

export function catalogKeys(language) {
  return Object.keys(catalogs[language] ?? {}).sort();
}
