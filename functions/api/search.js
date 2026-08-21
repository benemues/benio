/* Cloudflare Pages Function: GET /api/search?q=…
   Proxy für die Lebensmittel-Suche über die neue Open-Food-Facts-Such-API
   (search.openfoodfacts.org). Die alte cgi/search.pl blockt Cloudflare-IPs
   mit 503; die neue API ist dafür freigegeben und deutlich schneller.
   Die Antwort wird auf das alte Format { products: [...] } normalisiert,
   das app.js erwartet. */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });

export async function onRequestGet({ request }) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ products: [] });

  const url = 'https://search.openfoodfacts.org/search?'
    + new URLSearchParams({ q, page_size: 30, langs: 'de' });

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'benio/1.0 (private Kalorien-App; Cloudflare Pages)',
      'Accept': 'application/json',
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  if (!res.ok) {
    return json({ error: `Lebensmittel-Datenbank gerade nicht erreichbar (Status ${res.status}).` }, 502);
  }

  const data = await res.json();
  const products = (data.hits || []).map(h => ({
    product_name: h.product_name,
    product_name_de: h.product_name_de,
    // brands kommt hier als Array, app.js erwartet einen komma-getrennten String
    brands: Array.isArray(h.brands) ? h.brands.join(',') : (h.brands || ''),
    nutriments: h.nutriments || {},
    image_small_url: h.image_small_url || null,
    code: h.code,
    serving_size: h.serving_size,
  }));
  return json({ products });
}
