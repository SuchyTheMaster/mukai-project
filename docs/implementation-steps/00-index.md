# Etapy potencjalnego wdrożenia

Ten katalog dzieli potencjalne wdrożenie MVP Mukai na uporządkowane etapy. Numeryczne prefiksy nazw plików są częścią kolejności wdrażania.

Źródłem prawdy pozostają dokumenty nadrzędne w `docs/`: [README](../README.md), [Architektura](../architecture.md), [Pipeline przetwarzania](../processing-pipeline.md), [Kontrakty danych](../data-contracts.md), [Stos modeli AI](../model-stack.md), [Design system UI](../UI.md), [Edytor UI](../editor-ui.md), [Eksport UltraStar](../ultrastar-export.md) oraz [Operacje i testowanie](../operations-and-testing.md).

## Kolejność

| Etap | Plik | Główny wynik |
| --- | --- | --- |
| 01 | [01-fundament-aplikacji-i-kontrakty.md](01-fundament-aplikacji-i-kontrakty.md) | Szkielet aplikacji, Docker Compose, podstawowe kontrakty i magazyn artefaktów |
| 02 | [02-upload-preflight-i-utworzenie-joba.md](02-upload-preflight-i-utworzenie-joba.md) | Upload, preflight tagów i covera, utworzenie `Job` |
| 03 | [03-orkiestracja-statusy-i-artefakty.md](03-orkiestracja-statusy-i-artefakty.md) | Kolejka, statusy etapów, pobieranie artefaktów i kontrola błędów |
| 04 | [04-normalizacja-audio-i-bpm.md](04-normalizacja-audio-i-bpm.md) | FFmpeg, artefakty robocze audio i wykrycie BPM |
| 05 | [05-separacja-wokalu.md](05-separacja-wokalu.md) | Worker Demucs i stems wokalu/instrumentalu |
| 06 | [06-transkrypcja-i-alignacja.md](06-transkrypcja-i-alignacja.md) | Worker WhisperX, segmenty, słowa i czasy |
| 07 | [07-pitch-i-szkic-arrangement.md](07-pitch-i-szkic-arrangement.md) | Worker pitch, nuty i pierwszy edytowalny `Arrangement` |
| 08 | [08-edytor-recenzji.md](08-edytor-recenzji.md) | Ręczna edycja tekstu, timingów, sylab, nut i pitch |
| 09 | [09-eksport-karaoke.md](09-eksport-karaoke.md) | Paczki ZIP dla UltraStar Deluxe, UltraStar Play i Vocaluxe |
| 10 | [10-eksport-import-projektu-i-retencja.md](10-eksport-import-projektu-i-retencja.md) | ZIP projektu, import projektu i retencja 24h |
| 11 | [11-utwardzenie-operacyjne-i-akceptacja-mvp.md](11-utwardzenie-operacyjne-i-akceptacja-mvp.md) | Hardening, benchmark modeli, testy końcowe i akceptacja MVP |

## Zasady podziału

- Etapy są ułożone tak, żeby najpierw ustabilizować kontrakty danych i przepływ statusów, a dopiero potem podłączać kosztowne workery AI.
- Każdy etap powinien kończyć się działającym, testowalnym przyrostem, nawet jeśli część kolejnych modułów jest jeszcze mockowana.
- Workery AI są rozdzielone etapami, bo mają inne zależności, profile zasobów, ryzyka GPU i testy akceptacyjne.
- Eksport karaoke i eksport/import projektu są osobnymi etapami, ponieważ paczki karaoke nie zawierają danych projektu, a ZIP projektu ma inną semantykę retencji i importu.
- Etap 11 nie zastępuje testów w poprzednich etapach. Zbiera testy przekrojowe, wydajnościowe, operacyjne i manualne potrzebne przed uznaniem MVP za gotowe.

