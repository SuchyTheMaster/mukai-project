# Pipeline przetwarzania

## 1. Upload

Wejście:

- Plik audio: `mp3`, `wav`, `flac`, opcjonalnie `m4a`.
- Metadane: tytuł, artysta, język, opcjonalny BPM utworu, opcjonalny rok/gatunek.

Walidacja:

- Maksymalny rozmiar pliku i czas trwania muszą być konfigurowalne.
- Backend zapisuje oryginał jako artefakt niemodyfikowany.
- Nazwy plików eksportu są normalizowane i nie mogą zawierać ścieżek.

## 2. Normalizacja audio

Cel:

- Przygotować spójny format roboczy dla modeli.

Artefakty:

- `mix.wav`: znormalizowane audio robocze.
- `audio_metadata.json`: sample rate, kanały, duration, loudness, hash.

Decyzje:

- Roboczo używać WAV PCM.
- Zachować oryginalny czas trwania i offset bez przycinania początku.
- Resampling wykonywać oddzielnie dla wymagań modeli, nie nadpisując `mix.wav`.

## 3. Separacja wokalu

Model:

- Demucs v4, profil jakości `htdemucs_ft` albo profil szybszy `htdemucs`.

Wejście:

- `mix.wav`.

Wyjście:

- `vocals.wav`
- `instrumental.wav` albo stem `other`/miks instrumentalny zależnie od konfiguracji.
- `separation.json` z modelem, parametrami i czasem przetwarzania.

Wymagania:

- Używać GPU, jeśli jest dostępne.
- Obsługiwać brak pamięci GPU przez zmniejszenie segmentu albo przez czytelny błąd.
- Nie zakładać, że separacja jest idealna; dalsze moduły muszą tolerować bleeding instrumentów.

## 4. Transkrypcja i alignacja tekstu

Model:

- WhisperX z `large-v3` jako profil domyślny.
- `large-v3-turbo` jako profil szybki do benchmarku.

Wejście:

- `vocals.wav`.

Wyjście:

- `transcript.raw.json`: segmenty modelu ASR.
- `transcript.aligned.json`: segmenty, słowa, czasy start/end, confidence.

Wymagania:

- Wymuszać język, jeśli użytkownik podał go w uploadzie.
- Zachować segmenty o niskiej pewności, ale oznaczyć je do ręcznej korekty.
- Dla piosenek dopuszczać powtórzenia, wydłużone sylaby i fragmenty bez słów.

## 5. Detekcja pitch

Model:

- torchcrepe jako implementacja CREPE w PyTorch.

Wejście:

- `vocals.wav`.

Wyjście:

- `pitch.frames.json`: ramki `time`, `frequency_hz`, `periodicity`, `confidence`.
- `pitch.notes.json`: zsegmentowane nuty po filtracji.

Wymagania:

- Przechowywać ramki F0 niezależnie od nut, żeby edytor mógł pokazać surowy kontur.
- Użyć progu ciszy i progu periodicity, żeby ograniczyć fałszywe nuty.
- Konwertować częstotliwość do MIDI i do pitch UltraStar dopiero po filtracji.

## 6. Łączenie tekstu z nutami

Cel:

- Połączyć rozpoznane słowa/frazy z nutami w edytowalny szkic karaoke.

Reguły startowe:

- Fraza tekstu wyznacza linię karaoke.
- Nuty przypisywać do słów na podstawie przecięcia czasowego.
- Jeśli jedno słowo trwa przez wiele nut, dzielić je na token główny i przedłużenia zgodne z konwencją UltraStar.
- Jeśli pitch jest niepewny, oznaczać nutę jako wymagającą korekty zamiast usuwać ją automatycznie.

Wyjście:

- `draft.arrangement.json`.

## 7. Edycja ręczna

Użytkownik zatwierdza:

- Tekst.
- Podział na frazy.
- Start i koniec fraz/słów.
- Wysokości i długości nut.
- Typy nut, np. normalna, freestyle, rap, golden.

Wynik:

- `review.approved.json`.

## 8. Eksport

Eksporter generuje:

- Plik UltraStar `.txt`.
- Opcjonalnie pliki audio referencjonowane przez `#AUDIO`, `#VOCALS`, `#INSTRUMENTAL`.
- Raport walidacji eksportu.
