import json
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from pydantic import ValidationError

from app.db import repository
from app.domain.contracts import (
    ConfigurationPresetCatalog,
    ConfigurationPresetSummary,
    Job,
    PresetConfiguration,
)


DEFAULT_PRESET_ID = "default"
DEFAULT_PRESET_PATH = Path(__file__).resolve().parents[1] / "configuration_presets" / "default.json"


@dataclass(frozen=True)
class ResolvedConfigurationPreset:
    preset_id: str
    name: str
    preset_type: str
    configuration: PresetConfiguration
    fallback_fields: list[str]


class PresetConfigurationError(ValueError):
    pass


@lru_cache(maxsize=1)
def load_default_preset_document() -> dict:
    document = json.loads(DEFAULT_PRESET_PATH.read_text(encoding="utf-8"))
    if document.get("presetId") != DEFAULT_PRESET_ID or document.get("presetType") != "predefined":
        raise PresetConfigurationError("Nieprawidłowy identyfikator lub typ domyślnego presetu.")
    configuration = document.get("configuration")
    missing = _missing_leaf_paths(configuration, PresetConfiguration().model_dump(mode="json"))
    if missing:
        raise PresetConfigurationError(f"Domyślny preset nie zawiera pól: {', '.join(missing)}")
    PresetConfiguration.model_validate(configuration)
    return document


def default_configuration(language: str | None = None) -> PresetConfiguration:
    document = load_default_preset_document()
    configuration = deepcopy(document["configuration"])
    normalized_language = (language or "").strip().lower().replace("_", "-")
    if normalized_language == "pl" or normalized_language.startswith("pl-"):
        configuration = _deep_merge(configuration, document.get("languageOverrides", {}).get("pl", {}))
    return PresetConfiguration.model_validate(configuration)


def configuration_from_job(job: Job) -> PresetConfiguration:
    return PresetConfiguration(
        profiles=job.profiles,
        transcriptionSettings=job.transcriptionSettings,
        pitchSettings=job.pitchSettings,
        syllabificationSettings=job.syllabificationSettings,
    )


def configuration_catalog() -> ConfigurationPresetCatalog:
    document = load_default_preset_document()
    summaries = [
        ConfigurationPresetSummary(
            presetId=DEFAULT_PRESET_ID,
            name=document["name"],
            presetType="predefined",
        )
    ]
    baseline = default_configuration().model_dump(mode="json")
    for row in repository.list_configuration_presets():
        raw = row.get("configuration") or {}
        missing = _missing_leaf_paths(raw, baseline)
        invalid_reason = None
        try:
            PresetConfiguration.model_validate(_deep_merge(baseline, raw))
        except (ValidationError, TypeError, ValueError) as exc:
            invalid_reason = _validation_message(exc)
        is_custom = row["preset_type"] == "custom"
        summaries.append(
            ConfigurationPresetSummary(
                presetId=row["preset_id"],
                name=row["name"],
                presetType=row["preset_type"],
                canDelete=is_custom,
                canOverwrite=is_custom,
                missingFields=missing,
                invalidReason=invalid_reason,
            )
        )
    summaries.sort(key=lambda item: (0 if item.presetId == DEFAULT_PRESET_ID else 1 if item.presetType == "predefined" else 2, item.name.casefold(), item.presetId))
    return ConfigurationPresetCatalog(presets=summaries)


def resolve_configuration_preset(preset_id: str, language: str | None) -> ResolvedConfigurationPreset:
    baseline_model = default_configuration(language)
    baseline = baseline_model.model_dump(mode="json")
    if preset_id == DEFAULT_PRESET_ID:
        document = load_default_preset_document()
        return ResolvedConfigurationPreset(DEFAULT_PRESET_ID, document["name"], "predefined", baseline_model, [])
    row = repository.get_configuration_preset(preset_id)
    if not row:
        raise KeyError(preset_id)
    raw = row.get("configuration") or {}
    missing = _missing_leaf_paths(raw, baseline)
    try:
        configuration = PresetConfiguration.model_validate(_deep_merge(baseline, raw))
    except (ValidationError, TypeError, ValueError) as exc:
        raise PresetConfigurationError(_validation_message(exc)) from exc
    return ResolvedConfigurationPreset(row["preset_id"], row["name"], row["preset_type"], configuration, missing)


def _deep_merge(baseline: dict, override: dict) -> dict:
    if not isinstance(override, dict):
        raise TypeError("Konfiguracja presetu musi być obiektem JSON.")
    merged = deepcopy(baseline)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _missing_leaf_paths(candidate, baseline, prefix: str = "") -> list[str]:
    if not isinstance(baseline, dict):
        return []
    if not isinstance(candidate, dict):
        return sorted(_leaf_paths(baseline, prefix))
    missing: list[str] = []
    for key, baseline_value in baseline.items():
        path = f"{prefix}.{key}" if prefix else key
        if key not in candidate:
            missing.extend(_leaf_paths(baseline_value, path))
        elif isinstance(baseline_value, dict):
            missing.extend(_missing_leaf_paths(candidate[key], baseline_value, path))
    return sorted(missing)


def _leaf_paths(value, prefix: str) -> list[str]:
    if isinstance(value, dict):
        return [path for key, child in value.items() for path in _leaf_paths(child, f"{prefix}.{key}" if prefix else key)]
    return [prefix]


def _validation_message(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        path = ".".join(str(item) for item in first.get("loc", []))
        return f"Nieprawidłowa wartość pola {path}: {first.get('msg', 'błąd walidacji')}"
    return str(exc)
