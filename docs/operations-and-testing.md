# Operacje i testowanie

## Środowisko GPU

Założenia:

- Aplikacja działa w Dockerze.
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
- Jeśli użytkownik zaznaczy opcję czyszczenia, pliki audio i artefakty robocze mogą zostać usunięte po pomyślnym eksporcie.
- Eksport powinien być odtwarzalny z `review.approved.json`.
- Paczka ZIP powinna zawierać `mukai-project.json`, żeby można było kontynuować pracę nad utworem po imporcie.
- `mukai-project.json` przechowuje pełną edycję, ustawienia modeli, metadane, wybory eksportu, BPM, transkrypcję, czasy i pitch/nuty.
- Import `mukai-project.json` nie powinien ponownie uruchamiać BPM, ASR, alignacji ani pitch detection.
- W logach nie zapisywać pełnych ścieżek użytkownika, jeśli mogą ujawniać dane prywatne.

## Testy dokumentacji na obecnym etapie

- Sprawdzić, czy każdy dokument z indeksu istnieje.
- Sprawdzić, czy nie ma sprzecznych nazw statusów i artefaktów.
- Sprawdzić, czy linki do źródeł są aktualne.
- Sprawdzić, czy dokumenty frontendowe odwołują się do [UI.md](UI.md) jako źródła design systemu.

## Przyszłe testy jednostkowe

- Konwersja `seconds -> UltraStar beats`.
- Konwersja `MIDI -> UltraStar pitch`.
- Walidacja wykrytego muzycznego BPM i wynikowego `#BPM` UltraStar.
- Walidacja `Arrangement`.
- Walidacja `ExportSelection`.
- Walidacja kompletności `mukai-project.json`.
- Walidacja ostrzeżenia przy ponownym imporcie audio o innej długości.
- Serializacja i migracje kontraktów JSON.
- Tokenizacja tekstu do linii UltraStar.

## Przyszłe testy integracyjne

- Upload krótkiego pliku w każdym formacie: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Konwersja FFmpeg do wejść workerów.
- Uzupełnianie pól importu z metadanych audio.
- Przejście przez pipeline na mockowanych workerach.
- Separacja Demucs na krótkim fragmencie testowym.
- WhisperX na fragmencie wokalu z oczekiwanym językiem.
- WhisperX bez wymuszonego języka.
- torchcrepe na syntetycznej sinusoidzie i wokalu testowym.
- Eksport ZIP dla UltraStar Deluxe, UltraStar Play i Vocaluxe.
- Eksport wariantu z oryginalnym audio i wariantu instrumentalnego.
- Weryfikacja, że różne profile eksportu zmieniają nazwę ZIP, ale nie zmieniają bazowej nazwy katalogu i plików wewnątrz paczki.
- Ponowny import `mukai-project.json`.
- Ponowny import projektu po usunięciu stems i uruchomienie tylko separacji.
- Ponowny import projektu po usunięciu oryginalnego audio i ponowne wgranie audio.
- Eksport bez covera.
- Eksport instrumentalny z tagami `#AUDIO`, `#VOCALS` i `#INSTRUMENTAL`.

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
- Eksport z opcją usunięcia artefaktów po sukcesie.
- Import projektu z ponownie wgranym audio o innej długości i weryfikacja ostrzeżenia.
- Weryfikacja zgodności UI z [UI.md](UI.md): kolory, typografia, stany hover/focus/disabled, kontrast oraz reduced motion.

## Kryteria akceptacji MVP

- Użytkownik może wgrać utwór i otrzymać draft do edycji.
- Draft pokazuje tekst, czasy i nuty w jednym zsynchronizowanym widoku.
- Użytkownik może poprawić tekst, sylaby, typ nuty i pitch.
- Użytkownik może wybrać profile `htdemucs`/`htdemucs_ft` oraz `large-v3`/`large-v3-turbo`.
- Eksportowana paczka ZIP zawiera katalog z `.txt`, MP3 i JSON-em projektu; cover jest dodawany tylko wtedy, gdy został ustawiony.
- Jeśli cover nie został ustawiony, eksportowana paczka ZIP nie zawiera covera.
- `mukai-project.json` pozwala kontynuować ręczną edycję bez ponownego ASR/pitch/BPM.
- Wynik można ręcznie wczytać w wybranym kompatybilnym programie karaoke.
