# Pipeline przetwarzania

## 1. Upload

Wejście:

- Plik audio: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Metadane: tytuł, artysta, opcjonalny język, opcjonalny rok/gatunek.
- Profile modeli: separacja szybka albo dokładniejsza, transkrypcja szybka albo dokładniejsza.
- Opcjonalny cover, który może zostać użyty w eksporcie.
- Osadzony cover z tagów pliku źródłowego może zostać użyty jako wstępny cover, jeśli użytkownik nie wybierze innego pliku.
- Opcjonalny import `mukai-project.json` jako kontynuacja wcześniejszej pracy.

Walidacja:

- Nie nakładać sztywnego limitu czasu trwania utworu na poziomie specyfikacji MVP.
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

- `mix.wav`: znormalizowane audio robocze.
- `worker_inputs/demucs.wav`: audio dopasowane do wymagań Demucs, jeśli różni się od `mix.wav`.
- `worker_inputs/bpm.wav`: audio 44100 Hz dopasowane do wymagań Essentia `RhythmExtractor2013`.
- `audio_metadata.json`: sample rate, kanały, duration, loudness, hash.

Decyzje:

- Do konwersji i ekstrakcji ścieżki audio używać FFmpeg.
- Roboczo używać WAV PCM jako formatu pośredniego.
- Zachować oryginalny czas trwania i offset bez przycinania początku.
- Resampling wykonywać oddzielnie dla wymagań modeli, nie nadpisując `mix.wav`.
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
- `worker_inputs/whisperx.wav`: audio przygotowane z `vocals.wav` po separacji.
- `worker_inputs/torchcrepe.wav`: audio przygotowane z `vocals.wav` po separacji.
- `separation.json` z modelem, parametrami i czasem przetwarzania.

Wymagania:

- Używać GPU, jeśli jest dostępne.
- Obsługiwać brak pamięci GPU przez zmniejszenie segmentu albo przez czytelny błąd.
- Nie zakładać, że separacja jest idealna; dalsze moduły muszą tolerować bleeding instrumentów.
- Zapisać wybrany model w artefaktach i w JSON-ie ustawień projektu.

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
- Użyć progu ciszy i progu periodicity, żeby ograniczyć fałszywe nuty.
- Konwertować częstotliwość do MIDI i do pitch UltraStar dopiero po filtracji.

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

## 8. Edycja ręczna

Użytkownik zatwierdza:

- Tekst.
- Podział na frazy, słowa i sylaby.
- Start i koniec fraz/słów.
- Wysokości i długości nut.
- Typy nut: normalna, golden, freestyle, rap, rap golden.

Wynik:

- `review.approved.json`.

## 9. Eksport

Eksporter generuje:

- Jedną albo wiele paczek ZIP.
- Każda paczka zawiera katalog z plikiem UltraStar `.txt`, audio w MP3 i JSON-em projektu do ponownego wczytania; cover jest dodawany tylko wtedy, gdy został ustawiony.
- Dostępne warianty audio: oryginalne audio albo instrumental bez wokalu.
- Dostępne formaty docelowe: UltraStar Deluxe, UltraStar Play, Vocaluxe.
- Raport walidacji eksportu.
- Po pomyślnym eksporcie opcjonalnie usuwa pliki audio i artefakty robocze, jeśli użytkownik zaznaczył taką opcję.

## 10. Ponowny import projektu

Wejście:

- `mukai-project.json`.
- Opcjonalnie oryginalny plik audio, jeśli nie jest już dostępny w artefaktach.

Zasady:

- JSON zawsze zawiera pełną edycję, ustawienia modeli, metadane, wykryte BPM, transkrypcję, czasy, pitch/nuty i wybory eksportu.
- Import JSON-a nie uruchamia ponownie wykrywania BPM, transkrypcji, alignacji, czasów ani pitch detection.
- Jeśli usunięto tylko rozdzielone audio, aplikacja uruchamia ponownie wyłącznie separację Demucs na podstawie dostępnego oryginalnego audio.
- Jeśli usunięto oryginalne audio, import pozwala użytkownikowi wgrać je ponownie i dopiero wtedy ponownie rozdzielić wokal oraz instrumental.
- Jeśli długość ponownie wgranego audio różni się od długości zapisanej w JSON-ie, aplikacja pokazuje ostrzeżenie przed kontynuacją.
- Ostrzeżenie o innej długości audio nie zmienia automatycznie timingów; użytkownik decyduje, czy kontynuować.
