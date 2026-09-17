# Gelber Zwerg – Internet V4.0

Online-Multiplayer für 3–6 Spieler mit eigener öffentlicher URL.

## Schnell lokal testen

Node.js 18+ installieren und im Projektordner:

```bash
npm start
```

Danach: `http://localhost:3000`

## Übers Internet spielen

Siehe **INTERNET_DEPLOY_RENDER.md**. Die Version enthält bereits eine `render.yaml` und ist für Render vorbereitet.

## Spielmodi

- **Standard** – bisheriges klassisches Regelwerk.
- **Abschiebe** – nach dem ersten Ausscheiden startet das Endgame: Restkarten-Strafe ×2 und Überlebensgrenze 9; nach jeweils drei weiteren Runden steigen beide weiter bis maximal ×5 / Grenze 15.
- **Chaos** – übernimmt das Abschiebe-Endgame und lost jedem Spieler zu Partiebeginn eine von 16 Spezialfähigkeiten zu. Die eigene Fähigkeit wird mit Erklärung und Status im Spiel angezeigt.

## Chaos-Fähigkeiten

Tauschen, Fallensteller, Springer, Kehrtwende, Späher, Nachtreter, Dieb, Blockierer, Schmuggler, Drängler, Glücksritter, Halsabschneider, Multiplikator, Zocker, Fälscher und Leichtgewicht.

## Layout V4

- kompaktere Spieler- und Statusbereiche
- Kartenreihe als Hauptbereich
- deutlich kleinerer Pot-Bereich direkt unter der Reihe
- große eigene Hand am unteren Rand
- Karten überlappen dynamisch, statt immer weiter Platz zu verbrauchen
- zusätzliche Anpassungen für kleinere Laptop-Höhen und mobile Displays

## Weiterhin enthalten

- eigene Spielernamen und 5-stelliger Raumcode
- 3–6 Spieler
- Kartenverteilung: 3 = 15/7 Rest, 4 = 12/4 Rest, 5 = 9/7 Rest, 6 = 8/4 Rest
- jeder sieht nur seine eigene Hand
- 52 eigene Kartenbilder + Kartenrückseite
- fünf Pot-Felder
- Bronze 1 / Silber 2 / Gold 5
- Drag & Drop / Antippen von Chips
- Pflichteinsätze, Pot-Auszahlungen und Doppel-Einsatz-Regel für übrig gebliebene Pot-Karten
- Not-Einzahlung und Ausscheiden
- zyklische 13-Rang-Reihenlogik mit Richtungswahl
- Mehrfachzüge und Skip-Regel
- Live-Synchronisation via Server-Sent Events + Polling-Fallback
- automatischer Rundenwechsel bei allen Clients ohne manuelles Neuladen
- sichtbarer Spielverlauf bleibt aus der Oberfläche entfernt

## Wichtig

Die Räume werden aktuell nur im Arbeitsspeicher gehalten. Ein Neustart oder Redeploy des Servers beendet bestehende Räume.
