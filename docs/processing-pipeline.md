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

- Po akceptacji formularza kroku `Źródło` frontend wysyła `POST /api/jobs/uploads` z `uploadDraftId`, finalnymi metadanymi i opcjonalnym ręcznym coverem. Pola `artist` i `title` są wymagane.
- Profile modeli oraz ustawienia separacji, transkrypcji, detekcji tonów i wstępnego dopasowania są zbierane dopiero wtedy, gdy pipeline dojdzie do powiązanego z nimi kroku.
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
- Etap przetwarzania audio jest w UI rozbity na podetapy: preprocessing/FFmpeg, BPM, Demucs, WhisperX, detekcja tonów i wstępne dopasowanie.
- Jeśli etap wymaga ustawień użytkownika przed startem, jego `StageSnapshot` pozostaje w statusie `pending`, ale ma `actionRequired=true` i `settingsForm` wskazujące formularz UI.
- Zatwierdzenie formularza etapu zapisuje ustawienia przez `POST /api/jobs/{jobId}/stages/{stage}/settings`, porównuje stare i nowe wartości po polach, unieważnia tylko artefakty etapów zależnych od faktycznie zmienionych danych, a następnie kontynuuje pipeline od pierwszego wymaganego miejsca.
- Zmiana metadanych źródła poza `language`, np. tytułu, artysty, albumu, roku albo gatunku, nie unieważnia żadnego etapu audio ani AI. Zmiana `language` unieważnia `transcribing` i `aligning`, a podmiana pliku audio unieważnia wszystkie etapy od `preprocessing` do `aligning`.
- Jeśli etap zależny traci artefakty, ale jego własne ustawienia były już zatwierdzone i nie uległy zmianie, pipeline może przeliczyć go automatycznie bez ponownego pokazywania formularza.
- Każdy podetap zapisuje `StageSnapshot` w `Job.processing`, jeśli ma postęp, wynik, błąd albo artefakty widoczne dla użytkownika.
- Długie operacje zapisują `progressMode`, `progressPercent` i `etaSec`, jeśli worker potrafi je wiarygodnie określić. Jeśli nie, status pozostaje `indeterminate`, a UI pokazuje czas trwania.
- Błędy etapów muszą zawierać krótki komunikat dla użytkownika i kompaktowy log diagnostyczny bez sekretów, tokenów i prywatnych ścieżek.
- Po zakończeniu podetapu artefakty są przypisywane do `producedByStage` i `producedBySubstep`, żeby UI mogło pokazać przycisk pobrania przy właściwym podetapie.
- Reset etapu jest operacją planowaną przez `POST /api/jobs/{jobId}/stages/{stage}/reset`; reset unieważnia artefakty wskazanego etapu i dalszych etapów zależnych, zachowując oryginalne audio, metadane i cover.
- Frontend zapisuje w `localStorage` ostatni snapshot `Job`, aktywny draft uploadu, ustawienia formularzy etapów i informację, czy otwarty był edytor. Po odświeżeniu strony UI pokazuje ostatni znany etap i odświeża `Job` z API, bez wymagania rozpoczynania pracy od nowa.
- Akcja `Od nowa` wymaga potwierdzenia w dialogu. Po potwierdzeniu usuwa lokalny stan przeglądarki, unieważnia artefakty etapów od `preprocessing` do `aligning`, czyści wynikowe dane po stronie API i wraca do pierwszego kroku bez automatycznego kolejkowania pipeline'u.
- Etapy preprocessingu audio przed edytorem są idempotentne: jeśli po błędzie, odświeżeniu strony albo imporcie projektu istnieją kompletne artefakty etapu, worker oznacza etap jako `completed` i kontynuuje od następnego wymaganego etapu albo formularza ustawień.
- Wznowienie po błędzie używa `POST /api/jobs/{jobId}/stages/{stage}/resume`; zachowuje zatwierdzone ustawienia etapu, czyści tylko niekompletne artefakty od miejsca wznowienia i kolejkuje pipeline od tego etapu.

## 2. Normalizacja audio

Cel:

- Przygotować spójne formaty robocze dla kolejnych workerów.

Artefakty:

- `mix.wav`: znormalizowane audio robocze, WAV PCM, 44100 Hz, stereo, bez zmiany długości i offsetu.
- `worker_inputs/bpm.wav`: WAV PCM, 44100 Hz, mono jako downmix wszystkich kanałów, dopasowane do Essentia `RhythmExtractor2013`.
- `audio_metadata.json`: sample rate, kanały, duration, loudness, hash.

Decyzje:

- Do konwersji i ekstrakcji ścieżki audio używać FFmpeg.
- Roboczo używać WAV PCM jako formatu pośredniego.
- Zachować oryginalny czas trwania i offset bez przycinania początku.
- Resampling wykonywać oddzielnie dla wymagań modeli, nie nadpisując `mix.wav`.
- W obecnej implementacji `worker_inputs/demucs.wav` jest tworzony leniwie w workerze separacji jako kopia `mix.wav` i zapisywany jako asset typu `demucs_input`, a nie jako artefakt etapu preprocessingu.
- Jeśli worker wymaga mono, tworzyć je jako downmix wszystkich kanałów, a nie przez odrzucenie jednego kanału.
- Dla `MP4` traktować plik jako kontener z audio; jeśli zawiera wideo, pipeline ignoruje obraz.

## 3. Detekcja BPM

Cel:

- Wykryć BPM utworu i zapisać go jako domyślną siatkę eksportu UltraStar.

Wejście:

- `worker_inputs/bpm.wav`.

Wyjście:

- `tempo.json`: wykryte BPM, confidence, metoda, ewentualne alternatywne wartości; asset typu `tempo`.

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

- `worker_inputs/demucs.wav` przygotowany przez worker separacji z `mix.wav`.

Wyjście:

- `vocals.wav`
- `instrumental.wav` albo stem `other`/miks instrumentalny zależnie od konfiguracji.
- `worker_inputs/whisperx.wav`: WAV PCM, 16000 Hz, mono jako downmix wszystkich kanałów `vocals.wav`, przygotowany po separacji.
- `worker_inputs/torchcrepe.wav`: WAV PCM, 16000 Hz, mono jako downmix wszystkich kanałów `vocals.wav`, przygotowany po separacji.
- `separation.json` z modelem, parametrami i czasem przetwarzania.

Typy assetów zapisywane przez aktualną implementację:

- `demucs_input` dla `worker_inputs/demucs.wav`.
- `vocals` dla `vocals.wav`.
- `instrumental` dla `instrumental.wav`.
- `whisperx_input` dla `worker_inputs/whisperx.wav`.
- `torchcrepe_input` dla `worker_inputs/torchcrepe.wav`.
- `separation_manifest` dla `separation.json`.

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

- `transcript.raw.json`: segmenty modelu ASR; asset typu `transcript_raw`.
- `transcript.aligned.json`: aligned words i segmenty ASR z czasami start/end, opcjonalnymi czasami znaków i confidence; asset typu `transcript_aligned`. Finalne frazy karaoke powstają dopiero we wstępnym dopasowaniu.

Wymagania:

- Docelowo wykonywać transkrypcję i forced alignment w osobnym workerze Docker `worker-transcribe`.
- Wymuszać język, jeśli użytkownik podał go w uploadzie.
- Nie wymuszać języka dla utworów wielojęzycznych ani wtedy, gdy użytkownik zostawi pole języka puste.
- Uwzględnić, że Whisper pracuje na oknach około 30 sekund; dla długich utworów pipeline musi poprawnie segmentować lub przekazywać audio do WhisperX tak, żeby zachować globalne czasy.
- Worker nie może przekazywać do ASR tylko pierwszego okna 30 sekund. Do WhisperX trafia cały `worker_inputs/whisperx.wav`, a podział na okna 30 sekund jest realizowany przez VAD/Cut & Merge WhisperX z globalnymi czasami segmentów.
- Domyślnie używać Silero VAD przez WhisperX `vad_method="silero"`, z `pyannote` jako trybem alternatywnym.
- Jeśli wersja WhisperX w obrazie nie obsługuje jawnego `vad_method`, worker nie przerywa transkrypcji i zapisuje w diagnostyce, czy metoda VAD została wymuszona, wstrzyknięta przez `vad_model`, czy użyto domyślnego VAD tej wersji.
- `TranscriptionSettings.positioning` steruje `return_char_alignments`: `words_and_syllables` zapisuje czasy znaków przy słowach, a `words_only` zostawia tylko czasy słów.
- `transcript.raw.json` zachowuje surowe segmenty ASR bez przepisywania ich na frazy karaoke.
- Po forced alignment worker zapisuje aligned words bez finalnego grupowania w sentencje karaoke.
- Artefakty transkrypcji zapisują czas trwania wejścia, rozmiar okna, oczekiwaną liczbę okien i maksymalny czas końca segmentów, żeby dało się diagnostycznie wykryć wynik ucięty do pierwszych 30 sekund.
- Artefakty transkrypcji zapisują metodę VAD, opcje VAD, próg pauzy dla fraz i padding fraz.
- Zachować segmenty o niskiej pewności, ale oznaczyć je do ręcznej korekty.
- Dla piosenek dopuszczać powtórzenia, wydłużone sylaby i fragmenty bez słów.
- Zapisać wersje WhisperX, modelu ASR, modelu alignacji, PyTorch/CUDA i parametry batch w artefaktach transkrypcji.

## 6. Detekcja tonów

Model:

- torchcrepe jako implementacja CREPE w PyTorch.

Wejście:

- `worker_inputs/torchcrepe.wav` przygotowany z `vocals.wav`.

Wyjście:

- `pitch.frames.json`: ramki `time`, `frequency_hz`, `periodicity`, `confidence`; asset typu `pitch_frames`.
- `pitch.notes.json`: zsegmentowane nuty karaoke tworzone dopiero w kroku `Wstępne dopasowanie`; asset typu `pitch_notes`.

Wymagania:

- Docelowo wykonywać pitch detection w osobnym workerze Docker `worker-pitch`.
- Przechowywać ramki F0 niezależnie od nut, żeby edytor mógł pokazać surowy kontur.
- W ustawieniach detekcji tonów dostępne są parametry analizy F0: próg ciszy `-42 dBFS`, próg periodicity `0.55` i krok ramek `10 ms`.
- Minimalna długość nuty karaoke `120 ms` i scalanie przerw do `90 ms` należą do kroku `Wstępne dopasowanie`, bo sterują segmentacją ramek F0 do nut karaoke.
- Zapisać wersję torchcrepe, PyTorch/CUDA, progi i parametry analizy w `pitch.frames.json`.

## 7. Łączenie tekstu z nutami

Cel:

- Połączyć rozpoznane słowa/frazy z nutami w edytowalny szkic karaoke.
- Przygotować edycję na poziomie słów i sylab.
- Utworzyć sentencje karaoke z aligned words oraz nuty karaoke z ramek F0 zgodnie z ustawieniami `Ms między sentencjami`, `Najkrótsza nuta karaoke (ms)` i `Scalanie krótkich przerw (ms)`.

Reguły startowe:

- Fraza tekstu wyznacza linię karaoke.
- W ramach frazy dzielić słowa na sylaby przed dopasowaniem nut zgodnie z `Job.syllabificationSettings`.
- Tryb `none` nie dzieli słów; całe wyrazy z transkrypcji są pojedynczymi sylabami edycyjnymi.
- Jeśli `positioning=words_and_syllables` i słowo ma kompletne czasy znaków, granice sylab wyznaczać z pierwszej i ostatniej litery sylaby, przycinając wynik do czasu słowa.
- Jeśli czasy znaków są niekompletne albo nie pasują do podziału sylab, użyć dotychczasowego równego podziału czasu słowa i oznaczyć sylaby do recenzji.
- Tryb `heuristic` używa dotychczasowej heurystyki.
- Tryb `kokosznicka` działa tylko dla języka `pl`.
- Tryb `pyphen` mapuje język na dostępny słownik Pyphen.
- Język rozstrzygać kolejno z wymuszonego języka `Job.metadata`, `detectedLanguage`, a potem `alignmentLanguage` z `transcript.aligned.json`.
- Jeśli wybrana metoda nie obsługuje języka, nie jest dostępna albo zwróci niepoprawny podział, użyć heurystyki i zapisać powód fallbacku w `Arrangement.syllabification`.
- Sylaba dostaje własną wartość `midi` wyliczoną jako uśrednienie nut przecinających jej czas trwania.
- `NoteEvent` pozostaje niezależną warstwą diagnostyczną; initial alignment nie dzieli nut pod sylaby i nie zapisuje trwałej relacji sylaba-nuta.
- Jeśli kolejne sylaby tego samego słowa mają tę samą wartość `midi`, szkic może scalić je w jeden blok sylaby.
- Sylaby bez `midi` zostawiać jako elementy do recenzji. Nuty bez przecięcia z sylabami zostają w niezależnej warstwie diagnostycznej bez dopasowywania ich na siłę.
- Jeśli pitch jest niepewny, oznaczać nutę jako wymagającą korekty zamiast usuwać ją automatycznie.

Wyjście:

- `draft.arrangement.json` jako artefakt szkicu; asset typu `draft_arrangement`.
- Aktualny `Arrangement` w Postgresie zainicjalizowany na podstawie szkicu.
- Szkic zawiera sentencje, wyrazy, sylaby oraz niezależne `NoteEvent` w strukturze `Arrangement`.
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

- Jedną paczkę ZIP zgodną z aktualnymi wersjami UltraStar Deluxe, UltraStar Play i Vocaluxe.
- Paczka zawiera katalog z plikiem UltraStar `.txt`, oryginalnym audio, instrumentalem i wokalem/a capella w MP3; cover jest dodawany tylko wtedy, gdy został ustawiony.
- Paczka karaoke nie zawiera `mukai-project.json` ani innych danych potrzebnych do odtworzenia projektu w Mukai.
- Tagi `#AUDIO`, `#INSTRUMENTAL` i `#VOCALS` wskazują odpowiednio pliki z sufiksami `[FULL]`, `[INSTR]` i `[VOC]`.
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
