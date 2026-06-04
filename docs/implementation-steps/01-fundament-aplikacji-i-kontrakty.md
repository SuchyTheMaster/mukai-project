# Etap 01: Fundament aplikacji i kontrakty

## Cel

Zbudować minimalny fundament techniczny, na którym kolejne etapy mogą bezpiecznie rozwijać upload, pipeline, edytor i eksport. Ten etap nie uruchamia jeszcze właściwego przetwarzania audio.

## Źródła prawdy

- [Architektura](../architecture.md)
- [Kontrakty danych](../data-contracts.md)
- [Design system UI](../UI.md)
- [Operacje i testowanie](../operations-and-testing.md)

## Zakres

- Szkielet backendu Python/FastAPI.
- Szkielet frontendu React z globalnym shellem aplikacji.
- Docker Compose dla API, frontendu, Postgresa i Redisa.
- Wolumeny Docker poza repozytorium dla artefaktów i cache modeli.
- Bazowe migracje Postgresa dla `Job`, metadanych, statusów, `Arrangement`, wyborów eksportu i rekordów artefaktów.
- Wewnętrzne typy lub schematy odpowiadające kontraktom `Job`, `StageSnapshot`, `AudioAsset`, `Tempo`, `Arrangement`, `ExportSelection` i `ProjectExport`.
- Abstrakcja magazynu artefaktów zabezpieczająca ścieżki przed wyjściem poza katalog roboczy aplikacji.
- Ujednolicony format błędów API, logów diagnostycznych i sanitizacji prywatnych ścieżek.
- Bazowy frontend zgodny z `UI.md`: header `MUKAI`, lewa kolumna, centralny obszar pracy i prawa kolumna etapów jako puste lub przykładowe stany.
- Przygotowanie assetów runtime frontendu z `docs/assets/` do `frontend/public/brand/`, jeśli frontend jest już tworzony w tym etapie.

## Poza zakresem

- Upload plików audio.
- Uruchamianie FFmpeg, modeli AI i workerów.
- Edytor waveform/piano roll.
- Eksport ZIP.

## Zależności

Ten etap jest startowy. Jeśli repozytorium nie ma jeszcze implementacji, powinien utworzyć minimalną strukturę aplikacji, ale bez dodawania funkcjonalności spoza zakresu.

## Wynik etapu

- Aplikacja uruchamia się lokalnie w Dockerze.
- Backend ma endpoint zdrowia i podłączoną bazę.
- Frontend pokazuje roboczy shell zgodny z layoutem z dokumentacji.
- Postgres ma migracje dla podstawowych encji.
- Redis jest dostępny dla przyszłej kolejki, nawet jeśli nie obsługuje jeszcze zdarzeń.
- Artefakty i cache modeli mają zadeklarowane wolumeny poza repozytorium.

## Kryteria akceptacji

- Kontrakty danych są serializowalne i zgodne z przykładami z [data-contracts.md](../data-contracts.md).
- Brak plików audio, cache modeli i artefaktów w repozytorium.
- Frontend nie importuje bezpośrednio plików z `docs/assets/`.
- Brak zewnętrznych API i brak logowania w MVP.
- Build frontendu i backendu działa na przypiętych zależnościach.

## Proponowane testy

- Testy jednostkowe serializacji i walidacji podstawowych kontraktów.
- Test migracji bazy na pustym Postgresie.
- Smoke test API healthcheck.
- Smoke test frontendu, że shell renderuje header, lewy panel, obszar roboczy i prawy panel etapów.
- Weryfikacja, że wolumen artefaktów i cache modeli nie wskazuje na katalog w repozytorium.

