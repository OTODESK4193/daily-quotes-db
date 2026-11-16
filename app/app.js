/* 今日の言葉 — 静的版アプリ本体
 * 前半は端末非依存のコアロジック (Nodeでの検証にも使う)、後半がブラウザUI。
 * UIは Muse版 (App.tsx) の構成に一致させた移植。唯一の差分は ◀▶ 行の省略。
 */
(function () {
  'use strict';

  /* ================= コアロジック ================= */

  var GROUPS = [
    '政治・社会', '哲学・思想', '文学', '宗教・精神',
    '科学・学問', '芸術・音楽・映画', '芸能・スポーツ', 'その他'
  ];

  var KEYS = {
    rotation: 'kotoba.rotation.v1',
    favorites: 'kotoba.favorites.v1',
    history: 'kotoba.history.v1',
    theme: 'kotoba.theme.v1'
  };

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* localStorage互換の raw ストレージを JSON 読み書きラッパに変換 */
  function jsonStorage(raw) {
    return {
      read: function (key, fallback) {
        try {
          var v = raw.getItem(key);
          return v === null || v === undefined ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
      },
      write: function (key, value) {
        try { raw.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存失敗は無視 */ }
      }
    };
  }

  function createMemoryStorage() {
    var m = {};
    return jsonStorage({
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); }
    });
  }

  /* データ更新への追随: 消えたIDを除外し、新規IDはシャッフルして末尾に追加 */
  function reconcileOrder(order, ids, rng) {
    var valid = {};
    ids.forEach(function (id) { valid[id] = true; });
    var kept = order.filter(function (id) { return valid[id]; });
    var seen = {};
    kept.forEach(function (id) { seen[id] = true; });
    var added = shuffle(ids.filter(function (id) { return !seen[id]; }), rng);
    return kept.concat(added);
  }

  /*
   * 今日の言葉を解決する。
   * - 同日: 同じ言葉
   * - 別日: +1だけ前進 (何日空けても飛ばさない)
   * - 一巡の終わり: 再シャッフルして新しい一巡の1件目
   * 戻り値: { quote, position (1始まり), total, cycle }
   */
  function resolveToday(store, quotes, todayStr, rng) {
    rng = rng || Math.random;
    var byId = {};
    quotes.forEach(function (q) { byId[q.id] = q; });
    var ids = quotes.map(function (q) { return q.id; });

    var state = store.read(KEYS.rotation, null);
    var fresh = false;
    if (!state || !Array.isArray(state.order) || state.order.length === 0) {
      state = { order: shuffle(ids, rng), pos: 0, lastDate: todayStr, cycle: 1 };
      fresh = true;
    } else {
      var before = state.order.join(' ');
      state.order = reconcileOrder(state.order, ids, rng);
      if (state.order.join(' ') !== before) {
        if (state.pos >= state.order.length) state.pos = state.order.length - 1;
        if (state.pos < 0) state.pos = 0;
      }
      if (state.lastDate !== todayStr && state.lastDate < todayStr) {
        state.pos += 1;
        if (state.pos >= state.order.length) {
          state.order = shuffle(ids, rng);
          state.pos = 0;
          state.cycle = (state.cycle || 1) + 1;
        }
        state.lastDate = todayStr;
        fresh = true;
      }
    }

    var quote = byId[state.order[state.pos]];
    if (fresh) {
      var history = store.read(KEYS.history, []);
      var top = history[0];
      if (!top || top.id !== quote.id || top.date !== todayStr) {
        history.unshift({ id: quote.id, date: todayStr, pos: state.pos + 1, cycle: state.cycle });
        if (history.length > 1000) history.length = 1000;
        store.write(KEYS.history, history);
      }
    }
    store.write(KEYS.rotation, state);
    return { quote: quote, position: state.pos + 1, total: state.order.length, cycle: state.cycle };
  }

  /* ---- お気に入り (新しい順に保持) ---- */
  function getFavorites(store) {
    var favs = store.read(KEYS.favorites, []);
    return Array.isArray(favs) ? favs : [];
  }
  function isFavorite(store, id) {
    return getFavorites(store).indexOf(id) >= 0;
  }
  function toggleFavorite(store, id) {
    var favs = getFavorites(store);
    var i = favs.indexOf(id);
    if (i >= 0) { favs.splice(i, 1); } else { favs.unshift(id); }
    store.write(KEYS.favorites, favs);
    return i < 0;
  }

  function getHistory(store) {
    var h = store.read(KEYS.history, []);
    return Array.isArray(h) ? h : [];
  }

  /* ---- 検索: キーワード (人物名/原文/和訳/書き下し/タグ) + 大分類 + 確度 ---- */
  function searchQuotes(quotes, criteria) {
    var keyword = (criteria.keyword || '').trim().toLowerCase();
    var tokens = keyword ? keyword.split(/\s+/) : [];
    return quotes.filter(function (q) {
      if (criteria.group && q.category_group !== criteria.group) return false;
      if (criteria.grade && q.grade !== criteria.grade) return false;
      if (tokens.length) {
        var hay = [
          q.person_ja, q.person_original, q.quote_original, q.quote_ja,
          q.quote_reading || '', (q.tags || []).join(' ')
        ].join('\n').toLowerCase();
        for (var i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) < 0) return false;
        }
      }
      return true;
    });
  }

  /* ---- 表示用ヘルパー (Muse版の文言に一致) ---- */
  function gradeLabel(grade) {
    if (grade === 'A') return 'A 出典確実';
    if (grade === 'B') return 'B 伝承あり';
    return 'C 帰属に疑義';
  }
  function typeLabel(type) {
    if (type === 'meigen_mayo') return '迷言寄りの名言';
    if (type === 'dokugen') return '毒のある言葉';
    return '名言';
  }
  function isJapaneseOriginal(q) {
    return (q.language || '').indexOf('日本語') >= 0;
  }
  function mainText(q) {
    return isJapaneseOriginal(q) ? q.quote_original : (q.quote_ja || q.quote_original);
  }
  /* 主役テキストの長さで5段階 (17–30px) */
  function fontSizeClass(text) {
    var len = (text || '').length;
    if (len <= 25) return 'fs-1';
    if (len <= 50) return 'fs-2';
    if (len <= 90) return 'fs-3';
    if (len <= 150) return 'fs-4';
    return 'fs-5';
  }
  /* 外国語の原文は小さめの4段階 (15–20px) */
  function originalSizeClass(text) {
    var len = (text || '').length;
    if (len <= 40) return 'os-1';
    if (len <= 90) return 'os-2';
    if (len <= 160) return 'os-3';
    return 'os-4';
  }
  function attribution(q) {
    return q.grade === 'C' ? q.person_ja + 'の言葉として伝わる' : q.person_ja;
  }
  function shareText(q) {
    return '『' + mainText(q) + '』\n— ' + attribution(q) + '\n#今日の言葉';
  }
  function shareUrl(q) {
    return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText(q));
  }
  function todayString(d) {
    d = d || new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  var core = {
    GROUPS: GROUPS, KEYS: KEYS,
    shuffle: shuffle, jsonStorage: jsonStorage, createMemoryStorage: createMemoryStorage,
    reconcileOrder: reconcileOrder, resolveToday: resolveToday,
    getFavorites: getFavorites, isFavorite: isFavorite, toggleFavorite: toggleFavorite,
    getHistory: getHistory, searchQuotes: searchQuotes,
    gradeLabel: gradeLabel, typeLabel: typeLabel,
    isJapaneseOriginal: isJapaneseOriginal, mainText: mainText,
    fontSizeClass: fontSizeClass, originalSizeClass: originalSizeClass,
    attribution: attribution, shareText: shareText, shareUrl: shareUrl,
    todayString: todayString
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }
  if (typeof document === 'undefined' || typeof QUOTES_DATA === 'undefined') {
    return; // Node検証時など、UIは起動しない
  }

  /* ================= ブラウザUI ================= */

  var store = jsonStorage(window.localStorage);
  var byId = {};
  QUOTES_DATA.forEach(function (q) { byId[q.id] = q; });

  var currentView = 'home';
  var detailBack = 'home';
  var detailId = null;
  var todayResult = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---- テーマ ---- */
  function themePref() {
    var t = store.read(KEYS.theme, 'auto');
    return (t === 'light' || t === 'dark') ? t : 'auto';
  }
  function applyTheme() {
    var pref = themePref();
    var dark = pref === 'dark' ||
      (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('theme-toggle').textContent =
      'テーマ：' + (pref === 'auto' ? '端末' : pref === 'light' ? 'ライト' : 'ダーク');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#141311' : '#faf8f3');
  }
  $('theme-toggle').addEventListener('click', function () {
    var order = ['auto', 'light', 'dark'];
    var next = order[(order.indexOf(themePref()) + 1) % order.length];
    store.write(KEYS.theme, next);
    applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---- 画面遷移 ---- */
  function show(view) {
    currentView = view;
    ['home', 'detail', 'search', 'favorites', 'history'].forEach(function (v) {
      $('view-' + v).hidden = v !== view;
    });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-nav]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-nav');
      if (v === 'search') renderSearch();
      if (v === 'favorites') renderFavorites();
      if (v === 'history') renderHistory();
      show(v);
    });
  });

  /* ---- 言葉フレームの描画 (ホーム/詳細 共通、Muse版 QuoteText の順序) ---- */
  function renderFrame(container, q) {
    container.textContent = '';
    if (isJapaneseOriginal(q)) {
      container.appendChild(el('p', 'quote-main ' + fontSizeClass(q.quote_original), q.quote_original));
    } else {
      container.appendChild(el('p', 'quote-original ' + originalSizeClass(q.quote_original), q.quote_original));
      if (q.quote_reading) {
        var rw = el('div', 'reading-wrap');
        rw.appendChild(el('span', 'reading-label', '書き下し'));
        rw.appendChild(el('p', 'quote-reading', q.quote_reading));
        container.appendChild(rw);
      }
      if (q.quote_ja && q.quote_ja !== q.quote_original) {
        container.appendChild(el('p', 'quote-main ' + fontSizeClass(q.quote_ja), q.quote_ja));
      }
      if (q.language) {
        container.appendChild(el('p', 'origin-line', '原文：' + q.language));
      }
    }
    var meta = el('div', 'frame-meta');
    var badges = el('div', 'badge-row');
    badges.appendChild(el('span',
      'badge' + (q.grade === 'C' ? ' badge-grade-c' : ''), gradeLabel(q.grade)));
    badges.appendChild(el('span', 'meta-text', typeLabel(q.type)));
    if (q.category || q.region) {
      badges.appendChild(el('span', 'meta-text',
        [q.category, q.region].filter(Boolean).join('・')));
    }
    meta.appendChild(badges);
    var nameLine = el('p', 'person-name', q.person_ja);
    if (q.grade === 'C') {
      nameLine.appendChild(el('span', 'c-note', 'の言葉として伝わる'));
    }
    if (q.person_original && q.person_original !== q.person_ja) {
      nameLine.appendChild(el('span', 'person-original', q.person_original));
    }
    if (q.person_years) {
      nameLine.appendChild(el('span', 'person-years', q.person_years));
    }
    meta.appendChild(nameLine);
    container.appendChild(meta);
  }

  function favButton(btn, id) {
    var fav = isFavorite(store, id);
    btn.textContent = fav ? '★ お気に入り' : '☆ お気に入り';
    btn.classList.toggle('is-fav', fav);
  }

  /* ---- ホーム ---- */
  function renderHome() {
    var now = new Date();
    $('home-date').textContent = now.toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    });
    todayResult = resolveToday(store, QUOTES_DATA, todayString(now));
    var q = todayResult.quote;
    renderFrame($('home-frame'), q);
    favButton($('home-fav'), q.id);
    $('home-share').href = shareUrl(q);
    $('home-meaning').textContent = q.meaning;
    $('home-source').textContent = q.source;
  }
  $('home-tap').addEventListener('click', function () {
    if (todayResult) openDetail(todayResult.quote.id, 'home');
  });
  $('home-fav').addEventListener('click', function () {
    if (!todayResult) return;
    toggleFavorite(store, todayResult.quote.id);
    favButton($('home-fav'), todayResult.quote.id);
  });

  /* ---- 詳細 (Muse版 DetailView の見出しと順序) ---- */
  function section(title, text) {
    var wrap = el('div', 'section');
    wrap.appendChild(el('h2', 'section-title', title));
    wrap.appendChild(el('p', 'body-text', text));
    return wrap;
  }
  function openDetail(id, back) {
    var q = byId[id];
    if (!q) return;
    detailId = id;
    detailBack = back || 'home';
    renderFrame($('detail-frame'), q);

    var bioWrap = $('detail-bio-wrap');
    if (q.person_bio) {
      bioWrap.hidden = false;
      $('detail-bio').textContent = q.person_bio;
    } else {
      bioWrap.hidden = true;
    }
    favButton($('detail-fav'), q.id);
    $('detail-share').href = shareUrl(q);

    var box = $('detail-sections');
    box.textContent = '';
    box.appendChild(section('詳しい解説', q.meaning));
    box.appendChild(section('機知に富んだ解説', q.critical_view));
    box.appendChild(section('裏話', q.background));
    var src = el('div', 'section');
    src.appendChild(el('h2', 'section-title', '出典'));
    src.appendChild(el('p', 'body-text', q.source));
    if (q.source_detail) src.appendChild(el('p', 'body-text', q.source_detail));
    box.appendChild(src);
    box.appendChild(section('確度の根拠', q.authenticity_note));
    if (q.tags && q.tags.length) {
      var tagWrap = el('div', 'section');
      var row = el('div', 'tag-row');
      q.tags.forEach(function (t) { row.appendChild(el('span', 'tag-chip', t)); });
      tagWrap.appendChild(row);
      box.appendChild(tagWrap);
    }

    var same = QUOTES_DATA.filter(function (o) {
      return o.person_ja === q.person_ja && o.id !== q.id;
    });
    var sameWrap = $('detail-same-wrap');
    var sameBox = $('detail-same');
    sameBox.textContent = '';
    if (same.length) {
      sameWrap.hidden = false;
      $('detail-same-title').textContent = '同じ人物の言葉（' + same.length + '件）';
      same.forEach(function (o) { sameBox.appendChild(listItem(o, null)); });
    } else {
      sameWrap.hidden = true;
    }
    show('detail');
  }
  $('detail-back').addEventListener('click', function () { show(detailBack); });
  $('detail-fav').addEventListener('click', function () {
    if (!detailId) return;
    toggleFavorite(store, detailId);
    favButton($('detail-fav'), detailId);
    if (todayResult && todayResult.quote.id === detailId) {
      favButton($('home-fav'), detailId);
    }
  });

  /* ---- 一覧アイテム (検索/お気に入り/履歴 共通) ---- */
  function listItem(q, subText) {
    var item = el('button', 'list-item');
    item.type = 'button';
    var main = el('div', 'list-item-main');
    main.appendChild(el('p', 'list-item-quote', mainText(q)));
    main.appendChild(el('p', 'list-item-sub',
      q.person_ja + (subText ? ' ・ ' + subText : '')));
    item.appendChild(main);
    item.appendChild(el('span',
      'badge' + (q.grade === 'C' ? ' badge-grade-c' : ''), q.grade));
    item.addEventListener('click', function () { openDetail(q.id, currentView); });
    return item;
  }

  /* ---- 検索 ---- */
  var groupSelect = $('search-group');
  groupSelect.appendChild(el('option', null, 'すべて'));
  groupSelect.options[0].value = '';
  GROUPS.forEach(function (g) {
    var o = el('option', null, g);
    o.value = g;
    groupSelect.appendChild(o);
  });
  function renderSearch() {
    var results = searchQuotes(QUOTES_DATA, {
      keyword: $('search-keyword').value,
      group: groupSelect.value,
      grade: $('search-grade').value
    });
    $('search-count').textContent = results.length + ' 件';
    var box = $('search-results');
    box.textContent = '';
    results.forEach(function (q) { box.appendChild(listItem(q, q.category_group)); });
  }
  $('search-keyword').addEventListener('input', renderSearch);
  groupSelect.addEventListener('change', renderSearch);
  $('search-grade').addEventListener('change', renderSearch);

  /* ---- お気に入り一覧 ---- */
  function renderFavorites() {
    var favs = getFavorites(store).map(function (id) { return byId[id]; })
      .filter(function (q) { return !!q; });
    var box = $('favorites-list');
    box.textContent = '';
    $('favorites-empty').hidden = favs.length > 0;
    favs.forEach(function (q) {
      var item = listItem(q, null);
      var btn = el('button', 'fav-btn is-fav', '★ 解除');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'お気に入り解除');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleFavorite(store, q.id);
        renderFavorites();
        if (todayResult && todayResult.quote.id === q.id) favButton($('home-fav'), q.id);
        if (detailId === q.id) favButton($('detail-fav'), q.id);
      });
      item.appendChild(btn);
      box.appendChild(item);
    });
  }

  /* ---- 履歴 ---- */
  function renderHistory() {
    var hist = getHistory(store);
    var box = $('history-list');
    box.textContent = '';
    $('history-empty').hidden = hist.length > 0;
    hist.forEach(function (h) {
      var q = byId[h.id];
      if (!q) return;
      box.appendChild(listItem(q, h.date + ' ・ ' + h.pos + ' 件目'));
    });
  }

  /* ---- 起動 ---- */
  applyTheme();
  renderHome();
  show('home');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 未対応環境では無視 */ });
    });
  }
})();
