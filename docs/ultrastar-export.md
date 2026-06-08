# Eksport UltraStar

## Cel

Eksporter karaoke zamienia zatwierdzony `Arrangement` na jedną lub wiele paczek ZIP. Każda paczka karaoke zawiera katalog z plikiem `.txt` oraz audio w MP3. Cover jest dodawany tylko wtedy, gdy użytkownik go ustawił. Paczki karaoke nie zawierają `mukai-project.json` ani innych danych projektu.

Eksport projektu jest osobną akcją `Wyeksportuj projekt`. Ta akcja generuje oddzielny ZIP projektu do późniejszego importu w Mukai.

Użytkownik wybiera:

- format docelowy: UltraStar Deluxe, UltraStar Play, Vocaluxe;
- wariant audio: oryginalne audio albo audio bez wokalu;
- nazwę katalogu/paczki, domyślnie pochodzącą z nazwy pliku źródłowego;
- cover z importu, jeśli jest dostępny, albo wgrany ręcznie; jeśli cover nie jest ustawiony, paczka nie zawiera covera.

ZIP-y dla różnych profili eksportu i wariantów audio mają różne nazwy. Katalog i pliki wewnątrz ZIP-a używają konsekwentnie tej samej nazwy bazowej niezależnie od profilu docelowego i wariantu; zawartość pliku playback MP3 zależy od wariantu.

## Struktura paczki karaoke ZIP

Przykład ZIP dla profilu UltraStar Deluxe i wariantu oryginalnego:

```text
Artist - Song Title [ultrastar-deluxe original].zip
```

Zawartość:

```text
Artist - Song Title/
├── Artist - Song Title.txt
└── Artist - Song Title.mp3
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
└── Artist - Song Title [vocals].mp3
```

## Format bazowy

Plik powinien być zapisany jako UTF-8 bez BOM.

Nagłówki dla wariantu `original_audio`:

```text
#VERSION:1.1.0
#TITLE:Song Title
#ARTIST:Artist
#AUDIO:Artist - Song Title.mp3
#BPM:493.8
#GAP:12345
```

Dodatkowy fallback dla profilu `ultrastar_deluxe`:

```text
#MP3:Artist - Song Title.mp3
```

Opcjonalne nagłówki dla wariantu `original_audio`:

```text
#CREATOR:Mukai
#LANGUAGE:Polish
#COVER:cover.jpg
#COMMENT:Generated draft reviewed in Mukai
```

Nagłówki dla wariantu `instrumental`:

```text
#VERSION:1.1.0
#TITLE:Song Title
#ARTIST:Artist
#AUDIO:Artist - Song Title.mp3
#INSTRUMENTAL:Artist - Song Title.mp3
#VOCALS:Artist - Song Title [vocals].mp3
#BPM:493.8
#GAP:12345
```

Dodatkowy fallback dla profilu `ultrastar_deluxe`:

```text
#MP3:Artist - Song Title.mp3
```

Opcjonalne nagłówki dla wariantu `instrumental`:

```text
#CREATOR:Mukai
#LANGUAGE:Polish
#COVER:cover.jpg
#COMMENT:Generated draft reviewed in Mukai
```

Polityka tagów MVP:

- UltraStar Play i Vocaluxe używają `#AUDIO` jako głównego tagu playback.
- UltraStar Deluxe używa `#AUDIO` oraz fallbacku `#MP3` wskazującego ten sam plik MP3.
- Wariant instrumentalny używa `#INSTRUMENTAL` dla instrumentalnego playbacku i `#VOCALS` dla osobnego stemu wokalu.

Warianty audio:

- W paczce z oryginalnym audio `#AUDIO` wskazuje oryginalne audio skonwertowane do MP3. Jeśli w paczce są stems, `#VOCALS` i `#INSTRUMENTAL` wskazują osobne pliki wokalu i instrumentalu.
- W paczce instrumentalnej `#AUDIO` wskazuje plik MP3 używany do odtwarzania, a `#INSTRUMENTAL` wskazuje ten sam plik instrumentalny. Wewnętrzna nazwa pliku pozostaje `Artist - Song Title.mp3`.
- Paczka instrumentalna zawiera też `#VOCALS` wskazujący osobny plik wokalu, nawet jeśli użytkownik eksportuje tylko wersję bez wokalu.
- Jeśli cover nie jest ustawiony, nie generować tagu `#COVER` i nie dodawać pliku covera do ZIP-a.

## Mapowanie czasu

Wewnętrznie aplikacja używa sekund. UltraStar używa beatów liczonych względem `#BPM` i `#GAP`.

Aplikacja wykrywa realne BPM utworu, ale do tagu `#BPM` eksportuje BPM UltraStar. Zgodnie ze specyfikacją UltraStar `#BPM` nie jest zwykłym BPM utworu; idealnie jest to wartość około cztery razy większa niż muzyczne BPM utworu.

Definicje:

```text
song_bpm = acceptedSongBpm
ultrastar_bpm = acceptedSongBpm * 4
gap_ms = gapMs
beat_ms = 60000 / ultrastar_bpm
start_beat = round((start_sec * 1000 - gap_ms) / beat_ms)
length_beats = max(1, round((end_sec - start_sec) * 1000 / beat_ms))
```

Rekomendacja MVP:

- Wykryć realne BPM utworu i zapisać je jako `Tempo.detectedSongBpm`.
- Wyliczyć `#BPM` jako UltraStar BPM na podstawie `Tempo.acceptedSongBpm`.
- Pozwolić użytkownikowi poprawić BPM przed eksportem; UI musi jasno pokazać wykryte BPM, zaakceptowane BPM i wynikowe `#BPM`.
- Użyć `Tempo.gapMs` jako `#GAP`; domyślnie jest to czas startu pierwszej zatwierdzonej nuty w milisekundach.
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
- Kolejne części tej samej sylaby mogą być reprezentowane normalnym tokenem `~`; eksporter traktuje go jak tekst tokenu.
- Puste tokeny przedłużenia `isExtension=true` i `extendsTokenId` są obsługiwane tylko kompatybilnościowo; eksporter nie zgaduje tekstu przedłużeń.
- Znaki diakrytyczne są dozwolone dzięki UTF-8.

## Walidacja eksportu

Eksporter musi zgłosić błąd, jeśli:

- brakuje `TITLE`, `ARTIST`, `AUDIO`;
- profil `ultrastar_deluxe` nie zawiera `#MP3`;
- nuta ma długość mniejszą niż 1 beat;
- frazy są poza kolejnością;
- token nie ma przypisanego pitch;
- wynikowy plik nie kończy się `E`.
- tag `#VOCALS` albo `#INSTRUMENTAL` wskazuje plik, którego nie ma w paczce.
- profil UltraStar Deluxe wygenerował `#MP3`, który nie wskazuje tego samego pliku co `#AUDIO`.

Eksporter powinien zgłosić ostrzeżenie, jeśli:

- `#GAP` jest ujemny;
- pitch jest poza typowym zakresem wokalu;
- fraza ma bardzo długą pauzę bez znacznika końca;
- użyto `#VOCALS` albo `#INSTRUMENTAL`, ale docelowy odtwarzacz może ich jeszcze nie wspierać.

Walidacja przez parser konkretnego odtwarzacza nie jest wymagana w MVP.

## Warianty kompatybilności

Eksporter musi mieć osobne profile dla:

- UltraStar Deluxe;
- UltraStar Play;
- Vocaluxe.

Profile różnią się wyłącznie polityką tagów kompatybilności, ale nie zmieniają schematu nazw katalogu i plików wewnątrz ZIP-a. Wszystkie profile bazują na tych samych danych `Arrangement`; dane projektu nie są zapisywane w paczkach karaoke. Każdy profil musi mieć test kompatybilności z docelowym odtwarzaczem albo jawnie opisane założenie, jeśli test manualny nie został jeszcze wykonany.

Polityka profili:

- `ultrastar_play`: generuje `#AUDIO`; w wariancie instrumentalnym dodatkowo `#INSTRUMENTAL` i `#VOCALS`.
- `vocaluxe`: generuje `#AUDIO`; w wariancie instrumentalnym dodatkowo `#INSTRUMENTAL` i `#VOCALS`.
- `ultrastar_deluxe`: generuje `#AUDIO` oraz fallback `#MP3` wskazujący ten sam plik; w wariancie instrumentalnym dodatkowo `#INSTRUMENTAL` i `#VOCALS`.

Nazwa ZIP-a zawiera profil eksportu i wariant audio, np. `[ultrastar-deluxe original]`, `[ultrastar-play instrumental]`, `[vocaluxe original]`. Wewnętrzny katalog i nazwy plików zachowują tę samą nazwę bazową.

## Eksport projektu

Akcja `Wyeksportuj projekt` jest oddzielna od eksportu paczek karaoke. Nie modyfikuje zawartości paczek UltraStar, tylko tworzy osobny ZIP projektu.

Przykładowa nazwa:

```text
Artist - Song Title [mukai-project].zip
```

Przykładowa zawartość archiwum dla projektu po zatwierdzeniu edycji:

```text
mukai-project.json
job.json
source/
└── source-file.mp3
artifacts/
├── audio_metadata.json
├── mix.wav
├── worker_inputs/
├── vocals.wav
├── instrumental.wav
├── separation.json
├── transcript.raw.json
├── transcript.aligned.json
├── pitch.frames.json
├── pitch.notes.json
└── draft.arrangement.json
exports/
└── validation-report.json
```

ZIP projektu musi zawierać:

- pełną edycję użytkownika zserializowaną z aktualnego `Arrangement` w Postgresie do `mukai-project.json`;
- rekord `Job` ze statusem, datami, metadanymi i profilami modeli;
- ustawienia modeli;
- metadane;
- wybory eksportu;
- `Tempo`, w tym `detectedSongBpm`, `acceptedSongBpm`, wynikowe `#BPM` i `gapMs`;
- transkrypcję i czasy;
- pitch frames, note events, karaoke tokens i finalny arrangement;
- oryginalny plik źródłowy;
- wszystkie artefakty zapisane dla `Job` i potrzebne do odtworzenia stanu po wykonanych etapach pipeline'u;
- manifest artefaktów z typami, ścieżkami w archiwum, hashami, rozmiarami i czasami utworzenia;
- politykę retencji `projectExportRetentionHours: 24`.

Jeśli `Job` nie ma jeszcze któregoś artefaktu, archiwum nie musi go sztucznie tworzyć. Musi jednak zawierać komplet artefaktów wymaganych dla statusu zapisanego w manifeście.

Po pomyślnym utworzeniu i przekazaniu ZIP-a projektu aplikacja ustawia `cleanupEligibleAt` na 24 godziny po eksporcie i przywraca status `Job` do `awaiting_review`. Lokalny `Job`, oryginalny plik, artefakty i eksporty zapisane dla tego zadania mogą zostać usunięte dopiero po upływie TTL.

## Import projektu

Import projektu przyjmuje ZIP utworzony przez `Wyeksportuj projekt`. Import nie przyjmuje pojedynczego `mukai-project.json` jako samodzielnego formatu MVP.

Import:

- waliduje strukturę archiwum, manifest i hashe artefaktów;
- odtwarza `Job`, oryginalny plik i artefakty w magazynie aplikacji;
- ustawia stan tak, jakby etapy pipeline'u były już wykonane;
- nie uruchamia ponownie normalizacji audio, BPM, separacji, ASR, alignacji ani pitch detection;
- kończy się błędem, jeśli archiwum nie zawiera wymaganych plików albo nie przejdzie walidacji.

## Źródło formatu

- UltraStar format: https://usdx.eu/format/
