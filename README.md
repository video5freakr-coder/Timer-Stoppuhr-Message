# Lern-Timer v10

Stoppuhren und Timer für Notion, mit einer Windows-App für Benachrichtigungen, Alarmton und ein Mini-Fenster, das immer im Vordergrund bleibt.

## Was v10 kann

- **Beliebig viele Stoppuhren und Timer.** Mit ＋ neben „Stoppuhren“ oder „Timer“ fügst du eine neue Uhr hinzu, sie erscheint unten. Standard sind 1 Stoppuhr und 1 Timer. Jede Karte lässt sich einklappen und zeigt dann die Zeit in der Kopfzeile.
- **Überzeit:** Ein abgelaufener Timer zählt rot ins Minus weiter (z.B. −00:03:12).
- **Nichts geht verloren:** Uhren laufen über absolute Zeitstempel. Neuladen von Notion, ein Absturz oder ein Neustart unterbrechen sie nicht. Jede Änderung wird sofort an drei Orten gespeichert: im Notion-Widget, in der Windows-App und in Firebase.
- **Beide Seiten bedienen alles:** Notion und Windows-App haben dieselbe Oberfläche. Änderungen erscheinen in Echtzeit auf der anderen Seite.
- **Echter Verbindungsstatus:** „geöffnet“ heisst wirklich geöffnet. Schliesst du die Windows-App, zeigt Notion das nach wenigen Sekunden an (bei einem Absturz spätestens nach etwa einer Minute).
- **Windows-Benachrichtigung** beim Ablauf, bleibt sichtbar, bis du sie wegklickst, mit den Knöpfen „Alarm stoppen“ und „Noch 5 Min.“.
- **Mini-Fenster (Bild-in-Bild)** in der Windows-App: zeigt die laufenden Uhren gross, mit Fortschrittsbalken, und bleibt über allen anderen Fenstern.
- **Alarm stoppen auf einer Seite stoppt ihn überall.** In Notion klingelt der Alarm standardmässig nur, wenn die Windows-App geschlossen ist, damit es nicht doppelt läutet.
- **Rückgängig** nach Löschen und Zurücksetzen (9 Sekunden lang).
- Alle Klänge aus v9 (6 Alarmklänge, 6 Hintergrundklänge für Stoppuhren) und Alarmdauer 30 s / 1 min / 3 min / bis Stopp.
- Uhren aus v9 werden beim ersten Start automatisch übernommen, ebenso der bisherige Verbindungscode.

## Einrichtung

### 1. Firebase-Datenbank anlegen (einmalig, ca. 10 Minuten, kostenlos)

Die Bezeichnungen in der Firebase-Konsole können leicht abweichen.

1. <https://console.firebase.google.com> öffnen und mit deinem Google-Konto anmelden.
2. **Projekt erstellen**, Name z.B. `lern-timer`. Google Analytics kannst du ausschalten.
3. Im Menü links unter **Build/Erstellen** → **Realtime Database** → **Datenbank erstellen**.
4. Standort **Belgien (europe-west1)** wählen → **Im gesperrten Modus starten**.
5. Reiter **Regeln**: den ganzen Inhalt durch den Inhalt von `firebase-rules.json` ersetzen → **Veröffentlichen**.
6. Reiter **Daten**: Oben steht die Adresse der Datenbank, z.B.
   `https://lern-timer-1a2b3-default-rtdb.europe-west1.firebasedatabase.app`. Kopieren.

Der kostenlose Spark-Plan braucht kein Zahlungsmittel. Eine „Web-App“ musst du in Firebase nicht registrieren.

### 2. Dateien auf GitHub hochladen

1. Im Repository `Timer-Stoppuhr-Message` auf **Add file → Upload files** klicken, alle Dateien aus diesem Ordner hineinziehen und committen. Gleichnamige Dateien werden ersetzt.
2. Die alten Dateien `widget.css` und `companion.css` werden nicht mehr gebraucht. Du kannst sie löschen, sie stören aber auch nicht.
3. `config.js` ist bereits mit deiner Datenbank (`lern-timer`) ausgefüllt. Nur falls du einmal eine andere Datenbank verwendest: `config.js` auf GitHub öffnen → Stift-Symbol → die Adresse zwischen die Anführungszeichen setzen:
   ```js
   export const FIREBASE_DATABASE_URL = "https://lern-timer-1a2b3-default-rtdb.europe-west1.firebasedatabase.app";
   ```
   → **Commit changes**.
4. GitHub Pages braucht danach ein paar Minuten, bis die neue Version online ist.

### 3. Notion

1. Das Widget wie bisher einbetten: `https://video5freakr-coder.github.io/Timer-Stoppuhr-Message/`
2. Unten im Widget **Windows-App** aufklappen. Bei „Server (Firebase)“ sollte jetzt **verbunden** stehen.
3. Empfohlen: Den **Embed-Link mit Code** kopieren, in Notion einen neuen Embed-Block damit anlegen und den alten löschen. Dann bleibt die Verbindung auch bestehen, wenn Notion seinen Speicher leert.

### 4. Windows-App

1. Im Notion-Widget auf **Windows-App öffnen und verbinden** klicken. Die App übernimmt den Code automatisch.
2. In Edge über **Installieren** oben rechts (oder Edge-Menü → Apps → „Diese Website als App installieren“) als App installieren.
3. **Benachrichtigungen und Töne** aufklappen → Haken bei „Windows-Benachrichtigung“ setzen → in Edge erlauben → **Test-Benachrichtigung senden**.
4. Damit keine Meldung verloren geht:
   - `edge://apps` → Lern-Timer → automatischen Start bei der Windows-Anmeldung einschalten.
   - Edge-Einstellungen → System und Leistung → bei den Ausnahmen für schlafende Tabs `video5freakr-coder.github.io` eintragen.
   - „Nicht stören“ in Windows unterdrückt Meldungen. Beim Lernen ausschalten oder Edge als Ausnahme zulassen.
5. Erscheint in der App der rote Hinweis „Klicke einmal hier hinein …“, einmal in die App klicken, dann darf sie Töne abspielen.

Hattest du die alte Begleit-App aus dem Repository `notion-timer-widget` installiert, deinstalliere sie und installiere die neue aus `Timer-Stoppuhr-Message`.

### 5. Mini-Fenster

In der Windows-App oben auf **⧉ Mini-Fenster** klicken. Das kleine Fenster zeigt die laufenden Uhren (der nächste ablaufende Timer gross oben) und bleibt über allen Fenstern, auch wenn die App minimiert ist. Grösse und Position kannst du mit der Maus ändern. Aus einem Notion-Embed heraus erlauben Browser kein solches Fenster, deshalb gibt es das Mini-Fenster nur in der Windows-App.

## Wichtig zu wissen

- Die Windows-App muss **geöffnet** sein (minimiert reicht), damit sie Benachrichtigungen zeigen kann.
- Der **Verbindungscode** ist der Schlüssel zu deinen Uhren. Wer ihn kennt, kann sie sehen und steuern. Teile den Embed-Link mit Code nicht öffentlich. Die Firebase-Adresse in `config.js` ist dagegen unbedenklich.
- Ohne Eintrag in `config.js` funktioniert alles lokal, nur ohne Synchronisierung.

## Künftige Updates

Bei jeder neuen Version die Dateien wieder hochladen. Die Versionsnummer steckt in den Dateiverweisen (`?v=10.0`), damit Browser nicht mit alten Dateien weiterarbeiten. Die Notion-URL musst du nicht mehr ändern. `config.js` beim Hochladen nicht überschreiben (oder danach die Adresse wieder eintragen).

## Statusanzeigen

| Anzeige | Bedeutung |
|---|---|
| Server **verbunden** | Firebase erreichbar, Änderungen werden synchronisiert. |
| Server **getrennt** | Kein Internet. Die Uhren laufen trotzdem weiter, Änderungen werden nachgeliefert. |
| Server **Zugriff verweigert** | Die Regeln aus `firebase-rules.json` sind nicht veröffentlicht. |
| Server **nicht eingerichtet** | `config.js` ist leer. |
| Windows-App **geöffnet** | Die App läuft und wird dich benachrichtigen. |
| Windows-App **geschlossen · zuletzt 14:32** | Die App ist zu. Es kommt keine Windows-Meldung, Notion übernimmt den Alarmton. |

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `widget.js` | Notion-Widget |
| `companion.html`, `companion.js` | Windows-App |
| `core.js` | Logik der Uhren (Zeit, Überzeit, Zusammenführen) |
| `app.js` | Speichern, Synchronisieren, Aktionen |
| `sync.js` | Verbindung zu Firebase |
| `ui.js`, `styles.css`, `shared-ui.js` | Oberfläche |
| `runtime.js` | Ablauf-Überwachung und Klänge |
| `sounds.js` | Alle Klänge |
| `pip.js` | Mini-Fenster |
| `sw.js`, `manifest.webmanifest`, Icons | Installierbare App, Offline-Start, Benachrichtigungs-Knöpfe |
| `config.js` | Deine Firebase-Adresse |
| `firebase-rules.json` | Sicherheitsregeln für Firebase |
