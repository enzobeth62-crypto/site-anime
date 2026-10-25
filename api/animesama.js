const ALLOWED_ACTIONS = {
  search: { path: "/api/getSerchAnime", params: ["q", "l"], required: ["q"] },
  catalog: { path: "/api/loadBaseAnimeData", params: [], required: [] },
  seasons: { path: "/api/getInfoAnime", params: ["q"], required: ["q"] },
  season: { path: "/api/getSpecificAnime", params: ["q", "s", "v"], required: ["q"] }
};

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const action = typeof req.query.action === "string" ? req.query.action : "";
  const config = ALLOWED_ACTIONS[action];
  if (!config) return res.status(400).json({ error: "Action inconnue." });

  const base = (process.env.ANIMESAMA_API_URL || "").trim().replace(/\/+$/, "");
  if (!base) {
    return res.status(503).json({
      error: "Le service AnimeSamaApi n’est pas encore configuré. Consulte ANIMESAMA_SETUP.md."
    });
  }

  let upstream;
  try {
    upstream = new URL(base);
  } catch (_) {
    return res.status(500).json({ error: "L’URL du service AnimeSamaApi est invalide." });
  }
  if (upstream.protocol !== "https:" && upstream.hostname !== "localhost" && upstream.hostname !== "127.0.0.1") {
    return res.status(500).json({ error: "Le service AnimeSamaApi doit utiliser HTTPS en production." });
  }

  const params = new URLSearchParams();
  for (const key of config.params) {
    const value = typeof req.query[key] === "string" ? req.query[key].trim() : "";
    if (config.required.includes(key) && !value) {
      return res.status(400).json({ error: "Paramètre requis manquant : " + key });
    }
    if (value) {
      if (value.length > (key === "q" ? 120 : 40)) {
        return res.status(400).json({ error: "Paramètre trop long : " + key });
      }
      if (key === "l") {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
          return res.status(400).json({ error: "La limite doit être comprise entre 1 et 50." });
        }
      }
      params.set(key, value);
    }
  }

  const target = new URL(config.path, upstream.origin);
  target.search = params.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json, text/plain;q=0.9" },
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      return res.status(502).json({ error: "Le service de catalogue a répondu avec une erreur (" + response.status + ")." });
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return res.status(502).json({ error: "Le service de catalogue n’a pas renvoyé de JSON valide." });
    }
    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({
      error: error.name === "AbortError"
        ? "Le service de catalogue met trop de temps à répondre."
        : "Impossible de joindre le service AnimeSamaApi."
    });
  } finally {
    clearTimeout(timeout);
  }
};