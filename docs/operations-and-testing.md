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

## Orkiestracja workerów

- Docelowo ciężkie operacje działają jako osobne serwisy Docker: `worker-separate-stems`, `worker-transcribe` i `worker-pitch`.
- Lżejszy worker koordynujący może wykonywać normalizację FFmpeg, przygotowanie wejść workerów, BPM i publikację kolejnych zdarzeń.
- Wszystkie workery używają wspólnego wolumenu artefaktów `mukai_artifacts` oraz wspólnego wolumenu cache modeli `mukai_model_cache`.
- Redis pozostaje kolejką i miejscem krótkotrwałych blokad, żeby kilka ciężkich workerów nie próbowało jednocześnie używać jednego GPU bez skonfigurowanej współbieżności.
- Każdy worker raportuje rolę, urządzenie, wersje bibliotek, parametry modelu, czasy start/koniec, postęp i skrócony log diagnostyczny zgodnie ze `StageSnapshot`.
- Jeśli host ma jedno GPU, domyślna konfiguracja powinna dopuszczać tylko jedną ciężką operację GPU naraz; większa współbieżność wymaga osobnej decyzji i testów VRAM.

## Build obrazu workera

- Obraz `worker` budować przez `docker compose build worker`; zależności AI nie są instalowane na hoście.
- Obraz workera nie może przypadkowo pobierać pełnego stosu CUDA przez zwykłe `torch==...` z domyślnego PyPI bez jawnej decyzji technicznej. Taki zapis potrafi dociągnąć wielogigabajtowy graf zależności, np. `torch`, `nvidia-cudnn-cu12`, `nvidia-cublas-cu12`, `nvidia-cufft-cu12`, `nvidia-nccl-cu12` i `triton`, przez co build trwa kilkanaście minut i jest podatny na timeouty, przerwane pobrania oraz brak miejsca.
- Wariant PyTorch/CUDA dla workera musi być zadeklarowany w jednym z dwóch kontrolowanych sposobów:
  - obraz bazowy PyTorch/CUDA, np. `pytorch/pytorch:<wersja>-cuda<wersja>-cudnn<wersja>-runtime`, a `requirements-worker.txt` nie instaluje ponownie `torch` i `torchaudio`;
  - jawny indeks wheelów PyTorch w Dockerfile, np. `--index-url https://download.pytorch.org/whl/cu124` albo wariant CPU dla profilu awaryjnego, z przypiętymi wersjami `torch` i `torchaudio`.
- Wybór wariantu GPU/CPU, wersji PyTorch, wersji CUDA i źródła wheelów musi być zapisany w dokumentacji przy zmianie Dockerfile albo `requirements-worker.txt`.
- Ciężkie zależności AI powinny być rozdzielone według ról workerów, kiedy projekt przejdzie z przejściowego workera `worker` na docelowe `worker-separate-stems`, `worker-transcribe` i `worker-pitch`. Workery nie powinny instalować bibliotek, których dana rola nie używa.
- `requirements-worker.txt` może zawierać zależności AI takie jak Demucs, torchcrepe, WhisperX albo Essentia, ale nie powinien ukrywać wyboru wariantu PyTorch/CUDA. PyTorch jest elementem środowiska wykonawczego workera GPU, nie zwykłą drobną zależnością aplikacyjną.
- Pierwszy build workera nadal może być długi, ale akceptowalny build musi mieć kontrolowany i przewidywalny graf zależności. Jeśli build pobiera kilka GB wheelów CUDA z PyPI, traktować to jako problem specyfikacji obrazu, nie jako normalny stan docelowy.
- Jeśli build kończy się na kroku `pip install --no-cache-dir -r requirements-worker.txt` z kodem `2`, uruchomić diagnostycznie `docker compose build worker --progress=plain`, żeby zobaczyć pełny błąd `pip`. Sam skrót Compose `exit code: 2` nie wskazuje, czy problemem jest sieć, resolver zależności, brak miejsca czy przerwanie pobierania.
- Przy błędach `No space left on device`, przerwanych pobraniach dużych wheelów CUDA albo timeoutach najpierw sprawdzić storage Dockera i łączność z PyPI. Nie przenosić instalacji zależności workera na hosta.

## Troubleshooting GPU NVIDIA w Dockerze na WSL/Debianie

Źródła odniesienia:

- NVIDIA Container Toolkit install guide: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
- CUDA on WSL User Guide: https://docs.nvidia.com/cuda/wsl-user-guide/index.html

Procedura dla Docker Engine uruchamianego w dystrybucji Debian na WSL:

1. W Windows zainstalować aktualny sterownik NVIDIA z obsługą WSL 2. W WSL nie instalować linuksowego sterownika NVIDIA; Windows udostępnia sterownik do WSL.
2. Zaktualizować WSL z PowerShell: `wsl.exe --update`, a potem uruchomić dystrybucję Debian.
3. W Debianie sprawdzić, czy WSL widzi GPU: `/usr/lib/wsl/lib/nvidia-smi`. Jeśli polecenie działa, problem dotyczy najczęściej runtime'u kontenerów.
4. Zainstalować wymagania repozytorium NVIDIA:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg2
```

5. Dodać repozytorium NVIDIA Container Toolkit:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
```

6. Zainstalować toolkit:

```bash
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

7. Skonfigurować runtime Docker i zrestartować demona:

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Jeśli dystrybucja WSL nie używa `systemd`, zamiast restartu przez `systemctl` użyć właściwego sposobu startu Docker Engine dla tej dystrybucji, np. restart usługi albo ponowne uruchomienie WSL.

8. Uruchomić smoke test z aktualnym obrazem CUDA:

```bash
docker run --rm --gpus all nvidia/cuda:<aktualny-tag-base> nvidia-smi
```

9. Jeśli smoke test działa, ale workery Mukai nadal nie widzą GPU, sprawdzić `docker compose` pod kątem `NVIDIA_VISIBLE_DEVICES=all`, `NVIDIA_DRIVER_CAPABILITIES=compute,utility`, rezerwacji urządzeń GPU oraz logów `worker-separate-stems`, `worker-transcribe` i `worker-pitch`.

## Powtarzalne buildy frontendu

- Paczki Node w `package.json` muszą mieć przypięte konkretne wersje; nie używać `latest`.
- `package-lock.json` jest częścią repozytorium i musi być aktualizowany razem ze zmianami zależności.
- Dockerfile frontendu instaluje zależności przez `npm ci`, żeby build używał lockfile.
- Build frontendu wykonywać na poziomie Dockera przez `docker compose build frontend`. Nie traktować hostowego `npm ci` ani hostowego `npm run build` jako testu akceptacyjnego projektu.
- Host może służyć co najwyżej do wygenerowania albo aktualizacji `package-lock.json`, jeśli zmieniają się zależności; katalog `frontend/node_modules` nie jest artefaktem projektu i nie powinien być wymagany do pracy aplikacji.
- Po zmianie zależności albo konfiguracji frontendu testem akceptacyjnym jest `docker compose build frontend`.
- Nie podbijać wersji zależności przez automatyczne `npm audit fix --force` bez osobnej decyzji, bo może to zmienić graf zależności i zachowanie builda.

## Przechowywanie plików

- Pliki audio użytkownika, artefakty, eksporty oraz cache modeli przechowywać na wolumenie Docker poza repozytorium aplikacji.
- Artefakty zadań muszą mieć TTL albo ręczny mechanizm czyszczenia.
- Zapis projektu nie ustawia TTL; automatyczna retencja pozostaje wyłączona.
- Eksport powinien być odtwarzalny z zatwierdzonego `Arrangement` w Postgresie oraz jego serializacji w `mukai-project.json`.
- Paczki karaoke ZIP nie mogą zawierać `mukai-project.json` ani innych danych projektu.
- ZIP projektu z akcji `Zapisz` musi zawierać draft albo pełny `Job`, oryginalny plik, artefakty, zastosowane ustawienia, robocze formularze i stan edytora.
- Po pomyślnym eksporcie projektu lokalny rekord `Job`, oryginalny plik i artefakty tego zadania mogą zostać usunięte dopiero po upływie TTL.
- Import ZIP-a projektu nie może ponownie uruchamiać normalizacji audio, separacji, BPM, ASR, alignacji ani pitch detection.
- W logach nie zapisywać pełnych ścieżek użytkownika, jeśli mogą ujawniać dane prywatne.

## Upload i ekspozycja sieciowa

- MVP nie dodaje wbudowanego logowania ani autoryzacji nawet przy wystawieniu aplikacji w sieci.
- Maksymalny rozmiar uploadu to 500 MB.
- Backend waliduje rozszerzenie, MIME oraz wynik `ffprobe`; pliki bez obsługiwanej ścieżki audio są odrzucane.
- Backendowy preflight uploadu odczytuje tagi i osadzony cover przed utworzeniem `Job`; tagi muszą być poprawnie dekodowane dla UTF-8, UTF-16 i przypadków mieszanych.
- Nazwy plików są normalizowane i nie mogą zawierać ścieżek ani znaków sterujących.

## Testy dokumentacji na obecnym etapie

- Sprawdzić, czy każdy dokument z indeksu istnieje.
- Sprawdzić, czy nie ma sprzecznych nazw statusów i artefaktów.
- Sprawdzić, czy dokumenty nie zawierają sprzecznych zasad usuwania joba po eksporcie projektu.
- Sprawdzić, czy dokumenty opisują jeden aktualny stan edycji i sesyjne undo/redo zamiast trwałej historii wersji.
- Sprawdzić, czy `review.approved.json` nie występuje jako źródło prawdy aktywnego `Arrangement`.
- Sprawdzić, czy wzory eksportu używają `acceptedSongBpm` i `gapMs`, a nie wykrytego BPM.
- Sprawdzić, czy linki do źródeł są aktualne.
- Sprawdzić, czy dokumenty frontendowe odwołują się do [UI.md](UI.md) jako źródła design systemu.
- Sprawdzić, czy dokumenty uploadu spójnie opisują `POST /api/uploads/inspect`, `UploadInspection`, `EmbeddedCover` i pierwszeństwo ręcznego covera.
- Sprawdzić, czy dokumenty UI spójnie rozróżniają `docs/assets/` jako źródło pierwotne dla agenta i `frontend/public/brand/` jako katalog wynikowy dla aplikacji.
- Sprawdzić, czy `docs/assets/favicon.png` jest opisane jako źródło favicon, a runtime/build używa wygenerowanych rozmiarów `256`, `128`, `64`, `32` i `16`.
- Sprawdzić, czy dokumenty wskazują domyślne modele `htdemucs_ft` i `large-v3`.
- Sprawdzić, czy dokumenty nie mieszają przejściowego workera etapu 2 z docelowymi rolami `worker-separate-stems`, `worker-transcribe` i `worker-pitch`.
- Sprawdzić, czy specyfikacja builda workera eliminuje niekontrolowane pobieranie pełnego stosu PyTorch/CUDA przez `torch==...` z domyślnego PyPI i wskazuje jawny wariant obrazu bazowego albo indeks wheelów PyTorch.

Checklist audytu `docs` względem kodu:

- Porównać endpointy opisane w [Architektura](architecture.md) z dekoratorami `@router.*` w `backend/app/api/routes.py`.
- Rozdzielić endpointy obecnie zaimplementowane od endpointów wymaganych w MVP, ale planowanych.
- Porównać typy `AudioAsset.type` opisywane w [Kontrakty danych](data-contracts.md) i [Pipeline przetwarzania](processing-pipeline.md) z workerami w `backend/app/workers/`.
- Sprawdzić, czy statusy `JobStatus` z kodu mają zgodną semantykę w dokumentach, szczególnie statusy eksportu/importu istniejące w kontraktach przed implementacją endpointów.
- Porównać domyślne wartości UI z `frontend/src/main.jsx`, w tym modele, sylabizację, pozycjonowanie, snap i limity edytora.
- Sprawdzić jednostki czasu w UI i API: backendowe pola z sufiksem `Ms` przechowują milisekundy, nawet jeśli UI pokazuje wygodniejszą jednostkę i przelicza ją przed wysłaniem.

## Przyszłe testy jednostkowe

Testy eksportu karaoke oraz round-trip zapisu/importu projektu są wymagane dla MVP.

- Konwersja `seconds -> UltraStar beats`.
- Konwersja `MIDI -> UltraStar pitch`.
- Walidacja uploadu: limit 500 MB, MIME, rozszerzenie i `ffprobe`.
- Walidacja preflightu uploadu: odczyt tagów UTF-8, UTF-16 i mieszanych oraz brak uszkodzonych znaków narodowych.
- Walidacja `EmbeddedCover`: wykrycie MIME, rozmiaru i promocja covera z tagów do assetu `Job`, jeśli użytkownik nie wskaże ręcznego covera.
- Walidacja `acceptedSongBpm`/`gapMs -> UltraStar beats`.
- Walidacja wykrytego muzycznego BPM, zaakceptowanego BPM i wynikowego `#BPM` UltraStar.
- Walidacja `Arrangement`.
- Walidacja `ExportSelection`.
- Walidacja tagów UltraStar `#AUDIO`, `#INSTRUMENTAL` i `#VOCALS`.
- Walidacja braku legacy tagu `#MP3` w eksporcie MVP.
- Walidacja spójności nazw plików audio z sufiksami `[FULL]`, `[INSTR]` i `[VOC]`.
- Walidacja kompletności ZIP-a projektu, manifestu `mukai-project.json` i hashy artefaktów.
- Walidacja, że import nie przyjmuje pojedynczego `mukai-project.json` jako samodzielnego formatu MVP.
- Serializacja i migracje kontraktów JSON.
- Generowanie linii UltraStar z sentencji, wyrazów i sylab.

## Przyszłe testy integracyjne

- Upload krótkiego pliku w każdym formacie: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Odrzucenie uploadu większego niż 500 MB oraz pliku podszywającego się pod audio mimo niezgodnego `ffprobe`.
- Preflight plików z tagami ID3 UTF-8, ID3 UTF-16, FLAC/Vorbis comments i MP4/M4A tags.
- Preflight pliku z osadzonym coverem i weryfikacja, że ręczny cover zastępuje cover z tagów.
- Konwersja FFmpeg do wejść workerów.
- Uzupełnianie pól importu z metadanych audio.
- Weryfikacja, że `docker compose build frontend` przechodzi na przypiętych wersjach zależności i `package-lock.json`.
- Weryfikacja, że agent przygotowuje logo, tło i favicony z materiałów źródłowych w `docs/assets/`, a frontend ładuje wynikowe pliki z `frontend/public/brand/`.
- Weryfikacja, że z `docs/assets/favicon.png` powstają favicony `256x256`, `128x128`, `64x64`, `32x32` i `16x16`, a frontend deklaruje je w standardowych linkach favicon.
- Weryfikacja, że brak wynikowych assetów aplikacyjnych nie psuje builda, jeśli branding nie jest jeszcze wdrażany.
- Przejście przez pipeline na mockowanych workerach z Postgres i Redis.
- Przejście przez pipeline na mockowanych rolach `worker-separate-stems`, `worker-transcribe` i `worker-pitch` z weryfikacją `StageSnapshot`, postępu, błędu i artefaktów do pobrania.
- Weryfikacja `docker compose build worker --progress=plain`, że PyTorch/CUDA pochodzi z jawnie wybranego obrazu bazowego albo jawnego indeksu wheelów, a nie z przypadkowego grafu zależności domyślnego PyPI.
- Separacja Demucs na krótkim fragmencie testowym.
- WhisperX na fragmencie wokalu z oczekiwanym językiem.
- WhisperX bez wymuszonego języka.
- torchcrepe na syntetycznej sinusoidzie i wokalu testowym.
- Eksport jednego ZIP-a karaoke dla aktualnych wersji UltraStar Deluxe, UltraStar Play i Vocaluxe.
- Weryfikacja, że ZIP zawiera plik `.txt` oraz pliki audio `[FULL]`, `[INSTR]` i `[VOC]`.
- Weryfikacja, że tagi `#AUDIO`, `#INSTRUMENTAL` i `#VOCALS` wskazują istniejące pliki w paczce.
- Weryfikacja, że eksport nie generuje tagu `#MP3`.
- Weryfikacja, że po udanym eksporcie karaoke `Job` wraca do `awaiting_review`.
- Weryfikacja, że paczka karaoke nie zawiera `mukai-project.json`.
- Zapis ZIP-a projektu przez globalne `Zapisz`.
- Weryfikacja, że po udanym eksporcie projektu `Job` wraca do `awaiting_review`.
- Weryfikacja, że zapis projektu nie ustawia pól retencji.
- Weryfikacja, że mechanizm czyszczenia usuwa lokalny `Job` i artefakty dopiero po upływie TTL.
- Ponowny import ZIP-a projektu bez uruchamiania normalizacji audio, separacji, BPM, ASR, alignacji ani pitch detection.
- Ponowny import ZIP-a projektu z brakującym artefaktem i oczekiwany błąd walidacji.
- Eksport bez covera.
- Eksport z tagami `#AUDIO`, `#VOCALS` i `#INSTRUMENTAL`.
- Ręczne otwarcie paczki w aktualnych wersjach UltraStar Deluxe, UltraStar Play i Vocaluxe albo zapis jawnego założenia, jeśli test manualny nie został wykonany.

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
- Weryfikacja nagłówka `MUKAI - Music to Karaoke AI Creator` z logo przygotowanym ze źródła w `docs/assets/` i udostępnionym aplikacji w `frontend/public/brand/`.
- Weryfikacja, że `frontend/public/brand/mukai-background.png` pochodzi z `docs/assets/background.png` i jest subtelnie użyte jako tło u góry, wyśrodkowane poziomo (`top center`), bez kotwiczenia do lewej ani prawej strony.
- Weryfikacja shellu aplikacji: górny header, lewa kolumna uploadu i aktualnego etapu, centralny obszar pracy oraz prawa kolumna etapów.
- Weryfikacja, że preflight uzupełnia metadane, pokazuje dane techniczne audio i pozwala przywrócić domyślny cover z tagów albo wyczyścić cover.
- Weryfikacja kolorów etapów, pasków postępu, ETA lub stanu indeterminate, logu błędu i pobierania artefaktów przy podetapach.
- Smoke test GPU w kontenerze CUDA przez `docker run --rm --gpus all ... nvidia-smi` przed uruchomieniem ciężkich workerów.
- Zapis draftu, aktywnego processingu i edytora oraz ponowny import każdej fazy.
- Import projektu z ZIP-a i weryfikacja, że edytor otwiera odtworzony stan bez ponownego przetwarzania.
- Undo/redo działa w bieżącej sesji edytora, ale po odświeżeniu zostaje tylko aktualny zapisany stan.
- Weryfikacja zgodności UI z [UI.md](UI.md): kolory, typografia, stany hover/focus/disabled, kontrast oraz reduced motion.

## Kryteria akceptacji MVP

- Użytkownik może wgrać utwór i otrzymać draft do edycji.
- Draft pokazuje tekst, czasy i nuty w jednym zsynchronizowanym widoku.
- Użytkownik może poprawić tekst, sylaby, typ nuty i pitch.
- Użytkownik może wybrać profile `htdemucs`/`htdemucs_ft` oraz `large-v3`/`large-v3-turbo`, a domyślnie ustawione są dokładniejsze `htdemucs_ft` i `large-v3`.
- Eksportowana paczka karaoke ZIP zawiera katalog z `.txt` i MP3 bez JSON-a projektu; cover jest dodawany tylko wtedy, gdy został ustawiony.
- Jeśli cover nie został ustawiony, eksportowana paczka ZIP nie zawiera covera.
- Globalna akcja `Zapisz` tworzy ZIP projektu pozwalający kontynuować draft, processing albo ręczną edycję.
- Lokalny `Job` i artefakty nie dostają TTL po zapisie.
- Wynik można ręcznie wczytać w wybranym kompatybilnym programie karaoke.
