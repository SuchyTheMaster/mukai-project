# Otwarte pytania

Te decyzje warto doprecyzować przed implementacją.

## Produkt

- Czy aplikacja ma działać wyłącznie lokalnie, czy jako serwer dostępny w sieci domowej?
- Czy ma obsługiwać wielu użytkowników, czy tylko jedną osobę na jednym stanowisku?
- Czy eksport ma tworzyć sam `.txt`, czy paczkę z audio, coverem i katalogiem zgodnym z UltraStar?
- Czy docelowym odtwarzaczem jest UltraStar Deluxe, UltraStar Play, Vocaluxe, Performous, czy kilka naraz?

## Audio i modele

- Jakie formaty uploadu są obowiązkowe w MVP?
- Jaki maksymalny czas trwania utworu ma być akceptowany?
- Czy jakość separacji jest ważniejsza niż czas przetwarzania?
- Czy język piosenki będzie zawsze podawany przez użytkownika?
- Czy aplikacja ma wspierać utwory wielojęzyczne?

## Edycja

- Czy edytor ma obsługiwać skróty klawiaturowe od pierwszej wersji?
- Czy użytkownik ma edytować na poziomie słów, sylab, czy tylko nut?
- Czy potrzebny jest tryb porównania oryginału AI z wersją poprawioną?
- Czy wymagane są golden notes i rap notes w MVP?

## Eksport

- Czy `#BPM` ma być stałe jako siatka techniczna, czy wykrywane z utworu?
- Czy używać nowych tagów `#AUDIO`, `#VOCALS`, `#INSTRUMENTAL`, czy generować także starszy `#MP3`?
- Czy eksportować wersję z wokalem, instrumentalem, czy oba warianty?
- Czy aplikacja ma walidować wynik przez parser kompatybilny z konkretnym odtwarzaczem?

## Prawo i prywatność

- Czy aplikacja ma przypominać użytkownikowi, że powinien mieć prawa do przetwarzanego utworu?
- Jak długo przechowywać pliki audio i artefakty?
- Czy wymagany jest tryb całkowicie offline bez żadnych zewnętrznych API?
