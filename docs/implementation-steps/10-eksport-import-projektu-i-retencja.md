# Etap 10: Zapis i import projektu

## Cel

Dodać pełny ZIP projektu Mukai pozwalający wznowić draft uploadu, processing audio albo pracę w edytorze.

## Zakres

- Globalna akcja `EKSPORT PROJEKTU` obok `LISTA PROJEKTÓW` i `OD NOWA`.
- Eksport draftu przez `POST /api/projects/drafts/{uploadDraftId}/export`.
- Eksport `Job` przez `POST /api/jobs/{jobId}/exports/project`.
- Import przez `POST /api/projects/import`.
- Manifest `mukai-project.json` w wersji `1.0.0` z fazą `draft`, `processing` albo `review`.
- Rozdzielenie zastosowanego `appliedState` od niezatwierdzonego `workingState`.
- Zapis oryginalnego audio, coverów, wszystkich zarejestrowanych artefaktów, ustawień modeli, formularzy etapów, `Tempo`, transkrypcji, pitch, wyborów eksportu i `Arrangement`.
- Zapis `editorWorkspace`: undo/redo, zaznaczenie, playhead, viewport, ścieżka audio i ustawienia narzędzi.
- Checkpoint aktywnego processingu na ostatniej spójnej granicy etapu i automatyczne wznowienie pierwszego przerwanego etapu po imporcie.
- Walidacja struktury ZIP, wersji schematu, ścieżek, hashy, rozmiarów, liczby wpisów, metod kompresji, symlinków i szyfrowania.
- Nadawanie nowych lokalnych identyfikatorów przy imporcie oraz przepisywanie referencji.
- Brak automatycznej retencji i brak czyszczenia po zapisie projektu.

## Poza zakresem

- Import pojedynczego `mukai-project.json` bez ZIP-a.
- Serializacja pamięci aktywnego procesu AI; przerwany etap jest wykonywany od początku.
- Zapisywanie hoverów, tooltipów i stanu `playing`.
- Automatyczne usuwanie lokalnych projektów.

## Kryteria akceptacji

- Round-trip ZIP zachowuje zastosowane oraz robocze wartości użytkownika.
- Draft wraca do formularza, processing do właściwego etapu, a faza `review` do edytora.
- Ukończone etapy nie są ponownie wykonywane po imporcie checkpointu.
- Brak lub zmiana wymaganego pliku kończy import błędem bez częściowego utworzenia projektu.
- Paczka karaoke nie zawiera `mukai-project.json`, a przycisk edytora `ZAPISZ DLA GRY` nie zapisuje projektu Mukai.
- Pola `Retention` pozostają puste.

## Testy

- Eksport/import faz `draft`, `processing` i `review`.
- Zachowanie roboczych formularzy, undo/redo i ustawień edytora.
- Wznowienie dokładnie pierwszego niedokończonego etapu.
- Odrzucenie złego hasha, brakującego pliku, ZIP-slip, symlinka, duplikatu i przekroczonego limitu.
