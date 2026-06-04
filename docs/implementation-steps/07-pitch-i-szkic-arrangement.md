# Etap 07: Pitch i szkic Arrangement

## Cel

Dodać detekcję wysokości śpiewanych nut oraz pierwszy edytowalny szkic karaoke łączący transkrypcję, słowa, timing i nuty.

## Źródła prawdy

- [Pipeline przetwarzania](../processing-pipeline.md#6-detekcja-pitch)
- [Pipeline przetwarzania](../processing-pipeline.md#7-łączenie-tekstu-z-nutami)
- [Stos modeli AI](../model-stack.md#pitch-detection-torchcrepe)
- [Kontrakty danych](../data-contracts.md#arrangement)

## Zakres

- Osobny serwis Docker `worker-pitch`.
- torchcrepe jako implementacja CREPE w PyTorch.
- Użycie `worker_inputs/torchcrepe.wav` przygotowanego z wokalu.
- Zapis `pitch.frames.json` z ramkami F0, MIDI, periodicity i voiced.
- Segmentacja ramek do `pitch.notes.json`.
- Domyślne parametry pitch: próg ciszy `-45 dBFS`, periodicity `0.5`, krok ramek `10 ms`, minimalna długość nuty `80 ms`, scalanie przerw do `50 ms`.
- Użycie ustawień pitch zaakceptowanych przy uploadzie lub zmienionych przed resetem etapu.
- Przechowywanie surowych ramek F0 niezależnie od nut.
- Worker `worker-aligner` lub lekki moduł alignacji łączący `transcript.aligned.json` i `pitch.notes.json`.
- Tworzenie `draft.arrangement.json`.
- Inicjalizacja aktualnego `Arrangement` w Postgresie.
- Oznaczanie niepewnego pitch, braku nuty dla tekstu i nut bez tekstu jako stanów jakości do recenzji.

## Poza zakresem

- Zaawansowany edytor waveform/piano roll.
- Automatyczne rozwiązywanie wszystkich błędów sylabizacji.
- Eksport UltraStar.

## Zależności

- Etap 05 musi dostarczać `worker_inputs/torchcrepe.wav`.
- Etap 06 musi dostarczać `transcript.aligned.json`.
- Etap 03 musi zapewniać statusy, błędy i pobieranie artefaktów.

## Wynik etapu

- `Job` może dojść do statusu `awaiting_review`.
- W Postgresie istnieje aktualny `Arrangement` oparty o szkic AI.
- Edytor może otworzyć frazy, tokeny i nuty do ręcznej korekty.

## Kryteria akceptacji

- Częstotliwość jest konwertowana do MIDI i pitch UltraStar dopiero po filtracji.
- Niepewny pitch oznacza element do korekty, a nie automatyczne usunięcie.
- Token przedłużenia ma pusty tekst tylko wtedy, gdy `isExtension=true` i wskazuje `extendsTokenId`.
- `Arrangement` jest aktualnym stanem w Postgresie, a nie plikiem JSON jako źródłem prawdy podczas pracy.
- `draft.arrangement.json` pozostaje artefaktem szkicu.

## Proponowane testy

- Test torchcrepe na syntetycznej sinusoidzie.
- Test torchcrepe na krótkim fragmencie wokalu.
- Test segmentacji ramek do nut z progami domyślnymi i zmienionymi.
- Test łączenia słów z nutami na podstawie przecięcia czasowego.
- Test inicjalizacji `Arrangement` i walidacji tokenów przedłużenia.
- Test przejścia statusu do `awaiting_review`.

