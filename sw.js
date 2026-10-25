const CACHE='animeverse-shell-v1';
const SHELL=['/','/index.html','/manifest.webmanifest','/icons/animeverse-192.svg','/icons/animeverse-512.svg'];
const API_HOSTS=['supabase.co','anilist.co'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('animeverse-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
function isApi(url){return API_HOSTS.some(host=>url.hostname===host||url.hostname.endsWith('.'+host))||url.pathname.startsWith('/rest/v1/')||url.pathname.startsWith('/auth/v1/')||url.hostname==='graphql.anilist.co'}
async function cacheFirst(request){const cache=await caches.open(CACHE);const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok&&(response.type==='basic'||response.type==='cors'))cache.put(request,response.clone());return response}
async function pageFirst(request){const cache=await caches.open(CACHE);try{const response=await fetch(request);if(response.ok)cache.put('/',response.clone());return response}catch(error){return (await cache.match(request))||(await cache.match('/'))||Response.error()}}
self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(isApi(url))return;if(url.origin===self.location.origin){if(request.mode==='navigate'){event.respondWith(pageFirst(request));return}event.respondWith(cacheFirst(request));return}if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com')event.respondWith(cacheFirst(request))});
