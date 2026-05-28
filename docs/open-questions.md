# Otwarte pytania

Na tym etapie nie ma pytań blokujących start implementacji. Poniżej są decyzje przyjęte w specyfikacji.

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
- Do detekcji BPM używać Essentia `RhythmExtractor2013`.
- W paczce instrumentalnej `#AUDIO` i `#INSTRUMENTAL` wskazują ten sam plik instrumentalny, a `#VOCALS` wskazuje osobny stem wokalu.
