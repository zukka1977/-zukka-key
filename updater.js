const ZUKKA_APP_VERSION='4.1.0';
const ZUKKA_APP_BUILD='2026-10-04.1';

(() => {
  const versionEl=document.getElementById('appVersion');
  const statusEl=document.getElementById('updateStatus');
  if(versionEl)versionEl.textContent='v'+ZUKKA_APP_VERSION;

  let checking=false;

  async function refreshServiceWorker(){
    if(!('serviceWorker' in navigator))return null;
    try{
      const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
      await reg.update();
      if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
      return reg;
    }catch(_){
      return null;
    }
  }

  async function checkForUpdate(){
    if(checking)return;
    checking=true;
    try{
      const res=await fetch('./version.json?t='+Date.now(),{cache:'no-store'});
      if(!res.ok)throw new Error('version check failed');
      const remote=await res.json();
      const remoteVersion=String(remote.version||'').trim();

      if(remoteVersion && remoteVersion!==ZUKKA_APP_VERSION){
        if(statusEl)statusEl.textContent='v'+remoteVersion+'へ更新中…';
        await refreshServiceWorker();

        const reloadKey='zukka-key-reload-'+remoteVersion;
        if(!sessionStorage.getItem(reloadKey)){
          sessionStorage.setItem(reloadKey,'1');
          const url=new URL(location.href);
          url.searchParams.set('v',remoteVersion);
          url.searchParams.set('refresh',Date.now().toString());
          location.replace(url.href);
          return;
        }
        if(statusEl)statusEl.textContent='更新あり・再起動してください';
      }else{
        if(statusEl)statusEl.textContent='最新版';
      }
    }catch(_){
      if(statusEl)statusEl.textContent=navigator.onLine?'更新確認失敗':'オフライン';
    }finally{
      checking=false;
    }
  }

  window.addEventListener('load',async()=>{
    await refreshServiceWorker();
    setTimeout(checkForUpdate,400);
  });

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')checkForUpdate();
  });

  window.addEventListener('online',checkForUpdate);
})();
