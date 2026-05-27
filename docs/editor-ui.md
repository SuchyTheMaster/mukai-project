# Specyfikacja edytora UI

## Cel

Edytor ma umożliwić szybkie doprowadzenie wyniku AI do jakości grywalnego pliku UltraStar. Interfejs powinien skupiać się na pracy nad utworem, nie na stronie marketingowej.

## Widoki

### Upload

- Pole wyboru pliku audio.
- Metadane: tytuł, artysta, język, opcjonalny BPM, opcjonalny tryb jakości.
- Informacja o ograniczeniach pliku.
- Start zadania.

### Status zadania

- Pasek etapów pipeline'u.
- Log skrócony z ostatnim błędem.
- Czas trwania zadania i orientacyjny postęp.
- Link do edytora po statusie `awaiting_review`.

### Edytor

Główne obszary:

- Odtwarzacz audio z przełącznikiem oryginał/wokal/instrumental.
- Waveform z markerami fraz.
- Lista fraz tekstu.
- Piano roll lub siatka nut zsynchronizowana z osią czasu.
- Panel właściwości zaznaczonej frazy, słowa albo nuty.

## Operacje edycyjne

Tekst:

- Edycja treści frazy.
- Podział i scalanie fraz.
- Podział i scalanie słów/tokenów.
- Oznaczanie fragmentu jako instrumentalny, freestyle albo rap.

Timing:

- Przesuwanie początku i końca frazy.
- Przesuwanie początku i końca nuty.
- Dociąganie do siatki beatów.
- Lokalna korekta offsetu dla całej frazy.

Pitch:

- Przesuwanie nuty w górę/dół o półton.
- Scalanie krótkich nut.
- Dzielenie nuty.
- Ustawienie typu nuty.
- Podgląd surowego konturu F0 jako warstwy pod nutami.

Akcje globalne:

- Undo/redo.
- Zapis wersji roboczej.
- Walidacja przed eksportem.
- Eksport po zatwierdzeniu.

## Stany jakości

Edytor powinien wizualnie oznaczać:

- niską pewność transkrypcji;
- niską periodicity pitch;
- brak przypisanej nuty do tekstu;
- nutę bez tekstu;
- zbyt krótką nutę po przeliczeniu na beaty;
- nachodzące na siebie frazy.

## Wymagania UX

- Odtwarzanie musi być zsynchronizowane z waveformem i piano rollem.
- Najczęstsze korekty powinny dać się wykonać bez opuszczania głównego widoku.
- Edycje muszą być zapisywane jako wersje, żeby można było wrócić do poprzedniego stanu.
- Interfejs powinien obsługiwać długie utwory bez renderowania całej osi czasu naraz.
- Tekst w przyciskach i panelach nie może nachodzić na inne elementy przy małej szerokości ekranu.

## Minimalna walidacja przed eksportem

- Tytuł, artysta i plik audio są ustawione.
- Każda eksportowana linia ma co najmniej jedną nutę.
- Każda nuta ma dodatnią długość.
- Pitch mieści się w rozsądnym zakresie MIDI dla wokalu.
- Linie są posortowane rosnąco po czasie.
