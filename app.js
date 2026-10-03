const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const STORAGE_KEY='zukka-key-data-v1';
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
let lastPrediction=null;

function clone(v){return JSON.parse(JSON.stringify(v));}
function loadData(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY));return v&&v.logs?v:clone(defaultData)}catch{return clone(defaultData)}}
function saveData(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));refreshAll();}
function noteName(midi){if(midi===null||midi===undefined||midi==='')return 'なし';const n=Number(midi);return NOTE_NAMES[n%12]+(Math.floor(n/12)-1)}
function shiftLabel(v){v=Number(v);return v===0?'±0':v>0?`+${v}`:`${v}`}
function populateNoteSelect(el,min=43,max=76,none=false,selected=null){el.innerHTML='';if(none){const o=document.createElement('option');o.value='';o.textContent='なし';el.append(o)}for(let i=min;i<=max;i++){const o=document.createElement('option');o.value=i;o.textContent=noteName(i);if(Number(selected)===i)o.selected=true;el.append(o)}if(selected===null&&!none)el.value=67;}
function populateShifts(){const el=document.getElementById('logShift');for(let i=-6;i<=6;i++){const o=document.createElement('option');o.value=i;o.textContent=shiftLabel(i);el.append(o)}}

function setupSelects(){
  populateNoteSelect(chorusTop,55,73,false,66);populateNoteSelect(chestPeak,55,76,false,67);populateNoteSelect(falsettoPeak,55,79,true,null);populateNoteSelect(lowNote,40,60,false,48);
  populateNoteSelect(logChorus,55,73,false,66);populateNoteSelect(logPeak,55,76,false,67);populateNoteSelect(logFalsetto,55,79,true,null);populateNoteSelect(logLow,40,60,false,48);populateShifts();
}

function candidateScore(song,shift){
  const p=data.profile;
  const chorus=song.chorus+shift, peak=song.peak+shift, low=song.low+shift;
  const density=song.density;
  let score=100;
  // サビ主戦場: E4(64)〜F#4(66)が基本。高音密度が低ければG4まで許容。
  const cTarget=(p.preferredChorusLow+p.preferredChorusHigh)/2 + (density<=2?0.5:0);
  score-=Math.abs(chorus-cTarget)*8;
  // 地声ピーク: F#4〜G4。密度が高いほどF#寄り、低ければG寄り。
  const peakTarget=density>=4?p.preferredPeakLow:(density<=2?p.preferredPeakHigh:(p.preferredPeakLow+p.preferredPeakHigh)/2);
  score-=Math.abs(peak-peakTarget)*10;
  if(peak>=p.caution){score-=(peak-p.caution+1)*(density>=4?13:8)}
  if(low<p.minComfortLow)score-=(p.minComfortLow-low)*7;
  // ファルセットは軽く評価。高くても致命傷にしない。
  if(song.falsetto!=null){const f=song.falsetto+shift;if(f>74)score-=(f-74)*2.5}
  // 大きすぎる移調は少しだけ避ける。
  score-=Math.abs(shift)*1.2;
  // 実測データで似た曲のキー傾向を加える（kNN的補正）
  const good=data.logs.filter(l=>l.rating>=4&&Number.isFinite(l.chorus)&&Number.isFinite(l.peak));
  if(good.length){
    let totalW=0, weighted=0;
    for(const l of good){
      const originalChorus=l.chorus-l.shift, originalPeak=l.peak-l.shift;
      const dist=Math.abs(song.chorus-originalChorus)*1.2+Math.abs(song.peak-originalPeak)*1.6+Math.abs(song.low-(l.low-l.shift))*.35+Math.abs(song.density-(l.density||3))*.8;
      const w=(l.rating-2)/Math.pow(1+dist,1.35);
      totalW+=w; weighted+=w*l.shift;
    }
    if(totalW>0){const learned=weighted/totalW;score-=Math.abs(shift-learned)*3.2}
  }
  return score;
}

function predict(song){
  const list=[];for(let s=-6;s<=6;s++)list.push({shift:s,score:candidateScore(song,s)});
  list.sort((a,b)=>b.score-a.score);return list.slice(0,3);
}

function buildReason(song,best){
  const s=best.shift,c=song.chorus+s,p=song.peak+s,l=song.low+s;
  let bits=[];
  bits.push(`サビ高音が ${noteName(c)}、地声ピークが ${noteName(p)} に来ます。`);
  if(song.density>=4)bits.push('高音が多い曲なので、ピークを少し余裕側に置いています。');
  else if(song.density<=2)bits.push('高音が一瞬型なので、ピークはG4付近まで許容しています。');
  if(song.falsetto!=null)bits.push(`裏声の ${noteName(song.falsetto+s)} は別枠として軽く評価しています。`);
  if(l<48)bits.push('ただし低音がかなり下がるため、低く感じたら次点キーを試してください。');
  return bits.join(' ');
}

function runPrediction(){
  const song={title:songTitle.value.trim()||'この曲',artist:artist.value.trim(),chorus:+chorusTop.value,peak:+chestPeak.value,falsetto:falsettoPeak.value===''?null:+falsettoPeak.value,low:+lowNote.value,density:+highDensity.value};
  const top=predict(song);lastPrediction={song,top};
  bestKey.textContent=shiftLabel(top[0].shift);resultTitle.textContent=`おすすめは ${shiftLabel(top[0].shift)}`;resultReason.textContent=buildReason(song,top[0]);
  alternatives.innerHTML=top.slice(1).map((x,i)=>`<div class="alt"><span>${i===0?'次点':'第3候補'}</span><strong>${shiftLabel(x.shift)}</strong></div>`).join('');
  resultCard.classList.remove('hidden');resultCard.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function addLogFromForm(){
  const title=logTitle.value.trim();if(!title){alert('曲名を入れてください');return}
  const shift=+logShift.value;
  data.logs.unshift({title,artist:logArtist.value.trim(),shift,rating:+logRating.value,chorus:+logChorus.value+shift,peak:+logPeak.value+shift,falsetto:logFalsetto.value===''?null:+logFalsetto.value+shift,low:+logLow.value+shift,density:3,memo:logMemo.value.trim(),seed:false});
  saveData();logTitle.value='';logArtist.value='';logMemo.value='';alert('学習データに追加しました');
}

function savePredictedTrial(){
  if(!lastPrediction)return;const {song,top}=lastPrediction;
  switchTab('log');logTitle.value=song.title;logArtist.value=song.artist;logShift.value=top[0].shift;logChorus.value=song.chorus;logPeak.value=song.peak;logFalsetto.value=song.falsetto??'';logLow.value=song.low;logMemo.value=`予測 ${shiftLabel(top[0].shift)}。歌った後に評価を選んで保存。`;
}

function renderLogs(){
  logList.innerHTML=data.logs.map((l,i)=>`<article class="log-item"><div class="log-head"><div><div class="log-title">${escapeHtml(l.title)}</div><div class="log-artist">${escapeHtml(l.artist||'')}</div></div><div class="log-key">${shiftLabel(l.shift)}</div></div><div class="stars">${'★'.repeat(l.rating)}${'☆'.repeat(5-l.rating)}</div><div class="log-meta">サビ ${noteName(l.chorus)} / 地声ピーク ${noteName(l.peak)}${l.falsetto!=null?` / 裏声 ${noteName(l.falsetto)}`:''} / 最低 ${noteName(l.low)}</div>${l.memo?`<div class="log-memo">${escapeHtml(l.memo)}</div>`:''}${!l.seed?`<button class="text-button delete-log" data-i="${i}">削除</button>`:''}</article>`).join('');
  document.querySelectorAll('.delete-log').forEach(b=>b.onclick=()=>{data.logs.splice(+b.dataset.i,1);saveData()});
}

function learnProfile(){
  const good=data.logs.filter(l=>l.rating>=4);
  if(!good.length)return;
  const weightedMedian=(vals)=>{vals.sort((a,b)=>a.v-b.v);const total=vals.reduce((s,x)=>s+x.w,0);let a=0;for(const x of vals){a+=x.w;if(a>=total/2)return x.v}return vals.at(-1).v};
  const chorusMed=weightedMedian(good.map(l=>({v:l.chorus,w:l.rating})));
  const peakMed=weightedMedian(good.map(l=>({v:l.peak,w:l.rating})));
  data.profile.preferredChorusLow=Math.max(62,chorusMed-2);data.profile.preferredChorusHigh=Math.min(67,chorusMed);
  data.profile.preferredPeakLow=Math.max(65,peakMed-1);data.profile.preferredPeakHigh=Math.min(68,peakMed);
  data.profile.caution=Math.max(68,data.profile.preferredPeakHigh+1);
}

function refreshProfile(){
  learnProfile();const p=data.profile,good=data.logs.filter(l=>l.rating>=4);const confidence=Math.min(96,58+good.length*3);
  sweetSpot.textContent=`${noteName(p.preferredPeakLow)}〜${noteName(p.preferredPeakHigh)}`;confidenceValue.textContent=confidence;confidenceBar.style.width=confidence+'%';
  statChorus.textContent=`${noteName(p.preferredChorusLow)}〜${noteName(p.preferredChorusHigh)}`;statPeak.textContent=`${noteName(p.preferredPeakLow)}〜${noteName(p.preferredPeakHigh)}`;statCaution.textContent=`${noteName(p.caution)}〜`;statSongs.textContent=data.logs.length;
  profileSummary.textContent=`サビの主戦場 ${noteName(p.preferredChorusLow)}〜${noteName(p.preferredChorusHigh)} / 地声ピーク ${noteName(p.preferredPeakLow)}〜${noteName(p.preferredPeakHigh)}。${noteName(p.caution)}以上は曲中の密度で判断。`;
  insightText.innerHTML=`<strong>現在の学習：</strong><br>「最高音だけ」ではなく、サビで繰り返す高音と地声ピークを重視。高音が多い曲は少し下げ、一瞬だけの高音やファルセットは下げ過ぎないように判定します。`;
  localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
}
function refreshAll(){renderLogs();refreshProfile();}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function switchTab(name){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));document.getElementById(name+'Panel').classList.add('active');window.scrollTo({top:0,behavior:'smooth'})}
function exportData(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='zukka-key-backup.json';a.click();URL.revokeObjectURL(a.href)}
function importData(file){const r=new FileReader();r.onload=()=>{try{const v=JSON.parse(r.result);if(!v.logs)throw new Error();data=v;saveData();alert('復元しました')}catch{alert('バックアップファイルを読み込めませんでした')}};r.readAsText(file)}

setupSelects();refreshAll();
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
predictBtn.onclick=runPrediction;addLogBtn.onclick=addLogFromForm;saveTrialBtn.onclick=savePredictedTrial;
highDensity.oninput=()=>densityLabel.textContent=['','少ない','やや少ない','普通','多い','かなり多い'][+highDensity.value];
sampleBtn.onclick=()=>{songTitle.value='新しい曲';artist.value='';chorusTop.value=66;chestPeak.value=68;falsettoPeak.value=70;lowNote.value=48;highDensity.value=4;highDensity.oninput()};
installHelpBtn.onclick=()=>installDialog.showModal();closeDialog.onclick=()=>installDialog.close();
exportBtn.onclick=exportData;importInput.onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
resetBtn.onclick=()=>{if(confirm('追加した学習データを消して初期状態に戻しますか？')){data=clone(defaultData);saveData()}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
