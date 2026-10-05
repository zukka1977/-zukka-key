(() => {
  const VERSION = '4.4.4';
  const JINA_KEY_STORAGE = 'zukka-key-jina-api-key';
  const RANGE_STORAGE = 'zukka-key-song-ranges-v1';
  const LOOKUP_STATE_STORAGE = 'zukka-key-range-lookup-state-v2';

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

  // Artist names often have harmless notation differences:
  // ポルノグラフィティ / ポルノグラフィティー, etc.
  // Some music databases also use old/variant kanji (徳永 / 德永, 高 / 髙).
  // Normalize a small, conservative set so the correct cover is not rejected.
  const artistNorm = (v) => norm(v)
    .replace(/[ーｰ]/g,'')
    .replace(/德/g,'徳')
    .replace(/髙/g,'高')
    .replace(/﨑/g,'崎')
    .replace(/神/g,'神')
    .replace(/﨑/g,'崎');
  const artistQueryVariants = (v) => {
    const raw=String(v||'').trim();
    const vars=[raw, raw.replace(/[ーｰ]+$/g,'')].filter(Boolean);
    return [...new Set(vars)];
  };

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

  function identityEvidence(item, title, artist) {
    const itemTitle=String(item?.title || '');
    const content=String(item?.content || '');
    const qt=norm(title);
    const qa=artistNorm(artist);
    if(!qt)return 0;

    const titleNorm=norm(itemTitle);
    const contentNorm=norm(content);
    if(!titleNorm.includes(qt) && !contentNorm.includes(qt))return 0;
    if(!qa)return titleNorm.includes(qt) ? 35 : 20;

    const itemTitleArtist=artistNorm(itemTitle);
    if(titleNorm.includes(qt) && itemTitleArtist.includes(qa))return 60;

    // The requested artist should appear close to the exact song-title row.
    // This prevents another artist's version on a long catalogue page from
    // being mistaken for the requested cover.
    const ls=lines(content);
    const idx=exactTitleIndex(content,title);
    if(idx>=0){
      const local=artistNorm(ls.slice(Math.max(0,idx-3),Math.min(ls.length,idx+6)).join(' '));
      if(local.includes(qa))return 50;
    }

    // Search snippets are sometimes flattened into one short block. Accept
    // those only when both title and artist are present in the short snippet.
    const rawHay=`${itemTitle}
${content}`;
    if(rawHay.length<=2600 && artistNorm(rawHay).includes(qa))return 30;
    return 0;
  }

  function containsIdentity(item, title, artist) {
    return identityEvidence(item,title,artist) >= (artist ? 30 : 20);
  }

  function noteFromLabels(content, labels, reject=[]) {
    const ls=lines(content);
    for (const label of labels) {
      for (let i=0;i<ls.length;i++) {
        const line=ls[i];
        const idx=line.indexOf(label);
        if (idx<0) continue;

        // Reject only when the unwanted word is close to the target label.
        const local=line.slice(Math.max(0,idx-24), Math.min(line.length,idx+120));
        if (reject.some(x => local.includes(x))) continue;

        // Some sources (notably KeyTube via Reader) put the value on the
        // NEXT line: "最低音\nmid1D (D3)". Search the label line plus the
        // following 3 lines, but stop before another known label to avoid
        // accidentally grabbing 最高音 when looking for 最低音.
        const first=line.slice(idx+label.length);
        const nearby=[first];
        for(let j=i+1;j<Math.min(ls.length,i+4);j++){
          const next=ls[j];
          if(j>i+1 && /最低音|最高音|地声最高音|裏声最高音|最頻音|平均値|安定音域/.test(next)) break;
          nearby.push(next);
        }
        const m=nearby.join(' ').match(tokenRe);
        if(m){
          const midi=tokenToMidi(m[0]);
          if(Number.isFinite(midi))return midi;
        }
      }
    }
    return null;
  }

  function rangeFromLabels(content, labels) {
    const ls=lines(content);
    for (const label of labels) {
      for (let i=0;i<ls.length;i++) {
        const line=ls[i];
        const idx=line.indexOf(label);
        if(idx<0)continue;
        const nearby=[line.slice(idx+label.length)];
        for(let j=i+1;j<Math.min(ls.length,i+5);j++){
          const next=ls[j];
          if(j>i+1 && /最低音|最高音|地声最高音|裏声最高音|最頻音|平均値/.test(next)) break;
          nearby.push(next);
        }
        const xs=allTokens(nearby.join(' '));
        if(xs.length>=2)return [xs[0].midi,xs[1].midi];
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

  function parseKeyTube(item, title, artist) {
    const url = String(item.url || '');
    const content = String(item.content || '');
    if (!/keytube\.net\/song\/detail\//i.test(url)) return null;
    if (!containsIdentity(item,title,artist)) return null;

    const low = noteFromLabels(content, ['最低音']);
    const peak = noteFromLabels(content, ['最高音']);
    const common = noteFromLabels(content, ['最も多く使われている音程','最頻音']);
    if (!Number.isFinite(low) || !Number.isFinite(peak)) return null;

    // KeyTube lists the overall observed range, not a reviewed chest/falsetto split.
    // Use the most frequent pitch only as a conservative proxy for the repeated
    // high-note zone when it sits reasonably close to the top of the range.
    let stableHigh = null;
    if (Number.isFinite(common) && common > low && common <= peak && common >= peak - 5) {
      stableHigh = common;
    }

    const localLines = lines(content).filter(line =>
      /最低音|最高音|平均値|最頻音|最も多く使われている音程|監修/.test(line)
    ).slice(0,18);
    const noteText = localLines.join(' ');
    const reviewed = !/監修されていません/.test(noteText);

    return buildRange({
      low,peak,
      falsetto:null,
      noteText,
      stableHigh,
      source:'WEB / KeyTube',
      sourceUrl:url,
      sourceQuality:reviewed ? 84 : 74
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
           parseKeyTube(item,title,artist) ||
           parseGeneric(item,title,artist);
  }

  function getItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.search)) return payload.search;
    return [];
  }

  function lookupIdentity(title,artist){
    if(typeof songIdentity==='function')return songIdentity(title,artist);
    return `${artistNorm(artist)}::${norm(title)}`;
  }

  function readLookupState(){
    try{return JSON.parse(localStorage.getItem(LOOKUP_STATE_STORAGE)||'{}')||{};}catch(_){return {};}
  }
  function writeLookupState(state){
    try{localStorage.setItem(LOOKUP_STATE_STORAGE,JSON.stringify(state));}catch(_){}
  }
  function blockLookup(title,artist,reason,minutes){
    const state=readLookupState();
    state[lookupIdentity(title,artist)]={reason,until:Date.now()+minutes*60*1000};
    writeLookupState(state);
  }
  function blockGlobalLookup(reason,minutes){
    const state=readLookupState();
    state.__global__={reason,until:Date.now()+minutes*60*1000};
    writeLookupState(state);
  }
  function paidSearchBlock(){
    const state=readLookupState();
    const row=state.__global__;
    if(!row)return null;
    if(Number(row.until)<=Date.now()){delete state.__global__;writeLookupState(state);return null;}
    return row;
  }
  function lookupBlock(title,artist){
    const state=readLookupState();
    const key=lookupIdentity(title,artist);
    const row=state[key];
    if(!row)return null;
    if(Number(row.until)<=Date.now()){
      delete state[key];writeLookupState(state);return null;
    }
    return row;
  }
  function clearLookupBlock(title,artist){
    const state=readLookupState();delete state[lookupIdentity(title,artist)];writeLookupState(state);
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
    localStorage.removeItem(LOOKUP_STATE_STORAGE);
    if(statusEl)statusEl.textContent='音域検索APIキーを保存しました。再検索できます。';
    diag('APIキー保存済み');
    return true;
  }
  if(keyBtn)keyBtn.onclick=setJinaKey;

  const FREE_SOURCE_DOMAINS=['kkti.app','music-key.com','www.music-key.com','w.atwiki.jp','keytube.net','www.keytube.net'];

  function allowedSourceUrl(value){
    try{
      const u=new URL(String(value||''));
      return FREE_SOURCE_DOMAINS.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));
    }catch(_){return false;}
  }

  function uniqueAllowedUrls(values){
    const out=[];const seen=new Set();
    for(const value of values){
      let url=String(value||'').replace(/&amp;/g,'&').trim();
      if(!allowedSourceUrl(url))continue;
      try{
        const u=new URL(url);u.hash='';url=u.toString();
      }catch(_){continue;}
      if(seen.has(url))continue;seen.add(url);out.push(url);
    }
    return out;
  }

  async function timedFetch(url,opts={},ms=10000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),ms);
    try{return await fetch(url,{...opts,signal:controller.signal});}
    finally{clearTimeout(timer);}
  }

  async function readerFetch(targetUrl){
    const endpoint='https://r.jina.ai/'+targetUrl;
    let res;
    try{
      res=await timedFetch(endpoint,{method:'GET',mode:'cors',cache:'no-store',headers:{Accept:'text/plain','X-No-Cache':'true'}},12000);
    }catch(err){
      if(err?.name==='AbortError')throw new Error('FREE_READER_TIMEOUT');
      throw new Error('FREE_READER_NETWORK');
    }
    const text=await res.text().catch(()=> '');
    if(res.status===429)throw new Error('FREE_READER_RATE_LIMIT');
    if(res.status>=500)throw new Error('FREE_READER_TEMP');
    if(!res.ok)throw new Error(`FREE_READER_HTTP_${res.status}`);
    return text;
  }

  async function directOrReaderText(targetUrl){
    // Some source sites allow CORS. Use them directly first so Jina is not
    // touched at all; Reader is only a compatibility fallback.
    try{
      const res=await timedFetch(targetUrl,{method:'GET',mode:'cors',cache:'no-store',headers:{Accept:'text/html,text/plain,application/xml'}},6500);
      if(res.ok)return {text:await res.text(),via:'direct'};
    }catch(_){}
    return {text:await readerFetch(targetUrl),via:'reader'};
  }

  function urlsFromSearchPayload(text){
    const raw=String(text||'');
    const urls=[];
    for(const m of raw.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/ig))urls.push(m[1]);
    for(const m of raw.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g))urls.push(m[1]);
    for(const m of raw.matchAll(/https?:\/\/[^\s<>"')\]]+/g))urls.push(m[0]);

    // Jina Reader can emit relative KeyTube links on the native search page.
    // Resolve those here so we do not need a general-purpose search engine first.
    for(const m of raw.matchAll(/(?:href=["']?|\]\()?(\/song\/detail\/\d+)/ig)){
      urls.push('https://keytube.net'+m[1]);
    }
    return uniqueAllowedUrls(urls);
  }

  async function discoverKeyTubeUrls(title,artist){
    // KeyTube already has a public song search UI. Reading that page via the
    // free Reader is much more reliable than asking Bing to discover it.
    // Try title+artist first, then title only because variant kanji such as
    // 徳/德 can prevent an exact search on some indexes.
    const words=[
      `${title} ${artist||''}`.trim(),
      String(title||'').trim()
    ].filter(Boolean);
    const found=[];
    let via='';
    let lastError='';
    for(const word of [...new Set(words)]){
      const target=`https://keytube.net/search/?t=song&word=${encodeURIComponent(word)}`;
      try{
        const got=await directOrReaderText(target);
        via=got.via;
        for(const url of urlsFromSearchPayload(got.text)){
          if(/keytube\.net\/song\/detail\/\d+/i.test(url))found.push(url);
        }
      }catch(err){
        lastError=String(err?.message||'');
      }
      if(found.length>=6)break;
    }
    return {urls:[...new Set(found)],via,lastError};
  }

  async function discoverFreeUrls(query){
    const bing=`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=8`;
    const got=await directOrReaderText(bing);
    return {urls:urlsFromSearchPayload(got.text),via:got.via};
  }

  function looksLikeHtml(text){
    const s=String(text||'').slice(0,2000).toLowerCase();
    return /<!doctype\s+html|<html\b|<body\b|<main\b|<div\b|<section\b/.test(s);
  }

  function htmlToReadableText(html){
    let raw=String(html||'');
    if(!looksLikeHtml(raw))return raw;

    // Direct CORS fetches return raw HTML while Reader returns plain text.
    // The range parsers are intentionally text-based, so normalize both routes
    // into the same readable-text shape before identity/range extraction.
    raw=raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
      .replace(/<br\s*\/?>/gi,'\n')
      .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|dt|dd|header|footer|main|nav|table|ul|ol)>/gi,'\n')
      .replace(/<[^>]+>/g,' ');

    // Decode entities in-browser without depending on an external library.
    try{
      const ta=document.createElement('textarea');
      ta.innerHTML=raw;
      raw=ta.value;
    }catch(_){
      raw=raw
        .replace(/&nbsp;/gi,' ')
        .replace(/&amp;/gi,'&')
        .replace(/&lt;/gi,'<')
        .replace(/&gt;/gi,'>')
        .replace(/&quot;/gi,'"')
        .replace(/&#39;|&apos;/gi,"'");
    }

    return raw
      .replace(/[\t\f\v]+/g,' ')
      .replace(/ *\n */g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .replace(/ {2,}/g,' ')
      .trim();
  }

  async function freePageItem(url){
    const got=await directOrReaderText(url);
    const raw=String(got.text||'');
    const content=htmlToReadableText(raw);
    const first=content.split(/\r?\n/).find(x=>x.trim())||'';
    return {url,title:first.slice(0,180),content,_via:got.via,_rawHtml:looksLikeHtml(raw)};
  }

  async function searchRangeFree(title,artist){
    const who=String(artist||'').trim();
    const variants=artistQueryVariants(who);
    const primary=variants[0]||who;
    const queries=[
      `"${title}" "${primary}" 音域 最高音 最低音`,
      `site:keytube.net/song/detail/ "${title}" "${primary}"`,
      `site:kkti.app/key/songs/ "${title}" "${primary}"`,
      `site:music-key.com "${title}" "${primary}"`
    ];
    if(variants[1])queries.push(`"${title}" "${variants[1]}" 音域`);

    const seenUrls=new Set();
    const candidates=[];
    let discovered=0;
    let directHits=0;
    let readerHits=0;
    let htmlNormalized=0;
    let identityHits=0;
    let parseAttempts=0;
    let lastFreeError='';

    async function inspectUrls(urls){
      discovered+=urls.length;
      for(const url of urls.slice(0,8)){
        if(seenUrls.has(url))continue;
        seenUrls.add(url);
        let item;
        try{item=await freePageItem(url);}catch(err){lastFreeError=String(err?.message||'');continue;}
        if(item._via==='direct')directHits++;else readerHits++;
        if(item._rawHtml)htmlNormalized++;
        const evidence=identityEvidence(item,title,artist);
        if(evidence < (artist ? 30 : 20))continue;
        identityHits++;
        parseAttempts++;
        const parsed=parseAny(item,title,artist);
        if(!parsed)continue;
        let score=Number(parsed.sourceQuality||0)+evidence;
        if(parsed.falsetto!=null)score+=5;
        if(parsed.oneOffPeak||parsed.frequentPeak)score+=6;
        if(parsed.noteText)score+=2;
        candidates.push({...parsed,identityScore:evidence,_score:score,freeFetch:item._via});
      }
    }

    // 1) Native KeyTube search page first. This avoids the brittle Bing+CORS
    // discovery route and is enough for many mainstream/covers.
    diag('無料検索：KeyTube内検索');
    try{
      const kt=await discoverKeyTubeUrls(title,artist);
      if(kt.lastError)lastFreeError=kt.lastError;
      await inspectUrls(kt.urls);
    }catch(err){lastFreeError=String(err?.message||'');}

    let strong=candidates.find(x=>Number(x.sourceQuality)>=74&&Number(x.identityScore)>=50);

    // 2) If KeyTube did not find a confirmed artist/version, broaden discovery.
    if(!strong){
      for(let qi=0;qi<Math.min(queries.length,4);qi++){
        diag(`無料検索：補助 ${qi+1}/${Math.min(queries.length,4)}`);
        let discovery;
        try{discovery=await discoverFreeUrls(queries[qi]);}
        catch(err){lastFreeError=String(err?.message||'');continue;}
        await inspectUrls(discovery.urls.slice(0,5));
        strong=candidates.find(x=>Number(x.sourceQuality)>=88&&Number(x.identityScore)>=50);
        if(strong)break;
      }
    }

    candidates.sort((a,b)=>b._score-a._score);
    const reliable=candidates.filter(x=>Number(x.sourceQuality)>=65&&Number(x.identityScore)>=30);
    return {range:reliable[0]||null,candidates,discovered,directHits,readerHits,htmlNormalized,identityHits,parseAttempts,lastFreeError};
  }

  async function jinaSearch(query,key) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    let res;
    try{
      res=await fetch('https://s.jina.ai/',{
        method:'POST',
        mode:'cors',
        cache:'no-store',
        signal:controller.signal,
        headers:{
          Authorization:`Bearer ${key}`,
          Accept:'application/json',
          'Content-Type':'application/json',
          'X-No-Cache':'true'
        },
        body:JSON.stringify({q:query,hl:'ja',gl:'jp',num:8})
      });
    }catch(err){
      if(err?.name==='AbortError')throw new Error('JINA_TIMEOUT');
      throw new Error('JINA_NETWORK');
    }finally{
      clearTimeout(timer);
    }

    let raw='';
    try{raw=await res.text();}catch(_){}
    const low=String(raw||'').toLowerCase();

    if(res.status===401||res.status===403)throw new Error('JINA_AUTH');
    if(res.status===402 || low.includes('insufficientbalance') || low.includes('balance not enough'))throw new Error('JINA_QUOTA');
    if(res.status===429)throw new Error('JINA_RATE_LIMIT');

    if(res.status===422){
      if(
        low.includes('no search results available') ||
        low.includes('assertionfailureerror') ||
        low.includes('code":422') ||
        low.includes("code':422")
      )return [];
    }

    if(res.status>=500)throw new Error('JINA_TEMP');
    if(!res.ok)throw new Error(`JINA_HTTP_${res.status}`);

    let payload;
    try{payload=JSON.parse(raw);}catch(_){throw new Error('JINA_BAD_JSON');}
    return getItems(payload);
  }

  async function searchRangePaid(title,artist) {
    const key=getJinaKey();
    if(!key)return {needsKey:true};

    const variants=artistQueryVariants(artist);
    const primary=variants[0]||artist||'';
    const alternate=variants.find(v=>v!==primary)||'';
    const queries=[
      `"${title}" "${primary}" 地声最低音 地声最高音 裏声最高音`,
      `site:music-key.com "${title}" "${primary}"`,
      `site:w.atwiki.jp/saikouon_dokoda "${title}" "${primary}"`,
      `site:kkti.app/key/songs "${title}" "${primary}"`
    ];
    if(alternate)queries.push(`"${title}" "${alternate}" 最高音 最低音 音域`);

    const seen=new Set();
    const candidates=[];
    let totalResults=0;

    for(let i=0;i<queries.length;i++){
      diag(`検索 ${i+1}/${queries.length}`);
      let items=[];
      try{
        items=await jinaSearch(queries[i],key);
      }catch(err){
        const msg=String(err?.message||'');
        if(msg.startsWith('JINA_HTTP_422'))items=[];
        else throw err;
      }
      totalResults+=items.length;

      for(const item of items){
        const id=`${item.url||''}::${item.title||''}`;
        if(seen.has(id))continue;
        seen.add(id);

        const evidence=identityEvidence(item,title,artist);
        if(evidence < (artist ? 30 : 20))continue;
        const parsed=parseAny(item,title,artist);
        if(!parsed)continue;

        let score=parsed.sourceQuality||0;
        score+=evidence;
        if(parsed.falsetto!=null)score+=5;
        if(parsed.oneOffPeak||parsed.frequentPeak)score+=6;
        if(parsed.noteText)score+=2;
        candidates.push({...parsed,identityScore:evidence,_score:score});
      }

      const strong=candidates.find(x=>Number(x.sourceQuality)>=88 && Number(x.identityScore)>=50);
      if(strong)break;
    }

    candidates.sort((a,b)=>b._score-a._score);
    const reliable=candidates.filter(x=>Number(x.sourceQuality)>=65 && Number(x.identityScore)>=30);
    return {range:reliable[0]||null,count:totalResults,candidates,reliableCount:reliable.length};
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
        identityScore:range.identityScore||null,
        fetchedAt:range.fetchedAt||new Date().toISOString(),
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

  function savedRangeFor(title,artist){
    try{
      const raw=JSON.parse(localStorage.getItem(RANGE_STORAGE)||'{}');
      const id=typeof songIdentity==='function'
        ? songIdentity(title,artist)
        : `${norm(artist)}::${norm(title)}`;
      return raw[id]||null;
    }catch(_){
      return null;
    }
  }

  function clearPreviousSongUi(){
    const rs=document.getElementById('rangeDataStatus');
    const ps=document.getElementById('personalKeyStatus');
    const rn=document.getElementById('rangeDataNote');
    const badge=document.getElementById('rangeSourceBadge');
    const card=document.getElementById('resultCard');

    if(rs){rs.textContent='—';rs.className='';}
    if(ps){ps.textContent='—';ps.className='';}
    if(rn)rn.textContent='';
    if(badge)badge.textContent='検索待ち';
    if(card)card.classList.add('hidden');
  }

  function markPending(label='音域待ち'){
    try{
      if(typeof setPredictionPending==='function'){setPredictionPending(label);return;}
    }catch(_){}
    const ps=document.getElementById('personalKeyStatus');
    const card=document.getElementById('resultCard');
    if(ps){ps.textContent=label;ps.className='warn';}
    if(card)card.classList.add('hidden');
  }

  btn.onclick=async function(event){
    const titleEl=document.getElementById('songTitle');
    const artistEl=document.getElementById('artist');
    const title=titleEl?.value?.trim()||'';
    const artist=artistEl?.value?.trim()||'';

    // Important: visible state may still belong to the previously searched song.
    // Reset it before any lookup so another song's WEB取得/推奨キー cannot leak forward.
    clearPreviousSongUi();
    diag('新しい曲として検索開始');

    await previousLookup.call(this,event);

    if(hasMeasuredResult()){
      diag('実測ログ使用');
      if(statusEl)statusEl.textContent='過去の実測キーを最優先しました。';
      return;
    }

    // Only use a range if it belongs to THIS title + artist.
    // v4.2.3 incorrectly looked at the visible "WEB取得" badge, so the prior
    // song could be mistaken for the newly entered song.
    const saved=savedRangeFor(title,artist);
    if(saved){
      const trusted=!!saved.manualConfirmed || Number(saved.sourceQuality)>=65;
      if(trusted){
        applyRange(saved,title,artist);
        diag(saved.manualConfirmed?'手動確認済みキャッシュ使用':'保存済み音域キャッシュ使用');
        if(statusEl)statusEl.textContent=saved.manualConfirmed
          ? 'この曲の手動確認済み音域を使用しました。WEB検索は行っていません。'
          : 'この曲の保存済み音域を使用しました。WEB検索は行っていません。';
        return;
      }
    }

    if(!title)return;

    const blocked=lookupBlock(title,artist);
    if(blocked){
      markPending('音域待ち');
      diag('直近検索を再利用');
      if(statusEl)statusEl.textContent='この曲は直近の検索で確かな音域が見つかりませんでした。API節約のため少し時間を空けて再検索します。手入力なら今すぐ続けられます。';
      return;
    }

    const oldText=btn.textContent;
    btn.disabled=true;
    btn.textContent='無料音域検索中…';
    if(statusEl)statusEl.textContent='保存データ → 無料WEB検索 → 必要な時だけ有料検索API、の順で探しています…';

    let freeFound=null;
    try{
      // v4.4: paid Jina Search is no longer the primary path.
      // First discover/fetch source pages with direct CORS where possible,
      // falling back to the unauthenticated Reader endpoint only when needed.
      try{freeFound=await searchRangeFree(title,artist);}catch(err){freeFound={range:null,lastFreeError:String(err?.message||'')};}

      if(freeFound?.range){
        if(titleEl)titleEl.value=title;
        if(artistEl)artistEl.value=artist;
        clearLookupBlock(title,artist);
        applyRange(freeFound.range,title,artist);
        const apiStatus=document.getElementById('apiStatus');
        if(apiStatus)apiStatus.textContent='無料WEB音域を確認し、ずっかの声プロフィールで推奨キーを判定しました。';
        const route=freeFound.range.freeFetch==='direct'?'直接取得':'無料Reader経由';
        diag(`${freeFound.range.source} 採用 / ${route}`);
        if(statusEl)statusEl.textContent=`無料音域取得成功：${midiLabel(freeFound.range.low)}〜${midiLabel(freeFound.range.peak)}（${route}）`;
        return;
      }

      // Only if free discovery could not produce a reliable range do we use
      // the paid Search API, and only when the user has configured a key.
      const paidBlock=paidSearchBlock();
      const paidKey=getJinaKey();
      if(!paidKey || paidBlock){
        markPending('音域待ち');
        const suffix=paidBlock?'有料検索APIは利用上限のため休止中です。':'必要なら「予備検索API設定」で有料検索を追加できます。';
        const fetched=(freeFound?.directHits||0)+(freeFound?.readerHits||0);
        const freeDiag=freeFound?.lastFreeError?.includes('RATE_LIMIT')
          ? `無料Reader混雑 / 候補URL ${freeFound?.discovered||0}件`
          : `無料検索：候補URL ${freeFound?.discovered||0}件 / 詳細取得 ${fetched}件 / HTML整形 ${freeFound?.htmlNormalized||0}件 / 歌手一致 ${freeFound?.identityHits||0}件 / 解析成功 ${freeFound?.candidates?.length||0}件`;
        diag(freeDiag);
        if(statusEl)statusEl.textContent=`無料検索では歌手版まで確認できる音域が見つかりませんでした。${suffix} 手入力ならそのまま判定できます。`;
        // Do not block on transient Reader errors. Only cache a true no-result.
        if(!freeFound?.lastFreeError)blockLookup(title,artist,'no-result',180);
        return;
      }

      btn.textContent='予備WEB検索中…';
      if(statusEl)statusEl.textContent='無料検索では見つからなかったため、予備の検索APIを1回だけ使っています…';
      const found=await searchRangePaid(title,artist);

      if(!found.range){
        markPending('音域待ち');
        blockLookup(title,artist,'no-result',360);
        diag(`一致データなし（予備検索 ${found.count||0}件）`);
        if(statusEl)statusEl.textContent='無料検索＋予備検索でも、曲名・アーティストが一致する信頼できる音域を確認できませんでした。誤判定防止のため推測値は出していません。手入力で続行できます。';
        return;
      }

      if(titleEl)titleEl.value=title;
      if(artistEl)artistEl.value=artist;
      clearLookupBlock(title,artist);
      applyRange(found.range,title,artist);

      const apiStatus=document.getElementById('apiStatus');
      if(apiStatus)apiStatus.textContent='予備WEB検索から音域を確認し、ずっかの声プロフィールで推奨キーを判定しました。';
      diag(`${found.range.source} 採用 / 予備検索API`);
      if(statusEl)statusEl.textContent=`音域取得成功：${midiLabel(found.range.low)}〜${midiLabel(found.range.peak)}（予備検索API）`;
    }catch(err){
      console.error(err);
      markPending('音域待ち');
      const msg=String(err?.message||'');
      if(msg==='JINA_AUTH'){
        diag('予備検索API認証エラー');
        if(statusEl)statusEl.textContent='予備検索APIキーが無効です。「予備検索API設定」から入れ直してください。無料検索と手入力は引き続き使えます。';
      }else if(msg==='JINA_QUOTA'){
        blockGlobalLookup('quota',720);
        diag('予備検索API利用上限');
        if(statusEl)statusEl.textContent='予備検索APIの利用上限に達しました。無料検索は次の曲でも引き続き使えます。音域を手入力しても判定できます。';
      }else if(msg==='JINA_RATE_LIMIT'){
        diag('予備検索API混雑');
        if(statusEl)statusEl.textContent='予備検索APIが混み合っています。無料検索は利用できます。数分後に再試行するか、手入力で続けてください。';
      }else{
        const fetched=(typeof freeFound!=='undefined'&&freeFound)?((freeFound.directHits||0)+(freeFound.readerHits||0)):0;
        const extra=(typeof freeFound!=='undefined'&&freeFound)
          ? `無料候補URL ${freeFound.discovered||0}件 / 詳細取得 ${fetched}件 / HTML整形 ${freeFound.htmlNormalized||0}件 / 歌手一致 ${freeFound.identityHits||0}件 / 解析成功 ${freeFound.candidates?.length||0}件`
          : '無料検索情報なし';
        diag(`音域検索エラー / ${extra}`);
        if(statusEl)statusEl.textContent='音域検索に失敗しました。キー/BPMは残しています。無料検索は次回も試せます。手入力でも判定できます。';
      }
    }finally{
      btn.disabled=false;
      btn.textContent=oldText;
    }
  };

  if(statusEl)statusEl.textContent=getJinaKey()
    ? '音域検索：無料WEB優先 / 予備検索APIも準備OK'
    : '音域検索：無料WEB優先。予備検索APIは未設定でも使えます。';

  diag(getJinaKey()?'無料優先モード v4.4.4 / 予備APIあり':'無料優先モード v4.4.4');
})();