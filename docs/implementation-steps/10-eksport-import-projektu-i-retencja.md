# Etap 10: Eksport, import projektu i retencja

## Cel

Dodać osobny format ZIP projektu Mukai, który pozwala wznowić ręczną edycję bez ponownego uruchamiania przetwarzania audio i modeli AI.

## Źródła prawdy

- [Eksport UltraStar](../ultrastar-export.md#eksport-projektu)
- [Eksport UltraStar](../ultrastar-export.md#import-projektu)
- [Kontrakty danych](../data-contracts.md#mukaiproject)
- [Architektura](../architecture.md#magazyn-artefaktów)

## Zakres

- Osobna akcja `Wyeksportuj projekt` przez `POST /api/jobs/{jobId}/exports/project`.
- Status przejściowy `exporting_project`.
- Generowanie ZIP-a projektu z `mukai-project.json`, `job.json`, oryginalnym plikiem, artefaktami i raportami walidacji.
- Serializacja aktualnego `Arrangement` z Postgresa do `mukai-project.json`.
- Manifest artefaktów z typami, ścieżkami w archiwum, hashami, rozmiarami i czasami utworzenia.
- Zapis ustawień modeli, metadanych, `Tempo`, transkrypcji, pitch frames, note events, wyborów eksportu i polityki retencji.
- Po udanym eksporcie ustawienie `projectExportedAt`, `cleanupEligibleAt = projectExportedAt + 24h` i `cleanupReason = "project_export_ttl"`.
- Powrót `Job` do `awaiting_review` po udanym eksporcie projektu.
- Endpoint `POST /api/projects/import` przyjmujący ZIP projektu.
- Walidacja struktury archiwum, manifestu i hashy.
- Odtworzenie `Job`, oryginalnego pliku i artefaktów w magazynie aplikacji.
- Oznaczenie pominiętych etapów jako `skipped` lub odtworzonych zgodnie z kontraktem statusów.
- UI importu projektu oraz ostrzeżenie o retencji 24h po eksporcie projektu.
- Mechanizm czyszczenia lokalnych `Job` i artefaktów dopiero po upływie TTL.

## Poza zakresem

- Import pojedynczego `mukai-project.json` bez ZIP-a.
- Ponowne uruchamianie normalizacji, BPM, separacji, ASR, alignacji albo pitch detection podczas importu.
- Umieszczanie danych projektu w paczkach karaoke.

## Zależności

- Etap 03 musi dostarczać artefakty, statusy i bezpieczny magazyn plików.
- Etap 07 lub 08 musi dostarczać `Arrangement`.
- Etap 09 może dostarczać raporty walidacji i wybory eksportu, ale ZIP projektu powinien działać także przed zwykłym eksportem karaoke, jeśli `Job` ma wymagane artefakty dla bieżącego statusu.

## Wynik etapu

- Użytkownik może wyeksportować pełny projekt.
- Użytkownik może zaimportować ZIP projektu i kontynuować pracę w edytorze.
- Lokalny `Job` i artefakty mają jasną politykę retencji po eksporcie projektu.

## Kryteria akceptacji

- ZIP projektu zawiera komplet artefaktów wymaganych dla statusu zapisanego w manifeście.
- Import kończy się błędem, jeśli brakuje wymaganego pliku albo hash się nie zgadza.
- Import nie przelicza żadnego etapu pipeline'u.
- Paczki karaoke nadal nie zawierają `mukai-project.json`.
- Lokalny `Job` nie jest usuwany natychmiast po eksporcie projektu, tylko dopiero po upływie 24h i przez mechanizm czyszczenia.

## Proponowane testy

- Test kompletności ZIP-a projektu i `mukai-project.json`.
- Test walidacji hashy artefaktów.
- Test importu poprawnego ZIP-a bez uruchamiania pipeline'u.
- Test importu ZIP-a z brakującym artefaktem i oczekiwanym błędem.
- Test ustawienia pól retencji po eksporcie projektu.
- Test mechanizmu czyszczenia po upływie TTL.
- Test UI importu projektu i ostrzeżenia o retencji.

