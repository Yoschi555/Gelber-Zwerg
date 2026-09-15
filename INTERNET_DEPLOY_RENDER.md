# Gelber Zwerg – öffentlich übers Internet spielen

Diese Version ist bereits für einen normalen Node.js-Webhost vorbereitet. Am einfachsten ist Render.

## Einmalig: Projekt zu GitHub hochladen

1. Öffne https://github.com und melde dich an.
2. Oben rechts `+` → `New repository`.
3. Name z. B. `gelber-zwerg`.
4. Repository erstellen.
5. Auf der Repo-Seite `Add file` → `Upload files`.
6. Lade **den Inhalt dieses entpackten Ordners** hoch (nicht die ZIP selbst).
7. Unten `Commit changes`.

Wichtig: `render.yaml`, `server.js`, `package.json` und der komplette `public`-Ordner müssen im Hauptverzeichnis des Repositories liegen.

## Danach auf Render veröffentlichen

1. Öffne https://render.com und melde dich an.
2. Verbinde dein GitHub-Konto mit Render.
3. `New` → `Blueprint`.
4. Wähle dein Repository `gelber-zwerg`.
5. Render erkennt die `render.yaml` automatisch.
6. Blueprint erstellen / deployen.
7. Nach dem erfolgreichen Deploy bekommst du eine öffentliche Adresse, z. B. `https://gelber-zwerg-xxxx.onrender.com`.

Diese Adresse schickst du allen Mitspielern. Sie funktioniert auch aus einem anderen WLAN bzw. über mobile Daten.

## Im Spiel

- Einer öffnet die öffentliche URL, gibt seinen Namen ein und erstellt einen Raum.
- Er schickt den angezeigten 5-stelligen Raumcode an die anderen.
- Die anderen öffnen **dieselbe öffentliche URL**, geben ihren eigenen Namen + Raumcode ein und joinen.
- Bei 3 oder 4 Spielern kann der Host starten.

## Hinweis zur aktuellen V3

Die Räume liegen im Arbeitsspeicher des Servers. Bei einem Server-Neustart oder Redeploy gehen laufende Räume verloren. Für normale einzelne Spielabende ist das okay. Eine spätere Version kann die Räume dauerhaft in einer Datenbank speichern.
