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
- Domyślne parametry pitch: próg ciszy `-42 dBFS`, periodicity `0.55`, krok ramek `10 ms`, minimalna długość nuty `120 ms`, scalanie przerw do `90 ms`, jako praktyczny profil startowy dla typowych piosenek i łączenia tekstu z nutami karaoke.
- Użycie ustawień pitch zaakceptowanych przy uploadzie lub zmienionych przed resetem etapu.
- Przechowywanie surowych ramek F0 niezależnie od nut.
- Worker `worker-aligner` lub lekki moduł alignacji łączący `transcript.aligned.json` i `pitch.notes.json`.
- Użycie finalnych fraz z `transcript.aligned.json` jako linii karaoke.
- Podział słów na sylaby przed dopasowaniem nut wybraną metodą `Job.syllabificationSettings`.
- Obsługa metod `kokosznicka`, `pyphen`, `heuristic` i `none`.
- Rozstrzyganie języka dla sylabizacji w kolejności: wymuszony język z `Job.metadata`, `detectedLanguage`, `alignmentLanguage`.
- Fallback do dotychczasowej heurystyki, gdy wybrana metoda nie obsłuży języka, pakiet nie będzie dostępny albo zwróci niepoprawny wynik.
- Dopasowanie nut do sylab na podstawie przecięcia czasowego w całym utworze.
- Tworzenie `draft.arrangement.json`.
- Inicjalizacja aktualnego `Arrangement` w Postgresie.
- Zapis `Arrangement.syllabification` z metodą wybraną, metodą zastosowaną, językiem, źródłem języka, powodem fallbacku i wersjami pakietów.
- Oznaczanie niepewnego pitch, braku nuty dla sylaby i nut bez tekstu jako stanów jakości do recenzji.

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
- Tryb `none` przekazuje całe słowa jako tokeny sylabowe.
- `kokosznicka` dla języka innego niż `pl` używa heurystyki i zapisuje fallback.
- `pyphen` bez obsługiwanego słownika używa heurystyki i zapisuje fallback.
- `Arrangement.syllabification` zapisuje `requestedMethod`, `appliedMethod` i `fallbackReason`.
- UI pokazuje finalną metodę sylabizacji w pasku jakości, a fallback wyróżnia ostrzeżeniem.
- Niepewny pitch oznacza element do korekty, a nie automatyczne usunięcie.
- Token przedłużenia z pustym tekstem jest obsługiwany tylko kompatybilnościowo przez `isExtension=true` i `extendsTokenId`; nowy szkic go nie tworzy.
- Jedna nuta może być przypisana maksymalnie do jednego tokenu, a jeden token maksymalnie do jednej nuty.
- Gdy jedna nuta przecina kilka sylab, worker dzieli nutę na części z tym samym MIDI.
- Gdy jedna sylaba przecina kilka nut, worker scala kolejne nuty z tym samym MIDI, a `~` tworzy tylko dla kontynuacji na innym MIDI.
- Brakujące sylaby dostają `missing_note` i `needs_syllable_review`, a nuty bez tekstu dostają `unassigned_note`.
- `Arrangement` jest aktualnym stanem w Postgresie, a nie plikiem JSON jako źródłem prawdy podczas pracy.
- `draft.arrangement.json` pozostaje artefaktem szkicu.

## Proponowane testy

- Test torchcrepe na syntetycznej sinusoidzie.
- Test torchcrepe na krótkim fragmencie wokalu.
- Test segmentacji ramek do nut z progami domyślnymi i zmienionymi.
- Test trybu `none`, `kokosznicka + pl`, `kokosznicka + en`, `pyphen` ze słownikiem i `pyphen` bez słownika.
- Test łączenia sylab z nutami na podstawie przecięcia czasowego.
- Test przypadków: sylaba bez nuty, nuta bez sylaby, jedna nuta przez kilka sylab, jedna sylaba przez kilka nut, scalanie kolejnych nut tej samej sylaby o tym samym MIDI.
- Test inicjalizacji `Arrangement` i walidacji unikalności niepustego `KaraokeToken.noteId`.
- Test przejścia statusu do `awaiting_review`.
