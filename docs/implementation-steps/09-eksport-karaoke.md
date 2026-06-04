# Etap 09: Eksport karaoke

## Cel

Zamienić zatwierdzony `Arrangement` na paczki karaoke ZIP zgodne z UltraStar Deluxe, UltraStar Play i Vocaluxe.

## Źródła prawdy

- [Eksport UltraStar](../ultrastar-export.md)
- [Kontrakty danych](../data-contracts.md#exportselection)
- [Pipeline przetwarzania](../processing-pipeline.md#9-eksport)
- [Edytor UI](../editor-ui.md#eksport-w-ui)

## Zakres

- Walidacja przed eksportem przez `POST /api/jobs/{jobId}/exports/validate`.
- Eksport paczek karaoke przez `POST /api/jobs/{jobId}/exports/karaoke`.
- Obsługa wielu profili docelowych: UltraStar Deluxe, UltraStar Play, Vocaluxe.
- Obsługa wariantów audio: `original_audio` i `instrumental`.
- Konwersja playback audio do MP3.
- Generowanie `.txt` UltraStar jako UTF-8 bez BOM.
- Mapowanie sekund na beaty na podstawie `Tempo.acceptedSongBpm` i `Tempo.gapMs`.
- Mapowanie MIDI na pitch UltraStar jako `midi_note - 60`.
- Obsługa typów nut `normal`, `golden`, `freestyle`, `rap` i `rap_golden`.
- Polityka tagów `#AUDIO`, `#MP3`, `#INSTRUMENTAL` i `#VOCALS` zależna od profilu.
- Opcjonalny cover tylko wtedy, gdy został ustawiony.
- Raport walidacji eksportu jako artefakt.
- Zapis ZIP-ów jako artefaktów eksportu.
- Po udanym eksporcie powrót `Job` do statusu `awaiting_review`.

## Poza zakresem

- Eksport ZIP-a projektu `Wyeksportuj projekt`.
- Import projektu.
- Automatyczna publikacja do baz piosenek.

## Zależności

- Etap 08 musi umożliwiać zapis aktualnego, zatwierdzonego `Arrangement`.
- Etap 04 musi dostarczać zaakceptowany `Tempo`.
- Etap 05 musi dostarczać stems dla wariantu instrumentalnego.

## Wynik etapu

- Użytkownik może wybrać profile, warianty i nazwę paczki.
- Aplikacja generuje jeden lub wiele ZIP-ów karaoke.
- Paczki karaoke nie zawierają `mukai-project.json` ani innych danych projektu.

## Kryteria akceptacji

- UltraStar Deluxe dostaje `#AUDIO` oraz fallback `#MP3` wskazujący ten sam MP3.
- UltraStar Play i Vocaluxe używają `#AUDIO`.
- Wariant instrumentalny zawiera playback instrumentalny oraz osobny plik wokalu wskazany przez `#VOCALS`.
- Różne profile i warianty zmieniają nazwę ZIP, ale nie zmieniają bazowej nazwy katalogu i plików wewnątrz paczki.
- Eksport bez covera nie generuje `#COVER` i nie dodaje pliku covera.
- Wynikowy plik `.txt` kończy się `E`.

## Proponowane testy

- Test jednostkowy `seconds -> UltraStar beats`.
- Test jednostkowy `MIDI -> UltraStar pitch`.
- Test walidacji `ExportSelection`.
- Test generowania tagów dla UltraStar Deluxe, UltraStar Play i Vocaluxe.
- Test wariantu `original_audio` i `instrumental`.
- Test eksportu z coverem i bez covera.
- Test, że paczka karaoke nie zawiera `mukai-project.json`.
- Test manualnego otwarcia wyniku w wybranym odtwarzaczu karaoke lub zapis jawnego założenia, jeśli test nie został wykonany.

