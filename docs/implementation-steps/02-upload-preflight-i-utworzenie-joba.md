# Etap 02: Upload, preflight i utworzenie Joba

## Cel

Dodać pierwszy realny przepływ użytkownika: wybór pliku audio, inspekcję techniczną i metadanych, akceptację ustawień oraz utworzenie `Job` w statusie `uploaded`.

## Źródła prawdy

- [Pipeline przetwarzania](../processing-pipeline.md#1-upload)
- [Kontrakty danych](../data-contracts.md#uploadinspection)
- [Edytor UI](../editor-ui.md#upload)
- [Operacje i testowanie](../operations-and-testing.md#upload-i-ekspozycja-sieciowa)

## Zakres

- Endpoint `POST /api/uploads/inspect` bez tworzenia trwałego `Job`.
- Walidacja rozmiaru uploadu do 500 MB.
- Walidacja rozszerzenia, MIME i wyniku `ffprobe`.
- Odczyt tagów audio i osadzonego covera biblioteką metadanych, np. Mutagen.
- Obsługa tagów UTF-8, UTF-16 i przypadków mieszanych bez psucia znaków narodowych.
- Zwracanie `UploadInspection`, `SourceMetadata` i `EmbeddedCover`.
- Tymczasowe przechowanie draftu uploadu i covera do czasu utworzenia `Job`.
- Formularz uploadu w React: audio, metadane, opcjonalny język, cover, profile modeli i zaawansowane ustawienia pitch.
- Wyszukiwalny combobox `Konfiguracja` z grupami plikowych/bazodanowych presetów wbudowanych i bazodanowych presetów użytkownika, oraz osobny select `Tryb` z wartościami `manual` i `automatic`.
- Rozwiązywanie częściowych presetów względem plikowego `default`, wymagane ostrzeżenie przed startem i zapis snapshotu nazwy, typu oraz pól fallbacku w `Job`.
- Domyślne profile `htdemucs_ft` i `large-v3` oraz ręczny wybór szybszych `htdemucs` i `large-v3-turbo`.
- Akcja `Przywróć domyślny` dla covera z tagów.
- Endpoint `POST /api/jobs/uploads`, który promuje zaakceptowany draft do `Job`.
- Endpoint `GET /api/jobs/{jobId}` z podstawowym statusem i metadanymi.
- Zapis oryginalnego pliku audio jako niemodyfikowanego artefaktu.
- Zapis covera z tagów albo ręcznego covera jako assetu, jeśli użytkownik go zaakceptował.

## Poza zakresem

- Normalizacja audio i start pipeline'u.
- Publikacja zadań do ciężkich workerów AI.
- Edycja tekstu i nut.
- Eksport paczek.

## Zależności

- Etap 01 musi dostarczać backend, frontend, bazę, magazyn artefaktów i podstawowe kontrakty.

## Wynik etapu

- Użytkownik może wybrać plik audio i zobaczyć jego dane techniczne.
- Formularz automatycznie uzupełnia metadane z tagów, jeśli są dostępne.
- Cover z tagów jest traktowany tak samo jak cover wybrany z dysku, z możliwością ręcznego zastąpienia.
- Po akceptacji formularza powstaje `Job` ze statusem `uploaded`.

## Kryteria akceptacji

- Pliki bez obsługiwanej ścieżki audio są odrzucane.
- `POST /api/uploads/inspect` nie tworzy `Job`.
- `POST /api/jobs/uploads` nie przyjmuje losowego pliku spoza wcześniej zaakceptowanego draftu.
- Nazwy plików są normalizowane i nie zawierają ścieżek ani znaków sterujących.
- Jeśli cover nie istnieje i użytkownik nie wskaże ręcznego covera, dalszy przepływ pozostaje poprawny.

## Proponowane testy

- Testy jednostkowe walidacji rozszerzenia, MIME, limitu 500 MB i wyniku `ffprobe`.
- Testy preflightu dla tagów ID3 UTF-8, ID3 UTF-16, FLAC/Vorbis comments i MP4/M4A tags.
- Test wykrycia osadzonego covera i zastąpienia go ręcznym coverem.
- Test utworzenia `Job` ze statusem `uploaded`.
- Test UI: uzupełnienie formularza z tagów, edycja pól, przywrócenie domyślnego covera i start zadania.
