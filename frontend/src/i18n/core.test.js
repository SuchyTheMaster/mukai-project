import test from "node:test";
import assert from "node:assert/strict";
import { catalogs, LOCALE_CODES } from "./catalog.js";
import {
  AVAILABLE_LANGUAGES,
  INTERFACE_LANGUAGE_STORAGE_KEY,
  apiErrorTranslationKey,
  localizedLanguageOptions,
  normalizeLanguageCode,
  resolvePreferredLanguage,
  translate,
  translatePlural,
} from "./core.js";

function storageWith(value) {
  return { getItem: (key) => key === INTERFACE_LANGUAGE_STORAGE_KEY ? value : null };
}

test("normalizes regional codes and the jp alias", () => {
  assert.equal(normalizeLanguageCode("de-DE"), "de");
  assert.equal(normalizeLanguageCode("pt_BR"), "pt");
  assert.equal(normalizeLanguageCode("jp"), "ja");
  assert.equal(normalizeLanguageCode("ja-JP"), "ja");
});

test("stored preference wins over the browser language", () => {
  assert.equal(resolvePreferredLanguage({ storage: storageWith("fr"), browserLanguage: "de-DE" }), "fr");
});

test("invalid stored and browser languages fall back to English", () => {
  assert.equal(resolvePreferredLanguage({ storage: storageWith("xx"), browserLanguage: "pl" }), "en");
  assert.equal(resolvePreferredLanguage({ storage: storageWith(null), browserLanguage: "nl-NL" }), "en");
});

test("an unavailable storage uses the browser preference", () => {
  const storage = { getItem() { throw new Error("denied"); } };
  assert.equal(resolvePreferredLanguage({ storage, browserLanguage: "es-MX" }), "es");
});

test("every locale exposes the same complete set of non-empty messages", () => {
  const expected = Object.keys(catalogs.en).sort();
  for (const locale of LOCALE_CODES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), expected);
    for (const key of expected) assert.notEqual(catalogs[locale][key].trim(), "", `${locale}.${key}`);
  }
});

test("every interface language uses an existing local SVG flag", async () => {
  await Promise.all(AVAILABLE_LANGUAGES.map(async ({ code, flagSrc }) => {
    assert.match(flagSrc, /^\/flags\/[a-z]+\.svg$/, code);
    const { access } = await import("node:fs/promises");
    await access(new URL(`../../public${flagSrc}`, import.meta.url));
  }));
});

test("interpolation and locale plural rules are applied", () => {
  assert.equal(translate("de", "preset.deleteMessage", { name: "Rock" }).includes("Rock"), true);
  assert.equal(translatePlural("pl", "editor.sentenceCount", 2), "2 sentencje");
  assert.equal(translatePlural("en", "editor.sentenceCount", 2), "2 sentences");
  assert.equal(translatePlural("ja", "editor.noteCount", 3), "3 ノート");
});

test("song language names follow the current interface locale", () => {
  const english = Object.fromEntries(localizedLanguageOptions(["", "de", "ja"], "en"));
  const german = Object.fromEntries(localizedLanguageOptions(["", "de", "ja"], "de"));
  assert.equal(english[""], "Auto");
  assert.match(english.de, /German/i);
  assert.match(german.de, /Deutsch/i);
});

test("stable API codes map to localized message groups", () => {
  assert.equal(apiErrorTranslationKey("unsupported_extension"), "error.invalidAudio");
  assert.equal(apiErrorTranslationKey("metadata_required"), "error.metadataRequired");
  assert.equal(apiErrorTranslationKey("project_manifest_invalid"), "error.invalidProject");
  assert.equal(apiErrorTranslationKey("unknown_code"), null);
});
