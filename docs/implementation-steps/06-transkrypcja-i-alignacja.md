# Etap 06: Transkrypcja i alignacja

## Cel

Dodać lokalną transkrypcję wokalu z czasami segmentów i słów, tak aby kolejne etapy mogły połączyć tekst z nutami.

## Źródła prawdy

- [Pipeline przetwarzania](../processing-pipeline.md#5-transkrypcja-i-alignacja-tekstu)
- [Stos modeli AI](../model-stack.md#transkrypcja-whisperx)
- [Kontrakty danych](../data-contracts.md#transcriptsegment)
- [Operacje i testowanie](../operations-and-testing.md#przyszłe-testy-integracyjne)

## Zakres

- Osobny serwis Docker `worker-transcribe`.
- WhisperX z profilami `large-v3` i `large-v3-turbo`.
- Domyślny profil dokładniejszy `large-v3`, zgodny z wyborem z uploadu.
- Przekazanie języka do WhisperX tylko wtedy, gdy użytkownik go podał.
- Pozostawienie detekcji języka Whisperowi, gdy użytkownik zostawił język pusty.
- Zachowanie globalnych czasów dla długich utworów mimo pracy modelu na oknach około 30 sekund.
- Zapis `transcript.raw.json` z segmentami ASR.
- Zapis `transcript.aligned.json` z segmentami, słowami, start/end i confidence.
- Oznaczanie segmentów o niskiej pewności do ręcznej korekty bez automatycznego usuwania.
- Zapis wersji WhisperX, modelu ASR, modelu alignacji, PyTorch/CUDA i parametrów batch.
- Aktualizacja statusu `transcribing`, postępu, diagnostyki i artefaktów.

## Poza zakresem

- Automatyczne pobieranie tekstów z zewnętrznych serwisów.
- Pitch detection.
- Finalny podział na sylaby i nuty.

## Zależności

- Etap 05 musi dostarczać `worker_inputs/whisperx.wav`.
- Etap 03 musi zapewniać kolejkę, statusy i obsługę błędów workera.

## Wynik etapu

- `Job` ma transkrypcję z segmentami i słowami w czasie.
- UI może pokazać etap WhisperX, pobrać artefakty i oznaczyć niską pewność jako wymagającą recenzji.
- Dane są gotowe do połączenia z pitch i szkicem karaoke.

## Kryteria akceptacji

- Dla utworu z wymuszonym językiem worker przekazuje język do modelu.
- Dla utworu bez wskazanego języka worker nie wymusza języka.
- Segmenty zachowują globalne czasy względem oryginalnego utworu.
- Niska pewność nie usuwa tekstu z wyniku, tylko oznacza go do korekty.
- Worker nie korzysta z zewnętrznych API.

## Proponowane testy

- Test WhisperX na krótkim fragmencie wokalu z oczekiwanym językiem.
- Test WhisperX bez wymuszonego języka.
- Test dłuższego pliku z weryfikacją globalnych czasów segmentów.
- Test serializacji `TranscriptSegment` i słów.
- Test oznaczania niskiej pewności.
- Test błędu workera i logu diagnostycznego bez prywatnych ścieżek.

