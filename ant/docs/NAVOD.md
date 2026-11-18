# Baja & Baja — PDF dielnička 🐜

Vaša vlastná dielnička na PDF. Nie kúpený program — vlastná appka, spravená pre vás dvoch.

---

## Ako ju spustiť

1. Stiahnite si súbor **`BajaBaja.html`** (napríklad z e-mailu).
2. **Dvakrát naň kliknite.** Otvorí sa v prehliadači (Chrome, Edge, Firefox…).
3. Nič sa neinštaluje, nič netreba povoľovať, nepotrebujete administrátora.
   Je to jeden súbor — môžete si ho uložiť na plochu alebo na USB.

> Všetko sa deje len vo vašom počítači. Žiadny dokument sa nikam neposiela.
> Funguje aj bez internetu (jedinú výnimku má OCR — viď nižšie).

---

## Prvé spustenie

- Vyberiete si, **kto otvára dielničku** (Pája 1 / Pája 2 / obaja).
- Dielnička sa spýta, **ako sa dnes máte**, a podľa nálady sa zafarbí.
- Potom už ste v dielničke. Náladu viete kedykoľvek zmeniť ikonou 🎨 vpravo hore.

---

## Čo appka vie

### Otvoriť dokument
Kliknite hore na **Otvoriť PDF**, alebo súbor jednoducho **pretiahnite do okna**.

### Pridávať do dokumentu (nástroje vľavo)
- **Text** — kliknite do strany a píšte. Meníte písmo, veľkosť, farbu, tučné/šikmé. Plná slovenská aj česká diakritika.
- **Obrázok** — vložíte fotku/podpis/logo a potiahnete na miesto, rožtekom zmeníte veľkosť.
- **Kresliť** — pero voľnou rukou.
- **Zvýrazniť** — ťahom cez text ako zvýrazňovačom.
- **Rámik / Čiara** — jednoduché tvary.
- **Lístok** — nalepovacia poznámka.
- **Výber** — doplnok posuniete alebo prepíšete.
- **Guma** — doplnok zmažete (pôvodný obsah PDF ostáva nedotknutý).

### Prekrytie
Nástroj **Prekryť** spraví nepriehľadný (napr. čierny) obdĺžnik cez časť strany. Je viditeľný — slúži na zakrytie údaja, nie na skrývanie, že sa dokument menil.

### Strany
Otáčanie, mazanie, **duplikovanie**, **zmena poradia ťahaním**, **pripojenie ďalšieho PDF**, **výber strán** do nového súboru (napr. `1-3,5`), **prázdna strana**, **vodoznak** (napr. NÁVRH/KÓPIA šikmo cez strany) a **číslovanie strán**.

### Tlač
Ikonou 🖨️ hore otvoríš hotový dokument aj s doplnkami rovno na tlač.

### Formulár
Ak má PDF interaktívne políčka, vyplníte ich a uložíte.

### OCR — text zo skenu
Z naskenovanej (obrázkovej) strany prečíta text, aby sa dal skopírovať. Jazyky SK / CZ / EN.
*Pri prvom spustení si stiahne jazykový balík z internetu; potom funguje aj offline.*

### Konverzie
- PDF → obrázky (PNG v jednom .zip)
- PDF → text (.txt)
- PDF → Word (.docx)
- Obrázky → PDF
- Zmenšiť PDF
- Vyčistiť údaje (odstráni meno autora, program a pod.)

### Uložiť
Hore **Uložiť PDF** (alebo Ctrl+S). Nový súbor s vašimi doplnkami nájdete v **stiahnutých súboroch**.
Pôvodný dokument sa neprepíše — vznikne nový `…-upravene.pdf`.

---

## Dobré vedieť

- **Doplnky vs. pôvodný text.** Appka do dokumentu *pridáva* vlastné veci (text, obrázky, poznámky, tvary) a spravuje strany, formuláre a konverzie. Needituje pôvodné písmená už vysádzané v súbore — na úpravu vlastného textu použite PDF → Word, upravte vo Worde a uložte späť.
- **Náladový denníček** aj voľba, kto ste, sa ukladajú len u vás v prehliadači. Keď súbor pošlete ďalej, vaše nálady v ňom nie sú.
- **Keď niečo zlyhá**, dielnička to povie dole v stavovom riadku alebo bublinou. Skúste súbor otvoriť znova.

---

## Ako to vzniklo

Pre technicky zvedavých: celá appka je jediný HTML súbor s vloženými knižnicami
(pdf.js na zobrazenie, pdf-lib na úpravy, fontkit na písma, tesseract.js na OCR).
Žiadny server, žiadne účty, žiadne sledovanie.

Zdrojové súbory a build (`npm run ...`) sú v priečinku `ant/`.
