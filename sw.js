/* Service worker del CRM: permite instalarlo como app y que abra offline.
   Estrategia: red primero (para datos frescos), con respaldo a caché si no hay internet.
   Las llamadas a /api/ SIEMPRE van a la red (nunca se cachean). */
const CACHE='riders-crm-v1';
const ASSETS=['/','/index.html','/manifest.json','/icon-192.png','/icon-512.png','/icon-180.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.pathname.indexOf('/api/')===0)return; // API y no-GET: siempre red
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r&&r.ok&&url.origin===location.origin){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));}
      return r;
    }).catch(()=>caches.match(e.request).then(m=>m||caches.match('/index.html')))
  );
});
