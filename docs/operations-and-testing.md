# Operacje i testowanie

## Środowisko GPU

Założenia:

- Aplikacja działa w Dockerze.
- Backend API działa w Python/FastAPI, frontend w React, baza trwała w Postgresie, a kolejka i koordynacja workerów w Redis.
- Główny tryb pracy używa GPU NVIDIA i CUDA.
- Workery AI powinny raportować dostępne urządzenie, VRAM i wersje bibliotek.
- Modele powinny być pobierane i cache'owane poza repozytorium aplikacji.
- Profil CPU jest trybem awaryjnym, nie domyślnym.
- Aplikacja nie korzysta z zewnętrznych API.
- FFmpeg jest wymaganym narzędziem lokalnym do konwersji audio.
- Wybraną biblioteką do detekcji BPM jest Essentia `RhythmExtractor2013`.

Minimalne dane diagnostyczne zadania:

- model i wersja;
- parametry batch/segment;
- wybrany profil separacji i transkrypcji;
- czas startu i końca etapu;
- peak VRAM, jeśli dostępny;
- hash wejścia;
- komunikat błędu bez prywatnych danych.

## Przechowywanie plików

- Pliki audio użytkownika przechowywać w katalogu danych aplikacji, nie w repozytorium.
- Artefakty zadań powinny mieć TTL albo ręczny mechanizm czyszczenia.
- Po eksporcie projektu domyślny TTL lokalnego `Job` i artefaktów wynosi 24 godziny.
- Eksport powinien być odtwarzalny z `review.approved.json`.
- Paczki karaoke ZIP nie powinny zawierać `mukai-project.json` ani innych danych projektu.
- Osobny ZIP projektu z akcji `Wyeksportuj projekt` powinien zawierać pełny `Job`, oryginalny plik, artefakty, manifest `mukai-project.json`, ustawienia modeli, metadane, wybory eksportu, BPM, transkrypcję, czasy i pitch/nuty.
- Po pomyślnym eksporcie projektu lokalny rekord `Job`, oryginalny plik i artefakty tego zadania mogą zostać usunięte dopiero po upływie TTL.
- Import ZIP-a projektu nie powinien ponownie uruchamiać normalizacji audio, separacji, BPM, ASR, alignacji ani pitch detection.
- W logach nie zapisywać pełnych ścieżek użytkownika, jeśli mogą ujawniać dane prywatne.

## Upload i ekspozycja sieciowa

- MVP nie dodaje wbudowanego logowania ani autoryzacji nawet przy wystawieniu aplikacji w sieci.
- Maksymalny rozmiar uploadu to 500 MB.
- Backend waliduje rozszerzenie, MIME oraz wynik `ffprobe`; pliki bez obsługiwanej ścieżki audio są odrzucane.
- Nazwy plików są normalizowane i nie mogą zawierać ścieżek ani znaków sterujących.

## Testy dokumentacji na obecnym etapie

- Sprawdzić, czy każdy dokument z indeksu istnieje.
- Sprawdzić, czy nie ma sprzecznych nazw statusów i artefaktów.
- Sprawdzić, czy dokumenty nie zawierają sprzecznych zasad usuwania joba po eksporcie projektu.
- Sprawdzić, czy dokumenty opisują jeden aktualny stan edycji i sesyjne undo/redo zamiast trwałej historii wersji.
- Sprawdzić, czy linki do źródeł są aktualne.
- Sprawdzić, czy dokumenty frontendowe odwołują się do [UI.md](UI.md) jako źródła design systemu.

## Przyszłe testy jednostkowe

- Konwersja `seconds -> UltraStar beats`.
- Konwersja `MIDI -> UltraStar pitch`.
- Walidacja uploadu: limit 500 MB, MIME, rozszerzenie i `ffprobe`.
- Walidacja wykrytego muzycznego BPM i wynikowego `#BPM` UltraStar.
- Walidacja `Arrangement`.
- Walidacja `ExportSelection`.
- Walidacja kompletności ZIP-a projektu, manifestu `mukai-project.json` i hashy artefaktów.
- Walidacja, że import nie przyjmuje pojedynczego `mukai-project.json` jako samodzielnego formatu MVP.
- Serializacja i migracje kontraktów JSON.
- Tokenizacja tekstu do linii UltraStar.

## Przyszłe testy integracyjne

- Upload krótkiego pliku w każdym formacie: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Odrzucenie uploadu większego niż 500 MB oraz pliku podszywającego się pod audio mimo niezgodnego `ffprobe`.
- Konwersja FFmpeg do wejść workerów.
- Uzupełnianie pól importu z metadanych audio.
- Przejście przez pipeline na mockowanych workerach z Postgres i Redis.
- Separacja Demucs na krótkim fragmencie testowym.
- WhisperX na fragmencie wokalu z oczekiwanym językiem.
- WhisperX bez wymuszonego języka.
- torchcrepe na syntetycznej sinusoidzie i wokalu testowym.
- Eksport ZIP dla UltraStar Deluxe, UltraStar Play i Vocaluxe.
- Eksport wariantu z oryginalnym audio i wariantu instrumentalnego.
- Weryfikacja, że różne profile eksportu zmieniają nazwę ZIP, ale nie zmieniają bazowej nazwy katalogu i plików wewnątrz paczki.
- Weryfikacja, że paczki karaoke nie zawierają `mukai-project.json`.
- Eksport ZIP-a projektu przez `Wyeksportuj projekt`.
- Weryfikacja, że po udanym eksporcie projektu lokalny `Job` i artefakty mają ustawiony TTL 24h.
- Weryfikacja, że mechanizm czyszczenia usuwa lokalny `Job` i artefakty dopiero po upływie TTL.
- Ponowny import ZIP-a projektu bez uruchamiania normalizacji audio, separacji, BPM, ASR, alignacji ani pitch detection.
- Ponowny import ZIP-a projektu z brakującym artefaktem i oczekiwany błąd walidacji.
- Eksport bez covera.
- Eksport instrumentalny z tagami `#AUDIO`, `#VOCALS` i `#INSTRUMENTAL`.
- Eksport profili UltraStar Deluxe, UltraStar Play i Vocaluxe z właściwymi tagami kompatybilności.

## Przyszłe testy manualne

- Utwór polski z długimi samogłoskami.
- Utwór angielski z szybkim tekstem.
- Utwór z intro bez wokalu.
- Utwór z backing vocals.
- Utwór z mocnym pogłosem.
- Utwór wielojęzyczny bez wymuszonego języka.
- Edycja frazy, zapis, odświeżenie strony i eksport.
- Eksport z niestandardowym coverem.
- Eksport bez covera.
- Eksport projektu i weryfikacja ostrzeżenia, że lokalny `Job` oraz artefakty będą dostępne przez 24 godziny po sukcesie.
- Import projektu z ZIP-a i weryfikacja, że edytor otwiera odtworzony stan bez ponownego przetwarzania.
- Undo/redo działa w bieżącej sesji edytora, ale po odświeżeniu zostaje tylko aktualny zapisany stan.
- Weryfikacja zgodności UI z [UI.md](UI.md): kolory, typografia, stany hover/focus/disabled, kontrast oraz reduced motion.

## Kryteria akceptacji MVP

- Użytkownik może wgrać utwór i otrzymać draft do edycji.
- Draft pokazuje tekst, czasy i nuty w jednym zsynchronizowanym widoku.
- Użytkownik może poprawić tekst, sylaby, typ nuty i pitch.
- Użytkownik może wybrać profile `htdemucs`/`htdemucs_ft` oraz `large-v3`/`large-v3-turbo`.
- Eksportowana paczka karaoke ZIP zawiera katalog z `.txt` i MP3 bez JSON-a projektu; cover jest dodawany tylko wtedy, gdy został ustawiony.
- Jeśli cover nie został ustawiony, eksportowana paczka ZIP nie zawiera covera.
- Osobna akcja `Wyeksportuj projekt` tworzy ZIP projektu pozwalający kontynuować ręczną edycję bez ponownego ASR/pitch/BPM.
- Po pomyślnym eksporcie projektu lokalny `Job` i artefakty dostają TTL 24h.
- Wynik można ręcznie wczytać w wybranym kompatybilnym programie karaoke.
