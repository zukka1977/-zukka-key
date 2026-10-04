(() => {
  const VERSION = '4.2.3';
  const JINA_KEY_STORAGE = 'zukka-key-jina-api-key';
  const RANGE_STORAGE = 'zukka-key-song-ranges-v1';

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
    // Japanese karaoke notation is A-based:
    // mid2A=A3, mid2C=C4, hiA=A4, hiC=C5.
    const aOctave = ({low:1, mid1:2, mid2:3, hi:4, hihi:5, hihihi:6})[prefix];
    if (aOctave == null) return null;
    const octave = (letter === 'A' || letter === 'B') ? aOctave : aOctave + 1;

    return 12 * (octave + 1) + notePc[letter] + accidentalOffset(m[3]);
  }

  function midiLabel(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const n = Number(midi);
    return Number.isFinite(n) ? names[(n % 12 + 12) % 12] + (Math.floor(n / 12) - 1) : '—';
  }

  function allTokens(text) {
    return [...String(text || '').matchAll(new RegExp(NOTE_TOKEN, 'ig'))]
      .map(m => ({raw:m[0], midi:tokenToMidi(m[0])}))
      .filter(x => Number.isFinite(x.midi));
  }

  function lines(text) {
    return String(text || '').split(/\r?\n/);
  }

  function exactTitleIndex(content, title) {
    const qt = norm(title);
    if (!qt) return -1;
    const ls = lines(content);
    let best = -1;
    let bestScore = -1;
    for (let i=0;i<ls.length;i++) {
      const n = norm(ls[i]);
      if (!n.includes(qt)) continue;
      let score = 10;
      if (n === qt) score += 100;
      if (ls[i].includes('|')) score += 20;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function containsIdentity(item, title, artist) {
    const hay = norm(`${item.title || ''}\n${item.content || ''}`);
    const qt = norm(title);
    const qa = norm(artist);
    if (!qt || !hay.includes(qt)) return false;
    if (qa && !hay.includes(qa)) return false;
    return true;
  }

  function noteFromLabels(content, labels, reject=[]) {
    for (const label of labels) {
      for (const line of lines(content)) {
        if (!line.includes(label)) continue;
        if (reject.some(x => line.includes(x))) continue;
        const m = line.match(tokenRe);
        if (m) {
          const midi = tokenToMidi(m[0]);
          if (Number.isFinite(midi)) return midi;
        }
      }
    }
    return null;
  }

  function rangeFromLabels(content, labels) {
    for (const label of labels) {
      for (const line of lines(content)) {
        if (!line.includes(label)) continue;
        const xs = allTokens(line);
        if (xs.length >= 2) return [xs[0].midi, xs[1].midi];
      }
    }
    return null;
  }

  function frequencyInfo(text, rawPeakMidi) {
    const t = String(text || '');
    const oneOff = /(?:計|合計)?\s*[1１一]\s*(?:回|箇所)|1回のみ|1箇所のみ|一度だけ/.test(t);
    const frequent = /連発|頻出|何度も|繰り返|多用/.test(t);

    let density = 3;
    if (oneOff) density = 2;
    if (frequent) density = 5;

    const tokenList = allTokens(t).map(x => x.midi);
    const belowPeak = tokenList.filter(x => Number.isFinite(rawPeakMidi) ? x < rawPeakMidi : true);
    const notedCommon = belowPeak.length ? Math.max(...belowPeak) : null;

    return {oneOff, frequent, density, notedCommon};
  }

  function deriveChorus(low, peak, noteText, stableHigh=null) {
    if (Number.isFinite(stableHigh) && stableHigh <= peak) return stableHigh;

    const freq = frequencyInfo(noteText, peak);
    if (Number.isFinite(freq.notedCommon)) return Math.max(low + 3, Math.min(freq.notedCommon, peak));

    // If the absolute chest peak appears only once, do not equate it with the
    // repeated chorus ceiling. Keep the actual peak separately.
    if (freq.oneOff) return Math.max(low + 4, peak - 2);
    return Math.max(low + 4, peak - 1);
  }

  function buildRange({low,peak,falsetto=null,noteText='',source,sourceUrl,sourceQuality=50,stableHigh=null}) {
    if (!Number.isFinite(low) || !Number.isFinite(peak) || peak <= low) return null;

    const freq = frequencyInfo(noteText, peak);
    const chorus = Math.min(peak, deriveChorus(low, peak, noteText, stableHigh));

    return {
      low,
      peak,
      rawPeak:peak,
      chorus,
      falsetto:Number.isFinite(falsetto) ? falsetto : null,
      density:freq.density,
      oneOffPeak:freq.oneOff,
      frequentPeak:freq.frequent,
      source,
      sourceUrl,
      sourceQuality,
      confidence:sourceQuality >= 90 ? '高' : sourceQuality >= 65 ? '中' : '参考',
      noteText:String(noteText || '').replace(/\s+/g,' ').trim().slice(0,220)
    };
  }

  function parseMusicKey(item, title, artist) {
    const url = String(item.url || '');
    const content = String(item.content || '');
    if (!/music-key\.com/i.test(url)) return null;
    if (!containsIdentity(item,title,artist)) return null;

    const ls = lines(content);
    const idx = exactTitleIndex(content,title);
    if (idx < 0) return null;

    // music-key pages often put the note row a few lines after the title.
    const blockLines = ls.slice(Math.max(0,idx-3), Math.min(ls.length,idx+16));
    let noteRow = '';
    for (const line of blockLines) {
      const xs = allTokens(line);
      if (xs.length >= 2 && line.includes('|')) { noteRow = line; break; }
    }
    if (!noteRow) {
      // Jina can split the markdown row across lines; find the densest nearby line.
      noteRow = blockLines
        .map(line => ({line,count:allTokens(line).length}))
        .sort((a,b)=>b.count-a.count)[0]?.line || '';
    }

    const xs = allTokens(noteRow);
    if (xs.length < 2) return null;

    const low = xs[0].midi;
    const peak = xs[1].midi;
    const falsetto = xs.length >= 3 ? xs[2].midi : null;
    const noteText = blockLines.slice(Math.max(0, blockLines.indexOf(noteRow)), 16).join(' ');

    return buildRange({
      low,peak,falsetto,noteText,
      source:'WEB / 音域.com',
      sourceUrl:url,
      sourceQuality:100
    });
  }

  function parseSaikouonWiki(item, title, artist) {
    const url = String(item.url || '');
    const content = String(item.content || '');
    if (!/w\.atwiki\.jp\/saikouon_dokoda/i.test(url)) return null;
    if (!containsIdentity(item,title,artist)) return null;

    const ls = lines(content);
    const idx = exactTitleIndex(content,title);
    if (idx < 0) return null;

    const blockLines = ls.slice(Math.max(0,idx-2), Math.min(ls.length,idx+8));
    let row = blockLines.find(line => line.includes('|') && allTokens(line).length >= 2) || '';
    if (!row) return null;

    const xs = allTokens(row);
    const low = xs[0]?.midi;
    const peak = xs[1]?.midi;

    // Tables with 4 tokens are usually 地低 | 地高 | 裏低 | 裏高.
    // Tables with 3 tokens are usually 地低 | 地高 | 裏高.
    let falsetto = null;
    if (xs.length >= 4) falsetto = xs[3].midi;
    else if (xs.length >= 3) falsetto = xs[2].midi;

    const noteText = blockLines.join(' ');
    return buildRange({
      low,peak,falsetto,noteText,
      source:'WEB / 最高音DB',
      sourceUrl:url,
      sourceQuality:96
    });
  }

  function parseKkti(item, title, artist) {
    const url = String(item.url || '');
    const content = String(item.content || '');
    if (!/kkti\.app\/key\/songs\//i.test(url)) return null;
    if (!containsIdentity(item,title,artist)) return null;

    let low = noteFromLabels(content, ['最低音']);
    let peak = noteFromLabels(content, ['最高音'], ['母音','裏声']);
    const stable = rangeFromLabels(content, ['安定音域']);

    if (!Number.isFinite(low) || !Number.isFinite(peak)) {
      for (const line of lines(content)) {
        if (!line.includes('音域は')) continue;
        const xs = allTokens(line);
        if (xs.length >= 2) {
          low = Number.isFinite(low) ? low : xs[0].midi;
          peak = Number.isFinite(peak) ? peak : xs[1].midi;
          break;
        }
      }
    }

    return buildRange({
      low,peak,
      falsetto:null,
      noteText:content,
      stableHigh:stable?.[1] ?? null,
      source:'WEB / KKTI',
      sourceUrl:url,
      sourceQuality:88
    });
  }

  function parseGeneric(item, title, artist) {
    const content = String(item.content || '');
    if (!containsIdentity(item,title,artist)) return null;

    const low = noteFromLabels(content, ['地声最低音','最低音']);
    const peak = noteFromLabels(content, ['地声最高音'], ['裏声']);
    const falsetto = noteFromLabels(content, ['裏声最高音','裏高']);

    // Do not use a generic "最高音" as chest peak. It may actually be falsetto.
    if (!Number.isFinite(low) || !Number.isFinite(peak)) return null;

    return buildRange({
      low,peak,falsetto,
      noteText:content,
      source:'WEB / 音域ソース',
      sourceUrl:String(item.url || ''),
      sourceQuality:45
    });
  }

  function parseAny(item,title,artist) {
    return parseMusicKey(item,title,artist) ||
           parseSaikouonWiki(item,title,artist) ||
           parseKkti(item,title,artist) ||
           parseGeneric(item,title,artist);
  }

  function getItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.search)) return payload.search;
    return [];
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
    const res=await fetch('https://s.jina.ai/',{
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers:{
        Authorization:`Bearer ${key}`,
        Accept:'application/json',
        'Content-Type':'application/json',
        'X-No-Cache':'true'
      },
      body:JSON.stringify({q:query,hl:'ja',gl:'jp',num:10})
    });

    let raw='';
    try{raw=await res.text();}catch(_){}

    if(res.status===401||res.status===403)throw new Error('JINA_AUTH');
    if(!res.ok){
      const compact=String(raw||'').replace(/\s+/g,' ').slice(0,180);
      throw new Error(`JINA_HTTP_${res.status}${compact?': '+compact:''}`);
    }

    let payload;
    try{payload=JSON.parse(raw);}catch(_){throw new Error('JINA_BAD_JSON');}
    return getItems(payload);
  }

  async function searchRange(title,artist) {
    const key=getJinaKey();
    if(!key)return {needsKey:true};

    const queries=[
      `"${title}" "${artist}" 地声最低音 地声最高音 裏声最高音`,
      `"${title}" "${artist}" 音域.com`,
      `"${title}" "${artist}" 最高音DB`,
      `"${title}" "${artist}" KKTI 音域`
    ];

    const seen = new Set();
    const candidates = [];
    let totalResults = 0;

    for(let i=0;i<queries.length;i++){
      diag(`検索 ${i+1}/${queries.length}`);
      const items=await jinaSearch(queries[i],key);
      totalResults += items.length;

      for (const item of items) {
        const id = `${item.url || ''}::${item.title || ''}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const parsed = parseAny(item,title,artist);
        if (!parsed) continue;

        // Exact-source parsers beat generic sources. Completeness breaks ties.
        let score = parsed.sourceQuality || 0;
        if (parsed.falsetto != null) score += 5;
        if (parsed.oneOffPeak || parsed.frequentPeak) score += 6;
        if (parsed.noteText) score += 2;

        candidates.push({...parsed,_score:score});
      }
    }

    candidates.sort((a,b)=>b._score-a._score);
    return {range:candidates[0] || null,count:totalResults,candidates};
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

  function saveRangeMeta(range,title,artist){
    try{
      const raw=JSON.parse(localStorage.getItem(RANGE_STORAGE)||'{}');
      const id=typeof songIdentity==='function' ? songIdentity(title,artist) : `${norm(artist)}::${norm(title)}`;
      raw[id]={
        chorus:range.chorus,
        peak:range.peak,
        rawPeak:range.rawPeak,
        falsetto:range.falsetto,
        low:range.low,
        density:range.density,
        oneOffPeak:!!range.oneOffPeak,
        frequentPeak:!!range.frequentPeak,
        source:range.source,
        confidence:range.confidence,
        sourceQuality:range.sourceQuality,
        sourceUrl:range.sourceUrl,
        noteText:range.noteText,
        title,artist
      };
      localStorage.setItem(RANGE_STORAGE,JSON.stringify(raw));

      // Keep app.js in-memory range library in sync when accessible.
      if(typeof rangeLibrary!=='undefined'){
        rangeLibrary[id]=raw[id];
      }
    }catch(_){}
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
    if(d){
      d.value=String(range.density||3);
      if(typeof d.oninput==='function')d.oninput();
    }

    saveRangeMeta(range,title,artist);

    try{
      if(typeof setRangeUi==='function')setRangeUi(range);
      if(typeof currentRangeSource!=='undefined')currentRangeSource=range.source;
    }catch(_){}

    const rs=document.getElementById('rangeDataStatus');
    if(rs){rs.textContent='WEB取得';rs.className='ok';}

    const badge=document.getElementById('rangeSourceBadge');
    if(badge)badge.textContent=range.source;

    const note=document.getElementById('rangeDataNote');
    if(note){
      const parts=[
        `最低 ${midiLabel(range.low)}`,
        `常用高音 ${midiLabel(range.chorus)}`,
        `地声最高 ${midiLabel(range.peak)}`
      ];
      if(range.falsetto!=null)parts.push(`裏声最高 ${midiLabel(range.falsetto)}`);
      if(range.oneOffPeak)parts.push('地声最高は1回型');

      note.innerHTML=
        parts.join(' / ') +
        `。 <a href="${range.sourceUrl}" target="_blank" rel="noopener" style="color:#83b8ff">音域出典</a>` +
        `（${range.source}・信頼度 ${range.confidence}）`;
    }

    if(typeof runPrediction==='function'){
      runPrediction({scroll:false});
      const p=document.getElementById('personalKeyStatus');
      const best=document.getElementById('bestKey');
      if(p&&best){p.textContent=best.textContent;p.className='ok';}
    }
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

    // A saved WEB range from an older parser may be low-confidence/wrong.
    // Re-search older generic WEB data; preserve manual/confirmed ranges.
    if(hasSavedRange()){
      let shouldRefresh=false;
      try{
        const raw=JSON.parse(localStorage.getItem(RANGE_STORAGE)||'{}');
        const id=typeof songIdentity==='function' ? songIdentity(title,artist) : `${norm(artist)}::${norm(title)}`;
        const saved=raw[id];
        shouldRefresh=!!saved && (
          saved.source==='WEB / 音域ソース' ||
          !saved.sourceQuality ||
          Number(saved.sourceQuality)<65
        );
      }catch(_){}

      if(!shouldRefresh){
        diag('保存済み音域使用');
        if(statusEl)statusEl.textContent='保存済みの高信頼音域から推奨キーを表示しました。';
        return;
      }
    }

    if(!title)return;

    if(!getJinaKey()){
      diag('音域APIキー未設定');
      if(statusEl)statusEl.textContent='「音域API設定」でJina APIキーを登録してください。';
      return;
    }

    const oldText=btn.textContent;
    btn.disabled=true;
    btn.textContent='WEB音域精査中…';
    if(statusEl)statusEl.textContent='複数の音域DBを照合しています…';

    try{
      const found=await searchRange(title,artist);

      if(!found.range){
        diag(`一致データなし（検索結果 ${found.count||0}件）`);
        if(statusEl)statusEl.textContent=
          '曲名・アーティストが一致する信頼できる音域データを確認できませんでした。誤判定防止のため推測値は出していません。';
        return;
      }

      if(titleEl)titleEl.value=title;
      if(artistEl)artistEl.value=artist;

      applyRange(found.range,title,artist);

      const apiStatus=document.getElementById('apiStatus');
      if(apiStatus)apiStatus.textContent=
        'WEB音域を複数候補から精査し、ずっかの声プロフィールで推奨キーを判定しました。';

      diag(`${found.range.source} 採用`);
      if(statusEl)statusEl.textContent=
        `音域取得成功：${midiLabel(found.range.low)}〜${midiLabel(found.range.peak)}` +
        (found.range.oneOffPeak ? '（最高音は1回型）' : '');
    }catch(err){
      console.error(err);
      const msg=String(err?.message||'');
      if(msg==='JINA_AUTH'){
        diag('Jina認証エラー');
        if(statusEl)statusEl.textContent='Jina APIキーが無効です。「音域API設定」から入れ直してください。';
      }else{
        diag(`通信/解析エラー ${msg}`);
        if(statusEl)statusEl.textContent=`WEB音域検索エラー: ${msg.slice(0,120)}`;
      }
    }finally{
      btn.disabled=false;
      btn.textContent=oldText;
    }
  };

  if(statusEl)statusEl.textContent=getJinaKey()
    ? 'WEB音域検索：準備OK（複数ソース精査モード）'
    : '初めての曲はWEB音域検索を使います。音域APIキーは未設定です。';

  diag(getJinaKey()?'準備OK v4.2.3':'APIキー未設定');
})();