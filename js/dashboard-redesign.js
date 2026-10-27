/* Animeverse premium navigation, preserving the existing app controls and IDs. */
(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const icon=(name)=>{const paths={
home:'<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
collection:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
play:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.5-4A8.5 8.5 0 1 1 21 11.5Z"/>',
list:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
logout:'<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>'
};return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.grid)+'</svg>'};
function init(){
 const wrap=$('.wrap'),header=$('.top'),brand=$('.top .brand');if(!wrap||!header||$('#avLeftSidebar'))return;
 const sidebar=document.createElement('aside');sidebar.id='avLeftSidebar';sidebar.setAttribute('aria-label','Navigation principale');
 if(brand){brand.classList.add('av-brand');sidebar.append(brand)}
 const group=(label)=>{const g=document.createElement('div');g.className='av-nav-group';g.innerHTML='<div class="av-nav-label">'+label+'</div>';return g};
 const primary=group('Découvrir'),library=group('Ta bibliothèque'),account=group('Compte'),actions=$('#headActions');
 const decorate=(b,label,ico)=>{if(!b)return;b.classList.remove('primary');b.setAttribute('aria-label',label);b.setAttribute('title',label);b.innerHTML='<span class="av-side-icon" aria-hidden="true">'+icon(ico)+'</span><span class="av-side-text">'+label+'</span>';return b};
 const move=(id,g,label,ico)=>{const b=decorate($('#'+id),label,ico);if(b)g.append(b)};
 move('navLibrary',primary,'Accueil','home');move('navChat',primary,'Communauté','chat');move('navVideos',primary,'Vidéos','play');move('navCalendar',primary,'Calendrier','calendar');
 const makeAction=(g,label,ico,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn av-side-action';b.setAttribute('aria-label',label);b.title=label;b.innerHTML='<span class="av-side-icon" aria-hidden="true">'+icon(ico)+'</span><span class="av-side-text">'+label+'</span>';b.addEventListener('click',fn);g.append(b);return b};
 makeAction(library,'Collection','collection',()=>{ $('#navLibrary')?.click();$('#search')?.focus();document.querySelector('#collection')?.scrollIntoView({behavior:'smooth',block:'start'})});
 makeAction(library,'En cours','play',()=>{ $('#navLibrary')?.click();const f=$('#statusFilter');if(f){f.value='En cours';f.dispatchEvent(new Event('change',{bubbles:true}))}document.querySelector('#collection')?.scrollIntoView({behavior:'smooth',block:'start'})});
 makeAction(library,'Catalogue','search',()=>{document.querySelector('.catalogue')?.scrollIntoView({behavior:'smooth',block:'start'})});
 makeAction(library,'Listes','list',()=>{$('#navLibrary')?.click();document.querySelector('#collection')?.scrollIntoView({behavior:'smooth',block:'start'})});
 makeAction(library,'Historique','clock',()=>{const e=$('#resumeSection');if(e){e.style.display='block';e.scrollIntoView({behavior:'smooth',block:'start'})}});
 const spacer=document.createElement('div');spacer.className='av-sidebar-spacer';
 const logout=makeAction(account,'Déconnexion','logout',async()=>{const client=window.__animeverseAssistantBridge?.getClient?.();if(client){const {error}=await client.auth.signOut();if(error)console.error('Déconnexion impossible',error)}else $('#authOpen')?.click()});
 sidebar.append(primary,library,spacer,account);wrap.prepend(sidebar);
 const right=document.createElement('aside');right.id='avRightSidebar';right.setAttribute('aria-label','Suggestions d’animes');
 right.innerHTML='<div class="av-rail-head"><strong>À découvrir</strong><span class="av-rail-label">ANIMEVERSE</span></div><label class="av-rail-search"><input id="avRailSearch" type="search" placeholder="Rechercher un anime…" aria-label="Rechercher un anime"></label><section class="av-rail-section"><h3>Populaires</h3><div id="avRailPopular"></div><a class="av-rail-more" href="/animes.html">Voir le catalogue</a></section><section class="av-rail-section"><h3>Explorer</h3><div id="avRailMovies"></div><a class="av-rail-more" href="/animes.html">Découvrir plus</a></section>';wrap.append(right);
 const recs={avRailPopular:[['One Piece','Aventure · Action','https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/one-piece.jpg'],['Demon Slayer','Action · Fantastique','https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/demon-slayer.jpg'],['Spy x Family','Comédie · Espionnage','https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/spy-x-family.jpg']],avRailMovies:[['Your Name','Romance · Drame','https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/your-name.jpg'],['Jujutsu Kaisen','Action · Surnaturel','https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/jujutsu-kaisen.jpg'],['Frieren','Aventure · Fantastique','https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/frieren.jpg']]};
 for(const [target,items] of Object.entries(recs)){const box=$('#'+target);for(const [title,meta,src]of items){const a=document.createElement('a');a.className='av-rail-item';a.href='/animes.html?q='+encodeURIComponent(title);const img=new Image();img.className='av-rail-poster';img.loading='lazy';img.alt='';img.src=src;img.onerror=()=>img.removeAttribute('src');const copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=title;detail.textContent=meta;copy.append(name,detail);a.append(img,copy);box.append(a)}}
 const railSearch=$('#avRailSearch');railSearch?.addEventListener('keydown',e=>{if(e.key==='Enter'&&railSearch.value.trim())location.href='/animes.html?q='+encodeURIComponent(railSearch.value.trim())});
 // Compact mobile dock; each action delegates to the original control or the desktop action.
 const dock=document.createElement('nav');dock.className='av-mobile-dock';dock.setAttribute('aria-label','Navigation mobile');
 const dockButton=(label,ico,fn)=>{const b=document.createElement('button');b.type='button';b.className='av-dock-item';b.title=label;b.setAttribute('aria-label',label);b.innerHTML=icon(ico)+'<span>'+label+'</span>';b.addEventListener('click',fn);dock.append(b);return b};
 dockButton('Accueil','home',()=>$('#navLibrary')?.click());dockButton('Collection','collection',()=>sidebar.querySelector('[aria-label="Collection"]')?.click());dockButton('En cours','play',()=>sidebar.querySelector('[aria-label="En cours"]')?.click());dockButton('Catalogue','search',()=>sidebar.querySelector('[aria-label="Catalogue"]')?.click());
 const more=dockButton('Plus','plus',()=>{sidebar.classList.toggle('av-mobile-open');more.setAttribute('aria-expanded',String(sidebar.classList.contains('av-mobile-open')))});more.setAttribute('aria-expanded','false');document.body.append(dock);
 const active=()=>{const view=['libraryView','chatView','videosView','calendarView'].find(id=>{const e=$('#'+id);return e&&!e.classList.contains('hidden')});const map={libraryView:'navLibrary',chatView:'navChat',videosView:'navVideos',calendarView:'navCalendar'};$$('#avLeftSidebar button[aria-current]').forEach(b=>b.removeAttribute('aria-current'));const target=$('#'+map[view]);target?.setAttribute('aria-current','page');const name=target?.getAttribute('aria-label');dock.querySelectorAll('.av-dock-item').forEach(b=>b.classList.toggle('is-active',b.getAttribute('aria-label')===name))}
 document.addEventListener('click',e=>{if(e.target.closest('#navLibrary,#navChat,#navVideos,#navCalendar'))setTimeout(active,40);if(!e.target.closest('#avLeftSidebar,.av-mobile-dock'))sidebar.classList.remove('av-mobile-open')});
 const views=['#libraryView','#chatView','#videosView','#calendarView'].map(q=>$(q)).filter(Boolean);if(views.length)new MutationObserver(active).observe(wrap,{subtree:true,attributes:true,attributeFilter:['class']});active();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();