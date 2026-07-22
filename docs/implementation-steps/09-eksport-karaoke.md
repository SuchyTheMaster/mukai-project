# Etap 09: Eksport karaoke

## Cel

Zamienić zatwierdzony `Arrangement` na jedną paczkę karaoke ZIP zgodną z aktualnymi wersjami UltraStar Deluxe, UltraStar Play i Vocaluxe.

## Źródła prawdy

- [Eksport UltraStar](../ultrastar-export.md)
- [Kontrakty danych](../data-contracts.md#exportselection)
- [Pipeline przetwarzania](../processing-pipeline.md#9-eksport)
- [Edytor UI](../editor-ui.md#eksport-w-ui)

## Zakres

- Walidacja przed eksportem przez `POST /api/jobs/{jobId}/exports/validate`.
- Eksport jednej paczki karaoke przez `POST /api/jobs/{jobId}/exports/karaoke`.
- Konwersja oryginalnego audio, instrumentalu i wokalu/a capella do MP3.
- Generowanie `.txt` UltraStar jako UTF-8 bez BOM.
- Mapowanie sekund na beaty na podstawie `Tempo.acceptedSongBpm` i `Tempo.gapMs`.
- Mapowanie MIDI na pitch UltraStar jako `midi_note - 60`.
- Obsługa typów nut `normal`, `golden`, `freestyle`, `rap` i `rap_golden`.
- Stała polityka tagów `#AUDIO`, kompatybilnościowego `#MP3`, `#INSTRUMENTAL` i `#VOCALS`.
- Spójne nazwy plików audio: `[FULL]`, `[INSTR]`, `[VOC]`.
- Opcjonalny cover tylko wtedy, gdy został ustawiony.
- Raport walidacji eksportu jako artefakt.
- Zapis ZIP-a jako artefaktu eksportu.
- Po udanym eksporcie powrót `Job` do statusu `awaiting_review`.

## Poza zakresem

- Zapis ZIP-a projektu globalnym przyciskiem `EKSPORT PROJEKTU`.
- Import projektu.
- Automatyczna publikacja do baz piosenek.

## Zależności

- Etap 08 musi umożliwiać zapis aktualnego, zatwierdzonego `Arrangement`.
- Etap 04 musi dostarczać zaakceptowany `Tempo`.
- Etap 05 musi dostarczać stems wokalu i instrumentalu.

## Wynik etapu

- Użytkownik może wybrać nazwę paczki/katalogu i opcjonalny cover.
- Aplikacja generuje jeden ZIP karaoke.
- Paczka karaoke nie zawiera `mukai-project.json` ani innych danych projektu.

## Kryteria akceptacji

- Plik `.txt` zawiera `#AUDIO`, `#MP3`, `#INSTRUMENTAL` i `#VOCALS`.
- `#AUDIO` i `#MP3` wskazują `{baseFilename} [FULL].mp3`.
- `#INSTRUMENTAL` wskazuje `{baseFilename} [INSTR].mp3`.
- `#VOCALS` wskazuje `{baseFilename} [VOC].mp3`.
- `#BPM` zawiera `Tempo.acceptedSongBpm`, natomiast mnożnik `4` jest stosowany tylko do siatki pozycji nut.
- Eksport bez covera nie generuje `#COVER` i nie dodaje pliku covera.
- Wynikowy plik `.txt` kończy się `E`.

## Proponowane testy

- Test jednostkowy `seconds -> UltraStar beats`.
- Test jednostkowy `MIDI -> UltraStar pitch`.
- Test walidacji `ExportSelection`.
- Test generowania tagów `#AUDIO`, `#MP3`, `#INSTRUMENTAL` i `#VOCALS`.
- Test spójności tagów z nazwami plików `[FULL]`, `[INSTR]`, `[VOC]`.
- Test zgodności `#AUDIO` i `#MP3` oraz regresji tempa odtwarzania w UltraStar Deluxe.
- Test eksportu z coverem i bez covera.
- Test, że paczka karaoke nie zawiera `mukai-project.json`.
- Test manualnego otwarcia wyniku w aktualnych wersjach UltraStar Deluxe, UltraStar Play i Vocaluxe lub zapis jawnego założenia, jeśli test nie został wykonany.
