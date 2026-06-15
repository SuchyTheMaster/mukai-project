# Specyfikacja edytora UI

## Cel

Edytor ma umożliwić szybkie doprowadzenie wyniku AI do jakości grywalnego pliku UltraStar. Interfejs powinien skupiać się na pracy nad utworem, nie na stronie marketingowej.

Warstwa wizualna całego interfejsu musi być zgodna z design systemem RetroWave opisanym w [UI.md](UI.md). Ten plik jest źródłem prawdy dla kolorów, typografii, spacingu, radiusów, glow, komponentów, stanów hover/focus/disabled oraz zasad kontrastu i reduced motion.

## Shell aplikacji

- Lewa pływająca kolumna ma na górze branding z logo, napisem `MUKAI` i mniejszym napisem `Music to Karaoke AI Creator`, a niżej sekcję uploadu audio z kompaktowym podsumowaniem wybranego pliku i coverem.
- Po utworzeniu zadania ta sekcja zmienia tytuł na `WGRANE AUDIO`, ukrywa obszar uploadu oraz przyciski covera i zostawia dane pliku z nieklikalnym podglądem okładki.
- Branding zajmuje tylko szerokość lewej kolumny; środkowa i prawa kolumna zaczynają się od góry strony z zachowaniem paddingu.
- Prawa pływająca kolumna pokazuje aktualny etap oraz wszystkie spodziewane etapy pipeline'u od uploadu do eksportu. Etapy są rozróżnione kolorami na wykonane, przetwarzane, oczekujące i błędne.
- W widoku `Dopasowanie` prawa kolumna jest domyślnie ukryta, ale użytkownik może ją pokazać i ponownie ukryć.
- Centralny obszar roboczy pokazuje aktywny widok: upload, status przetwarzania, edytor albo eksport.
- Na małych ekranach prawa kolumna etapów musi zmienić się w zwijany panel albo poziomy pasek, żeby nie zasłaniać formularzy ani edytora.

## Widoki

### Upload

- Pole wyboru pliku audio.
- Obsługiwane formaty: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Metadane: tytuł, artysta, opcjonalny język, opcjonalny rok/gatunek.
- Język jest wybierany z przeszukiwalnej listy języków obsługiwanych przez Whisper `large-v3`; pozycja `Auto` oznacza brak wymuszonego języka i pozwala Whisperowi wykryć język.
- Pozycje języka pokazują pełną nazwę w UI, ale do payloadu trafia kod języka, np. `pl` dla `Polski`.
- Po wyborze pliku audio frontend wysyła go do `POST /api/uploads/inspect`, żeby pobrać tagi, dane techniczne audio i osadzony cover przed utworzeniem `Job`.
- Jeśli plik audio zawiera metadane, formularz automatycznie uzupełnia tytuł, artystę, album, rok i gatunek.
- Po preflight UI pokazuje dane techniczne pliku źródłowego: format/kontener z pola `container`, `codec`, `channels`, `sampleRate` jako częstotliwość próbkowania oraz `durationSec`.
- Tagi tekstowe muszą być poprawnie odczytane i pokazane niezależnie od tego, czy w pliku są zapisane jako UTF-8, UTF-16 czy mieszane kodowanie obsługiwane przez bibliotekę metadanych.
- Każde pole uzupełnione z tagów pozostaje edytowalne i użytkownik może nadpisać wartość przed startem zadania.
- Jeśli plik audio zawiera osadzony cover utworu albo albumu, formularz automatycznie ustawia go jako wstępny cover.
- Cover z tagów jest widoczny tak samo jak cover wskazany z dysku: jest wybrany, pokazany w podglądzie i zostanie użyty w eksporcie, jeśli użytkownik go nie zastąpi.
- Przed utworzeniem zadania kliknięcie podglądu covera otwiera wybór pliku z dysku; po utworzeniu zadania podgląd covera w lewej kolumnie jest nieklikalny.
- Ręcznie wskazany cover zastępuje cover wykryty w tagach.
- Akcja `Z tagów` przywraca cover wykryty w tagach; jeśli tagi nie zawierały covera, czyści wybór covera.
- W UI importu przycisk ręcznego wgrania covera jest podpisany `Z dysku`, a przywrócenie covera z tagów jest podpisane `Z tagów`; oba znajdują się pod podglądem okładki w lewej kolumnie.
- Jeśli metadane albo cover nie istnieją, pola pozostają do ręcznego uzupełnienia, a eksport bez covera pozostaje poprawny.
- Wskazówka: dla utworów wielojęzycznych wybierz `Auto`, żeby Whisper sam wykrył język.
- Wybór modelu separacji pokazuje w selekcie tylko nazwy `htdemucs_ft` i `htdemucs`; tooltip wyjaśnia, że `htdemucs_ft` jest dokładniejszy, a `htdemucs` szybszy.
- Wybór metody wykrywania mowy/VAD jest widoczny w tym samym wierszu co modele separacji i transkrypcji, w kolejności: separacja, wykrywanie mowy, transkrypcja.
- Każda z tych trzech pozycji ma ikonę informacyjną z tooltipem, który krótko wyjaśnia cel kroku i wpływ wyboru.
- Wybór modelu transkrypcji pokazuje w selekcie tylko nazwy `large-v3` i `large-v3-turbo`; tooltip wyjaśnia, że `large-v3` jest dokładniejszy, a `large-v3-turbo` szybszy.
- Zaawansowane ustawienia transkrypcji zawierają select `Pozycjonowanie` z opcjami `słowa i sylaby` oraz `tylko słowa`; `słowa i sylaby` jest domyślne, ale przy sylabizacji `Bez podziału` UI wymusza i blokuje `tylko słowa`.
- Pole `Cs między sentencjami` edytuje próg przerwy w centisekundach dla wygody UI. Kontrakt backendu nadal przechowuje `sentenceGapMs` w milisekundach, więc frontend przelicza wartość z centisekund na milisekundy przed wysłaniem payloadu.
- Zaawansowane ustawienia pitch: próg ciszy, próg periodicity, krok ramek, minimalna długość nuty i scalanie krótkich przerw.
- Opcjonalny upload covera, który może zostać użyty w eksporcie.
- Podgląd covera jest widoczny od razu po wykryciu grafiki z tagów albo po ręcznym wgraniu pliku.
- Jeśli preflight nie wykrył covera i użytkownik nie wgra ręcznego covera, eksportowana paczka nie zawiera covera.
- Informacja, że audio zostanie przekonwertowane lokalnie przez FFmpeg do formatów roboczych.
- Główna akcja startu w środkowej kolumnie jest podpisana `Przetwarzaj audio`.

### Import Projektu

- Użytkownik może wczytać ZIP projektu utworzony przez opcję `Wyeksportuj projekt`.
- UI pokazuje błąd, jeśli archiwum nie ma wymaganej struktury, brakuje w nim artefaktów albo hashe nie zgadzają się z manifestem.
- Import odtwarza stan tak, jakby pliki były już wgrane i przetworzone przez pipeline.
- Import nie uruchamia ponownie normalizacji audio, BPM, separacji, transkrypcji, alignacji ani pitch detection.

### Status zadania

- Pasek etapów pipeline'u pokazuje od razu wszystkie spodziewane etapy, także oczekujące.
- Etap przetwarzania audio jest widoczny jako podetapy: preprocessing/FFmpeg, BPM, Demucs, WhisperX, pitch detection oraz alignment/draft.
- Każdy podetap ma własny kolor statusu: wykonany, przetwarzany, oczekujący albo błędny.
- Długie operacje pokazują pasek postępu. Jeśli backend zna postęp i ETA, UI pokazuje procent i pozostały czas; jeśli ma tylko estymację, pokazuje szacowany procent; jeśli nie zna postępu, pokazuje pasek indeterminate oraz czas trwania.
- Po zakończeniu podetapu UI pokazuje przy nim akcje pobrania dostępnych artefaktów.
- Log skrócony z ostatnim błędem zawiera krótki komunikat oraz kompaktowy, rozwijany tekst szczegółowego logu diagnostycznego bez sekretów i prywatnych ścieżek.
- Link do edytora po statusie `awaiting_review`.

### Edytor

Główne obszary:

- Odtwarzacz audio z przełącznikiem oryginał/wokal/instrumental.
- Jeden wysoki wykres edytora z waveformem w tle, cienkimi markerami fraz i blokami sylab w pitch lane.
- Lista sentencji tekstu z edycją słów i sylab. `Sentencje` są etykietą UI dla istniejących linii/fraz karaoke w `Arrangement`.
- Ghost nuty bez tekstu jako półprzezroczyste bloki diagnostyczne w tym samym wykresie.
- Panel właściwości zaznaczonej frazy, słowa, sylaby albo nuty.

## Operacje edycyjne

Tekst:

- Edycja treści frazy.
- Podział i scalanie fraz. Podział zaznaczonej sentencji/frazy odbywa się w miejscu playheada; jeśli playhead jest poza dzieloną sentencją, UI pokazuje komunikat `Przewiń wskaźnik do miejsca podziału wewnątrz dzielonej sentencji.` z przyciskiem `OK` i nie zmienia danych.
- Jeśli playhead wypada w środku sylaby podczas podziału sentencji, sylaba jest rozcinana czasowo i tekstowo, a `NoteEvent` pozostaje bez zmian.
- Podział i scalanie słów.
- Podział i scalanie sylab.
- Oznaczanie fragmentu jako instrumentalny, freestyle albo rap.

Timing:

- Przesuwanie początku i końca frazy.
- Przesuwanie początku i końca bloku sylaby.
- Korekta czasu sylaby nie zmienia żadnej nuty diagnostycznej.
- Przyciąganie krawędzi do pobliskich krawędzi bloków, nut, fraz i opcjonalnej siatki.
- Lokalna korekta offsetu dla całej frazy.

Pitch:

- Przesuwanie bloku sylaby w górę/dół po półtonach.
- Korekta pitch zmienia `midi` sylaby i nie synchronizuje żadnej nuty diagnostycznej.
- Blok bez `midi` jest oznaczony jako brak nuty; pierwsze pionowe przesunięcie ustawia `midi` sylaby bez tworzenia `NoteEvent`.
- Scalanie krótkich nut.
- Dzielenie i scalanie nut działa tylko na warstwie diagnostycznej nut.
- Ustawienie typu nuty.
- Podgląd surowego konturu F0 jako warstwy pod nutami.

Akcje globalne:

- Undo/redo.
- Zapis aktualnego stanu roboczego.
- Reset aktualnego etapu pracy, jeśli status zadania pozwala na przeliczenie od tego etapu.
- Walidacja przed eksportem.
- Eksport po zatwierdzeniu.
- Wyeksportuj projekt.
- Skróty klawiaturowe nie są wymagane w MVP.

## Stany jakości

Edytor powinien wizualnie oznaczać:

- niską pewność transkrypcji;
- niską periodicity pitch;
- sylabę bez wartości MIDI;
- nutę bez tekstu;
- zbyt krótką nutę po przeliczeniu na beaty;
- nachodzące na siebie frazy.

## Wymagania UX

- Odtwarzanie musi być zsynchronizowane z połączonym wykresem waveform/sylaby pitch.
- Przełączniki `Oryginał`, `Wokal` i `Instrumental` są w nagłówku wykresu, a przyciski poprzedniego/następnego elementu, `Play`, pasek postępu, zoom, kłódka ograniczenia odtwarzania, magnes przyciągania i pole zakresu przyciągania znajdują się po prawej stronie tego samego nagłówka.
- Przyciski `poprzedni element` i `następny element` przesuwają playhead do najbliższej krawędzi sylaby odpowiednio przed albo po aktualnej pozycji.
- Wszystkie przyciski w nagłówku wykresu używają tego samego kompaktowego stylu aktywnego i nieaktywnego co przełącznik magnesu.
- Przyciski przybliżania i oddalania zmieniają widoczny zakres wykresu o `25%` i pozwalają zejść poniżej okna `5 s`.
- Przycisk z ikoną zapętlania znajduje się bezpośrednio po prawej stronie `Play`, ma systemowy tooltip `Zapętl odtwarzanie` i przełącza zapętlanie aktualnego odtwarzania.
- Gdy zapętlanie jest włączone, każde odtwarzanie uruchomione z `Play` albo z dwukliku na elemencie powtarza się od miejsca rozpoczęcia do miejsca zakończenia, dopóki użytkownik nie zatrzyma odtwarzania albo nie wyłączy zapętlania.
- Magnes przełącza przyciąganie elementów na wykresie, jest ostatnim przyciskiem w pasku narzędzi i pokazuje aktywny stan neonowym świeceniem; tooltip ma treść `przyciągaj elementy na wykresie`.
- Po prawej stronie magnesu znajduje się pole liczbowe zakresu przyciągania w milisekundach. Domyślna wartość to `20`, minimum to `0`, a krok kontrolek to `10`.
- Kłódka przełącza odtwarzanie tylko widocznego zakresu wykresu; tooltip ma treść `ogranicz odtwarzanie do widocznego zakresu`. Gdy opcja jest aktywna, `Play` startuje z bieżącej pozycji w widocznym zakresie albo z początku zakresu, zatrzymuje się na końcu zakresu i wraca playheadem do startu tego odtwarzania bez przewijania wykresu dalej.
- Nagłówek wykresu nie pokazuje czasów początku i końca widocznego zakresu.
- Pasek pozycji okna wykresu znajduje się bezpośrednio pod wykresem i pokazuje widoczny zakres jako uchwyt o szerokości zależnej od zoomu. Na styku wykresu i paska nie ma podwójnej ramki ani zaokrągleń.
- Kliknięcie pustego miejsca na wykresie ustawia playhead, a przeciągnięcie pustego miejsca przesuwa widoczny zakres osi czasu bez tworzenia wpisu undo.
- Lista `Sentencje` pokazuje separator z przyciskiem `+` przed, między i po blokach; dodanie nowej sentencji odbywa się przez inline pole tekstowe, żeby nie tworzyć pustych tokenów.
- Dwuklik na bloku sentencji w liście albo na markerze sentencji na wykresie zoomuje wykres tak, żeby objąć całą sentencję.
- Dwuklik na sylabie na wykresie albo w liście `Sentencje` zaznacza sylabę i zoomuje wykres do jej zakresu.
- Prawy klik na sentencji, wyrazie albo sylabie zaznacza element i odtwarza jego zakres.
- `ArrangementSyllable` jest podstawowym blokiem edycji na wykresie; `NoteEvent` pozostaje niezależnym źródłem pitch i diagnostyki, domyślnie ukrytym.
- Podczas przesuwania sylaby albo zmiany jej początku lub końca wykres pokazuje cienką pionową przerywaną prowadnicę przez całą wysokość wykresu. Prowadnica nie pojawia się przy przesuwaniu nut diagnostycznych.
- Blok sylaby pokazuje tekst w pierwszym wierszu i samą liczbę MIDI w drugim wierszu; przy braku nuty drugi wiersz pokazuje `brak`, a pełna informacja `MIDI {wartość}` jest widoczna w tooltipie.
- Uchwyty zmiany granic bloku są widoczne na hover, focus i zaznaczeniu.
- Najczęstsze korekty powinny dać się wykonać bez opuszczania głównego widoku.
- MVP utrwala tylko jeden aktualny stan edycji; undo/redo działa sesyjnie w otwartym edytorze i nie musi przetrwać odświeżenia strony.
- Interfejs powinien obsługiwać długie utwory bez renderowania całej osi czasu naraz.
- Tekst w przyciskach i panelach nie może nachodzić na inne elementy przy małej szerokości ekranu.
- MVP nie wymaga widoku porównania oryginalnego wyniku AI z poprawioną wersją.
- Przyciski, pola formularzy, checkboxy, radio, tooltipy, chipy, listy i karty powinny używać wariantów z [UI.md](UI.md), chyba że dany element wymaga specjalnego wzorca edytora audio.
- Statusy jakości AI powinny używać kolorów semantycznych z [UI.md](UI.md): success, warning, error i info.
- Animacje glow muszą mieć wariant reduced-motion zgodny z [UI.md](UI.md).

## Eksport w UI

- Użytkownik może zaznaczyć jeden lub wiele formatów docelowych: UltraStar Deluxe, UltraStar Play, Vocaluxe.
- Użytkownik może zaznaczyć jeden lub oba warianty paczki: oryginalne audio albo audio bez wokalu.
- Każda paczka karaoke jest eksportowana jako ZIP zawierający cały katalog utworu.
- Paczki karaoke nie zawierają `mukai-project.json` ani innych danych projektu.
- Domyślna nazwa katalogu pochodzi z nazwy pliku źródłowego i może zostać zmieniona przed eksportem.
- Użytkownik może wybrać cover z importu, jeśli jest dostępny, albo wgrać inny cover przed eksportem.
- Jeśli cover nie jest ustawiony, eksport przebiega bez covera.
- ZIP-y dla różnych profili eksportu mają różne nazwy, ale katalog i pliki wewnątrz używają tego samego schematu nazw.
- Osobna akcja `Wyeksportuj projekt` generuje ZIP zawierający cały `Job`, oryginalny plik, artefakty i manifesty JSON potrzebne do odtworzenia projektu.
- Przed akcją `Wyeksportuj projekt` UI powinien jasno poinformować, że po udanym eksporcie lokalny `Job` i artefakty pozostaną dostępne przez 24 godziny, a potem mogą zostać usunięte przez mechanizm czyszczenia.

## Minimalna walidacja przed eksportem

- Tytuł, artysta i plik audio są ustawione.
- Każda eksportowana linia ma co najmniej jedną nutę.
- Każda nuta ma dodatnią długość.
- Pitch mieści się w rozsądnym zakresie MIDI dla wokalu.
- Linie są posortowane rosnąco po czasie.
- Golden notes, rap notes i rap golden notes są obsługiwane jako typy nut w MVP.
