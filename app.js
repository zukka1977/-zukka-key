const APP_VERSION='4.4.3';
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const STORAGE_KEY='zukka-key-data-v1';
const RANGE_STORAGE='zukka-key-song-ranges-v1';
const API_KEY_STORAGE='zukka-key-getsong-api-key';
const API_BASE='https://api.getsong.co';

const defaultData={
  profile:{preferredChorusLow:64,preferredChorusHigh:66,preferredPeakLow:66,preferredPeakHigh:67,caution:68,minComfortLow:48},
  logs:[
    {title:'化粧',artist:'清水翔太',shift:-1,rating:5,chorus:66,peak:67,falsetto:69,low:50,density:3,memo:'-1がベスト。実測。',seed:true},
    {title:'駅',artist:'徳永英明',shift:-1,rating:5,chorus:66,peak:67,falsetto:null,low:48,density:3,memo:'-1がドンピシャ。実測。',seed:true},
    {title:'会いたい',artist:'徳永英明',shift:0,rating:5,chorus:65,peak:67,falsetto:null,low:49,density:2,memo:'原キー0がドンピシャ。実測。',seed:true},
    {title:'OH MY LITTLE GIRL',artist:'尾崎豊',shift:-1,rating:4,chorus:66,peak:67,falsetto:null,low:49,density:4,memo:'-1が歌いやすい。',seed:true},
    {title:'君がいるだけで',artist:'米米CLUB',shift:0,rating:5,chorus:67,peak:68,falsetto:67,low:50,density:4,memo:'原キーがかなり歌いやすい。終盤転調もOK。',seed:true},
    {title:'今夜の涙は最高',artist:'チェッカーズ',shift:0,rating:5,chorus:66,peak:67,falsetto:70,low:50,density:3,memo:'原キーがいい感じ。フェイク高音は別枠。',seed:true},
    {title:'メロディー',artist:'玉置浩二',shift:0,rating:5,chorus:65,peak:66,falsetto:null,low:48,density:2,memo:'原キーがとても合う基準曲。',seed:true},
    {title:'プルシアンブルーの肖像',artist:'安全地帯',shift:0,rating:5,chorus:64,peak:65,falsetto:null,low:47,density:2,memo:'原キーが合う基準曲。',seed:true}
  ]
};

let data=loadData();
let rangeLibrary=loadRanges();
let lastPrediction=null;
let lastApiSong=null;
let currentRangeSource='manual';

function clone(v){return JSON.parse(JSON.stringify(v));}
function loadData(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY));return v&&v.logs?v:clone(defaultData)}catch{return clone(defaultData)}}
function loadRanges(){try{return JSON.parse(localStorage.getItem(RANGE_STORAGE))||{}}catch{return {}}}
function saveData(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));refreshAll();}
function saveRanges(){localStorage.setItem(RANGE_STORAGE,JSON.stringify(rangeLibrary));}
function noteName(midi){if(midi===null||midi===undefined||midi==='')return 'なし';const n=Number(midi);return NOTE_NAMES[n%12]+(Math.floor(n/12)-1)}
function shiftLabel(v){v=Number(v);return v===0?'±0':v>0?`+${v}`:`${v}`}
function normalizeText(v){return String(v||'').normalize('NFKC').toLowerCase().replace(/[\s　・･\-–—_・「」『』()（）]/g,'')}
function songIdentity(title,artistName){return `${normalizeText(artistName)}::${normalizeText(title)}`}
function populateNoteSelect(el,min=43,max=76,none=false,selected=null,placeholder=false){
  el.innerHTML='';
  if(placeholder&&!none){const o=document.createElement('option');o.value='';o.textContent='選択してください';el.append(o)}
  if(none){const o=document.createElement('option');o.value='';o.textContent='なし';el.append(o)}
  for(let i=min;i<=max;i++){const o=document.createElement('option');o.value=i;o.textContent=noteName(i);if(selected!==null&&Number(selected)===i)o.selected=true;el.append(o)}
  if(selected===null&&!none)el.value=placeholder?'':String(Math.min(max,Math.max(min,67)));
}
function populateShifts(){const el=document.getElementById('logShift');el.innerHTML='';for(let i=-6;i<=6;i++){const o=document.createElement('option');o.value=i;o.textContent=shiftLabel(i);el.append(o)}}
function setupSelects(){
  // New songs start blank: default notes must never be mistaken for real song data.
  populateNoteSelect(chorusTop,55,73,false,null,true);populateNoteSelect(chestPeak,55,76,false,null,true);populateNoteSelect(falsettoPeak,55,79,true,null);populateNoteSelect(lowNote,40,60,false,null,true);
  populateNoteSelect(logChorus,55,73,false,66);populateNoteSelect(logPeak,55,76,false,67);populateNoteSelect(logFalsetto,55,79,true,null);populateNoteSelect(logLow,40,60,false,48);populateShifts();
}

function getApiKey(){return localStorage.getItem(API_KEY_STORAGE)||''}
function setApiKey(){
  const current=getApiKey();
  const key=prompt('GetSongKEY APIキーを入力してください。\nこのキーはGitHubには保存せず、この端末内だけに保存します。',current);
  if(key===null)return false;
  const clean=key.trim();
  if(!clean){localStorage.removeItem(API_KEY_STORAGE);apiStatus.textContent='APIキーを削除しました。';return false}
  localStorage.setItem(API_KEY_STORAGE,clean);apiStatus.textContent='APIキーをこの端末に保存しました。';return true;
}
function artistNameOf(song){
  const a=song&&song.artist;if(!a)return '';
  if(Array.isArray(a))return a.map(x=>x&&x.name).filter(Boolean).join(', ');
  return a.name||String(a);
}
function songMatchScore(song,title,artistName){
  const nt=normalizeText(title),na=normalizeText(artistName);
  const xt=normalizeText(song&&song.title),xa=normalizeText(artistNameOf(song));
  if(!nt||!xt)return -Infinity;
  let score=0;
  if(xt===nt)score+=60;
  else if(xt.includes(nt)||nt.includes(xt))score+=30;
  else return -Infinity;

  // Cover songs must match the requested artist. A title-only hit is never
  // auto-selected when the user supplied an artist name.
  if(na){
    if(xa===na)score+=60;
    else if(xa.includes(na)||na.includes(xa))score+=35;
    else return -Infinity;
  }
  return score;
}
function chooseBestSong(items,title,artistName){
  const ranked=[...items]
    .map(song=>({song,score:songMatchScore(song,title,artistName)}))
    .filter(x=>Number.isFinite(x.score))
    .sort((a,b)=>b.score-a.score);
  return ranked[0]?.song||null;
}

function findGoodLog(title,artistName){
  const key=songIdentity(title,artistName);
  return data.logs.filter(l=>songIdentity(l.title,l.artist)===key&&l.rating>=4).sort((a,b)=>b.rating-a.rating)[0]||null;
}
function deriveRangeFromLog(log){
  if(!log)return null;
  return {chorus:Number(log.chorus)-Number(log.shift),peak:Number(log.peak)-Number(log.shift),falsetto:log.falsetto==null?null:Number(log.falsetto)-Number(log.shift),low:Number(log.low)-Number(log.shift),density:Number(log.density||3),source:'歌唱履歴から復元',confidence:log.rating===5?'高':'中'};
}
function findRangeData(title,artistName){
  const id=songIdentity(title,artistName);
  if(rangeLibrary[id])return {...rangeLibrary[id],source:rangeLibrary[id].source||'端末保存'};
  const log=findGoodLog(title,artistName);
  if(log)return deriveRangeFromLog(log);
  return null;
}
function applyRangeToForm(r){
  if(!r)return;
  chorusTop.value=String(r.chorus);chestPeak.value=String(r.peak);falsettoPeak.value=r.falsetto==null?'':String(r.falsetto);lowNote.value=String(r.low);highDensity.value=String(r.density||3);highDensity.oninput();
}
function setRangeUi(range){
  if(range){
    rangeDataStatus.textContent='あり';rangeDataStatus.className='ok';
    rangeDataNote.textContent=`${range.source||'保存済み'} / 信頼度 ${range.confidence||'中'}。音域を自動入力しました。`;
    rangeSourceBadge.textContent=range.source||'保存済み';currentRangeSource=range.source||'saved';
  }else{
    rangeDataStatus.textContent='未登録';rangeDataStatus.className='warn';
    rangeDataNote.textContent='原曲キー/BPMだけでは歌いやすいキーは正確に決められません。下の音域を確認・修正して保存すれば次回から自動です。';
    rangeSourceBadge.textContent='手入力';currentRangeSource='manual';
  }
}
function rangeFormComplete(){return chorusTop.value!==''&&chestPeak.value!==''&&lowNote.value!=='';}
function clearRangeForm(){chorusTop.value='';chestPeak.value='';falsettoPeak.value='';lowNote.value='';highDensity.value='3';highDensity.oninput();rangeSourceBadge.textContent='手入力待ち';currentRangeSource='manual';}
function setPredictionPending(label='音域待ち'){personalKeyStatus.textContent=label;personalKeyStatus.className='warn';resultCard.classList.add('hidden');bestKey.textContent='—';resultTitle.textContent='音域を入力すると判定できます';resultReason.textContent='';alternatives.innerHTML='';lastPrediction=null;}
function renderApiCandidate(song){
  if(!song)return;
  lastApiSong=song;
  originalKey.textContent=song.key_of||'—';originalBpm.textContent=song.tempo||'—';apiSongLink.href=song.uri||'https://getsongbpm.com/';apiResult.classList.remove('hidden');
  if(song.title)songTitle.value=song.title;const an=artistNameOf(song);if(an)artist.value=an;
  const range=findRangeData(song.title,an);setRangeUi(range);
  if(range)applyRangeToForm(range);
  const known=findGoodLog(song.title,an);
  if(known){personalKeyStatus.textContent=shiftLabel(known.shift);personalKeyStatus.className='ok';runPrediction({confirmedLog:known,scroll:false});}
  else if(range){runPrediction({scroll:false});personalKeyStatus.textContent=bestKey.textContent;personalKeyStatus.className='ok';}
  else{clearRangeForm();setPredictionPending('音域待ち');}
}
function renderApiCandidates(items,selectedId){
  apiCandidates.innerHTML='';
  for(const song of items){const o=document.createElement('option');o.value=song.id||'';const an=artistNameOf(song);o.textContent=`${song.title||'不明'} — ${an||'不明'}｜${song.key_of||'?'}｜${song.tempo||'?'} BPM`;if(song.id===selectedId)o.selected=true;apiCandidates.append(o)}
  apiCandidatesWrap.classList.toggle('hidden',items.length<=1);
  apiCandidates.onchange=()=>renderApiCandidate(items.find(x=>String(x.id)===apiCandidates.value));
}
async function autoLookup(){
  const title=songTitle.value.trim(),artistName=artist.value.trim();if(!title){alert('曲名を入れてください');return}
  let key=getApiKey();if(!key){if(!setApiKey())return;key=getApiKey();if(!key)return}
  autoLookupBtn.disabled=true;autoLookupBtn.textContent='検索中…';apiStatus.textContent='曲データを検索しています…';
  try{
    const params=new URLSearchParams();params.set('api_key',key);params.set('limit','8');
    if(artistName){params.set('type','both');params.set('lookup',`song:${title} artist:${artistName}`)}else{params.set('type','song');params.set('lookup',title)}
    const res=await fetch(`${API_BASE}/search/?${params.toString()}`,{method:'GET',mode:'cors',cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const payload=await res.json();const items=Array.isArray(payload.search)?payload.search:[];
    if(!items.length){apiResult.classList.add('hidden');resultCard.classList.add('hidden');apiStatus.textContent='一致する曲が見つかりませんでした。アーティスト名も入れて再検索してください。';return}
    const best=chooseBestSong(items,title,artistName);
    renderApiCandidates(items,best&&best.id);
    if(!best){
      lastApiSong=null;
      apiResult.classList.remove('hidden');
      originalKey.textContent='—';originalBpm.textContent='—';
      rangeDataStatus.textContent='歌手確認待ち';rangeDataStatus.className='warn';
      setPredictionPending('判定保留');
      rangeDataNote.textContent='同名曲は見つかりましたが、入力したアーティスト版と確認できません。カバー曲の取り違え防止のため自動採用しません。';
      resultCard.classList.add('hidden');
      apiStatus.textContent='曲名は見つかりましたが、指定したアーティスト版を確認できませんでした。検索候補を確認するか、表記を調整してください。';
      return;
    }
    renderApiCandidate(best);
    const known=findGoodLog(songTitle.value,artist.value),range=findRangeData(songTitle.value,artist.value);
    apiStatus.textContent=known?'過去の歌唱実績を発見。実測キーを最優先で表示しました。':range?'歌手版データ＋保存済み音域から、ずっか推奨キーまで自動判定しました。':'歌手版キー/BPMは取得済み。音域は未登録なので、WEB音域検索または手入力で続行します。';
  }catch(err){console.error(err);apiStatus.textContent='自動取得に失敗しました。APIキーまたは通信状態を確認してください。';}
  finally{autoLookupBtn.disabled=false;autoLookupBtn.textContent='曲データ取得 → ずっか判定'}
}

function candidateScore(song,shift){
  const p=data.profile;const chorus=song.chorus+shift,peak=song.peak+shift,low=song.low+shift,density=song.density;let score=100;
  const cTarget=(p.preferredChorusLow+p.preferredChorusHigh)/2+(density<=2?0.5:0);score-=Math.abs(chorus-cTarget)*8;
  const peakTarget=density>=4?p.preferredPeakLow:(density<=2?p.preferredPeakHigh:(p.preferredPeakLow+p.preferredPeakHigh)/2);score-=Math.abs(peak-peakTarget)*10;
  if(peak>=p.caution)score-=(peak-p.caution+1)*(density>=4?13:8);if(low<p.minComfortLow)score-=(p.minComfortLow-low)*7;
  if(song.falsetto!=null){const f=song.falsetto+shift;if(f>74)score-=(f-74)*2.5}score-=Math.abs(shift)*1.2;
  const good=data.logs.filter(l=>l.rating>=4&&Number.isFinite(l.chorus)&&Number.isFinite(l.peak));
  if(good.length){let totalW=0,weighted=0;for(const l of good){const originalChorus=l.chorus-l.shift,originalPeak=l.peak-l.shift;const dist=Math.abs(song.chorus-originalChorus)*1.2+Math.abs(song.peak-originalPeak)*1.6+Math.abs(song.low-(l.low-l.shift))*.35+Math.abs(song.density-(l.density||3))*.8;const w=(l.rating-2)/Math.pow(1+dist,1.35);totalW+=w;weighted+=w*l.shift}if(totalW>0){const learned=weighted/totalW;score-=Math.abs(shift-learned)*(good.length>=5?6.5:4.5)}}
  return score;
}
function predict(song){const list=[];for(let s=-6;s<=6;s++)list.push({shift:s,score:candidateScore(song,s)});list.sort((a,b)=>b.score-a.score);return list.slice(0,3)}
function buildReason(song,best,confirmedLog=null){
  if(confirmedLog)return `この曲は過去に ${shiftLabel(confirmedLog.shift)} で「${confirmedLog.rating===5?'ドンピシャ':'歌いやすい'}」と実測済み。モデル予測より実際の歌唱結果を優先しています。`;
  const s=best.shift,c=song.chorus+s,p=song.peak+s,l=song.low+s;let bits=[];bits.push(`サビ高音が ${noteName(c)}、地声ピークが ${noteName(p)} に来ます。`);
  if(song.density>=4)bits.push('高音が多い曲なので、ピークを少し余裕側に置いています。');else if(song.density<=2)bits.push('高音が一瞬型なので、ピークはG4付近まで許容しています。');
  if(song.falsetto!=null)bits.push(`裏声の ${noteName(song.falsetto+s)} は別枠として軽く評価しています。`);if(l<48)bits.push('低音がかなり下がるので、低く感じたら次点も試してください。');return bits.join(' ');
}
function currentSongFromForm(){return {title:songTitle.value.trim()||'この曲',artist:artist.value.trim(),chorus:chorusTop.value===''?null:+chorusTop.value,peak:chestPeak.value===''?null:+chestPeak.value,falsetto:falsettoPeak.value===''?null:+falsettoPeak.value,low:lowNote.value===''?null:+lowNote.value,density:+highDensity.value}}
function runPrediction(opts={}){
  const song=currentSongFromForm();const confirmedLog=opts.confirmedLog||findGoodLog(song.title,song.artist);
  if(!confirmedLog&&!rangeFormComplete()){setPredictionPending('音域待ち');if(opts.silent!==true)apiStatus.textContent='おすすめキーを出すには、サビ高音・地声最高音・最低音を入力してください。';return null;}
  let top=predict(song);
  if(confirmedLog){const confirmed={shift:Number(confirmedLog.shift),score:999};top=[confirmed,...top.filter(x=>x.shift!==confirmed.shift)].slice(0,3)}
  lastPrediction={song,top};bestKey.textContent=shiftLabel(top[0].shift);resultTitle.textContent=confirmedLog?`実測ベスト ${shiftLabel(top[0].shift)}`:`おすすめは ${shiftLabel(top[0].shift)}`;resultReason.textContent=buildReason(song,top[0],confirmedLog);
  alternatives.innerHTML=top.slice(1).map((x,i)=>`<div class="alt"><span>${i===0?'次点':'第3候補'}</span><strong>${shiftLabel(x.shift)}</strong></div>`).join('');
  const meta=[];if(lastApiSong&&songIdentity(lastApiSong.title,artistNameOf(lastApiSong))===songIdentity(song.title,song.artist)){if(lastApiSong.key_of)meta.push(`歌手版 ${lastApiSong.key_of}`);if(lastApiSong.tempo)meta.push(`${lastApiSong.tempo} BPM`)}meta.push(`音域: ${currentRangeSource==='manual'?'手入力':currentRangeSource}`);resultMeta.textContent=meta.join(' / ');
  resultCard.classList.remove('hidden');personalKeyStatus.textContent=shiftLabel(top[0].shift);personalKeyStatus.className='ok';if(opts.scroll!==false)resultCard.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function saveCurrentRange(){
  const title=songTitle.value.trim(),artistName=artist.value.trim();if(!title){alert('先に曲名を入れてください');return}
  if(!rangeFormComplete()){alert('サビ高音・地声最高音・最低音を入力してください。');setPredictionPending('音域待ち');return}
  const s=currentSongFromForm();const id=songIdentity(title,artistName);rangeLibrary[id]={chorus:s.chorus,peak:s.peak,falsetto:s.falsetto,low:s.low,density:s.density,source:'手動確認済み',confidence:'高',sourceQuality:100,manualConfirmed:true,savedAt:new Date().toISOString(),title,artist:artistName};saveRanges();setRangeUi(rangeLibrary[id]);apiStatus.textContent='この曲の音域を保存しました。次回から曲名検索だけで推奨キーまで自動判定できます。';runPrediction();
}
function addLogFromForm(){
  const title=logTitle.value.trim();if(!title){alert('曲名を入れてください');return}const shift=+logShift.value;
  data.logs.unshift({title,artist:logArtist.value.trim(),shift,rating:+logRating.value,chorus:+logChorus.value+shift,peak:+logPeak.value+shift,falsetto:logFalsetto.value===''?null:+logFalsetto.value+shift,low:+logLow.value+shift,density:3,memo:logMemo.value.trim(),seed:false});saveData();logTitle.value='';logArtist.value='';logMemo.value='';alert('学習データに追加しました');
}
function savePredictedTrial(){if(!lastPrediction)return;const {song,top}=lastPrediction;switchTab('log');logTitle.value=song.title;logArtist.value=song.artist;logShift.value=top[0].shift;logChorus.value=song.chorus;logPeak.value=song.peak;logFalsetto.value=song.falsetto??'';logLow.value=song.low;logMemo.value=`予測 ${shiftLabel(top[0].shift)}。歌った後に評価を選んで保存。`;}
function renderLogs(){
  logList.innerHTML=data.logs.map((l,i)=>`<article class="log-item"><div class="log-head"><div><div class="log-title">${escapeHtml(l.title)}</div><div class="log-artist">${escapeHtml(l.artist||'')}</div></div><div class="log-key">${shiftLabel(l.shift)}</div></div><div class="stars">${'★'.repeat(l.rating)}${'☆'.repeat(5-l.rating)}</div><div class="log-meta">サビ ${noteName(l.chorus)} / 地声ピーク ${noteName(l.peak)}${l.falsetto!=null?` / 裏声 ${noteName(l.falsetto)}`:''} / 最低 ${noteName(l.low)}</div>${l.memo?`<div class="log-memo">${escapeHtml(l.memo)}</div>`:''}${!l.seed?`<button class="text-button delete-log" data-i="${i}">削除</button>`:''}</article>`).join('');document.querySelectorAll('.delete-log').forEach(b=>b.onclick=()=>{data.logs.splice(+b.dataset.i,1);saveData()});
}
function learnProfile(){
  const good=data.logs.filter(l=>l.rating>=4);if(!good.length)return;const weightedMedian=(vals)=>{vals.sort((a,b)=>a.v-b.v);const total=vals.reduce((s,x)=>s+x.w,0);let a=0;for(const x of vals){a+=x.w;if(a>=total/2)return x.v}return vals.at(-1).v};
  const chorusMed=weightedMedian(good.map(l=>({v:l.chorus,w:l.rating}))),peakMed=weightedMedian(good.map(l=>({v:l.peak,w:l.rating})));data.profile.preferredChorusLow=Math.max(62,chorusMed-2);data.profile.preferredChorusHigh=Math.min(67,chorusMed);data.profile.preferredPeakLow=Math.max(65,peakMed-1);data.profile.preferredPeakHigh=Math.min(68,peakMed);data.profile.caution=Math.max(68,data.profile.preferredPeakHigh+1);
}
function refreshProfile(){
  learnProfile();const p=data.profile,good=data.logs.filter(l=>l.rating>=4),confidence=Math.min(96,58+good.length*3);sweetSpot.textContent=`${noteName(p.preferredPeakLow)}〜${noteName(p.preferredPeakHigh)}`;confidenceValue.textContent=confidence;confidenceBar.style.width=confidence+'%';statChorus.textContent=`${noteName(p.preferredChorusLow)}〜${noteName(p.preferredChorusHigh)}`;statPeak.textContent=`${noteName(p.preferredPeakLow)}〜${noteName(p.preferredPeakHigh)}`;statCaution.textContent=`${noteName(p.caution)}〜`;statSongs.textContent=data.logs.length;profileSummary.textContent=`サビの主戦場 ${noteName(p.preferredChorusLow)}〜${noteName(p.preferredChorusHigh)} / 地声ピーク ${noteName(p.preferredPeakLow)}〜${noteName(p.preferredPeakHigh)}。${noteName(p.caution)}以上は曲中の密度で判断。`;insightText.innerHTML=`<strong>現在の学習：</strong><br>最高音だけではなく、サビの常用高音・地声ピーク・高音密度・低音を重視。過去に実際に歌って高評価だった同一曲は、その実測キーを最優先します。`;localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
}
function refreshAll(){renderLogs();refreshProfile();}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function switchTab(name){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));document.getElementById(name+'Panel').classList.add('active');window.scrollTo({top:0,behavior:'smooth'})}
function exportData(){const payload={app:'ZUKKA KEY',version:4,data,rangeLibrary};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='zukka-key-backup-v4.json';a.click();URL.revokeObjectURL(a.href)}
function importData(file){const r=new FileReader();r.onload=()=>{try{const v=JSON.parse(r.result);if(v.data&&v.data.logs){data=v.data;rangeLibrary=v.rangeLibrary||{};}else if(v.logs){data=v;}else throw new Error();localStorage.setItem(STORAGE_KEY,JSON.stringify(data));saveRanges();refreshAll();alert('復元しました')}catch{alert('バックアップファイルを読み込めませんでした')}};r.readAsText(file)}

if(document.getElementById('appVersion'))document.getElementById('appVersion').textContent='v'+APP_VERSION;
if(document.getElementById('updateStatus'))document.getElementById('updateStatus').textContent='安定版';
setupSelects();refreshAll();
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));predictBtn.onclick=()=>runPrediction();saveRangeBtn.onclick=saveCurrentRange;addLogBtn.onclick=addLogFromForm;saveTrialBtn.onclick=savePredictedTrial;autoLookupBtn.onclick=autoLookup;apiKeyBtn.onclick=setApiKey;
highDensity.oninput=()=>densityLabel.textContent=['','少ない','やや少ない','普通','多い','かなり多い'][+highDensity.value];
[songTitle,artist,chorusTop,chestPeak,falsettoPeak,lowNote,highDensity].forEach(el=>el.addEventListener('change',()=>{if(el===chorusTop||el===chestPeak||el===falsettoPeak||el===lowNote||el===highDensity){rangeSourceBadge.textContent='手入力';currentRangeSource='manual';if(rangeFormComplete()){personalKeyStatus.textContent='判定待ち';personalKeyStatus.className='warn';}else{setPredictionPending('音域待ち');}}}));
sampleBtn.onclick=()=>{songTitle.value='会いたい';artist.value='徳永英明';};installHelpBtn.onclick=()=>installDialog.showModal();closeDialog.onclick=()=>installDialog.close();exportBtn.onclick=exportData;importInput.onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
resetBtn.onclick=()=>{if(confirm('追加した学習データと保存した曲別音域を消して初期状態に戻しますか？')){data=clone(defaultData);rangeLibrary={};localStorage.removeItem(RANGE_STORAGE);saveData()}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v='+APP_VERSION).then(r=>r.update()).catch(()=>{}));
