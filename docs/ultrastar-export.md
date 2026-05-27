# Eksport UltraStar

## Cel

Eksporter zamienia zatwierdzony `Arrangement` na plik `.txt` zgodny z formatem UltraStar oraz przygotowuje referencje do plików audio.

## Format bazowy

Plik powinien być zapisany jako UTF-8 bez BOM.

Minimalne nagłówki:

```text
#VERSION:1.1.0
#TITLE:Song Title
#ARTIST:Artist
#AUDIO:Artist - Song Title.mp3
#BPM:400
#GAP:12345
```

Opcjonalne nagłówki:

```text
#CREATOR:Mukai
#LANGUAGE:Polish
#VOCALS:Artist - Song Title [VOC].mp3
#INSTRUMENTAL:Artist - Song Title [INSTR].mp3
#COMMENT:Generated draft reviewed in Mukai
```

Dla zgodności ze starszymi narzędziami można dodać `#MP3`, ale domyślnym polem powinno być `#AUDIO`.

## Mapowanie czasu

Wewnętrznie aplikacja używa sekund. UltraStar używa beatów liczonych względem `#BPM` i `#GAP`.

Definicje:

```text
beat_ms = 60000 / BPM
start_beat = round((start_sec * 1000 - gap_ms) / beat_ms)
length_beats = max(1, round((end_sec - start_sec) * 1000 / beat_ms))
```

Rekomendacja MVP:

- Ustawić `#BPM:400`, jeśli użytkownik nie poda innej strategii.
- Ustawić `#GAP` na czas startu pierwszej zatwierdzonej nuty w milisekundach.
- Eksportować absolutne beaty bez `#RELATIVE`.

Uwaga: w UltraStar `#BPM` nie musi odpowiadać realnemu BPM utworu; specyfikacja traktuje je jako siatkę czasową dla nut.

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

Eksporter powinien zgłosić ostrzeżenie, jeśli:

- `#GAP` jest ujemny;
- pitch jest poza typowym zakresem wokalu;
- fraza ma bardzo długą pauzę bez znacznika końca;
- użyto `#VOCALS` albo `#INSTRUMENTAL`, ale docelowy odtwarzacz może ich jeszcze nie wspierać.

## Źródło formatu

- UltraStar format: https://usdx.eu/format/
