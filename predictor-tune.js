(() => {
  const RANGE_STORAGE='zukka-key-song-ranges-v1';
  const DATA_STORAGE='zukka-key-data-v1';

  if(typeof window.runPrediction!=='function')return;
  const originalRunPrediction=window.runPrediction;

  const norm=(v)=>String(v||'').normalize('NFKC').toLowerCase()
    .replace(/[\s　・･\-–—_「」『』【】()[\]（）"'’.,，。!！?？〜～]/g,'');

  const noteNames=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const midiLabel=(m)=>{
    const n=Number(m);
    return Number.isFinite(n)?noteNames[(n%12+12)%12]+(Math.floor(n/12)-1):'—';
  };

  function rangeForCurrentSong(){
    try{
      const title=document.getElementById('songTitle')?.value?.trim()||'';
      const artist=document.getElementById('artist')?.value?.trim()||'';
      const lib=JSON.parse(localStorage.getItem(RANGE_STORAGE)||'{}');
      return lib[`${norm(artist)}::${norm(title)}`]||null;
    }catch(_){return null;}
  }

  function hasConfirmedSameSong(){
    try{
      const title=document.getElementById('songTitle')?.value?.trim()||'';
      const artist=document.getElementById('artist')?.value?.trim()||'';
      const d=JSON.parse(localStorage.getItem(DATA_STORAGE)||'{}');
      return (d.logs||[]).some(x=>
        Number(x.rating||0)>=4 &&
        norm(x.title)===norm(title) &&
        norm(x.artist)===norm(artist)
      );
    }catch(_){return false;}
  }

  window.runPrediction=function(opts={}){
    // Never interfere with a confirmed personal result.
    if(opts.confirmedLog || hasConfirmedSameSong()){
      return originalRunPrediction(opts);
    }

    const meta=rangeForCurrentSong();
    const chest=document.getElementById('chestPeak');
    const chorus=document.getElementById('chorusTop');

    // ZUKKA rule:
    // An isolated very high chest note (A#4/B4 and above) should not be treated
    // the same as a repeated chest ceiling. Keep the real max visible, but score
    // the song using the repeated chorus ceiling. This is intentionally narrow
    // so normal songs and "花束のかわりにメロディーを" keep their existing behavior.
    const rawPeak=Number(meta?.rawPeak ?? meta?.peak);
    const commonHigh=Number(meta?.chorus);
    const useOneOffTolerance=
      !!meta?.oneOffPeak &&
      Number.isFinite(rawPeak) &&
      Number.isFinite(commonHigh) &&
      rawPeak>=70 &&               // A#4 or above
      rawPeak-commonHigh>=2 &&
      chest && chorus;

    if(!useOneOffTolerance){
      return originalRunPrediction(opts);
    }

    const originalPeakValue=chest.value;
    const effectivePeak=commonHigh;

    try{
      chest.value=String(effectivePeak);
      originalRunPrediction(opts);
    }finally{
      chest.value=originalPeakValue;
    }

    const reason=document.getElementById('resultReason');
    if(reason){
      reason.textContent=
        `地声最高 ${midiLabel(rawPeak)} は1回型なので、ずっか判定では繰り返し使う ${midiLabel(commonHigh)} を主に評価。`+
        ` 一瞬の最高音だけで下げすぎない補正を入れています。`;
    }

    const metaEl=document.getElementById('resultMeta');
    if(metaEl){
      const extra=`実音域ピーク ${midiLabel(rawPeak)}（1回） / 判定ピーク ${midiLabel(effectivePeak)}`;
      metaEl.textContent=metaEl.textContent ? `${metaEl.textContent} / ${extra}` : extra;
    }
  };

  // If the user saves a trial after one-off-peak tuning, restore the real chest
  // max in the log form rather than the temporary effective peak.
  const saveBtn=document.getElementById('saveTrialBtn');
  if(saveBtn && typeof saveBtn.onclick==='function'){
    const originalSave=saveBtn.onclick;
    saveBtn.onclick=function(...args){
      const meta=rangeForCurrentSong();
      const result=originalSave.apply(this,args);
      if(meta?.oneOffPeak && Number.isFinite(Number(meta.rawPeak ?? meta.peak))){
        const logPeak=document.getElementById('logPeak');
        if(logPeak)logPeak.value=String(Number(meta.rawPeak ?? meta.peak));
      }
      return result;
    };
  }
})();