(() => {
  const VERSION = '4.2.0';
  const JINA_KEY_STORAGE = 'zukka-key-jina-api-key';
  const btn = document.getElementById('autoLookupBtn');
  const keyBtn = document.getElementById('rangeApiKeyBtn');
  const statusEl = document.getElementById('rangeSearchStatus');

  if (!btn || typeof btn.onclick !== 'function') return;

  const previousLookup = btn.onclick;

  const norm = (v) =>
    String(v || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s　・･\-–—_「」『』【】()[\]（）"'’]/g, '');

  const notePc = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};

  function accidentalOffset(acc) {
    if (acc === '#' || acc === '♯') return 1;
    if (acc === 'b' || acc === '♭') return -1;
    return 0;
  }

  function tokenToMidi(token) {
    if (!token) return null;
    const t = String(token).trim().replace(/＃/g, '#');

    // Scientific pitch notation, e.g. F#3 / C5.
    let m = t.match(/^([A-Ga-g])([#♯b♭]?)(-?\d)$/);
    if (m) {
      const letter = m[1].toUpperCase();
      const oct = Number(m[3]);
      return 12 * (oct + 1) + notePc[letter] + accidentalOffset(m[2]);
    }

    // Japanese karaoke notation:
    // mid2C = C4, hiA = A4, hihiA = A5.
    m = t.match(/^(hihihi|hihi|hi|mid2|mid1|low)([A-Ga-g])([#♯b♭]?)$/i);
    if (!m) return null;

    const prefix = m[1].toLowerCase();
    const letter = m[2].toUpperCase();
    const cOctave = ({low:2, mid1:3, mid2:4, hi:5, hihi:6, hihihi:7})[prefix];
    if (cOctave == null) return null;

    const actualOctave = (letter === 'A' || letter === 'B') ? cOctave - 1 : cOctave;
    return 12 * (actualOctave + 1) + notePc[letter] + accidentalOffset(m[3]);
  }

  function midiLabel(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const n = Number(midi);
    if (!Number.isFinite(n)) return '—';
    return names[(n % 12 + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  const NOTE_TOKEN = '(?:hihihi|hihi|hi|mid2|mid1|low)[A-G](?:[#♯b♭])?|[A-G](?:[#♯b♭])?[1-7]';
  const noteTokenRe = new RegExp(NOTE_TOKEN, 'i');

  function extractNoteFromLabel(content, labels, rejectWords=[]) {
    const lines = String(content || '').split(/\r?\n/);
    for (const label of labels) {
      for (const line of lines) {
        if (!line.includes(label)) continue;
        if (rejectWords.some(w => line.includes(w))) continue;
        const m = line.match(noteTokenRe);
        if (m) {
          const midi = tokenToMidi(m[0]);
          if (Number.isFinite(midi)) return midi;
        }
      }
    }
    return null;
  }

  function extractRangeFromLabel(content, labels) {
    const lines = String(content || '').split(/\r?\n/);
    for (const label of labels) {
      for (const line of lines) {
        if (!line.includes(label)) continue;
        const matches = [...line.matchAll(new RegExp(NOTE_TOKEN, 'ig'))].map(x => x[0]);
        if (matches.length >= 2) {
          const a = tokenToMidi(matches[0]);
          const b = tokenToMidi(matches[1]);
          if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
        }
      }
    }
    return null;
  }

  function parseKkti(item) {
    const content = String(item.content || '');
    const url = String(item.url || '');
    if (!/kkti\.app\/key\/songs\//i.test(url)) return null;

    let low = extractNoteFromLabel(content, ['最低音']);
    let high = extractNoteFromLabel(content, ['最高音'], ['母音']);
    const stable = extractRangeFromLabel(content, ['安定音域']);

    // Fallback: "音域はmid1F# 〜 hiA"
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes('音域は')) continue;
        const matches = [...line.matchAll(new RegExp(NOTE_TOKEN, 'ig'))].map(x => x[0]);
        if (matches.length >= 2) {
          low = low ?? tokenToMidi(matches[0]);
          high = high ?? tokenToMidi(matches[1]);
          break;
        }
      }
    }

    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;

    let chorus = stable && Number.isFinite(stable[1]) ? stable[1] : Math.max(low + 4, high - 2);
    chorus = Math.min(chorus, high);

    const gap = high - chorus;
    const density = gap <= 1 ? 4 : gap <= 3 ? 3 : 2;

    return {
      low,
      peak: high,
      chorus,
      falsetto: null,
      density,
      source: 'WEB / KKTI',
      confidence: stable ? '高' : '中',
      sourceUrl: url,
      sourceTitle: item.title || 'KKTI'
    };
  }

  function getSearchItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.search)) return payload.search;
    return [];
  }

  function scoreItem(item, title, artist) {
    const hay = norm(`${item.title || ''} ${item.content || ''}`);
    const qt = norm(title);
    const qa = norm(artist);
    let score = 0;

    if (/kkti\.app\/key\/songs\//i.test(item.url || '')) score += 80;
    if (qt && hay.includes(qt)) score += 150;
    else return -999;

    if (qa) {
      if (hay.includes(qa)) score += 120;
      else return -999;
    }
    return score;
  }

  function ensureSelectValue(select, midi) {
    if (!select || midi == null) return;
    const value = String(midi);
    if (![...select.options].some(o => o.value === value)) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = midiLabel(midi);
      select.append(o);
      [...select.options]
        .sort((a,b) => {
          const av = a.value === '' ? -999 : Number(a.value);
          const bv = b.value === '' ? -999 : Number(b.value);
          return av - bv;
        })
        .forEach(o2 => select.append(o2));
    }
    select.value = value;
  }

  function applyWebRange(range, queryTitle, queryArtist) {
    ensureSelectValue(document.getElementById('chorusTop'), range.chorus);
    ensureSelectValue(document.getElementById('chestPeak'), range.peak);
    const f = document.getElementById('falsettoPeak');
    if (f) f.value = range.falsetto == null ? '' : String(range.falsetto);
    ensureSelectValue(document.getElementById('lowNote'), range.low);

    const density = document.getElementById('highDensity');
    if (density) {
      density.value = String(range.density || 3);
      if (typeof density.oninput === 'function') density.oninput();
    }

    // Persist for later searches using the app's existing range library.
    try {
      if (typeof songIdentity === 'function' && typeof rangeLibrary !== 'undefined') {
        const id = songIdentity(queryTitle, queryArtist);
        rangeLibrary[id] = {
          chorus: range.chorus,
          peak: range.peak,
          falsetto: range.falsetto,
          low: range.low,
          density: range.density,
          source: range.source,
          confidence: range.confidence,
          sourceUrl: range.sourceUrl,
          title: queryTitle,
          artist: queryArtist
        };
        if (typeof saveRanges === 'function') saveRanges();
      }
    } catch (_) {}

    try {
      if (typeof setRangeUi === 'function') setRangeUi(range);
      if (typeof currentRangeSource !== 'undefined') currentRangeSource = range.source;
    } catch (_) {}

    const rangeStatus = document.getElementById('rangeDataStatus');
    if (rangeStatus) {
      rangeStatus.textContent = 'WEB取得';
      rangeStatus.className = 'ok';
    }

    const badge = document.getElementById('rangeSourceBadge');
    if (badge) badge.textContent = range.source;

    const note = document.getElementById('rangeDataNote');
    if (note) {
      note.innerHTML =
        `最低 ${midiLabel(range.low)} / 常用高音 ${midiLabel(range.chorus)} / 最高 ${midiLabel(range.peak)}。` +
        ` <a href="${range.sourceUrl}" target="_blank" rel="noopener" style="color:#83b8ff">出典: KKTI</a>` +
        `（信頼度 ${range.confidence}）`;
    }

    if (typeof runPrediction === 'function') {
      runPrediction({scroll:false});
      const personal = document.getElementById('personalKeyStatus');
      const best = document.getElementById('bestKey');
      if (personal && best) {
        personal.textContent = best.textContent;
        personal.className = 'ok';
      }
    }
  }

  function getJinaKey() {
    return localStorage.getItem(JINA_KEY_STORAGE) || '';
  }

  function setJinaKey() {
    const current = getJinaKey();
    const value = prompt(
      'Jina Search APIキーを入力してください。\n初めての曲の音域をWEB検索するために使います。\nキーはGitHubには保存せず、この端末内だけに保存します。',
      current
    );
    if (value === null) return false;
    const clean = value.trim();
    if (!clean) {
      localStorage.removeItem(JINA_KEY_STORAGE);
      if (statusEl) statusEl.textContent = '音域検索APIキーを削除しました。';
      return false;
    }
    localStorage.setItem(JINA_KEY_STORAGE, clean);
    if (statusEl) statusEl.textContent = '音域検索APIキーをこの端末に保存しました。';
    return true;
  }

  if (keyBtn) keyBtn.onclick = setJinaKey;

  async function searchKktiRange(title, artist) {
    const key = getJinaKey();
    if (!key) return {needsKey:true};

    const q = `site:kkti.app/key/songs/ "${title}" "${artist}" 音域 最高音 最低音 安定音域`;
    const url = `https://s.jina.ai/?q=${encodeURIComponent(q)}`;

    const res = await fetch(url, {
      method:'GET',
      mode:'cors',
      cache:'no-store',
      headers:{
        'Authorization':`Bearer ${key}`,
        'Accept':'application/json'
      }
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('JINA_AUTH');
    }
    if (!res.ok) throw new Error(`JINA_HTTP_${res.status}`);

    const payload = await res.json();
    const items = getSearchItems(payload)
      .map(item => ({...item, _score:scoreItem(item,title,artist)}))
      .filter(item => item._score > 0)
      .sort((a,b) => b._score - a._score);

    for (const item of items) {
      const range = parseKkti(item);
      if (range) return {range,item};
    }
    return {range:null};
  }

  function alreadyHasMeasuredResult() {
    const title = document.getElementById('resultTitle')?.textContent || '';
    const apiStatus = document.getElementById('apiStatus')?.textContent || '';
    return title.includes('実測ベスト') || apiStatus.includes('実測ログ');
  }

  function alreadyHasRange() {
    const status = document.getElementById('rangeDataStatus')?.textContent || '';
    return status === 'あり' || status === 'WEB取得' || status === '実測あり';
  }

  btn.onclick = async function(event) {
    const titleEl = document.getElementById('songTitle');
    const artistEl = document.getElementById('artist');
    const queryTitle = titleEl?.value?.trim() || '';
    const queryArtist = artistEl?.value?.trim() || '';

    await previousLookup.call(this, event);

    // Personal measured data always beats web data.
    if (alreadyHasMeasuredResult()) {
      if (statusEl) statusEl.textContent = '実測ログを優先しました。WEB音域検索は不要です。';
      return;
    }
    if (alreadyHasRange()) {
      if (statusEl) statusEl.textContent = '保存済み音域を使用しました。';
      return;
    }
    if (!queryTitle) return;

    if (!getJinaKey()) {
      if (statusEl) statusEl.innerHTML =
        '初めての曲です。音域を自動取得するには「音域API設定」でJina無料キーを登録してください。';
      return;
    }

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'WEB音域検索中…';
    if (statusEl) statusEl.textContent = 'KKTIの楽曲音域を検索しています…';

    try {
      const found = await searchKktiRange(queryTitle, queryArtist);
      if (found.needsKey) {
        if (statusEl) statusEl.textContent = '音域APIキーを設定してください。';
        return;
      }
      if (!found.range) {
        if (statusEl) statusEl.textContent =
          'KKTIで一致する音域データを確認できませんでした。手入力で保存するか、別ソース対応を待ってください。';
        return;
      }

      // Restore the user's query text if another API normalized/replaced it.
      if (titleEl) titleEl.value = queryTitle;
      if (artistEl) artistEl.value = queryArtist;

      applyWebRange(found.range, queryTitle, queryArtist);

      const apiStatus = document.getElementById('apiStatus');
      if (apiStatus) {
        apiStatus.textContent =
          '原曲キー/BPM + WEB音域データ + ずっかの声プロフィールから推奨キーを自動判定しました。';
      }
      if (statusEl) {
        statusEl.textContent =
          `音域自動取得成功：${midiLabel(found.range.low)}〜${midiLabel(found.range.peak)}（${found.range.source}）`;
      }
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.textContent =
          String(err?.message) === 'JINA_AUTH'
            ? 'Jina APIキーが無効です。「音域API設定」から入れ直してください。'
            : 'WEB音域検索に失敗しました。通信状態またはJina APIの利用状況を確認してください。';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  };

  if (statusEl) {
    statusEl.textContent = getJinaKey()
      ? 'WEB音域検索：準備OK（Jina → KKTI）'
      : '初めての曲はWEB音域検索を使います。音域APIキーは未設定です。';
  }
})();