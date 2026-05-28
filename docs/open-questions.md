# Otwarte pytania

Większość decyzji produktowych została już określona. Poniżej zostają tylko kwestie, które warto doprecyzować przed implementacją albo w trakcie spike'a technicznego.

## Decyzje przyjęte

- Aplikacja działa w Dockerze i może być uruchomiona lokalnie albo wystawiona w sieci.
- MVP ma jednego użytkownika i nie wymaga logowania.
- Obsługiwane wejścia audio: `WAV`, `MP3`, `MP4`, `M4A`, `OGG`, `FLAC`.
- Eksport tworzy paczki ZIP z katalogiem utworu.
- Docelowe formaty eksportu: UltraStar Deluxe, UltraStar Play, Vocaluxe.
- Modele i narzędzia działają lokalnie, bez zewnętrznych API.
- Golden notes i rap notes są w MVP.
- BPM jest wykrywany z utworu.
- Używane są tagi `#AUDIO`, `#VOCALS`, `#INSTRUMENTAL`.
- Walidacja przez parser odtwarzacza nie jest wymagana w MVP.
- Aplikacja nie musi przypominać użytkownikowi o prawach do utworu.
- Jeśli użytkownik nie wgra covera, eksport odbywa się bez covera.
- `mukai-project.json` zawsze zawiera pełną edycję, ustawienia modeli, metadane i wybory eksportu.
- Import `mukai-project.json` nie powtarza BPM, transkrypcji, alignacji ani pitch detection.
- Paczka instrumentalna zawiera `#VOCALS` wskazujący osobny plik wokalu.
- ZIP-y dla różnych profili eksportu mają różne nazwy, a zawartość używa wspólnego schematu nazw.

## Do doprecyzowania

1. Którą bibliotekę do wykrywania BPM wybrać: Essentia `RhythmExtractor2013`, librosa `beat_track`, czy madmom RNN/DBN?
2. Czy w paczce instrumentalnej `#AUDIO` ma wskazywać ten sam plik co `#INSTRUMENTAL`, czy osobny miks referencyjny zgodny z oczekiwaniami konkretnego odtwarzacza?

## Propozycje domyślne

- Wybrać Essentia `RhythmExtractor2013` jako główną bibliotekę BPM, bo zwraca BPM, pozycje beatów, confidence i rozkład estymacji.
- Zachować librosa `beat_track` jako prosty fallback lub narzędzie porównawcze w testach.
- W paczce instrumentalnej ustawić `#AUDIO` na plik używany do odtwarzania, a `#INSTRUMENTAL` na ten sam plik instrumentalny, plus `#VOCALS` na osobny stem wokalu.
