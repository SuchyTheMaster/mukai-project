<p align="center">
  <img src="docs/assets/logo.png" alt="MUKAI - Music to Karaoke AI Creator" width="180">
</p>

<h1 align="center">Mukai</h1>

<p align="center">
  Lokalne narzędzie wykorzystujące AI do przygotowywania utworów karaoke.
</p>

Mukai zamienia plik audio w edytowalny projekt karaoke. Aplikacja oddziela wokal od podkładu, rozpoznaje tekst i jego timing, dzieli słowa na sylaby, wykrywa śpiewane dźwięki, a następnie łączy te dane w szkic, który można poprawić przed eksportem.

Gotowy utwór jest zapisywany jako jedna paczka ZIP przeznaczona dla aktualnych wersji UltraStar Deluxe, UltraStar Play i Vocaluxe. Osobno można zapisać pełny projekt Mukai, aby później wrócić do pracy bez rozpoczynania jej od początku.

## Co potrafi Mukai

- przyjmuje pliki `WAV`, `MP3`, `MP4`, `M4A`, `OGG` i `FLAC` o rozmiarze do 500 MB;
- odczytuje metadane i okładkę osadzoną w pliku, ale pozwala je poprawić lub uzupełnić;
- wykrywa tempo utworu oraz przygotowuje osobne ścieżki wokalu i instrumentalu;
- transkrybuje tekst, dopasowuje go w czasie i przeprowadza sylabizację, czyli dzieli słowa na sylaby;
- rozpoznaje wysokość śpiewanych nut i przypisuje ją do sylab;
- umożliwia ręczną korektę tekstu, słów, sylab, timingów, wysokości i typów nut;
- pozwala odsłuchiwać oryginał, wokal i instrumental podczas edycji;
- eksportuje paczkę karaoke z plikiem UltraStar `.txt`, audio i opcjonalną okładką;
- zapisuje oraz importuje kompletne projekty jako ZIP.

## Jak wygląda praca z aplikacją

1. Wgraj utwór audio albo wcześniej zapisany projekt ZIP.
2. Sprawdź metadane, okładkę oraz ustawienia przetwarzania.
3. Wybierz tryb automatyczny lub ręczny. Tryb ręczny zatrzymuje pipeline przed konfigurowalnymi etapami, a automatyczny korzysta z wybranego presetu.
4. Poczekaj, aż Mukai przygotuje audio, rozpozna tekst i dźwięki oraz utworzy wstępne dopasowanie.
5. Otwórz edytor i popraw elementy oznaczone jako wymagające uwagi.
6. Użyj `Eksportuj`, aby pobrać gotową paczkę karaoke, albo `Zapisz`, aby zachować pełny projekt do dalszej pracy.

Wynik modeli AI jest punktem wyjścia, nie ostateczną wersją utworu. Edytor jest integralną częścią procesu i pozwala skorygować niedokładności separacji, transkrypcji oraz detekcji tonu.

## Uruchomienie

Mukai działa jako zestaw kontenerów Docker. Do komfortowego przetwarzania zalecana jest karta NVIDIA z poprawnie skonfigurowanym NVIDIA Container Toolkit. Tryb CPU pełni rolę awaryjną i przy większych modelach może być zbyt wolny.

Uruchom aplikację z katalogu projektu:

```bash
docker compose up --build
```

Po uruchomieniu interfejs jest dostępny pod adresem [http://localhost:8080](http://localhost:8080), a stan API można sprawdzić pod [http://localhost:8000/api/health](http://localhost:8000/api/health).

Pierwszy build oraz pierwsze użycie modeli mogą potrwać dłużej i wymagać znacznej ilości miejsca na obrazy, modele oraz artefakty audio. Dane projektu są przechowywane w lokalnych wolumenach Dockera, poza repozytorium.

## Prywatność i sposób działania

Przetwarzanie odbywa się lokalnie w kontenerach. Mukai nie korzysta z zewnętrznych usług do separacji audio, transkrypcji ani wykrywania tonu. Aplikacja nie ma kont użytkowników, logowania ani mechanizmu uprawnień, dlatego nie powinna być wystawiana bezpośrednio do niezaufanej sieci.

Akcja `Od nowa` usuwa dane bieżącego projektu i resetuje interfejs. Automatyczna retencja projektów jest wyłączona, więc zapisane dane pozostają lokalnie do czasu ich świadomego usunięcia.

## Dokumentacja techniczna

Szczegółowe wymagania, architektura, kontrakty danych, pipeline, zasady eksportu i wskazówki operacyjne znajdują się w [katalogu `docs/`](docs/README.md).
