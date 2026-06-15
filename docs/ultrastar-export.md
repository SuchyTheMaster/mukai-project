# Eksport UltraStar

## Cel

Eksporter karaoke zamienia zatwierdzony `Arrangement` na jedną paczkę ZIP zgodną z aktualnymi wersjami UltraStar Deluxe, UltraStar Play i Vocaluxe. Paczka karaoke zawiera katalog z plikiem `.txt`, oryginalnym audio, instrumentalem i wokalem/a capella w MP3. Cover jest dodawany tylko wtedy, gdy użytkownik go ustawił. Paczka karaoke nie zawiera `mukai-project.json` ani innych danych projektu.

Eksport projektu jest osobną akcją `Wyeksportuj projekt`. Ta akcja generuje oddzielny ZIP projektu do późniejszego importu w Mukai.

Użytkownik wybiera:

- nazwę katalogu/paczki, domyślnie pochodzącą z nazwy pliku źródłowego;
- cover z importu, jeśli jest dostępny, albo wgrany ręcznie; jeśli cover nie jest ustawiony, paczka nie zawiera covera.

Eksport nie ma osobnych profili odtwarzaczy ani wariantów audio. Jedna paczka zawiera komplet plików wymaganych przez najnowsze wersje wspieranych programów.

## Struktura paczki karaoke ZIP

Przykład ZIP:

```text
Artist - Song Title [karaoke].zip
```

Zawartość:

```text
Artist - Song Title/
├── Artist - Song Title.txt
├── Artist - Song Title [FULL].mp3
├── Artist - Song Title [INSTR].mp3
└── Artist - Song Title [VOC].mp3
```

Jeśli ustawiono cover, zawartość zawiera dodatkowo:

```text
cover.jpg
```

## Format bazowy

Plik powinien być zapisany jako UTF-8 bez BOM.

Nagłówki obowiązkowe:

```text
#VERSION:1.1.0
#TITLE:Song Title
#ARTIST:Artist
#AUDIO:Artist - Song Title [FULL].mp3
#INSTRUMENTAL:Artist - Song Title [INSTR].mp3
#VOCALS:Artist - Song Title [VOC].mp3
#BPM:493.8
#GAP:12345
```

Opcjonalne nagłówki:

```text
#CREATOR:Mukai
#LANGUAGE:Polish
#COVER:cover.jpg
#COMMENT:Generated draft reviewed in Mukai
```

Polityka plików audio:

- `#AUDIO` wskazuje oryginalne audio skonwertowane do MP3 z sufiksem `[FULL]`.
- `#INSTRUMENTAL` wskazuje instrumentalny stem skonwertowany do MP3 z sufiksem `[INSTR]`.
- `#VOCALS` wskazuje wokal/a capella skonwertowany do MP3 z sufiksem `[VOC]`.
- Nazwy plików audio muszą być spójne z tagami w pliku `.txt`.
- Eksporter nie generuje tagu `#MP3`; starsze tryby kompatybilności nie są częścią MVP.
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

- Tekst sylaby nie może zawierać znaku nowej linii.
- Spacje powinny być kontrolowane przez eksportera na granicach wyrazów.
- Eksporter generuje zdarzenia UltraStar z `ArrangementSentence.words[].syllables[]`.
- Znaki diakrytyczne są dozwolone dzięki UTF-8.

## Walidacja eksportu

Eksporter musi zgłosić błąd, jeśli:

- brakuje `TITLE`, `ARTIST`, `AUDIO`, `INSTRUMENTAL` albo `VOCALS`;
- `#AUDIO`, `#INSTRUMENTAL` albo `#VOCALS` wskazuje plik, którego nie ma w paczce;
- nazwy plików audio nie odpowiadają wzorowi `{baseFilename} [FULL].mp3`, `{baseFilename} [INSTR].mp3`, `{baseFilename} [VOC].mp3`;
- nuta ma długość mniejszą niż 1 beat;
- frazy są poza kolejnością;
- sylaba eksportowana jako nuta punktowana nie ma wartości `midi`;
- wynikowy plik nie kończy się `E`.

Eksporter powinien zgłosić ostrzeżenie, jeśli:

- `#GAP` jest ujemny;
- pitch jest poza typowym zakresem wokalu;
- fraza ma bardzo długą pauzę bez znacznika końca;
- paczka nie została jeszcze ręcznie sprawdzona w aktualnych wersjach UltraStar Deluxe, UltraStar Play i Vocaluxe.

Walidacja przez parser konkretnego odtwarzacza nie jest wymagana w MVP.

## Kompatybilność

Eksporter generuje jedną paczkę dla aktualnych wersji:

- UltraStar Deluxe;
- UltraStar Play;
- Vocaluxe.

Założenie MVP: najnowsze dostępne wersje tych programów obsługują wspólny zestaw tagów `#AUDIO`, `#INSTRUMENTAL` i `#VOCALS`. Każda paczka powinna mieć test ręcznego otwarcia w aktualnych wersjach wspieranych programów albo jawnie opisane założenie, jeśli test manualny nie został jeszcze wykonany.

## Eksport projektu

Akcja `Wyeksportuj projekt` jest oddzielna od eksportu karaoke. Nie modyfikuje zawartości paczki UltraStar, tylko tworzy osobny ZIP projektu.

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
- pitch frames, note events i finalny arrangement sylabowy;
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
