const CACHE='zukka-key-v4.2.6';
const ASSETS=[
  './','./index.html',
  './styles.css?v=4.2.6',
  './app.js?v=4.2.6',
  './hotfix.js?v=4.2.6',
  './range-lookup.js?v=4.2.6',
  './predictor-tune.js?v=4.2.6',
  './updater.js?v=4.2.6',
  './version.json',
  './manifest.webmanifest?v=4.2.6',
  './icon-180.png','./icon-192.png','./icon-512.png'
];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('zukka-key-')&&k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.endsWith('/version.json')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match('./version.json')));
    return;
  }
  event.respondWith(fetch(req).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(req,copy));
    return response;
  }).catch(async()=>{
    const exact=await caches.match(req);
    if(exact)return exact;
    if(req.mode==='navigate')return caches.match('./index.html');
    return Response.error();
  }));
});
