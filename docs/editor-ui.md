# Specyfikacja edytora UI

## Cel

Edytor ma umożliwić szybkie doprowadzenie wyniku AI do jakości grywalnego pliku UltraStar. Interfejs powinien skupiać się na pracy nad utworem, nie na stronie marketingowej.

Warstwa wizualna całego interfejsu musi być zgodna z design systemem RetroWave opisanym w [UI.md](UI.md). Ten plik jest źródłem prawdy dla kolorów, typografii, spacingu, radiusów, glow, komponentów, stanów hover/focus/disabled oraz zasad kontrastu i reduced motion.

## Widoki

### Upload

- Pole wyboru pliku audio.
- Obsługiwane formaty: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Metadane: tytuł, artysta, opcjonalny język, opcjonalny rok/gatunek.
- Jeśli plik audio zawiera metadane, formularz importu automatycznie uzupełnia dostępne pola.
- Jeśli plik audio zawiera osadzony cover utworu albo albumu, formularz importu automatycznie ustawia go jako wstępny cover.
- Jeśli metadane nie istnieją, pola pozostają puste do ręcznego uzupełnienia.
- Wskazówka: dla utworów wielojęzycznych zostaw język pusty, żeby Whisper sam wykrył język.
- Wybór modelu separacji: szybszy `htdemucs` albo dokładniejszy `htdemucs_ft`.
- Wybór modelu transkrypcji: szybszy `large-v3-turbo` albo dokładniejszy `large-v3`.
- Opcjonalny upload covera, który może zostać użyty w eksporcie.
- Podgląd covera jest widoczny od razu po wykryciu grafiki z tagów albo po ręcznym wgraniu pliku.
- Jeśli użytkownik nie wgra covera, eksportowana paczka nie zawiera covera.
- Informacja, że audio zostanie przekonwertowane lokalnie przez FFmpeg do formatów roboczych.
- Start zadania.

### Import Projektu

- Użytkownik może wczytać `mukai-project.json`.
- Jeśli oryginalne audio jest niedostępne, UI prosi o ponowne wgranie pliku audio.
- Jeśli ponownie wgrany plik audio ma inną długość niż zapisana w JSON-ie, UI pokazuje ostrzeżenie przed kontynuacją.
- Import nie uruchamia ponownie BPM, transkrypcji, alignacji ani pitch detection.

### Status zadania

- Pasek etapów pipeline'u.
- Log skrócony z ostatnim błędem.
- Czas trwania zadania i orientacyjny postęp.
- Link do edytora po statusie `awaiting_review`.

### Edytor

Główne obszary:

- Odtwarzacz audio z przełącznikiem oryginał/wokal/instrumental.
- Waveform z markerami fraz.
- Lista fraz tekstu z edycją słów i sylab.
- Piano roll lub siatka nut zsynchronizowana z osią czasu.
- Panel właściwości zaznaczonej frazy, słowa, sylaby albo nuty.

## Operacje edycyjne

Tekst:

- Edycja treści frazy.
- Podział i scalanie fraz.
- Podział i scalanie słów.
- Podział i scalanie sylab.
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
- Skróty klawiaturowe nie są wymagane w MVP.

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
- MVP nie wymaga widoku porównania oryginalnego wyniku AI z poprawioną wersją.
- Przyciski, pola formularzy, checkboxy, radio, tooltipy, chipy, listy i karty powinny używać wariantów z [UI.md](UI.md), chyba że dany element wymaga specjalnego wzorca edytora audio.
- Statusy jakości AI powinny używać kolorów semantycznych z [UI.md](UI.md): success, warning, error i info.
- Animacje glow muszą mieć wariant reduced-motion zgodny z [UI.md](UI.md).

## Eksport w UI

- Użytkownik może zaznaczyć jeden lub wiele formatów docelowych: UltraStar Deluxe, UltraStar Play, Vocaluxe.
- Użytkownik może zaznaczyć jeden lub oba warianty paczki: oryginalne audio albo audio bez wokalu.
- Każda paczka eksportowana jest jako ZIP zawierający cały katalog utworu.
- Domyślna nazwa katalogu pochodzi z nazwy pliku źródłowego i może zostać zmieniona przed eksportem.
- Użytkownik może wybrać cover z importu, jeśli jest dostępny, albo wgrać inny cover przed eksportem.
- Jeśli cover nie jest ustawiony, eksport przebiega bez covera.
- Użytkownik może zaznaczyć opcję usunięcia plików audio i artefaktów roboczych po pomyślnym eksporcie.
- ZIP-y dla różnych profili eksportu mają różne nazwy, ale katalog i pliki wewnątrz używają tego samego schematu nazw.

## Minimalna walidacja przed eksportem

- Tytuł, artysta i plik audio są ustawione.
- Każda eksportowana linia ma co najmniej jedną nutę.
- Każda nuta ma dodatnią długość.
- Pitch mieści się w rozsądnym zakresie MIDI dla wokalu.
- Linie są posortowane rosnąco po czasie.
- Golden notes, rap notes i rap golden notes są obsługiwane jako typy nut w MVP.
