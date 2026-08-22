# benio – Kalorienzähler

Ein **kostenloses, privates und datensparsames Kalorien- & Makronährstoff-Tracking-App** auf Basis KI-gestützter Foto-Analyse. Fotografiere dein Essen, lass die Kalorien berechnen, fertig.

## Was ist benio?

benio ist eine **Progressive Web App (PWA)**, die du im Browser öffnest – keine App-Installation nötig. Die App speichert alle Daten **nur lokal auf deinem Gerät** in `localStorage`. Keine Cloud, keine Datensammlung, keine nervigen Push-Benachrichtigungen.

**Kernidee:** Fotografiere dein Gericht → Google Gemini Vision analysiert das Bild → die App zeigt dir Kalorien & Makros für genau deine Portion.

### Features
- Foto-Analyse mit Google Gemini Vision
- Automatische Kalorienziels-Berechnung (Mifflin-St Jeor-Formel)
- Tracking von Makronährstoffen (Kohlenhydrate, Protein, Fett)
- Tagesweise Navigation (Heute, morgen, gestern)
- Lebensmittel-Freitextsuche (Open Food Facts API)
- Offline-first, PWA-ready (als Homescreen-App installierbar)
- Nichts geht in die Cloud – nur lokal
- Kostenlos, keine Werbung, keine Premium-Features

---

## Wie es funktioniert

### Overview
```
Foto → Google Gemini (Vision) → JSON mit Nährwerten → lokal speichern → Dashboard aktualisieren
```

### Tech-Stack
- **Frontend:** Vanilla JavaScript (keine Frameworks), CSS Grid/Flexbox
- **Storage:** Browser `localStorage` (pro Tag: Mahlzeiten, Wasser, verbrannte Kalorien)
- **APIs:**
  - **Google Gemini Vision** (Bild-Analyse): kostenloses API, benötigt kostenlosen API-Key
  - **Open Food Facts API** (Lebensmittel-DB): kostenlos, kein Key nötig
- **Backend:** Cloudflare Pages Functions (serverlose Funktionen)
- **Deployment:** Cloudflare Pages

### Ablauf beim Fotos machen
1. Du klickst auf den Kamera-Button → wählst ein Foto aus der Galerie oder machst ein neues
2. Das Foto wird an `POST /api/analyze` gesendet
3. **Server-Funktion** sendet das Bild an **Google Gemini Vision**
4. Gemini analysiert: Gericht ↔ Komponenten (Reis, Hähnchen, …) ↔ Portionsgrößen ↔ Nährwerte
5. Antwort als JSON: `{ is_food, dish_name, confidence, items: [ {name, amount_g, kcal_per_100g, ...} ] }`
6. App rechnet um: `(amount_g / 100) * kcal_per_100g` pro Item
7. Summe wird in der aktuellen Mahlzeit (Breakfast/Lunch/Dinner/Snack) eingetragen
8. Alles speichert sich lokal; das Foto wird **gelöscht** (nicht gespeichert)

### Kalorieziel-Berechnung
Nach dem Onboarding (Alter, Größe, Gewicht, Aktivität, Ziel) berechnet die App dein tägliches Kalorienbudget:

```
BMR = 10·Gewicht + 6.25·Größe − 5·Alter + Geschlecht-Offset
Tagesbudget = BMR × Aktivitätsfaktor ± Zielmodifikator (±400 kcal bei Abnehmen/Zunehmen)
```

Makro-Split: 45% Carbs, 30% Protein, 25% Fett (editierbar in Settings).

---

## Bedienung

### Start
1. App öffnen: `https://benio.pages.dev/` (oder lokal laufen lassen)
2. **Onboarding:** Wähle dein Ziel (Abnehmen/Halten/Zunehmen), gib Alter, Größe, Gewicht, Geschlecht, Aktivität an
3. Fertig – dashboard lädt

### Täglicher Workflow
- **Oben:** Tagesansicht mit Kalorienring (kcal übrig), Ziel, gegessen, Sport
- **Mitte:** Mahlzeiten-Tabs (Frühstück, Mittag, Abend, Snack)
- **Unten:** Bottom-Navigation (Home / Einstellungen / Kamera)

### Essen hinzufügen
**Option 1: Foto machen**
- Button klicken → Foto aus Galerie oder Kamera → KI analysiert → Einträge hinzufügen

**Option 2: Lebensmittel suchen**
- in der Mahlzeit eingeben → "Banana", "Reis", "Hähnchenbrust" → Portion anpassen → Speichern

### Datum wechseln
- Oben: `‹ Heute ›` – klick auf die Pfeile, um einen Tag vor/zurück zu gehen

### Einstellungen
- Profil bearbeiten (Größe, Gewicht, Ziel)
- Makro-Ziele anpassen
- Aktivität ändern
- Reset: alle Daten löschen

---

## Installation & Setup

### Voraussetzungen
- **Node.js 18+** (für Cloudflare Pages Functions)
- **npm** oder **yarn**
- **Google Gemini API Key** (kostenlos, 15 Requests/min Free Tier)
  - https://aistudio.google.com → Get API Key
- **Cloudflare Account** (kostenlos)

### Lokal entwickeln
```bash
# Clone
git clone https://github.com/basti/benio.git
cd benio

# Dependencies
npm install

# API-Key setzen (lokal)
export GEMINI_API_KEY="dein-key-hier"

# Dev-Server starten (Cloudflare Pages Functions emulieren)
npx wrangler pages dev
# öffnet http://localhost:8788
```

### Deployment (Cloudflare Pages)
```bash
# 1. Repo mit GitHub verbinden
# 2. Cloudflare Dashboard → Pages → „benio" erstellen
# 3. Build-Einstellung: Build command = `npm run build`, Output = `public`
# 4. Environment Variable setzen:
#    GEMINI_API_KEY = [dein-api-key]
# 5. Pushen → Auto-Deployment
```

---

## Warum überhaupt?

Ich hatte **null Lust, Geld für Kalorien-Apps zu zahlen.**

Die populären Apps (MyFitnessPal, Yazio, Lifesum) verlangen monatlich 5–12 €. Die Funktionen sind okay, aber:
- Deine Essensfotos landen in fremden Clouds
- Ständig Werbung oder Features nur im Premium-Plan
- Oft sind die KI-Analysen lahm oder ungenau
- Keine Kontrolle über deine Daten

Also habe ich **benio** selbst gebaut: kostenlos, privat, mit moderner KI (Google Gemini). Das Rezept: einfache PWA, Browser-Storage, kostenlose APIs, und eine Pinch Self-Hosting auf Cloudflare Pages (kostenlos bis 50k Requests/Tag).

Ergebnis: Du trackst deine Kalorien, Google sieht die Fotos (für die Analyse), aber sonst niemand.

---

## Lizenz

MIT

## Bugs? Fehler?

Issues/PRs sind willkommen. 
