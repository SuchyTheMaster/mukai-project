# Etap 11: Utwardzenie operacyjne i akceptacja MVP

## Cel

Domknąć MVP przez testy przekrojowe, diagnostykę, powtarzalne buildy, benchmark modeli, sprawdzenie zgodności dokumentacji i manualną akceptację przepływów użytkownika.

## Źródła prawdy

- [Operacje i testowanie](../operations-and-testing.md)
- [Stos modeli AI](../model-stack.md#benchmark-akceptacyjny-modeli)
- [README](../README.md#zakres-mvp)
- [Eksport UltraStar](../ultrastar-export.md#kompatybilność)

## Zakres

- Powtarzalne buildy Docker dla frontendu, backendu i workerów.
- Weryfikacja, że zależności Node są przypięte i frontend buduje się przez `npm ci`.
- Weryfikacja, że wariant PyTorch/CUDA jest jawny i opisany w dokumentacji.
- Smoke test GPU w Dockerze przed testami ciężkich workerów.
- Diagnostyka workerów: role, device, VRAM, wersje bibliotek, parametry, hash wejścia, czasy start/koniec i bezpieczny log.
- Ograniczenie współbieżności ciężkich operacji GPU przy jednym GPU hosta.
- Benchmark akceptacyjny modeli na co najmniej 20 krótkich fragmentach.
- Testy integracyjne całego pipeline'u na krótkich plikach audio.
- Testy eksportu karaoke i projektu.
- Testy importu projektu bez ponownego przetwarzania.
- Test braku automatycznej retencji po zapisie projektu.
- Testy responsywności i reduced motion UI.
- Przegląd dokumentacji pod kątem sprzecznych statusów, nazw artefaktów, źródła prawdy `Arrangement` i linków.

## Poza zakresem

- Konta użytkowników i autoryzacja.
- Automatyczne pobieranie tekstów.
- Trening własnych modeli.
- Zewnętrzne API dla AI/audio.
- Duety jako wymaganie bazowe.

## Zależności

- Etapy 01-10 powinny być wdrożone lub świadomie zastąpione mockami tylko dla testów infrastrukturalnych.

## Wynik etapu

- MVP ma potwierdzony przepływ od uploadu do edycji i eksportu.
- Znane ograniczenia modeli i wydajności są opisane.
- Build i uruchomienie są powtarzalne.
- Dokumentacja pozostaje spójna z implementacją.

## Kryteria akceptacji

- Użytkownik może wgrać utwór i otrzymać draft do edycji.
- Draft pokazuje tekst, czasy i nuty w zsynchronizowanym widoku.
- Użytkownik może poprawić tekst, sylaby, typ nuty i pitch.
- Eksportowana paczka karaoke ZIP zawiera katalog z `.txt`, oryginalnym audio, instrumentalem i wokalem/a capella w MP3 bez danych projektu.
- Globalna akcja `Zapisz` tworzy ZIP pozwalający kontynuować draft, processing albo edycję.
- Zapis projektu nie ustawia TTL.
- Wynik da się ręcznie wczytać w aktualnych wersjach UltraStar Deluxe, UltraStar Play i Vocaluxe albo odnotowano jawne założenie o braku testu manualnego.

## Proponowane testy

- `docker compose build frontend`.
- `docker compose build api`.
- `docker compose build worker-separate-stems --progress=plain`.
- `docker compose build worker-transcribe --progress=plain`.
- `docker compose build worker-pitch --progress=plain`.
- Smoke test GPU przez kontener CUDA, jeśli host ma GPU NVIDIA.
- E2E: upload, preflight, przetwarzanie, edycja, eksport karaoke.
- Test eksportu: jeden ZIP z plikami `[FULL]`, `[INSTR]`, `[VOC]`, spójnymi tagami i bez `#MP3`.
- E2E: eksport projektu, import projektu, kontynuacja edycji.
- Testy manualne dla utworu polskiego, angielskiego, wielojęzycznego, z długim intro, backing vocals i pogłosem.
- Test dokumentacji: linki, spójność statusów i brak `review.approved.json` jako źródła prawdy.
