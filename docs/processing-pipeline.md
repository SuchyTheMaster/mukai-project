# Pipeline przetwarzania

## 1. Upload

Wejście:

- Plik audio: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Metadane: tytuł, artysta, opcjonalny język, opcjonalny rok/gatunek.
- Profile modeli: separacja szybka albo dokładniejsza, transkrypcja szybka albo dokładniejsza.
- Opcjonalny cover, który może zostać użyty w eksporcie.
- Osadzony cover z tagów pliku źródłowego może zostać użyty jako wstępny cover, jeśli użytkownik nie wybierze innego pliku.
- Opcjonalny import ZIP-a projektu utworzonego przez opcję `Wyeksportuj projekt` jako kontynuacja wcześniejszej pracy.

Walidacja:

- Nie nakładać sztywnego limitu czasu trwania utworu na poziomie specyfikacji MVP.
- Maksymalny rozmiar uploadu w MVP to 500 MB.
- Backend waliduje rozszerzenie, MIME oraz wynik `ffprobe`; plik jest przyjmowany tylko wtedy, gdy zawiera obsługiwaną ścieżkę audio.
- Backend zapisuje oryginał jako artefakt niemodyfikowany.
- Nazwy plików eksportu są normalizowane i nie mogą zawierać ścieżek.
- Jeśli użytkownik nie poda języka, detekcję języka pozostawić Whisperowi.
- Jeśli utwór jest wielojęzyczny, ekran importu powinien sugerować pozostawienie języka pustego.
- Jeśli plik audio zawiera metadane, aplikacja od razu uzupełnia odpowiednie pola formularza.
- Jeśli plik audio zawiera osadzony cover, aplikacja od razu pokazuje jego podgląd i traktuje go jak domyślny cover importu.
- Jeśli plik audio nie zawiera metadanych, pola pozostają do ręcznego uzupełnienia.
- Jeśli użytkownik nie wgra covera, eksport nie zawiera covera.

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
- `transcript.aligned.json`: segmenty, słowa, czasy start/end, confidence.

Wymagania:

- Wymuszać język, jeśli użytkownik podał go w uploadzie.
- Nie wymuszać języka dla utworów wielojęzycznych ani wtedy, gdy użytkownik zostawi pole języka puste.
- Uwzględnić, że Whisper pracuje na oknach około 30 sekund; dla długich utworów pipeline musi poprawnie segmentować lub przekazywać audio do WhisperX tak, żeby zachować globalne czasy.
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

- Przechowywać ramki F0 niezależnie od nut, żeby edytor mógł pokazać surowy kontur.
- Domyślnie użyć progu ciszy `-45 dBFS`, progu periodicity `0.5`, kroku ramek `10 ms`, minimalnej długości nuty `80 ms` i scalania przerw do `50 ms`.
- Powyższe parametry filtracji pitch muszą być dostępne w zaawansowanych ustawieniach i możliwe do samodzielnej zmiany przed uruchomieniem albo ponownym przeliczeniem pitch detection.
- Konwertować częstotliwość do MIDI i do pitch UltraStar dopiero po filtracji.
- Zapisać wersję torchcrepe, PyTorch/CUDA, progi i parametry filtracji w `pitch.notes.json`.

## 7. Łączenie tekstu z nutami

Cel:

- Połączyć rozpoznane słowa/frazy z nutami w edytowalny szkic karaoke.
- Przygotować edycję na poziomie słów i sylab.

Reguły startowe:

- Fraza tekstu wyznacza linię karaoke.
- Nuty przypisywać do słów na podstawie przecięcia czasowego.
- Jeśli jedno słowo trwa przez wiele nut, dzielić je na token główny i przedłużenia zgodne z konwencją UltraStar.
- Jeśli słowo zawiera wiele śpiewanych sylab, tworzyć edytowalne tokeny sylabowe.
- Jeśli pitch jest niepewny, oznaczać nutę jako wymagającą korekty zamiast usuwać ją automatycznie.

Wyjście:

- `draft.arrangement.json`.
- Szkic zawiera linie, `KaraokeToken` oraz `NoteEvent` w strukturze aktualnego `Arrangement`.

## 8. Edycja ręczna

Użytkownik zatwierdza:

- Tekst.
- Podział na frazy, słowa i sylaby.
- Start i koniec fraz/słów.
- Wysokości i długości nut.
- Typy nut: normalna, golden, freestyle, rap, rap golden.

Wynik:

- Jeden aktualny stan edycji zapisany w Postgresie.
- `review.approved.json` jest zapisywany albo aktualizowany po zatwierdzeniu edycji i nie oznacza trwałej historii wersji.

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
- Po pomyślnym utworzeniu i przekazaniu ZIP-a projektu aplikacja ustawia TTL retencji lokalnego `Job` i artefaktów na 24 godziny.

## 10. Ponowny import projektu z ZIP-a

Wejście:

- ZIP projektu utworzony przez opcję `Wyeksportuj projekt`.

Zasady:

- Import przyjmuje archiwum ZIP projektu, a nie pojedynczy plik JSON.
- Manifesty JSON w ZIP-ie zawierają pełną edycję, ustawienia modeli, metadane, wykryte BPM, transkrypcję, czasy, pitch/nuty, wybory eksportu i listę artefaktów z hashami.
- Import odtwarza stan tak, jakby pliki były już wgrane i przetworzone przez poszczególne etapy pipeline'u.
- Import nie uruchamia ponownie normalizacji audio, BPM, separacji, transkrypcji, alignacji, czasów ani pitch detection.
- Jeśli ZIP projektu nie zawiera wymaganej składowej albo hash artefaktu się nie zgadza, import kończy się błędem zamiast próbować odtwarzać brakujący etap.
