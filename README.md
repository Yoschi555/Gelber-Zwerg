# Gelber Zwerg – Internet V3

Online-Multiplayer-Prototyp für 3–4 Spieler mit eigener öffentlicher URL.

## Schnell lokal testen

Node.js 18+ installieren und im Projektordner:

```bash
npm start
```

Danach: `http://localhost:3000`

## Übers Internet spielen

Siehe **INTERNET_DEPLOY_RENDER.md**. Die Version enthält bereits eine `render.yaml` und ist für Render vorbereitet.

## Bereits enthalten

- eigene Spielernamen
- Raum erstellen + 5-stelliger Raumcode
- 3–4 Spieler
- jeder sieht nur seine eigene Hand
- 52 eigene Kartenbilder + Kartenrückseite
- fünf Pot-Felder
- Bronze 1 / Silber 2 / Gold 5
- Drag & Drop / Antippen von Chips
- Pflichteinsätze
- Pot-Auszahlungen
- A–K-Reihenlogik
- Skip-Regel
- Rundensieg + Restkarten-Auszahlung
- nächste Runde durch Host

## Wichtig

Die Räume werden aktuell nur im Arbeitsspeicher gehalten. Ein Neustart des Hosts beendet bestehende Räume.
