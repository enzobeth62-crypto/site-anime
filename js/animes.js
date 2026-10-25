(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { items: [], filtered: [], page: 1, pageSize: 20, query: "", catalogLoaded: false };
  const form = $("#search-form");
  const input = $("#search-input");
  const results = $("#results");
  const status = $("#status");
  const sortSelect = $("#sort-select");
  const pagination = $("#pagination");
  const dialog = $("#anime-dialog");

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.dataset.kind = kind;
  }
  function safeText(value) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  }
  function normalizeItem(item) {
    if (typeof item === "string") return { title: safeText(item), alternate: "", link: "" };
    if (!item || typeof item !== "object") return null;
    const title = safeText(item.title || item.name || item.nom);
    if (!title) return null;
    return {
      title,
      alternate: safeText(item.AlterTitle || item.alterTitle || item.alternateTitle || ""),
      link: safeText(item.lien || item.link || item.base_url || ""),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null
    };
  }
  function unique(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = item.title.toLocaleLowerCase("fr");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  async function api(action, params = {}) {
    const url = new URL("/api/animesama", window.location.origin);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Le service de catalogue est indisponible.");
    return data;
  }
  function showEmpty(title, detail) {
    results.replaceChildren();
    const box = document.createElement("div");
    box.className = "empty-state";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const p = document.createElement("p");
    p.textContent = detail;
    box.append(strong, p);
    results.append(box);
    pagination.hidden = true;
  }
  function makeCard(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "anime-card";
    button.setAttribute("aria-label", "Afficher les détails de " + item.title);
    const top = document.createElement("div");
    top.className = "card-top";
    const icon = document.createElement("span");
    icon.className = "card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.title.slice(0, 1).toLocaleUpperCase("fr");
    const headingWrap = document.createElement("div");
    headingWrap.style.minWidth = "0";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.title;
    const alt = document.createElement("div");
    alt.className = "card-alt";
    alt.textContent = item.alternate || "Titre alternatif non fourni";
    headingWrap.append(title, alt);
    top.append(icon, headingWrap);
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = item.score !== null ? "Correspondance " + item.score + "%" : "Catalogue";
    meta.append(tag);
    const open = document.createElement("div");
    open.className = "card-open";
    open.textContent = "Explorer les saisons →";
    button.append(top, meta, open);
    button.addEventListener("click", () => openAnime(item));
    return button;
  }
  function render() {
    results.replaceChildren();
    const sorted = [...state.filtered];
    if (sortSelect.value === "title") sorted.sort((a, b) => a.title.localeCompare(b.title, "fr"));
    state.filtered = sorted;
    const pages = Math.max(1, Math.ceil(sorted.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    sorted.slice(start, start + state.pageSize).forEach(item => results.append(makeCard(item)));
    $("#results-heading").textContent = state.query ? "Résultats de recherche" : "Catalogue disponible";
    $("#results-summary").textContent = sorted.length + " titre(s) affiché(s)";
    pagination.hidden = sorted.length <= state.pageSize;
    $("#page-label").textContent = "Page " + state.page + " / " + pages;
    $("#previous-page").disabled = state.page <= 1;
    $("#next-page").disabled = state.page >= pages;
    if (!sorted.length) showEmpty("Aucun résultat", "Essaie un autre titre ou charge le catalogue disponible.");
  }
  function setItems(items, query = "") {
    state.items = unique(items.map(normalizeItem).filter(Boolean));
    state.query = query;
    state.filtered = [...state.items];
    state.page = 1;
    render();
  }
  async function search(query) {
    const q = safeText(query);
    if (!q) return;
    input.value = q;
    setStatus("Recherche de « " + q + " »…");
    $("#results-heading").textContent = "Recherche en cours";
    try {
      const data = await api("search", { q, l: 30 });
      const items = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);
      setItems(items, q);
      setStatus(items.length ? items.length + " résultat(s) trouvé(s)." : "Aucun titre correspondant trouvé.", items.length ? "success" : "");
    } catch (error) {
      showEmpty("Catalogue indisponible", error.message + " Vérifie la configuration du serveur dans le guide d’installation.");
      setStatus(error.message, "error");
    }
  }
  async function loadCatalog() {
    setStatus("Chargement du catalogue… La première initialisation du service peut prendre du temps.");
    $("#load-catalog").disabled = true;
    try {
      const data = await api("catalog");
      if (!Array.isArray(data)) throw new Error("Le service n’a pas renvoyé une liste de titres.");
      state.catalogLoaded = true;
      setItems(data, "");
      setStatus("Catalogue chargé : " + state.items.length + " titre(s).", "success");
    } catch (error) {
      setStatus(error.message, "error");
      showEmpty("Impossible de charger le catalogue", error.message + " Lance d’abord l’initialisation du service AnimeSamaApi sur son hébergement.");
    } finally {
      $("#load-catalog").disabled = false;
    }
  }
  function makeJustWatchUrl(title) {
    return "https://www.justwatch.com/fr/recherche?q=" + encodeURIComponent(title);
  }
  async function openAnime(item) {
    $("#dialog-title").textContent = item.title;
    $("#dialog-alternate").textContent = item.alternate ? "Autre titre : " + item.alternate : "";
    $("#legal-search").href = makeJustWatchUrl(item.title);
    const seasonList = $("#season-list");
    const seasonSelect = $("#season-select");
    const languageSelect = $("#language-select");
    const episodePanel = $("#episode-panel");
    const episodeStatus = $("#episode-status");
    seasonList.replaceChildren();
    seasonSelect.replaceChildren(new Option("Chargement des saisons…", ""));
    seasonSelect.disabled = true;
    episodePanel.hidden = true;
    dialog.showModal();
    try {
      const data = await api("seasons", { q: item.title });
      const seasons = Array.isArray(data) ? data : (Array.isArray(data.seasons) ? data.seasons : []);
      seasonSelect.replaceChildren();
      seasonList.replaceChildren();
      if (!seasons.length) {
        seasonSelect.add(new Option("Aucune saison trouvée", ""));
        const empty = document.createElement("p");
        empty.className = "alternate-title";
        empty.textContent = "Aucune saison détaillée n’a été renvoyée pour ce titre.";
        seasonList.append(empty);
        return;
      }
      seasons.forEach((season, index) => {
        const name = safeText(season.Saison || season.season || season.title || ("Saison " + (index + 1)));
        const value = safeText(season.season_key || season.slug || (season.url ? season.url.replace(/\\/+$/, "").split("/").pop() : "") || ("saison" + (index + 1))).toLowerCase().replace(/\\s+/g, "");
        seasonSelect.add(new Option(name, value));
      });
      seasonSelect.disabled = false;

      async function showSelectedSeason() {
        const selected = seasons[seasonSelect.selectedIndex];
        if (!selected) return;
        seasonList.replaceChildren();
        episodePanel.hidden = false;
        episodeStatus.textContent = "Vérification des informations pour " + seasonSelect.options[seasonSelect.selectedIndex].text + " (" + (languageSelect.value === "vf" ? "VF" : "VOSTFR") + ")…";
        const row = document.createElement("div");
        row.className = "season-item";
        const wrap = document.createElement("div");
        const title = document.createElement("span");
        title.textContent = safeText(selected.Saison || selected.season || selected.title || "Saison sélectionnée");
        const small = document.createElement("small");
        small.textContent = "Les informations d’épisodes détaillées ne sont pas renvoyées par la route saisons.";
        wrap.append(title, document.createElement("br"), small);
        row.append(wrap);
        seasonList.append(row);
        $("#episode-list").replaceChildren();
        try {
          const seasonKey = seasonSelect.value || "saison1";
          const detail = await api("season", { q: item.title, s: seasonKey, v: languageSelect.value });
          const info = Array.isArray(detail) ? detail[0] : detail;
          const infoText = safeText(info && (info.Saison || info.title || info.url));
          episodeStatus.textContent = infoText
            ? infoText + " — Pour la liste des épisodes et les langues disponibles, consulte les plateformes légales."
            : "La saison est sélectionnée. Les épisodes et lecteurs vidéo ne sont pas fournis dans cette réponse API.";
        } catch (error) {
          episodeStatus.textContent = "Impossible de charger le détail de cette saison : " + error.message;
        }
        const legal = document.createElement("a");
        legal.href = makeJustWatchUrl(item.title);
        legal.target = "_blank";
        legal.rel = "noopener noreferrer";
        legal.className = "primary-link";
        legal.textContent = "Trouver les épisodes en " + (languageSelect.value === "vf" ? "VF" : "VOSTFR") + " ↗";
        $("#episode-list").append(legal);
      }
      seasonSelect.onchange = showSelectedSeason;
      languageSelect.onchange = showSelectedSeason;
      await showSelectedSeason();
    } catch (error) {
      seasonList.replaceChildren();
      seasonSelect.replaceChildren(new Option("Erreur de chargement", ""));
      const p = document.createElement("p");
      p.className = "alternate-title";
      p.textContent = "Impossible de récupérer les saisons : " + error.message;
      seasonList.append(p);
    }
  }
  form.addEventListener("submit", event => { event.preventDefault(); search(input.value); });
  document.querySelectorAll("[data-query]").forEach(button => button.addEventListener("click", () => search(button.dataset.query)));
  $("#load-catalog").addEventListener("click", loadCatalog);
  sortSelect.addEventListener("change", render);
  $("#previous-page").addEventListener("click", () => { if (state.page > 1) { state.page--; render(); } });
  $("#next-page").addEventListener("click", () => { if (state.page < Math.ceil(state.filtered.length / state.pageSize)) { state.page++; render(); } });
  $("#close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  const initialQuery = new URLSearchParams(window.location.search).get("q");
  if (initialQuery) search(initialQuery);
})();