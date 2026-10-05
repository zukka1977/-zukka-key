const CACHE='zukka-key-v4.4.2';
const CORE_ASSETS=[
  './','./index.html',
  './styles.css?v=4.4.2',
  './app.js?v=4.4.2',
  './range-lookup.js?v=4.4.2'
];
const OPTIONAL_ASSETS=[
  './manifest.webmanifest?v=4.4.2',
  './icon-180.png','./icon-192.png','./icon-512.png'
];

async function cacheIndividually(cache,assets){
  await Promise.allSettled(assets.map(async asset=>{
    try{
      const response=await fetch(asset,{cache:'reload'});
      if(response&&response.ok)await cache.put(asset,response.clone());
    }catch(_){/* Optional/offline fetch failure must not break SW install. */}
  }));
}

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cacheIndividually(cache,CORE_ASSETS);
    await cacheIndividually(cache,OPTIONAL_ASSETS);
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('zukka-key-')&&k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ]));
});

self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  // Network-first keeps a GitHub Pages style deployment fresh; exact cache is
  // the offline fallback. Navigation falls back to the cached app shell.
  event.respondWith(fetch(req).then(response=>{
    if(response&&response.ok){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
    }
    return response;
  }).catch(async()=>{
    const exact=await caches.match(req);
    if(exact)return exact;
    if(req.mode==='navigate')return caches.match('./index.html');
    return Response.error();
  }));
});
