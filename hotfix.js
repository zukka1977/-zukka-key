(() => {
  const btn = document.getElementById('autoLookupBtn');
  if (!btn || typeof btn.onclick !== 'function') return;

  const originalLookup = btn.onclick;

  const norm = (v) =>
    String(v || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s　・･\-–—_「」『』【】()[\]（）]/g, '');

  const shiftLabel = (v) => {
    const n = Number(v);
    return n === 0 ? '±0' : n > 0 ? `+${n}` : `${n}`;
  };

  // これまで会話で実測済みの基準曲。
  // localStorage の歌唱ログがあれば、そちらを優先する。
  const confirmedBaseline = [
    {title:'化粧', artist:'清水翔太', shift:-1, rating:5},
    {title:'駅', artist:'徳永英明', shift:-1, rating:5},
    {title:'会いたい', artist:'徳永英明', shift:0, rating:5},
    {title:'OH MY LITTLE GIRL', artist:'尾崎豊', shift:-1, rating:4},
    {title:'君がいるだけで', artist:'米米CLUB', shift:0, rating:5},
    {title:'今夜の涙は最高', artist:'チェッカーズ', shift:0, rating:5},
    {title:'メロディー', artist:'玉置浩二', shift:0, rating:5},
    {title:'プルシアンブルーの肖像', artist:'安全地帯', shift:0, rating:5}
  ];

  function allMeasuredLogs() {
    let saved = [];
    try {
      const d = JSON.parse(localStorage.getItem('zukka-key-data-v1') || '{}');
      if (Array.isArray(d.logs)) saved = d.logs;
    } catch (_) {}

    // 保存ログを先に置く。ユーザーが後から更新した実測を優先する。
    return [...saved, ...confirmedBaseline].filter(x => Number(x.rating || 0) >= 4);
  }

  function matchMeasured(title, artist) {
    const qt = norm(title);
    const qa = norm(artist);
    if (!qt) return null;

    const candidates = allMeasuredLogs()
      .map((log, index) => {
        const lt = norm(log.title);
        const la = norm(log.artist);

        let score = 0;
        if (lt === qt) score += 200;
        else if (qt.length >= 2 && (lt.includes(qt) || qt.includes(lt))) score += 70;
        else return null;

        if (qa) {
          if (la === qa) score += 200;
          else if (qa.length >= 2 && (la.includes(qa) || qa.includes(la))) score += 70;
          else return null;
        }

        score += Number(log.rating || 0) * 5;
        // 保存ログを baseline より優先
        if (index < allMeasuredLogs().length - confirmedBaseline.length) score += 20;

        return {log, score};
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.log || null;
  }

  function forceMeasuredResult(queryTitle, queryArtist, measured) {
    const songTitle = document.getElementById('songTitle');
    const artist = document.getElementById('artist');
    if (songTitle) songTitle.value = queryTitle;
    if (artist) artist.value = queryArtist;

    const personal = document.getElementById('personalKeyStatus');
    if (personal) {
      personal.textContent = shiftLabel(measured.shift);
      personal.className = 'ok';
    }

    const rangeStatus = document.getElementById('rangeDataStatus');
    if (rangeStatus) {
      rangeStatus.textContent = '実測あり';
      rangeStatus.className = 'ok';
    }

    const rangeNote = document.getElementById('rangeDataNote');
    if (rangeNote) {
      rangeNote.textContent =
        `歌唱ログ一致：${queryTitle} / ${queryArtist}。実際に歌って確認したキーを最優先します。`;
    }

    const badge = document.getElementById('rangeSourceBadge');
    if (badge) badge.textContent = '歌唱実績';

    const apiStatus = document.getElementById('apiStatus');
    if (apiStatus) {
      apiStatus.textContent =
        `実測ログを発見。APIの曲名・アーティスト表記に関係なく、実測 ${shiftLabel(measured.shift)} を最優先しました。`;
    }

    const card = document.getElementById('resultCard');
    if (card) card.classList.remove('hidden');

    const bestKey = document.getElementById('bestKey');
    if (bestKey) bestKey.textContent = shiftLabel(measured.shift);

    const title = document.getElementById('resultTitle');
    if (title) title.textContent = `実測ベスト ${shiftLabel(measured.shift)}`;

    const reason = document.getElementById('resultReason');
    if (reason) {
      reason.textContent =
        `この曲は過去の歌唱結果で「${Number(measured.rating) === 5 ? 'ドンピシャ' : '歌いやすい'}」と確認済み。モデル計算より実測を優先しています。`;
    }

    const meta = document.getElementById('resultMeta');
    const originalKey = document.getElementById('originalKey')?.textContent || '';
    const bpm = document.getElementById('originalBpm')?.textContent || '';
    if (meta) {
      const bits = [];
      if (originalKey && originalKey !== '—') bits.push(`原曲 ${originalKey}`);
      if (bpm && bpm !== '—') bits.push(`${bpm} BPM`);
      bits.push('判定: 実測ログ');
      meta.textContent = bits.join(' / ');
    }
  }

  btn.onclick = async function(event) {
    const titleEl = document.getElementById('songTitle');
    const artistEl = document.getElementById('artist');

    const queryTitle = titleEl?.value?.trim() || '';
    const queryArtist = artistEl?.value?.trim() || '';

    // APIが入力欄を書き換える前に、実測ログを確定しておく。
    const measured = matchMeasured(queryTitle, queryArtist);

    try {
      await originalLookup.call(this, event);
    } finally {
      // API側の表記に書き換わっても、検索した本人の入力へ戻す。
      if (titleEl) titleEl.value = queryTitle;
      if (artistEl) artistEl.value = queryArtist;

      if (measured) {
        forceMeasuredResult(queryTitle, queryArtist, measured);
      }
    }
  };
})();