# Zasady pracy w projekcie

## Zakres

- Pracuj tylko w aktualnym katalogu projektu.
- Nie czytaj i nie modyfikuj plików spoza katalogu projektu.
- Nie używaj ścieżek `/mnt/c`, `/mnt/d` ani innych montowań Windows.
- Nie twórz implementacji aplikacji, dopóki użytkownik wprost o to nie poprosi.
- Traktuj katalog `docs/` jako źródło prawdy dla wymagań, architektury i decyzji technicznych.

## Komunikacja

- Komunikuj się po polsku, chyba że użytkownik poprosi inaczej.
- Przed zmianą kodu albo plików pokaż krótki plan.
- Po zmianach pokaż listę zmodyfikowanych plików i proponowane testy.
- Jeśli podejmujesz decyzję projektową, zapisz założenie w dokumentacji albo wskaż je w odpowiedzi.

## Bezpieczeństwo operacji

- Nie uruchamiaj `docker`, `docker compose` (za wyjątkiem `docker compose logs`, `docker compose build` i `docker compose ls`), `sudo`, `rm`, `rm -rf`, `chmod -R`, `chown -R` bez wcześniejszego wyjaśnienia celu.
- Nie instaluj nowych zależności bez uzasadnienia i bez wskazania, który dokument lub moduł tego wymaga.
- Nie cofaj zmian użytkownika bez wyraźnej prośby.
- Nie zapisuj w repozytorium sekretów, tokenów, kluczy API, prywatnych danych ani plików audio użytkownika.

## Preferencje techniczne

- Najpierw czytaj istniejącą strukturę repozytorium i dopasowuj się do niej.
- Preferuj małe, jasno opisane zmiany zamiast szerokich refaktorów.
- Dla zmian frontendowych traktuj `docs/UI.md` jako źródło prawdy dla wyglądu, kolorów, typografii, komponentów i stanów interaktywnych.
- Dla logiki AI/audio dokumentuj wersje modeli, wejścia, wyjścia, jednostki czasu oraz sposób obsługi błędów.
- Dla modułów GPU opisuj wariant CPU tylko jako tryb awaryjny, jeśli jakość lub czas działania pozostają akceptowalne.
- Dla eksportu UltraStar zapisuj decyzje zgodne z formatem `.txt` i utrzymuj zgodność wsteczną, jeśli jest potrzebna.

## Testowanie

- Dla zmian w dokumentacji sprawdzaj kompletność linków, spójność nazw plików i brak sprzecznych założeń.
- Dla przyszłej implementacji wymagaj testów jednostkowych kontraktów danych, testów integracyjnych pipeline'u oraz testów eksportera UltraStar na przykładowych danych.
