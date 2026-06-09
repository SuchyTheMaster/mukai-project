# Pipeline przetwarzania

## 1. Upload

Wejście:

- Plik audio: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Metadane: tytuł, artysta, opcjonalny język wybierany z przeszukiwalnej listy języków Whisper `large-v3`, opcjonalny album, rok i gatunek.
- Profile modeli: domyślnie dokładniejsza separacja `htdemucs_ft` i dokładniejsza transkrypcja `large-v3`; użytkownik może ręcznie wybrać szybsze profile `htdemucs` i `large-v3-turbo`.
- Sylabizacja: wybór `Kokosznicka`, `Pyphen`, `Heurystyka` albo `Bez podziału`; dla języka `pl` UI domyślnie wybiera Kokosznicką, a dla pozostałych języków Pyphen.
- Opcjonalny cover, który może zostać użyty w eksporcie.
- Osadzony cover z tagów pliku źródłowego może zostać użyty jako wstępny cover, jeśli użytkownik nie wybierze innego pliku.
- Opcjonalny import ZIP-a projektu utworzonego przez opcję `Wyeksportuj projekt` jako kontynuacja wcześniejszej pracy.

Preflight uploadu:

- Po wyborze pliku frontend wysyła audio do `POST /api/uploads/inspect`.
- Preflight nie tworzy `Job`, nie uruchamia pipeline'u i nie zapisuje trwałego stanu projektu.
- Backend odczytuje tagi audio biblioteką metadanych, np. Mutagen; `ffprobe` pozostaje walidacją techniczną audio i źródłem danych takich jak czas trwania, kodek, sample rate i liczba kanałów.
- Odczyt tagów musi obsługiwać co najmniej UTF-8, UTF-16 i pliki z mieszanymi tagami, tak żeby polskie znaki i inne znaki narodowe nie były uszkadzane w formularzu.
- Jeśli tagi zawierają tytuł, artystę, album, rok albo gatunek, backend zwraca je jako `SourceMetadata`, a frontend wypełnia nimi formularz.
- Jeśli tagi zawierają osadzony cover, backend zwraca go jako tymczasowy `EmbeddedCover`, a frontend pokazuje go jako wybrany cover importu w sekcji cover.
- Frontend pokazuje od razu techniczne dane źródła: format/kontener z pola `container`, kodek, kanały, częstotliwość próbkowania i czas trwania.
- Przed utworzeniem zadania kliknięcie covera w UI pozwala wybrać plik z dysku. Akcja `Przywróć domyślny` przywraca cover z tagów albo czyści cover, jeśli tagi go nie zawierały.
- Po utworzeniu zadania lewa kolumna pokazuje `WGRANE AUDIO`, dane pliku i nieklikalny podgląd covera bez akcji zmiany covera.
- Jeśli tagi albo cover nie istnieją, preflight kończy się sukcesem z pustymi polami do ręcznego uzupełnienia.

Utworzenie zadania:

- Po akceptacji formularza frontend wysyła `POST /api/jobs/uploads` z `uploadDraftId`, finalnymi metadanymi, profilami modeli, ustawieniami transkrypcji, pitch, sylabizacji i opcjonalnym ręcznym coverem.
- Jeśli użytkownik nie wskaże ręcznie covera, a preflight wykrył osadzony cover, finalny `Job` używa covera z tagów jako covera importu.
- Jeśli użytkownik wskaże ręczny cover, ręczny plik zastępuje cover z tagów.
- Utworzenie `Job` zapisuje oryginalny plik jako artefakt niemodyfikowany i ustawia status `uploaded`.

Walidacja:

- Nie nakładać sztywnego limitu czasu trwania utworu na poziomie specyfikacji MVP.
- Maksymalny rozmiar uploadu w MVP to 500 MB.
- Backend waliduje rozszerzenie, MIME oraz wynik `ffprobe`; plik jest przyjmowany tylko wtedy, gdy zawiera obsługiwaną ścieżkę audio.
- Nazwy plików eksportu są normalizowane i nie mogą zawierać ścieżek.
- Jeśli użytkownik nie poda języka, detekcję języka pozostawić Whisperowi.
- Jeśli utwór jest wielojęzyczny, ekran importu powinien sugerować pozostawienie języka pustego.
- Jeśli preflight nie wykrył covera i użytkownik nie wgra ręcznego covera, eksport nie zawiera covera.

## Orkiestracja, statusy i postęp

- UI pokazuje od razu wszystkie oczekiwane etapy pipeline'u, także te, które jeszcze nie wystartowały.
- Etap przetwarzania audio jest w UI rozbity na podetapy: preprocessing/FFmpeg, BPM, Demucs, WhisperX, pitch detection i alignment/draft.
- Każdy podetap zapisuje `StageSnapshot` w `Job.processing`, jeśli ma postęp, wynik, błąd albo artefakty widoczne dla użytkownika.
- Długie operacje zapisują `progressMode`, `progressPercent` i `etaSec`, jeśli worker potrafi je wiarygodnie określić. Jeśli nie, status pozostaje `indeterminate`, a UI pokazuje czas trwania.
- Błędy etapów muszą zawierać krótki komunikat dla użytkownika i kompaktowy log diagnostyczny bez sekretów, tokenów i prywatnych ścieżek.
- Po zakończeniu podetapu artefakty są przypisywane do `producedByStage` i `producedBySubstep`, żeby UI mogło pokazać przycisk pobrania przy właściwym podetapie.
- Reset etapu jest operacją planowaną przez `POST /api/jobs/{jobId}/stages/{stage}/reset`; reset unieważnia artefakty wskazanego etapu i dalszych etapów zależnych, zachowując oryginalne audio, metadane i cover.

## 2. Normalizacja audio

Cel:

- Przygotować spójne formaty robocze dla kolejnych workerów.

Artefakty:

- `mix.wav`: znormalizowane audio robocze, WAV PCM, 44100 Hz, stereo, bez zmiany długości i offsetu.
- `worker_inputs/demucs.wav`: WAV PCM, 44100 Hz, stereo, jeśli różni się od `mix.wav`.
- `worker_inputs/bpm.wav`: WAV PCM, 44100 Hz, mono jako downmix wszystkich kanałów, dopasowane do Essentia `RhythmExtractor2013`.
- `audio_metadata.json`: sample rate, kanały, duration, loudness, hash.

Decyzje:

- Do konwersji i ekstrakcji ścieżki audio używać FFmpeg.
- Roboczo używać WAV PCM jako formatu pośredniego.
- Zachować oryginalny czas trwania i offset bez przycinania początku.
- Resampling wykonywać oddzielnie dla wymagań modeli, nie nadpisując `mix.wav`.
- Jeśli worker wymaga mono, tworzyć je jako downmix wszystkich kanałów, a nie przez odrzucenie jednego kanału.
- Dla `MP4` traktować plik jako kontener z audio; jeśli zawiera wideo, pipeline ignoruje obraz.

## 3. Detekcja BPM

Cel:

- Wykryć BPM utworu i zapisać go jako domyślną siatkę eksportu UltraStar.

Wejście:

- `worker_inputs/bpm.wav`.

Wyjście:

- `tempo.json`: wykryte BPM, confidence, metoda, ewentualne alternatywne wartości.

Wymagania:

- Wartość BPM utworu musi być edytowalna przed eksportem.
- Eksporter wylicza `#BPM` UltraStar z wykrytego BPM utworu, zamiast używać stałej technicznej wartości.
- Jeśli detekcja jest niepewna, interfejs oznacza BPM jako wymagający sprawdzenia.
- Do detekcji BPM używać Essentia `RhythmExtractor2013`.

## 4. Separacja wokalu

Model:

Demucs v4 z wyborem użytkownika:

- szybki profil `htdemucs`;
- dokładniejszy profil `htdemucs_ft`.

Wejście:

- `worker_inputs/demucs.wav` albo `mix.wav`, jeśli Demucs nie wymaga osobnego przygotowania.

Wyjście:

- `vocals.wav`
- `instrumental.wav` albo stem `other`/miks instrumentalny zależnie od konfiguracji.
- `worker_inputs/whisperx.wav`: WAV PCM, 16000 Hz, mono jako downmix wszystkich kanałów `vocals.wav`, przygotowany po separacji.
- `worker_inputs/torchcrepe.wav`: WAV PCM, 16000 Hz, mono jako downmix wszystkich kanałów `vocals.wav`, przygotowany po separacji.
- `separation.json` z modelem, parametrami i czasem przetwarzania.

Wymagania:

- Używać GPU, jeśli jest dostępne.
- Docelowo wykonywać separację w osobnym workerze Docker `worker-separate-stems`.
- Obsługiwać brak pamięci GPU przez jedną próbę zmniejszenia segmentu; jeśli ponowna próba zawiedzie, zakończyć etap czytelnym błędem infrastruktury.
- Nie zakładać, że separacja jest idealna; dalsze moduły muszą tolerować bleeding instrumentów.
- Zapisać wybrany model w artefaktach i manifestach projektu.
- Zapisać wersje pakietów, modelu, PyTorch/CUDA i parametry segmentu w `separation.json`.

## 5. Transkrypcja i alignacja tekstu

Model:

WhisperX z wyborem użytkownika:

- dokładniejszy profil `large-v3`;
- szybszy profil `large-v3-turbo`.

Wejście:

- `worker_inputs/whisperx.wav` przygotowany z `vocals.wav`.

Wyjście:

- `transcript.raw.json`: segmenty modelu ASR.
- `transcript.aligned.json`: finalne frazy karaoke, słowa, czasy start/end, confidence.

Wymagania:

- Docelowo wykonywać transkrypcję i forced alignment w osobnym workerze Docker `worker-transcribe`.
- Wymuszać język, jeśli użytkownik podał go w uploadzie.
- Nie wymuszać języka dla utworów wielojęzycznych ani wtedy, gdy użytkownik zostawi pole języka puste.
- Uwzględnić, że Whisper pracuje na oknach około 30 sekund; dla długich utworów pipeline musi poprawnie segmentować lub przekazywać audio do WhisperX tak, żeby zachować globalne czasy.
- Worker nie może przekazywać do ASR tylko pierwszego okna 30 sekund. Do WhisperX trafia cały `worker_inputs/whisperx.wav`, a podział na okna 30 sekund jest realizowany przez VAD/Cut & Merge WhisperX z globalnymi czasami segmentów.
- Domyślnie używać Silero VAD przez WhisperX `vad_method="silero"`, z `pyannote` jako trybem alternatywnym.
- Jeśli wersja WhisperX w obrazie nie obsługuje jawnego `vad_method`, worker nie przerywa transkrypcji i zapisuje w diagnostyce, czy metoda VAD została wymuszona, wstrzyknięta przez `vad_model`, czy użyto domyślnego VAD tej wersji.
- `transcript.raw.json` zachowuje surowe segmenty ASR bez przepisywania ich na frazy karaoke.
- Po forced alignment worker buduje finalne `TranscriptSegment` z aligned words: dłuższe przerwy między słowami rozdzielają sentencje/frazy, a krótkie pauzy pozostają w obrębie jednej frazy.
- Artefakty transkrypcji zapisują czas trwania wejścia, rozmiar okna, oczekiwaną liczbę okien i maksymalny czas końca segmentów, żeby dało się diagnostycznie wykryć wynik ucięty do pierwszych 30 sekund.
- Artefakty transkrypcji zapisują metodę VAD, opcje VAD, próg pauzy dla fraz i padding fraz.
- Zachować segmenty o niskiej pewności, ale oznaczyć je do ręcznej korekty.
- Dla piosenek dopuszczać powtórzenia, wydłużone sylaby i fragmenty bez słów.
- Zapisać wersje WhisperX, modelu ASR, modelu alignacji, PyTorch/CUDA i parametry batch w artefaktach transkrypcji.

## 6. Detekcja pitch

Model:

- torchcrepe jako implementacja CREPE w PyTorch.

Wejście:

- `worker_inputs/torchcrepe.wav` przygotowany z `vocals.wav`.

Wyjście:

- `pitch.frames.json`: ramki `time`, `frequency_hz`, `periodicity`, `confidence`.
- `pitch.notes.json`: zsegmentowane nuty po filtracji.

Wymagania:

- Docelowo wykonywać pitch detection w osobnym workerze Docker `worker-pitch`.
- Przechowywać ramki F0 niezależnie od nut, żeby edytor mógł pokazać surowy kontur.
- Domyślnie użyć progu ciszy `-42 dBFS`, progu periodicity `0.55`, kroku ramek `10 ms`, minimalnej długości nuty `120 ms` i scalania przerw do `90 ms`; te wartości są praktycznym punktem startowym dla typowych piosenek i szkicu karaoke.
- Powyższe parametry filtracji pitch muszą być dostępne w zaawansowanych ustawieniach i możliwe do samodzielnej zmiany przed uruchomieniem albo ponownym przeliczeniem pitch detection.
- Konwertować częstotliwość do MIDI i do pitch UltraStar dopiero po filtracji.
- Zapisać wersję torchcrepe, PyTorch/CUDA, progi i parametry filtracji w `pitch.notes.json`.

## 7. Łączenie tekstu z nutami

Cel:

- Połączyć rozpoznane słowa/frazy z nutami w edytowalny szkic karaoke.
- Przygotować edycję na poziomie słów i sylab.

Reguły startowe:

- Fraza tekstu wyznacza linię karaoke.
- W ramach frazy dzielić słowa na sylaby przed dopasowaniem nut zgodnie z `Job.syllabificationSettings`.
- Tryb `none` nie dzieli słów; całe wyrazy z transkrypcji są tokenami sylabowymi.
- Tryb `heuristic` używa dotychczasowej heurystyki.
- Tryb `kokosznicka` działa tylko dla języka `pl`.
- Tryb `pyphen` mapuje język na dostępny słownik Pyphen.
- Język rozstrzygać kolejno z wymuszonego języka `Job.metadata`, `detectedLanguage`, a potem `alignmentLanguage` z `transcript.aligned.json`.
- Jeśli wybrana metoda nie obsługuje języka, nie jest dostępna albo zwróci niepoprawny podział, użyć heurystyki i zapisać powód fallbacku w `Arrangement.syllabification`.
- Nuty przypisywać do sylab na podstawie przecięcia czasowego w całym utworze, z relacją `0..1 ↔ 0..1` między tokenem i nutą.
- Jeśli jedna nuta przecina kilka sylab, dzielić nutę na granicach sylab z zachowaniem MIDI.
- Jeśli jedna sylaba przecina kilka nut, najpierw scalać kolejne nuty o tym samym MIDI, a token `~` tworzyć tylko przy kontynuacji sylaby na innym MIDI.
- Sylaby bez nut i nuty bez sylab zostawiać jako elementy do recenzji, zamiast dopasowywać je na siłę.
- Jeśli pitch jest niepewny, oznaczać nutę jako wymagającą korekty zamiast usuwać ją automatycznie.

Wyjście:

- `draft.arrangement.json` jako artefakt szkicu.
- Aktualny `Arrangement` w Postgresie zainicjalizowany na podstawie szkicu.
- Szkic zawiera linie, `KaraokeToken` oraz `NoteEvent` w strukturze `Arrangement`.
- `Arrangement.syllabification` zapisuje `requestedMethod`, `appliedMethod`, język, źródło języka, ewentualny `fallbackReason` oraz wersje pakietów sylabizacji.

## 8. Edycja ręczna

Użytkownik zatwierdza:

- Tekst.
- Podział na frazy, słowa i sylaby.
- Start i koniec fraz/słów.
- Wysokości i długości nut.
- Typy nut: normalna, golden, freestyle, rap, rap golden.

Wynik:

- Jeden aktualny stan edycji zapisany w Postgresie.
- Zatwierdzony `Arrangement` pozostaje w Postgresie; przy eksporcie projektu jest serializowany do `mukai-project.json`.

## 9. Eksport

Eksporter karaoke generuje:

- Jedną albo wiele paczek ZIP.
- Każda paczka zawiera katalog z plikiem UltraStar `.txt` i audio w MP3; cover jest dodawany tylko wtedy, gdy został ustawiony.
- Paczki karaoke nie zawierają `mukai-project.json` ani innych danych potrzebnych do odtworzenia projektu w Mukai.
- Dostępne warianty audio: oryginalne audio albo instrumental bez wokalu.
- Dostępne formaty docelowe: UltraStar Deluxe, UltraStar Play, Vocaluxe.
- Raport walidacji eksportu.

Osobna akcja `Wyeksportuj projekt` generuje ZIP projektu:

- ZIP projektu zawiera cały `Job`: oryginalny plik, artefakty wszystkich wykonanych etapów, zapis edycji, ustawienia modeli, metadane, raporty walidacji i pliki JSON potrzebne do odtworzenia projektu.
- ZIP projektu musi zawierać wszystkie składowe wymagane do odtworzenia stanu bez ponownego uruchamiania przetwarzania.
- Po pomyślnym utworzeniu i przekazaniu ZIP-a projektu aplikacja ustawia TTL retencji lokalnego `Job` i artefaktów na 24 godziny oraz przywraca status `awaiting_review`.

## 10. Ponowny import projektu z ZIP-a

Wejście:

- ZIP projektu utworzony przez opcję `Wyeksportuj projekt`.

Zasady:

- Import przyjmuje archiwum ZIP projektu, a nie pojedynczy plik JSON.
- Manifesty JSON w ZIP-ie zawierają pełną edycję zserializowaną z Postgresa, ustawienia modeli, metadane, `Tempo`, transkrypcję, czasy, pitch/nuty, wybory eksportu i listę artefaktów z hashami.
- Import odtwarza stan tak, jakby pliki były już wgrane i przetworzone przez poszczególne etapy pipeline'u.
- Import nie uruchamia ponownie normalizacji audio, BPM, separacji, transkrypcji, alignacji, czasów ani pitch detection.
- Jeśli ZIP projektu nie zawiera wymaganej składowej albo hash artefaktu się nie zgadza, import kończy się błędem zamiast próbować odtwarzać brakujący etap.
