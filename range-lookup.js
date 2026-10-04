(() => {
  const VERSION = '4.2.1';
  const JINA_KEY_STORAGE = 'zukka-key-jina-api-key';
  const btn = document.getElementById('autoLookupBtn');
  const keyBtn = document.getElementById('rangeApiKeyBtn');
  const statusEl = document.getElementById('rangeSearchStatus');
  const diagnosticEl = document.getElementById('rangeDiagnostic');

  if (!btn || typeof btn.onclick !== 'function') return;
  const previousLookup = btn.onclick;

  const norm = (v) =>
    String(v || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[★☆♪♬\s　・･\-–—_「」『』【】()[\]（）"'’.,，。!！?？〜～]/g, '');

  const notePc = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  const NOTE_TOKEN = '(?:hihihi|hihi|hi|mid2|mid1|low)[A-G](?:[#♯b♭])?|[A-G](?:[#♯b♭])?[1-7]';
  const tokenRe = new RegExp(NOTE_TOKEN, 'i');

  function diag(text) {
    if (diagnosticEl) diagnosticEl.textContent = 'WEB音域診断: ' + text;
  }

  function accidentalOffset(acc) {
    if (acc === '#' || acc === '♯') return 1;
    if (acc === 'b' || acc === '♭') return -1;
    return 0;
  }

  function tokenToMidi(token) {
    if (!token) return null;
    const t = String(token).trim().replace(/＃/g, '#');

    let m = t.match(/^([A-Ga-g])([#♯b♭]?)(-?\d)$/);
    if (m) {
      const octave = Number(m[3]);
      return 12 * (octave + 1) + notePc[m[1].toUpperCase()] + accidentalOffset(m[2]);
    }

    m = t.match(/^(hihihi|hihi|hi|mid2|mid1|low)([A-Ga-g])([#♯b♭]?)$/i);
    if (!m) return null;

    const prefix = m[1].toLowerCase();
    const letter = m[2].toUpperCase();
    const cOctave = ({low:2, mid1:3, mid2:4, hi:5, hihi:6, hihihi:7})[prefix];
    if (cOctave == null) return null;

    // A-based Japanese karaoke notation:
    // mid2C=C4, hiA=A4, hiC=C5.
    const octave = (letter === 'A' || letter === 'B') ? cOctave - 1 : cOctave;
    return 12 * (octave + 1) + notePc[letter] + accidentalOffset(m[3]);
  }

  function midiLabel(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const n = Number(midi);
    return Number.isFinite(n) ? names[(n%12+12)%12] + (Math.floor(n/12)-1) : '—';
  }

  function allTokens(text) {
    return [...String(text || '').matchAll(new RegExp(NOTE_TOKEN, 'ig'))]
      .map(m => ({raw:m[0], midi:tokenToMidi(m[0])}))
      .filter(x => Number.isFinite(x.midi));
  }

  function lineWith(text, labels, reject=[]) {
    const lines = String(text || '').split(/\r?\n/);
    for (const label of labels) {
      const found = lines.find(line => line.includes(label) && !reject.some(x => line.includes(x)));
      if (found) return found;
    }
    return '';
  }

  function noteFromLabels(text, labels, reject=[]) {
    const line = lineWith(text, labels, reject);
    const m = line.match(tokenRe);
    return m ? tokenToMidi(m[0]) : null;
  }

  function rangeFromLabels(text, labels) {
    const line = lineWith(text, labels);
    const xs = allTokens(line);
    return xs.length >= 2 ? [xs[0].midi, xs[1].midi] : null;
  }

  function containsIdentity(item, title, artist) {
    const hay = norm(`${item.title || ''}\n${item.content || ''}`);
    const qt = norm(title);
    const qa = norm(artist);
    if (!qt || !hay.includes(qt)) return false;
    if (qa && !hay.includes(qa)) return false;
    return true;
  }

  function parseKkti(item, title, artist) {
    const url = String(item.url || '');
    const content = String(item.content || '');
    if (!/kkti\.app\/key\/songs\//i.test(url)) return null;
    if (!containsIdentity(item, title, artist)) return null;

    let low = noteFromLabels(content, ['最低音']);
    let peak = noteFromLabels(content, ['最高音'], ['母音']);
    const stable = rangeFromLabels(content, ['安定音域']);

    if (!Number.isFinite(low) || !Number.isFinite(peak)) {
      const line = lineWith(content, ['音域は']);
      const xs = allTokens(line);
      if (xs.length >= 2) {
        low = Number.isFinite(low) ? low : xs[0].midi;
        peak = Number.isFinite(peak) ? peak : xs[1].midi;
      }
    }

    if (!Number.isFinite(low) || !Number.isFinite(peak) || peak <= low) return null;

    let chorus = stable?.[1];
    if (!Number.isFinite(chorus)) chorus = Math.max(low + 4, peak - 2);
    chorus = Math.min(chorus, peak);

    return {
      low, peak, chorus, falsetto:null,
      density: Math.max(2, Math.min(4, peak - chorus <= 1 ? 4 : peak - chorus <= 3 ? 3 : 2)),
      source:'WEB / KKTI',
      confidence: stable ? '高' : '中',
      sourceUrl:url
    };
  }

  // 音域.com の検索結果は一つのページに複数曲が並ぶため、
  // 「曲名＋アーティスト」の近傍だけを切り出して誤マッチを防ぐ。
  function parseMusicKey(item, title, artist) {
    const url = String(item.url || '');
    const content = String(item.content || '');
    if (!/music-key\.com/i.test(url)) return null;

    const qt = norm(title), qa = norm(artist);
    const lines = content.split(/\r?\n/);

    let bestIndex = -1;
    for (let i=0;i<lines.length;i++) {
      const block = lines.slice(Math.max(0,i-5), Math.min(lines.length,i+10)).join('\n');
      const nb = norm(block);
      if (qt && nb.includes(qt) && (!qa || nb.includes(qa))) { bestIndex = i; break; }
    }
    if (bestIndex < 0) return null;

    const block = lines.slice(Math.max(0,bestIndex-8), Math.min(lines.length,bestIndex+18)).join('\n');
    const xs = allTokens(block).map(x => x.midi);
    if (xs.length < 2) return null;

    // Prefer the table row after the title. Typical order: 地低 | 地高 | 裏高 | Fake.
    let rowLow=null,rowPeak=null,rowFalsetto=null;
    for (const line of block.split(/\r?\n/)) {
      const nts = allTokens(line);
      if (nts.length >= 2 && line.includes('|')) {
        rowLow = nts[0].midi;
        rowPeak = nts[1].midi;
        rowFalsetto = nts[2]?.midi ?? null;
        if (rowPeak > rowLow) break;
      }
    }

    if (!Number.isFinite(rowLow) || !Number.isFinite(rowPeak) || rowPeak <= rowLow) return null;

    // Comments often tell us "サビはmid2Eまで", "mid2Gが連発" etc.
    let chorus = null;
    const chorusLine = block.split(/\r?\n/).find(x => x.includes('サビ') || x.includes('連発') || x.includes('ロングトーン'));
    if (chorusLine) {
      const c = allTokens(chorusLine).map(x => x.midi);
      if (c.length) chorus = Math.min(Math.max(...c), rowPeak);
    }
    if (!Number.isFinite(chorus)) chorus = Math.max(rowLow + 4, rowPeak - 2);

    let density=3;
    const notes = norm(block);
    if (notes.includes('連発') || notes.includes('ロングトーン')) density=4;
    else if (notes.includes('1回') || notes.includes('一回')) density=2;

    return {
      low:rowLow,
      peak:rowPeak,
      chorus,
      falsetto:rowFalsetto,
      density,
      source:'WEB / 音域.com',
      confidence:'中',
      sourceUrl:url
    };
  }

  function parseGeneric(item, title, artist) {
    const content = String(item.content || '');
    if (!containsIdentity(item,title,artist)) return null;

    const low = noteFromLabels(content, ['地声最低音','最低音','low']);
    const peak = noteFromLabels(content, ['地声最高音','最高音'], ['裏声','母音']);
    const falsetto = noteFromLabels(content, ['裏声最高音','裏声']);

    if (!Number.isFinite(low) || !Number.isFinite(peak) || peak <= low) return null;
    return {
      low, peak,
      chorus:Math.max(low+4,peak-2),
      falsetto:Number.isFinite(falsetto)?falsetto:null,
      density:3,
      source:'WEB / 音域ソース',
      confidence:'中',
      sourceUrl:String(item.url || '')
    };
  }

  function parseAny(item,title,artist) {
    return parseKkti(item,title,artist) ||
           parseMusicKey(item,title,artist) ||
           parseGeneric(item,title,artist);
  }

  function getItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.search)) return payload.search;
    return [];
  }

  function scoreItem(item,title,artist) {
    const hay = norm(`${item.title || ''}\n${item.content || ''}`);
    const qt = norm(title), qa = norm(artist);
    if (!qt || !hay.includes(qt)) return -999;
    if (qa && !hay.includes(qa)) return -999;

    let score=100;
    const url=String(item.url||'');
    if (/kkti\.app\/key\/songs\//i.test(url)) score+=80;
    else if (/music-key\.com/i.test(url)) score+=60;
    if (norm(item.title||'').includes(qt)) score+=30;
    return score;
  }

  function getJinaKey() {
    return localStorage.getItem(JINA_KEY_STORAGE) || '';
  }

  function setJinaKey() {
    const current=getJinaKey();
    const value=prompt(
      'Jina Search APIキーを入力してください。\n初めての曲の音域WEB検索に使います。\nキーはGitHubには保存せず、この端末内だけに保存します。',
      current
    );
    if(value===null)return false;
    const clean=value.trim();
    if(!clean){
      localStorage.removeItem(JINA_KEY_STORAGE);
      if(statusEl)statusEl.textContent='音域検索APIキーを削除しました。';
      return false;
    }
    localStorage.setItem(JINA_KEY_STORAGE,clean);
    if(statusEl)statusEl.textContent='音域検索APIキーを保存しました。';
    diag('APIキー保存済み');
    return true;
  }
  if(keyBtn)keyBtn.onclick=setJinaKey;

  async function jinaSearch(query,key) {
    const res=await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`,{
      method:'GET',
      mode:'cors',
      cache:'no-store',
      headers:{Authorization:`Bearer ${key}`,Accept:'application/json'}
    });
    if(res.status===401||res.status===403)throw new Error('JINA_AUTH');
    if(!res.ok)throw new Error(`JINA_HTTP_${res.status}`);
    return getItems(await res.json());
  }

  async function searchRange(title,artist) {
    const key=getJinaKey();
    if(!key)return {needsKey:true};

    const queries=[
      `site:kkti.app/key/songs/ "${title}" "${artist}"`,
      `"${title}" "${artist}" "地声最高音" "地声最低音"`,
      `"${title}" "${artist}" "最高音" "最低音" カラオケ 音域`
    ];

    let all=[];
    for(let i=0;i<queries.length;i++){
      diag(`検索 ${i+1}/${queries.length}`);
      const items=await jinaSearch(queries[i],key);
      all.push(...items);

      const ranked=all
        .map(item=>({...item,_score:scoreItem(item,title,artist)}))
        .filter(item=>item._score>0)
        .sort((a,b)=>b._score-a._score);

      for(const item of ranked){
        const range=parseAny(item,title,artist);
        if(range)return {range};
      }
    }
    return {range:null,count:all.length};
  }

  function ensureSelectValue(select,midi){
    if(!select||midi==null)return;
    const value=String(midi);
    if(![...select.options].some(o=>o.value===value)){
      const o=document.createElement('option');
      o.value=value;o.textContent=midiLabel(midi);select.append(o);
    }
    select.value=value;
  }

  function applyRange(range,title,artist){
    ensureSelectValue(document.getElementById('chorusTop'),range.chorus);
    ensureSelectValue(document.getElementById('chestPeak'),range.peak);
    const f=document.getElementById('falsettoPeak');
    if(f){
      if(range.falsetto==null)f.value='';
      else ensureSelectValue(f,range.falsetto);
    }
    ensureSelectValue(document.getElementById('lowNote'),range.low);

    const d=document.getElementById('highDensity');
    if(d){d.value=String(range.density||3);if(typeof d.oninput==='function')d.oninput();}

    try{
      const id=songIdentity(title,artist);
      rangeLibrary[id]={
        chorus:range.chorus,peak:range.peak,falsetto:range.falsetto,low:range.low,
        density:range.density,source:range.source,confidence:range.confidence,
        sourceUrl:range.sourceUrl,title,artist
      };
      saveRanges();
      setRangeUi(range);
      currentRangeSource=range.source;
    }catch(_){}

    const rs=document.getElementById('rangeDataStatus');
    if(rs){rs.textContent='WEB取得';rs.className='ok';}
    const badge=document.getElementById('rangeSourceBadge');
    if(badge)badge.textContent=range.source;
    const note=document.getElementById('rangeDataNote');
    if(note){
      note.innerHTML=`最低 ${midiLabel(range.low)} / 常用高音 ${midiLabel(range.chorus)} / 地声ピーク ${midiLabel(range.peak)}`+
        (range.falsetto!=null?` / 裏声 ${midiLabel(range.falsetto)}`:'')+
        `。 <a href="${range.sourceUrl}" target="_blank" rel="noopener" style="color:#83b8ff">音域出典</a>（信頼度 ${range.confidence}）`;
    }

    runPrediction({scroll:false});
    const p=document.getElementById('personalKeyStatus');
    const best=document.getElementById('bestKey');
    if(p&&best){p.textContent=best.textContent;p.className='ok';}
  }

  function hasMeasuredResult(){
    const t=document.getElementById('resultTitle')?.textContent||'';
    const s=document.getElementById('apiStatus')?.textContent||'';
    return t.includes('実測ベスト')||s.includes('実測ログ');
  }

  function hasSavedRange(){
    const s=document.getElementById('rangeDataStatus')?.textContent||'';
    return s==='あり'||s==='WEB取得'||s==='実測あり';
  }

  btn.onclick=async function(event){
    const titleEl=document.getElementById('songTitle');
    const artistEl=document.getElementById('artist');
    const title=titleEl?.value?.trim()||'';
    const artist=artistEl?.value?.trim()||'';

    await previousLookup.call(this,event);

    if(hasMeasuredResult()){
      diag('実測ログ使用');
      if(statusEl)statusEl.textContent='過去の実測キーを最優先しました。';
      return;
    }
    if(hasSavedRange()){
      diag('保存済み音域使用');
      if(statusEl)statusEl.textContent='保存済み音域から推奨キーを表示しました。';
      return;
    }
    if(!title)return;

    if(!getJinaKey()){
      diag('音域APIキー未設定');
      if(statusEl)statusEl.textContent='「音域API設定」でJina APIキーを登録してください。';
      return;
    }

    const oldText=btn.textContent;
    btn.disabled=true;
    btn.textContent='WEB音域検索中…';
    if(statusEl)statusEl.textContent='音域DBを検索しています…';

    try{
      const found=await searchRange(title,artist);
      if(!found.range){
        diag(`一致データなし（検索結果 ${found.count||0}件）`);
        if(statusEl)statusEl.textContent=
          '曲名・アーティストの一致する音域データを確認できませんでした。誤判定防止のため推測値は出していません。';
        return;
      }

      if(titleEl)titleEl.value=title;
      if(artistEl)artistEl.value=artist;
      applyRange(found.range,title,artist);

      const apiStatus=document.getElementById('apiStatus');
      if(apiStatus)apiStatus.textContent=
        '原曲キー/BPM + WEB音域 + ずっかの声プロフィールから推奨キーを自動判定しました。';

      diag(`${found.range.source} 成功`);
      if(statusEl)statusEl.textContent=`音域取得成功：${midiLabel(found.range.low)}〜${midiLabel(found.range.peak)}`;
    }catch(err){
      console.error(err);
      const msg=String(err?.message||'');
      if(msg==='JINA_AUTH'){
        diag('Jina認証エラー');
        if(statusEl)statusEl.textContent='Jina APIキーが無効です。「音域API設定」から入れ直してください。';
      }else{
        diag(`通信/解析エラー ${msg}`);
        if(statusEl)statusEl.textContent='WEB音域検索でエラーが出ました。診断表示を教えてください。';
      }
    }finally{
      btn.disabled=false;
      btn.textContent=oldText;
    }
  };

  if(statusEl)statusEl.textContent=getJinaKey()
    ? 'WEB音域検索：準備OK（KKTI＋音域.com）'
    : '初めての曲はWEB音域検索を使います。音域APIキーは未設定です。';
  diag(getJinaKey()?'準備OK':'APIキー未設定');
})();