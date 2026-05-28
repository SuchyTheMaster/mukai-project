# Eksport UltraStar

## Cel

Eksporter zamienia zatwierdzony `Arrangement` na jedną lub wiele paczek ZIP. Każda paczka zawiera katalog z plikiem `.txt`, audio w MP3 oraz JSON-em projektu, który można później wczytać w aplikacji i kontynuować pracę nad utworem. Cover jest dodawany tylko wtedy, gdy użytkownik go ustawił.

Użytkownik wybiera:

- format docelowy: UltraStar Deluxe, UltraStar Play, Vocaluxe;
- wariant audio: oryginalne audio albo audio bez wokalu;
- nazwę katalogu/paczki, domyślnie pochodzącą z nazwy pliku źródłowego;
- cover z importu, jeśli jest dostępny, albo wgrany ręcznie; jeśli cover nie jest ustawiony, paczka nie zawiera covera;
- opcjonalne usunięcie artefaktów roboczych po pomyślnym eksporcie.

ZIP-y dla różnych profili eksportu mają różne nazwy. Katalog i pliki wewnątrz ZIP-a używają tego samego schematu nazw niezależnie od profilu docelowego.

## Struktura paczki ZIP

Przykład ZIP dla profilu UltraStar Deluxe i wariantu oryginalnego:

```text
Artist - Song Title [ultrastar-deluxe original].zip
```

Zawartość:

```text
Artist - Song Title/
├── Artist - Song Title.txt
├── Artist - Song Title.mp3
└── mukai-project.json
```

Jeśli ustawiono cover, zawartość zawiera dodatkowo:

```text
cover.jpg
```

Przykład ZIP dla profilu Vocaluxe i wariantu instrumentalnego:

```text
Artist - Song Title [vocaluxe instrumental].zip
```

Zawartość:

```text
Artist - Song Title/
├── Artist - Song Title.txt
├── Artist - Song Title.mp3
├── Artist - Song Title [instrumental].mp3
├── Artist - Song Title [vocals].mp3
└── mukai-project.json
```

## Format bazowy

Plik powinien być zapisany jako UTF-8 bez BOM.

Minimalne nagłówki:

```text
#VERSION:1.1.0
#TITLE:Song Title
#ARTIST:Artist
#AUDIO:Artist - Song Title.mp3
#BPM:493.8
#GAP:12345
```

Opcjonalne nagłówki:

```text
#CREATOR:Mukai
#LANGUAGE:Polish
#COVER:cover.jpg
#VOCALS:Artist - Song Title [vocals].mp3
#INSTRUMENTAL:Artist - Song Title [instrumental].mp3
#COMMENT:Generated draft reviewed in Mukai
```

Używać nowych tagów `#AUDIO`, `#VOCALS`, `#INSTRUMENTAL`. Nie generować starszego tagu `#MP3` w MVP.

Warianty audio:

- W paczce z oryginalnym audio `#AUDIO` wskazuje oryginalne audio skonwertowane do MP3. Jeśli w paczce są stems, `#VOCALS` i `#INSTRUMENTAL` wskazują osobne pliki wokalu i instrumentalu.
- W paczce instrumentalnej `#AUDIO` wskazuje plik MP3 używany do odtwarzania, a `#INSTRUMENTAL` wskazuje ten sam plik instrumentalny.
- Paczka instrumentalna zawiera też `#VOCALS` wskazujący osobny plik wokalu, nawet jeśli użytkownik eksportuje tylko wersję bez wokalu.
- Jeśli cover nie jest ustawiony, nie generować tagu `#COVER` i nie dodawać pliku covera do ZIP-a.

## Mapowanie czasu

Wewnętrznie aplikacja używa sekund. UltraStar używa beatów liczonych względem `#BPM` i `#GAP`.

Aplikacja wykrywa realne BPM utworu, ale do tagu `#BPM` eksportuje BPM UltraStar. Zgodnie ze specyfikacją UltraStar `#BPM` nie jest zwykłym BPM utworu; idealnie jest to wartość około cztery razy większa niż muzyczne BPM utworu.

Definicje:

```text
song_bpm = detected_song_bpm
ultrastar_bpm = song_bpm * 4
beat_ms = 60000 / ultrastar_bpm
start_beat = round((start_sec * 1000 - gap_ms) / beat_ms)
length_beats = max(1, round((end_sec - start_sec) * 1000 / beat_ms))
```

Rekomendacja MVP:

- Wykryć realne BPM utworu.
- Wyliczyć `#BPM` jako UltraStar BPM na podstawie wykrytego BPM utworu.
- Pozwolić użytkownikowi poprawić BPM przed eksportem; UI powinien jasno pokazać realne BPM i wynikowe `#BPM`.
- Ustawić `#GAP` na czas startu pierwszej zatwierdzonej nuty w milisekundach.
- Eksportować absolutne beaty bez `#RELATIVE`.

Jeśli detekcja BPM jest niepewna, UI powinien oznaczyć ją do sprawdzenia, ale nie blokować eksportu, o ile użytkownik zaakceptuje wartość.

## Mapowanie pitch

UltraStar definiuje pitch `0` jako C4, czyli MIDI 60.

```text
ultrastar_pitch = midi_note - 60
```

Przykłady:

- MIDI 60 -> `0`
- MIDI 57 -> `-3`
- MIDI 64 -> `4`

## Linie nut

Format nuty:

```text
NoteType StartBeat Length Pitch Text
```

Przykład:

```text
: 0 4 -3 Pierw
: 4 3 -1 sza
- 10
: 14 5 0 fra
: 19 4 2 za
- 26
E
```

Typy:

- `:` normalna nuta.
- `*` golden note.
- `F` freestyle.
- `R` rap.
- `G` rap golden.

Koniec frazy:

```text
- StartBeat
```

Koniec pliku:

```text
E
```

## Reguły tekstu

- Tekst tokenu nie może zawierać znaku nowej linii.
- Spacje powinny być kontrolowane przez tokenizację eksportera.
- Przedłużone sylaby mogą być reprezentowane jako kolejne tokeny bez nowego słowa albo przez konwencję uzgodnioną po testach z UltraStar.
- Znaki diakrytyczne są dozwolone dzięki UTF-8.

## Walidacja eksportu

Eksporter musi zgłosić błąd, jeśli:

- brakuje `TITLE`, `ARTIST`, `AUDIO`;
- nuta ma długość mniejszą niż 1 beat;
- frazy są poza kolejnością;
- token nie ma przypisanego pitch;
- wynikowy plik nie kończy się `E`.
- tag `#VOCALS` albo `#INSTRUMENTAL` wskazuje plik, którego nie ma w paczce.

Eksporter powinien zgłosić ostrzeżenie, jeśli:

- `#GAP` jest ujemny;
- pitch jest poza typowym zakresem wokalu;
- fraza ma bardzo długą pauzę bez znacznika końca;
- użyto `#VOCALS` albo `#INSTRUMENTAL`, ale docelowy odtwarzacz może ich jeszcze nie wspierać.

Walidacja przez parser konkretnego odtwarzacza nie jest wymagana w MVP.

## Warianty kompatybilności

Eksporter powinien mieć osobne profile dla:

- UltraStar Deluxe;
- UltraStar Play;
- Vocaluxe.

Profile mogą różnić się szczegółami tagów i nazw plików, ale wszystkie muszą bazować na tych samych danych `Arrangement` i zapisywać JSON projektu do ponownego importu.

Nazwa ZIP-a zawiera profil eksportu i wariant audio, np. `[ultrastar-deluxe original]`, `[ultrastar-play instrumental]`, `[vocaluxe original]`. Wewnętrzny katalog i nazwy plików zachowują ten sam schemat, żeby import projektu nie zależał od profilu docelowego.

## `mukai-project.json`

Każda paczka zawiera `mukai-project.json`.

Plik musi zawierać:

- pełną edycję użytkownika;
- ustawienia modeli;
- metadane;
- wybory eksportu;
- wykryte BPM i wynikowe `#BPM`;
- transkrypcję i czasy;
- pitch frames, note events i finalny arrangement.

Import `mukai-project.json` nie uruchamia ponownie BPM, ASR, alignacji ani pitch detection. Może uruchomić tylko separację audio, jeśli brakuje rozdzielonych plików, ale dostępne jest oryginalne audio albo użytkownik wgra je ponownie.

## Źródło formatu

- UltraStar format: https://usdx.eu/format/
