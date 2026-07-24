# Specyfikacja edytora UI

## Cel

Edytor ma umożliwić szybkie doprowadzenie wyniku AI do jakości grywalnego pliku UltraStar. Interfejs powinien skupiać się na pracy nad utworem, nie na stronie marketingowej.

Warstwa wizualna całego interfejsu musi być zgodna z design systemem RetroWave opisanym w [UI.md](UI.md). Ten plik jest źródłem prawdy dla kolorów, typografii, spacingu, radiusów, glow, komponentów, stanów hover/focus/disabled oraz zasad kontrastu i reduced motion.

## Shell aplikacji

- Lewa pływająca kolumna ma na górze branding z logo, napisem `MUKAI` i mniejszym napisem `Music to Karaoke AI Creator`, a niżej sekcję uploadu audio z kompaktowym podsumowaniem wybranego pliku i coverem.
- Po utworzeniu zadania ta sekcja zmienia tytuł na `WGRANE AUDIO`, ukrywa obszar uploadu oraz przyciski covera i zostawia dane pliku z nieklikalnym podglądem okładki.
- Branding zajmuje tylko szerokość lewej kolumny; środkowa i prawa kolumna zaczynają się od góry strony z zachowaniem paddingu.
- Prawa pływająca kolumna pokazuje aktualny etap oraz wszystkie spodziewane etapy pipeline'u od uploadu do eksportu. Etapy są rozróżnione kolorami na wykonane, przetwarzane, oczekujące i błędne.
- Po ukończeniu przetwarzania prawa kolumna pokazuje osobną sekcję `Edycja dopasowania` z pełnoszerokim przyciskiem `Przejdź do edycji` w wariancie `primary`; centralne podsumowanie etapów nie zawiera tej akcji.
- Globalny przycisk `Zapisz` w lewej kolumnie używa niebieskiego wariantu `secondary`, zgodnego z przyciskiem `Wróć do audio`.
- W widoku `Dopasowanie` prawa kolumna jest domyślnie ukryta, ale użytkownik może ją pokazać i ponownie ukryć.
- Centralny obszar roboczy pokazuje aktywny widok: upload, status przetwarzania, edytor albo eksport.
- Na małych ekranach prawa kolumna etapów musi zmienić się w zwijany panel albo poziomy pasek, żeby nie zasłaniać formularzy ani edytora.

## Widoki

### Upload audio/projektu

- Pole `UPLOAD AUDIO/PROJEKTU` przyjmuje plik audio albo ZIP projektu; helper ma treść `Wybierz WAV, MP3, MP4, M4A, OGG, FLAC lub wgraj ZIP z projektem`.
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
- Po wybraniu `Silero` formularz pokazuje wyłącznie aktywne pola `threshold`, `neg_threshold`, `min_speech_duration_ms`, `min_silence_duration_ms`, `speech_pad_ms` i wspólne `chunk_size`; preset startowy to odpowiednio `0.30`, `0.15`, `80 ms`, `100 ms`, `100 ms` i `30 s`.
- Domyślnie wybrany `pyannote` ukrywa pola Silero i pokazuje wyłącznie `vad_onset`, `vad_offset` oraz wspólne `chunk_size`; preset startowy to `0.45`, `0.25` i `30 s`.
- Przełączenie VAD zachowuje edytowane wartości obu presetów, ale pola nieaktywnego modelu pozostają niewidoczne i nie są stosowane przez backend.
- Każde pole VAD ma przystępną polską etykietę, ikonę informacji z opisem wpływu parametru oraz techniczną nazwę parametru jako helper pod etykietą.
- Pole `Ms między sentencjami` edytuje próg przerwy `sentenceGapMs` bezpośrednio w milisekundach; frontend wysyła wpisaną wartość bez przeliczania jednostek, a puste pole oznacza `null` i tryb auto.
- Zaawansowane ustawienia pitch: próg ciszy, próg periodicity, krok ramek, minimalna długość nuty i scalanie krótkich przerw.
- Opcjonalny upload covera, który może zostać użyty w eksporcie.
- Podgląd covera jest widoczny od razu po wykryciu grafiki z tagów albo po ręcznym wgraniu pliku.
- Jeśli preflight nie wykrył covera i użytkownik nie wgra ręcznego covera, eksportowana paczka nie zawiera covera.
- Informacja, że audio zostanie przekonwertowane lokalnie przez FFmpeg do formatów roboczych.
- Główna akcja startu w środkowej kolumnie jest podpisana `Przetwarzaj audio`.
- Na lewo od głównej akcji znajdują się kolejno wyszukiwalny combobox `Konfiguracja` oraz select `Tryb`. Konfiguracje są grupowane jako `Wbudowane` i `Użytkownika`, customowe można usuwać po potwierdzeniu, a `Tryb` ma opcje `Ręczny` i `Automatyczny` z domyślnym `Automatyczny`.
- Po ukończeniu pipeline'u środkowa kolumna pozwala zapisać bieżące ustawienia jako customowy preset lub nadpisać istniejący. Niekompletne presety pokazują ostrzeżenie przed startem, a ich wartości uzupełnione z `Domyślna` są w formularzach ręcznych czerwone do czasu edycji danego pola.

### Import Projektu

- Użytkownik może wczytać ZIP projektu utworzony przez globalną akcję `EKSPORT PROJEKTU`.
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
- Podział zaznaczonej sentencji, wyrazu i sylaby odbywa się dokładnie w miejscu playheada. Playhead musi przecinać dzielony element i znajdować się dalej niż `20 ms` od obu jego brzegów.
- Jeśli playhead nie przecina dzielonego elementu, UI nie zmienia danych i pokazuje popup `Wskaż na wykresie miejsce podziału tego elementu, a następnie ponownie użyj przycisku "podziel"`. Jeśli odległość od dowolnego brzegu wynosi najwyżej `20 ms`, popup ma treść `Wskazane miejsce jest za blisko brzegu dzielonego elementu`.
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
- Globalny zapis pełnego projektu wraz z aktualnym stanem roboczym.
- Reset aktualnego etapu pracy, jeśli status zadania pozwala na przeliczenie od tego etapu.
- Walidacja przed eksportem.
- Eksport po zatwierdzeniu.
- Eksport paczki karaoke przez przycisk `ZAPISZ DLA GRY` w prawym górnym rogu edytora.
- Skróty klawiaturowe nie są wymagane w MVP.

## Stany jakości

Edytor powinien wizualnie oznaczać:

- niską pewność transkrypcji;
- niską pewność tonu;
- sylabę bez wartości MIDI;
- nutę bez tekstu;
- zbyt krótką nutę po przeliczeniu na beaty;
- nachodzące na siebie sentencje.

Pasek jakości wylicza te stany ponownie po każdej zmianie arrangementu i stosuje dla zbyt krótkich nut ten sam próg przeliczenia BPM na beaty co walidator eksportu. Pokazuje również liczbę sylab z flagą `needs_syllable_review` jako badge `Sylaby do sprawdzenia`. Wszystkie badge'e zachowują ten sam rozmiar również w stanie aktywnym. Kliknięcie badge'a z ostrzeżeniem wyróżnia białą ramką `3px` badge oraz powiązane sylaby na timeline i powiązane sylaby oraz wyrazy na liście sentencji; ponowne kliknięcie wyłącza wyróżnienie. Żółta ramka wyrazu na liście sentencji oraz warningi wyrazu w panelu właściwości są wyłącznie agregacją aktualnych warningów jego sylab: pojawiają się, gdy przynajmniej jedna sylaba ma warning, i znikają automatycznie, gdy nie ma go żadna sylaba. Sam brak przecinającej nuty nadaje wyłącznie `missing_note`, bez `needs_syllable_review`. Badge `Sylaby do sprawdzenia` w panelu właściwości ma tooltip `Kliknij aby potwierdzić, jeśli sylaba jest ok`; kliknięcie usuwa flagę z sylaby, a na poziomie wyrazu potwierdza wszystkie oznaczone sylaby tego wyrazu. Ręczna zmiana tekstu sylaby usuwa jej flagę `uncertain_text`. W panelu właściwości flaga niskiej pewności tekstu ma tooltip `kliknij by oznaczyć jako prawidłowy` i jest klikalna: akceptacja wyrazu usuwa flagę ze wszystkich jego sylab, a akceptacja pojedynczej sylaby usuwa stan wyrazu dopiero po zaakceptowaniu wszystkich jego sylab. Panel właściwości pokazuje również wyliczaną na bieżąco flagę zbyt krótkiej nuty dla sylaby oraz wyrazu. Flaga niskiej pewności tonu ma tooltip `kliknij aby uznać za pewny ton`; znika po kliknięciu albo po ręcznym ustawieniu MIDI. Akceptacja tej flagi na wyrazie obejmuje wszystkie jego sylaby.

## Wymagania UX

- Odtwarzanie musi być zsynchronizowane z połączonym wykresem waveform/sylaby pitch.
- Przełączniki `Oryginał`, `Wokal` i `Instrumental` są w nagłówku wykresu, a przyciski poprzedniego/następnego elementu, `Play`, pasek postępu, zoom, kłódka ograniczenia odtwarzania, magnes przyciągania i pole zakresu przyciągania znajdują się po prawej stronie tego samego nagłówka.
- Po prawej stronie wyboru ścieżki znajdują się niezależne regulatory audio podkładu i MIDI sylab. Ich poziomy `audioVolumePercent` i `midiVolumePercent` mają zakres `0`–`100`, krok `1` i są stosowane podczas odtwarzania bez restartowania transportu; zmiana poziomu automatycznie ustawia odpowiednią flagę aktywności, a lewy klik przycisku głośności przełącza mute bez zerowania poziomu. Audio steruje głośnością WaveSurfera liniowo od `0` do `1`. MIDI używa oscylatora trójkątnego w zakresach `startSec`–`endSec` sylab, gainu maksymalnego `0.12`, attacku `0.008 s` i release'u `0.025 s`; sylaby bez MIDI są pomijane. Pauza, seek, pętla, zmiana ścieżki i mute czyszczą aktywne głosy. Brak obsługi lub błąd Web Audio pokazuje komunikat edytora i wycisza wyłącznie MIDI.
- Przyciski `poprzedni element` i `następny element` przesuwają playhead do najbliższej krawędzi sylaby odpowiednio przed albo po aktualnej pozycji.
- Kliknięcie prawym przyciskiem myszy na `poprzedni element` albo `następny element` przesuwa playhead do najbliższej wcześniejszej albo późniejszej krawędzi całej sentencji. Gdy takiej krawędzi nie ma, playhead trafia odpowiednio na początek albo koniec całego audio.
- Wszystkie przyciski w nagłówku wykresu używają tego samego kompaktowego stylu aktywnego i nieaktywnego co przełącznik magnesu.
- Przyciski przybliżania i oddalania zmieniają widoczny zakres wykresu o `25%` i pozwalają zejść poniżej okna `5 s`.
- Nad wykresem `Shift + scroll up` przybliża widok, zmniejszając okno czasowe o `25%`, a `Shift + scroll down` oddala widok, zwiększając okno czasowe o `25%`, maksymalnie do czasu trwania całego utworu. Czas wskazywany przez poziomą pozycję kursora pozostaje pod kursorem po zmianie zoomu, z uwzględnieniem ograniczeń początku i końca utworu. Scroll bez `Shift` nie zmienia zoomu wykresu.
- Przycisk z ikoną zapętlania znajduje się bezpośrednio po prawej stronie `Play`, ma systemowy tooltip `Zapętl odtwarzanie` i przełącza zapętlanie aktualnego odtwarzania.
- Gdy zapętlanie jest włączone, każde odtwarzanie uruchomione z `Play` albo z dwukliku na elemencie powtarza się od miejsca rozpoczęcia do miejsca zakończenia, dopóki użytkownik nie zatrzyma odtwarzania albo nie wyłączy zapętlania.
- Magnes przełącza przyciąganie elementów na wykresie, jest ostatnim przyciskiem w pasku narzędzi i pokazuje aktywny stan neonowym świeceniem; tooltip ma treść `przyciągaj elementy na wykresie`.
- Po prawej stronie magnesu znajduje się pole liczbowe zakresu przyciągania w milisekundach. Domyślna wartość to `20`, minimum to `0`, a krok kontrolek to `10`.
- Kłódka przełącza odtwarzanie tylko widocznego zakresu wykresu; tooltip ma treść `ogranicz odtwarzanie do widocznego zakresu`. Gdy opcja jest aktywna, `Play` startuje z bieżącej pozycji w widocznym zakresie albo z początku zakresu, zatrzymuje się na końcu zakresu i wraca playheadem do startu tego odtwarzania bez przewijania wykresu dalej.
- Nagłówek wykresu nie pokazuje czasów początku i końca widocznego zakresu.
- Pasek pozycji okna wykresu znajduje się bezpośrednio pod wykresem i pokazuje widoczny zakres jako uchwyt o szerokości zależnej od zoomu. Na styku wykresu i paska nie ma podwójnej ramki ani zaokrągleń.
- Kliknięcie pustego miejsca na wykresie ustawia playhead, a przeciągnięcie pustego miejsca przesuwa widoczny zakres osi czasu bez tworzenia wpisu undo.
- Lewy dwuklik powiększający element oraz prawe kliknięcia ikon `Zoom In` i `Zoom Out` zapisują do `50` poprzednich viewportów. Prawy dwuklik na polu wykresu, rozpoznawany jako dwa kliknięcia w ciągu `300 ms` i w promieniu `8px`, przywraca ostatni z nich bez uruchamiania pojedynczej akcji prawego kliknięcia; pusty stos nie wykonuje akcji. Ciągły zoom, `Shift+scroll`, pan, scrollbar i auto-follow nie trafiają do historii.
- Prawy klik `Zoom Out` pokazuje cały utwór od początku bez limitu `120 s`. Prawy klik `Zoom In` wybiera sylabę pod playheadem, następnie sentencję, a poza nimi nie zmienia viewportu.
- Pojedynczy lewy klik markera sentencji na wykresie zaznacza sentencję i ustawia playhead w czasie odpowiadającym poziomej pozycji kliknięcia w jej zakresie. Klik sylaby nadal przenosi playhead na początek sylaby.
- Nad polem wykresu kursorowi towarzyszy cienka pionowa, biała, półprzezroczysta i przerywana prowadnica przez całą wysokość wykresu. Prowadnica znika po opuszczeniu pola oraz podczas przeciągania początku albo końca sylaby, tak aby widoczna była wyłącznie prowadnica przeciąganej krawędzi; po zakończeniu przeciągania prowadnica kursora wraca. Nie przechwytuje zdarzeń myszy.
- Podczas odtwarzania z włączonym przypinaniem zmiana aktywnej sentencji minimalnie przewija jej wiersz do widocznego obszaru listy z uwzględnieniem wysokości sticky wykresu. Pauza, brak aktywnej sentencji albo wyłączenie przypinania nie uruchamia przewijania.
- Lista `Sentencje` pokazuje separator z przyciskiem `+` przed, między i po blokach; dodanie nowej sentencji odbywa się przez inline pole tekstowe, żeby nie tworzyć pustych tokenów.
- Sentencje i sylaby na liście nie są przeciągalne. Spośród wyrazów przeciągalny jest wyłącznie pierwszy wyraz mający poprzednią sentencję oraz ostatni wyraz mający następną sentencję; gest rozpoczyna się na etykiecie wyrazu, nie na polu sylaby.
- Pierwszy wyraz można upuścić wyłącznie na całym bloku poprzedniej sentencji i trafia on na jej koniec, a ostatni wyraz wyłącznie na całym bloku następnej sentencji i trafia on na jej początek. Prawidłowy cel jest podświetlany i pokazuje półprzezroczystą kartę wyrazu w miejscu docelowym. Przeniesienie jedynego wyrazu usuwa opróżnioną sentencję.
- Przeniesienie wyrazu zachowuje czasy oraz pozostałe dane jego sylab i przelicza granice sentencji źródłowej oraz docelowej z minimalnego początku i maksymalnego końca zawartych sylab. Po każdej zmianie początku sylaby, również na wykresie i w panelu właściwości, lista stabilnie porządkuje sylaby według `startSec`.
- Jeśli chronologiczna kolejność rozdzieli sylaby jednego wyrazu innym wyrazem, lista pokazuje osobne fragmenty tego wyrazu. Po przywróceniu ciągłej kolejności fragmenty ponownie tworzą jeden element bez pozostawiania zduplikowanych sylab.
- Pole sylaby na liście automatycznie dopasowuje szerokość do całego aktualnego tekstu podczas wpisywania i nie ogranicza go stałą szerokością. Blok wyrazu ma szerokość wynikającą z pełnych szerokości wszystkich sylab, odstępów i przycisku dodawania; sylaby nie zawijają się wewnątrz wyrazu, natomiast lista nadal może zawijać całe bloki wyrazów.
- Dwuklik na bloku sentencji w liście albo na markerze sentencji na wykresie zoomuje wykres tak, żeby objąć całą sentencję.
- Dwuklik na sylabie na wykresie albo w liście `Sentencje` zaznacza sylabę i zoomuje wykres do jej zakresu.
- Prawy klik na sentencji, wyrazie albo sylabie zaznacza element i odtwarza jego zakres.
- `ArrangementSyllable` jest podstawowym blokiem edycji na wykresie; `NoteEvent` pozostaje niezależnym źródłem pitch i diagnostyki, domyślnie ukrytym.
- Podczas przesuwania sylaby albo zmiany jej początku lub końca wykres pokazuje cienką pionową przerywaną prowadnicę przez całą wysokość wykresu. Przy zmianie granicy prowadnica pozostaje przypięta do właściwego `startSec` albo `endSec`, niezależnie od położenia uchwytu względem bloku. Prowadnica nie pojawia się przy przesuwaniu nut diagnostycznych.
- Blok sylaby nie ma minimalnej szerokości ani zaokrągleń i skaluje się dokładnie proporcjonalnie do czasu po zoomie. Wypełnienie oraz obrys mają wspólną geometrię niewpływającą na wymiar bloku, także w stanach `review`, `quality-highlight` i `extension`. Wewnętrzne wiersze tekstu oraz MIDI używają `overflow: hidden`, `text-overflow: ellipsis` i pozostają ograniczone do szerokości sylaby; pełna informacja nadal jest dostępna w tooltipie.
- Sylaby są renderowane warstwowo w kolejności: przeciągana, hover, zaznaczona, pozostałe. Po zakończeniu interakcji tymczasowy priorytet znika, a przy równym poziomie późniejsza sylaba w `arrangement.tokens` przykrywa wcześniejszą. Przeciąganie z wciśniętym `Shift` wybiera na podstawie dominującego pierwszego ruchu i zachowuje do końca operacji tylko jedną oś: poziomą zmianę czasu albo pionową zmianę tonu.
- Podczas odtwarzania sylaba pod playheadem na wykresie ma `opacity: 1`; na liście `Sentencje` ten sam stan otrzymują sentencja pod playheadem oraz wyraz aktualnie śpiewanej sylaby. Sylaba na liście jest wypełniana od lewej warstwą `opacity: 1` dokładnie do procentowej pozycji playheada w jej zakresie. Sylaby ukończone od początku bieżącego cyklu pozostają wypełnione, natomiast sylaby sprzed miejsca uruchomienia i przyszłe zachowują bazową przezroczystość. Pauza, koniec odtwarzania i restart pętli przywracają bazowe wartości przed rozpoczęciem nowego cyklu animacji.
- Blok sylaby pokazuje tekst w pierwszym wierszu i samą liczbę MIDI w drugim wierszu; przy braku nuty drugi wiersz pokazuje `brak`, a pełna informacja `MIDI {wartość}` jest widoczna w tooltipie.
- Uchwyty zmiany granic mają aktywny obszar szerokości `9px`, lecz domyślnie są niewidoczne. Dla bloku o szerokości co najmniej `20px` są w całości wewnątrz, od `10px` do poniżej `20px` ich środek leży na krawędzi, a poniżej `10px` są w całości na zewnątrz. Hover własnego obszaru pokazuje biały półprzezroczysty uchwyt `#ffffff66` i kursor `ew-resize`; fokus klawiatury całego bloku pokazuje oba uchwyty w neutralnym półprzezroczystym wariancie. Całe `9px` pozostaje aktywne niezależnie od położenia.
- Najczęstsze korekty powinny dać się wykonać bez opuszczania głównego widoku.
- Aktywny storage utrwala jeden aktualny `Arrangement`; ZIP projektu przechowuje dodatkowo undo/redo, zaznaczenie, viewport, playhead, ścieżkę audio, poziomy i flagi aktywności audio/MIDI oraz ustawienia narzędzi edytora.
- Interfejs powinien obsługiwać długie utwory bez renderowania całej osi czasu naraz.
- Tekst w przyciskach i panelach nie może nachodzić na inne elementy przy małej szerokości ekranu.
- MVP nie wymaga widoku porównania oryginalnego wyniku AI z poprawioną wersją.
- Przyciski, pola formularzy, checkboxy, radio, tooltipy, chipy, listy i karty powinny używać wariantów z [UI.md](UI.md), chyba że dany element wymaga specjalnego wzorca edytora audio.
- Statusy jakości AI powinny używać kolorów semantycznych z [UI.md](UI.md): success, warning, error i info.
- Animacje glow muszą mieć wariant reduced-motion zgodny z [UI.md](UI.md).

## Eksport w UI

- Użytkownik eksportuje jedną paczkę ZIP zgodną z aktualnymi wersjami UltraStar Deluxe, UltraStar Play i Vocaluxe.
- Paczka karaoke zawiera cały katalog utworu, plik `.txt`, oryginalne audio, instrumental i wokal/a capella.
- Paczki karaoke nie zawierają `mukai-project.json` ani innych danych projektu.
- Domyślna nazwa katalogu pochodzi z nazwy pliku źródłowego i może zostać zmieniona przed eksportem.
- Nazwy plików audio są generowane z bazowej nazwy utworu jako `[FULL]`, `[INSTR]` i `[VOC]`; tagi w pliku `.txt` muszą wskazywać te same nazwy.
- Użytkownik może wybrać cover z importu, jeśli jest dostępny, albo wgrać inny cover przed eksportem.
- Jeśli cover nie jest ustawiony, eksport przebiega bez covera.
- Globalna akcja `EKSPORT PROJEKTU` generuje ZIP zawierający draft albo cały `Job`, oryginalny plik, artefakty, zastosowane ustawienia, robocze formularze i stan edytora.
- Zapis projektu nie ustawia TTL i nie uruchamia automatycznego usuwania lokalnego `Job`.

## Minimalna walidacja przed eksportem

- Tytuł, artysta i plik audio są ustawione.
- Każda eksportowana linia ma co najmniej jedną nutę.
- Każda nuta ma dodatnią długość.
- Pitch mieści się w rozsądnym zakresie MIDI dla wokalu.
- Linie są posortowane rosnąco po czasie.
- Linie nie nachodzą na siebie.
- Golden notes, rap notes i rap golden notes są obsługiwane jako typy nut w MVP.
