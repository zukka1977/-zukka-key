(() => {
  const originalAutoLookup = window.autoLookup;
  if (typeof originalAutoLookup !== 'function') return;

  window.autoLookup = async function(...args) {
    const queryTitle = window.songTitle?.value?.trim() || '';
    const queryArtist = window.artist?.value?.trim() || '';
    const knownFromQuery =
      typeof window.findGoodLog === 'function'
        ? window.findGoodLog(queryTitle, queryArtist)
        : null;

    await originalAutoLookup.apply(this, args);

    if (knownFromQuery && typeof window.runPrediction === 'function') {
      window.runPrediction({ confirmedLog: knownFromQuery, scroll: false });

      if (window.personalKeyStatus) {
        window.personalKeyStatus.textContent =
          typeof window.shiftLabel === 'function'
            ? window.shiftLabel(knownFromQuery.shift)
            : String(knownFromQuery.shift);
        window.personalKeyStatus.className = 'ok';
      }

      if (window.apiStatus) {
        window.apiStatus.textContent =
          '過去の歌唱実績を発見。検索前の曲名・アーティストを基準に、実測キーを最優先で表示しました。';
      }
    }
  };

  if (window.autoLookupBtn) {
    window.autoLookupBtn.onclick = window.autoLookup;
  }
})();