# Operacje i testowanie

## Środowisko GPU

Założenia:

- Główny tryb pracy używa GPU NVIDIA i CUDA.
- Workery AI powinny raportować dostępne urządzenie, VRAM i wersje bibliotek.
- Modele powinny być pobierane i cache'owane poza repozytorium aplikacji.
- Profil CPU jest trybem awaryjnym, nie domyślnym.

Minimalne dane diagnostyczne zadania:

- model i wersja;
- parametry batch/segment;
- czas startu i końca etapu;
- peak VRAM, jeśli dostępny;
- hash wejścia;
- komunikat błędu bez prywatnych danych.

## Przechowywanie plików

- Pliki audio użytkownika przechowywać w katalogu danych aplikacji, nie w repozytorium.
- Artefakty zadań powinny mieć TTL albo ręczny mechanizm czyszczenia.
- Eksport powinien być odtwarzalny z `review.approved.json`.
- W logach nie zapisywać pełnych ścieżek użytkownika, jeśli mogą ujawniać dane prywatne.

## Testy dokumentacji na obecnym etapie

- Sprawdzić, czy każdy dokument z indeksu istnieje.
- Sprawdzić, czy nie ma sprzecznych nazw statusów i artefaktów.
- Sprawdzić, czy linki do źródeł są aktualne.

## Przyszłe testy jednostkowe

- Konwersja `seconds -> UltraStar beats`.
- Konwersja `MIDI -> UltraStar pitch`.
- Walidacja `Arrangement`.
- Serializacja i migracje kontraktów JSON.
- Tokenizacja tekstu do linii UltraStar.

## Przyszłe testy integracyjne

- Upload krótkiego WAV i przejście przez pipeline na mockowanych workerach.
- Separacja Demucs na krótkim fragmencie testowym.
- WhisperX na fragmencie wokalu z oczekiwanym językiem.
- torchcrepe na syntetycznej sinusoidzie i wokalu testowym.
- Eksport `.txt` i ponowny parsing pliku.

## Przyszłe testy manualne

- Utwór polski z długimi samogłoskami.
- Utwór angielski z szybkim tekstem.
- Utwór z intro bez wokalu.
- Utwór z backing vocals.
- Utwór z mocnym pogłosem.
- Edycja frazy, zapis, odświeżenie strony i eksport.

## Kryteria akceptacji MVP

- Użytkownik może wgrać utwór i otrzymać draft do edycji.
- Draft pokazuje tekst, czasy i nuty w jednym zsynchronizowanym widoku.
- Użytkownik może poprawić błędny tekst i pitch.
- Eksportowany plik `.txt` zawiera poprawne nagłówki, nuty, końce fraz i `E`.
- Wynik można ręcznie wczytać w kompatybilnym programie UltraStar.
