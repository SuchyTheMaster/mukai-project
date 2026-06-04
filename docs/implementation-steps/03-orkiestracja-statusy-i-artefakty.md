# Etap 03: Orkiestracja, statusy i artefakty

## Cel

Utworzyć warstwę sterowania pipeline'em zanim pojawią się kosztowne workery AI. Etap ma pokazać pełny przepływ statusów, błędów, resetów i artefaktów na mockowanych lub lekkich zadaniach.

## Źródła prawdy

- [Architektura](../architecture.md#kolejka-i-orkiestracja)
- [Pipeline przetwarzania](../processing-pipeline.md#orkiestracja-statusy-i-postęp)
- [Kontrakty danych](../data-contracts.md#stagesnapshot)
- [Edytor UI](../editor-ui.md#status-zadania)

## Zakres

- Redis jako kolejka i mechanizm koordynacji zadań.
- Lekki worker koordynujący, który czyta zdarzenia `Job` i zapisuje `StageSnapshot`.
- Pełna mapa oczekiwanych etapów w `Job.processing`, także dla etapów jeszcze nierozpoczętych.
- Rozróżnienie statusów `pending`, `running`, `completed`, `failed` i `skipped`.
- Obsługa `progressMode`: `determinate`, `estimated`, `indeterminate`.
- Rejestrowanie krótkich komunikatów dla użytkownika i kompaktowych logów diagnostycznych bez sekretów.
- Rejestrowanie `artifactIds`, `producedByStage` i `producedBySubstep`.
- Endpoint pobierania artefaktów `GET /api/jobs/{jobId}/artifacts/{assetId}` z walidacją dostępu do ścieżek.
- Planowany reset etapu przez `POST /api/jobs/{jobId}/stages/{stage}/reset`.
- Widok statusu w UI z pełnym stage railem, postępem, ETA lub stanem indeterminate, błędami i akcjami pobierania artefaktów.
- Mockowane etapy pipeline'u pozwalające przejść od `uploaded` do kontrolowanego stanu testowego.

## Poza zakresem

- Realna konwersja FFmpeg.
- Realne modele Demucs, WhisperX i torchcrepe.
- Eksport karaoke.

## Zależności

- Etap 02 musi tworzyć `Job` w statusie `uploaded`.
- Etap 01 musi dostarczać kolejkę, bazę i magazyn artefaktów.

## Wynik etapu

- Po utworzeniu `Job` aplikacja potrafi kolejkować pracę i aktualizować statusy etapów.
- UI pokazuje pełny pipeline, nawet jeśli poszczególne etapy są jeszcze mockowane.
- Użytkownik widzi czytelny błąd, postęp i artefakty przypisane do etapów.

## Kryteria akceptacji

- API nigdy nie wykonuje ciężkiej pracy synchronicznie w żądaniu HTTP.
- Błąd workera ustawia `failed` i zapisuje etap błędu bez prywatnych ścieżek.
- Reset etapu zachowuje oryginalne audio, metadane i cover, a unieważnia etap i zależne etapy.
- Artefakt można pobrać tylko przez znany `assetId`, a nie przez dowolną ścieżkę.

## Proponowane testy

- Test integracyjny kolejki z mockowanym workerem.
- Test `StageSnapshot` dla postępu mierzalnego, estymowanego i indeterminate.
- Test błędu workera i sanitizacji logu diagnostycznego.
- Test pobierania artefaktu oraz próby path traversal.
- Test resetu etapu i listy unieważnionych zależności.
- Test UI stage rail dla stanów wykonany, przetwarzany, oczekujący i błędny.

