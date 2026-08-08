/* Service worker del CRM: permite instalarlo como app y que abra offline.
   Estrategia: red primero (para datos frescos), con respaldo a caché si no hay internet.
   Las llamadas a /api/ SIEMPRE van a la red (nunca se cachean). */
const CACHE='riders-crm-v2';
const ASSETS=['/','/index.html','/manifest.json','/icon-192.png','/icon-512.png','/icon-180.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// Notificaciones push: mostrarlas como aviso del teléfono y abrir la app al tocarlas.
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{};}catch(x){d={title:'Riders CRM',body:(e.data&&e.data.text&&e.data.text())||''};}
  e.waitUntil(self.registration.showNotification(d.title||'Riders CRM',{body:d.body||'',icon:'/icon-192.png',badge:'/icon-192.png',data:d,vibrate:[80,40,80]}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{for(const w of ws){if('focus'in w)return w.focus();}if(clients.openWindow)return clients.openWindow('/');}));
});
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
