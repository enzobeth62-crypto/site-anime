/* Dashboard shell: rearranges existing controls without replacing app logic */
(() => {
  "use strict";
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  function init() {
    const wrap = $(".wrap"), header = $(".top"), brand = $(".top .brand");
    if (!wrap || !header || $("#avLeftSidebar")) return;
    const sidebar = document.createElement("aside");
    sidebar.id = "avLeftSidebar";
    sidebar.setAttribute("aria-label", "Navigation principale");
    if (brand) sidebar.append(brand);
    const primary = document.createElement("div");
    primary.className = "av-nav-group";
    primary.innerHTML = '<div class="av-nav-label">Menu</div>';
    const secondary = document.createElement("div");
    secondary.className = "av-nav-group";
    secondary.innerHTML = '<div class="av-nav-label">Bibliothèque</div>';
    const actions = $("#headActions");
    const moveButton = (id, target, label, icon) => {
      const b = $("#"+id);
      if (!b) return;
      b.classList.remove("primary");
      b.setAttribute("aria-label", label);
      b.innerHTML = '<span class="av-side-icon" aria-hidden="true">'+icon+'</span><span class="av-side-text">'+label+'</span>';
      target.append(b);
    };
    moveButton("navLibrary", primary, "Accueil", "⌂");
    moveButton("navChat", primary, "Communauté", "♧");
    moveButton("navVideos", primary, "Vidéos", "▶");
    moveButton("navCalendar", primary, "Calendrier", "▦");
    const discover = document.createElement("a");
    discover.className = "av-side-link";
    discover.href = "/animes.html";
    discover.innerHTML = '<span class="av-side-icon" aria-hidden="true">⌕</span><span class="av-side-text">Découverte</span>';
    primary.append(discover);
    const collection = document.createElement("button");
    collection.type = "button";
    collection.className = "btn";
    collection.innerHTML = '<span class="av-side-icon" aria-hidden="true">▤</span><span class="av-side-text">Ma collection</span>';
    collection.addEventListener("click", () => { $("#navLibrary")?.click(); $("#search")?.focus(); });
    secondary.append(collection);
    const recent = document.createElement("button");
    recent.type = "button";
    recent.className = "btn";
    recent.innerHTML = '<span class="av-side-icon" aria-hidden="true">◷</span><span class="av-side-text">Récemment vus</span>';
    recent.addEventListener("click", () => { const section=$("#resumeSection"); if(section){section.style.display="block";section.scrollIntoView({behavior:"smooth",block:"start"});} else $("#navLibrary")?.click(); });
    secondary.append(recent);
    const spacer = document.createElement("div");
    spacer.className = "av-sidebar-spacer";
    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "btn";
    logout.innerHTML = '<span class="av-side-icon" aria-hidden="true">↪</span><span class="av-side-text">Compte / connexion</span>';
    logout.addEventListener("click", () => $("#authOpen")?.click());
    sidebar.append(primary, secondary, spacer, logout);
    wrap.prepend(sidebar);

    const right = document.createElement("aside");
    right.id = "avRightSidebar";
    right.setAttribute("aria-label", "Suggestions d’animes");
    right.innerHTML = '<div class="av-rail-head"><strong>À découvrir</strong><span class="av-rail-label">ANIMEVERSE</span></div><label class="av-rail-search"><input id="avRailSearch" type="search" placeholder="⌕ Rechercher un anime…" aria-label="Rechercher un anime"></label><section class="av-rail-section"><h3>Populaires</h3><div id="avRailPopular"></div><a class="av-rail-more" href="/animes.html">Voir le catalogue</a></section><section class="av-rail-section"><h3>Explorer</h3><div id="avRailMovies"></div><a class="av-rail-more" href="/animes.html">Découvrir plus</a></section>';
    wrap.append(right);
    const popular = [
      ["One Piece","Aventure · Action","https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/one-piece.jpg"],
      ["Demon Slayer","Action · Fantastique","https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/demon-slayer.jpg"],
      ["Spy x Family","Comédie · Espionnage","https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/spy-x-family.jpg"]
    ];
    const movies = [
      ["Your Name","Romance · Drame","https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/your-name.jpg"],
      ["Jujutsu Kaisen","Action · Surnaturel","https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/jujutsu-kaisen.jpg"],
      ["Frieren","Aventure · Fantastique","https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/frieren.jpg"]
    ];
    const makeRailItems = (items, target) => {
      const container = $("#"+target);
      items.forEach(([title, meta, src]) => {
        const item = document.createElement("a");
        item.className = "av-rail-item";
        item.href = "/animes.html?q="+encodeURIComponent(title);
        const img = document.createElement("img");
        img.className = "av-rail-poster"; img.src = src; img.alt = ""; img.loading = "lazy";
        img.onerror = () => { img.removeAttribute("src"); img.style.background = "linear-gradient(145deg,#1d4932,#29202f)"; };
        const copy = document.createElement("span");
        const name = document.createElement("strong"); name.textContent = title;
        const detail = document.createElement("small"); detail.textContent = meta;
        const rating = document.createElement("small"); rating.className = "av-rating"; rating.textContent = "✦ À explorer";
        copy.append(name, detail, rating); item.append(img, copy); container.append(item);
      });
    };
    makeRailItems(popular, "avRailPopular");
    makeRailItems(movies, "avRailMovies");
    const railSearch = $("#avRailSearch");
    railSearch.addEventListener("keydown", event => {
      if (event.key === "Enter" && railSearch.value.trim()) location.href = "/animes.html?q="+encodeURIComponent(railSearch.value.trim());
    });
    const activeNav = () => {
      const view = ["libraryView","chatView","videosView","calendarView"].find(id => { const e=$("#"+id); return e && !e.classList.contains("hidden"); });
      const map = {libraryView:"navLibrary",chatView:"navChat",videosView:"navVideos",calendarView:"navCalendar"};
      $$("#avLeftSidebar .av-nav-group button").forEach(b => b.removeAttribute("aria-current"));
      if (map[view]) $("#"+map[view])?.setAttribute("aria-current","page");
    };
    document.addEventListener("click", event => {
      if (event.target.closest("#navLibrary,#navChat,#navVideos,#navCalendar")) setTimeout(activeNav, 30);
    });
    const views = ["#libraryView","#chatView","#videosView","#calendarView"].map($).filter(Boolean);
    if (views.length) new MutationObserver(activeNav).observe(wrap,{subtree:true,attributes:true,attributeFilter:["class"]});
    activeNav();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true});
  else init();
})();