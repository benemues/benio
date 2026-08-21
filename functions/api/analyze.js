/* Cloudflare Pages Function: POST /api/analyze
   Analysiert ein Essensfoto mit der Google Gemini API (Vision + JSON-Schema-Ausgabe).
   Benötigt das Secret GEMINI_API_KEY – kostenloser Key über https://aistudio.google.com
   (Cloudflare Dashboard → Pages-Projekt "benio" → Settings → Environment variables). */

/* Alias, der immer auf das aktuelle Flash-Modell zeigt – so bricht nichts,
   wenn Google ältere Modelle abschaltet. */
const MODEL = 'gemini-flash-latest';

/* Prompt und Schema müssen mit dem Fallback in app.js (analyzeDirect) übereinstimmen. */
const SYSTEM_PROMPT = `Du bist Ernährungsexperte und analysierst Fotos von Mahlzeiten.

Gehe in drei Schritten vor:
1. Identifiziere das Gericht und alle sichtbaren Komponenten (z. B. „Reis", „Hähnchenbrust", „Brokkoli"). Führe Saucen, Dressings und Bratöl als eigene Komponente auf, wenn sie sichtbar oder sehr wahrscheinlich sind.
2. Schätze für jede Komponente die Portionsgröße in Gramm (verzehrfertig zubereitet). Nutze sichtbare Referenzen: Standardteller ≈ 26 cm, Gabel ≈ 20 cm, Handfläche, Glas. Berücksichtige Schichthöhe und Perspektive. Portionen werden auf Fotos häufig unterschätzt – sei realistisch.
3. Gib für jede Komponente typische Nährwerte pro 100 g des zubereiteten Lebensmittels an (kcal, Kohlenhydrate, Protein, Fett) – z. B. gekochter Reis, nicht roher.

Regeln:
- dish_name: kurzer deutscher Name des Gesamtgerichts.
- portion_hint: ein Satz, worauf sich deine Mengenschätzung stützt (Referenzobjekte, Tellergröße …).
- confidence: "hoch" | "mittel" | "niedrig".
- Zeigt das Bild kein Essen (oder nur geschlossene Verpackung), setze is_food auf false und lass items leer.`;

const RESULT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_food: { type: 'BOOLEAN' },
    dish_name: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['hoch', 'mittel', 'niedrig'] },
    portion_hint: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          amount_g: { type: 'NUMBER' },
          kcal_per_100g: { type: 'NUMBER' },
          carbs_per_100g: { type: 'NUMBER' },
          protein_per_100g: { type: 'NUMBER' },
          fat_per_100g: { type: 'NUMBER' },
        },
        required: ['name', 'amount_g', 'kcal_per_100g', 'carbs_per_100g', 'protein_per_100g', 'fat_per_100g'],
      },
    },
  },
  required: ['is_food', 'dish_name', 'confidence', 'portion_hint', 'items'],
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY ist auf dem Server nicht konfiguriert.' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Ungültiger Request.' }, 400); }
  const image = body?.image;
  const mediaType = body?.media_type;
  if (!image || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType || '')) {
    return json({ error: 'Bild fehlt oder Format wird nicht unterstützt.' }, 400);
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: image } },
            { text: 'Analysiere dieses Gericht und schätze die Nährwerte.' },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESULT_SCHEMA,
        },
      }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || 'Fehler bei der Gemini-API.';
    // 429 = Tageslimit des Gratis-Tarifs erreicht
    if (res.status === 429) return json({ error: 'Tageslimit der kostenlosen Gemini-API erreicht. Versuch es später erneut.' }, 429);
    return json({ error: msg }, 502);
  }

  const candidate = data.candidates?.[0];
  if (!candidate || candidate.finishReason === 'SAFETY') {
    return json({ error: 'Die Analyse wurde abgelehnt. Bitte versuche ein anderes Foto.' }, 422);
  }

  const text = candidate.content?.parts?.map(p => p.text || '').join('');
  if (!text) return json({ error: 'Leere Antwort der Analyse.' }, 502);
  try { return json(JSON.parse(text)); }
  catch { return json({ error: 'Analyse-Antwort konnte nicht gelesen werden.' }, 502); }
}
