# Etap 08: Edytor recenzji

## Cel

Zbudować właściwe narzędzie pracy użytkownika nad wynikiem AI: edycję tekstu, fraz, sylab, timingów, nut, typów nut i pitch przed eksportem.

## Źródła prawdy

- [Edytor UI](../editor-ui.md)
- [Design system UI](../UI.md)
- [Kontrakty danych](../data-contracts.md#arrangement)
- [Pipeline przetwarzania](../processing-pipeline.md#8-edycja-ręczna)

## Zakres

- Widok edytora dla `Job` w statusie `awaiting_review`.
- Odtwarzacz audio z przełącznikiem oryginał, wokal i instrumental.
- Waveform z markerami fraz.
- Piano roll lub siatka nut zsynchronizowana z osią czasu.
- Lista fraz z edycją tekstu, słów i sylab.
- Panel właściwości zaznaczonej frazy, słowa, sylaby albo nuty.
- Edycja start/end fraz, słów i nut.
- Podział i scalanie fraz, słów, sylab oraz nut.
- Przesuwanie pitch o półton, ustawianie typu nuty i scalanie krótkich nut.
- Statusy jakości AI: niska pewność transkrypcji, niska periodicity, brak nuty dla tekstu, zbyt krótka nuta i nachodzące frazy.
- Sesyjne undo/redo po stronie edytora.
- Zapis aktualnego `Arrangement` przez `PUT /api/jobs/{jobId}/arrangement`.
- Kontrola współbieżności zapisu przez `revision`.
- Akcja resetu aktualnego etapu, jeśli backend pozwala przeliczyć pracę od tego miejsca.
- Responsywne zachowanie prawej kolumny etapów na małych ekranach.

## Poza zakresem

- Trwała historia wersji edycji.
- Widok porównania oryginalnego wyniku AI z poprawioną wersją.
- Skróty klawiaturowe jako wymaganie MVP.
- Eksport karaoke.

## Zależności

- Etap 07 musi dostarczać aktualny `Arrangement`.
- Etap 05 musi dostarczać artefakty audio do odsłuchu.
- Etap 03 musi obsługiwać pobieranie lub streaming dozwolonych artefaktów audio.

## Wynik etapu

- Użytkownik może doprowadzić wynik AI do stanu grywalnego.
- Backend przechowuje jeden aktualny stan edycji.
- Odświeżenie strony zachowuje zapisany `Arrangement`, ale nie zachowuje sesyjnego undo/redo.

## Kryteria akceptacji

- Najczęstsze korekty da się wykonać bez opuszczania głównego widoku edytora.
- Odtwarzanie jest zsynchronizowane z waveformem i piano rollem.
- Edytor nie renderuje całej osi czasu długiego utworu naraz, jeśli szkodzi to wydajności.
- Tekst i kontrolki nie nachodzą na siebie na małych ekranach.
- UI używa kolorów, typografii, focusów, hoverów i reduced motion zgodnie z `UI.md`.

## Proponowane testy

- Test jednostkowy walidacji `Arrangement`.
- Test zapisu z poprawnym i nieaktualnym `revision`.
- Test edycji frazy, zapisu, odświeżenia strony i ponownego odczytu.
- Test sesyjnego undo/redo bez trwałej historii.
- Test synchronizacji odtwarzania z markerami fraz i nutami.
- Test responsywności edytora dla małej szerokości ekranu.
