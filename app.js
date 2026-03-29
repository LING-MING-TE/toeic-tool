'use strict';

/* =====================
   State
   ===================== */
const state = {
  words: [],
  filtered: [],
  currentView: 'library',
  searchQuery: '',
  sortOrder: 'alpha-az',
  libraryCategory: 'all',
  reviewedIndices: new Set(),
  currentCardIndex: null,
  cardFlipped: false,
  sentenceRevealed: false,
  accent: 'en-US',
  reviewMode: 'due',
  sessionDueCount: 0,
  articleType: 'dialogue',     // 'dialogue' | 'monologue' | 'double'
  articleCategory: 'all',
};

/* =====================
   TOEIC 分類清單
   ===================== */
const TOEIC_CATEGORIES = [
  { id: 'travel',               label: '旅遊' },
  { id: 'dining-out',           label: '餐飲' },
  { id: 'entertainment',        label: '娛樂' },
  { id: 'housing',              label: '居住' },
  { id: 'purchasing',           label: '採購' },
  { id: 'personnel',            label: '人事' },
  { id: 'offices',              label: '辦公室' },
  { id: 'health',               label: '健康' },
  { id: 'general-business',     label: '一般商業' },
  { id: 'manufacturing',        label: '製造業' },
  { id: 'corporate-development',label: '企業發展' },
  { id: 'technical',            label: '技術' },
  { id: 'financing-areas',      label: '財務' },
  { id: 'common',               label: '共用單字' },
];

/* =====================
   Utilities
   ===================== */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =====================
   API Key Module（Gemini）
   ===================== */
const APIKeyModule = {
  KEY: 'gemini-api-key',
  get()  { return localStorage.getItem(this.KEY) || ''; },
  set(k) { localStorage.setItem(this.KEY, k.trim()); },
  has()  { return !!this.get(); },
  clear(){ localStorage.removeItem(this.KEY); },
};

/* =====================
   SRS Module（間隔重複）
   ===================== */
const SRSModule = {
  KEY: 'toeic-srs',
  _data: {},

  load() {
    try { this._data = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch { this._data = {}; }
  },

  save() {
    localStorage.setItem(this.KEY, JSON.stringify(this._data));
  },

  // SM-2 簡化版：remembered=true 表示記得，false 表示忘記
  review(word, remembered) {
    const today = new Date().toISOString().slice(0, 10);
    const card = this._data[word] || { interval: 0, easeFactor: 2.5, repetitions: 0 };
    let { interval, easeFactor, repetitions } = card;

    if (remembered) {
      if (repetitions === 0)      interval = 1;
      else if (repetitions === 1) interval = 6;
      else                        interval = Math.round(interval * easeFactor);
      repetitions++;
    } else {
      interval = 1;
      repetitions = 0;
      easeFactor = Math.max(1.3, easeFactor - 0.15);
    }

    const next = new Date();
    next.setDate(next.getDate() + interval);

    this._data[word] = {
      interval,
      easeFactor: Math.round(easeFactor * 100) / 100,
      repetitions,
      nextReview: next.toISOString().slice(0, 10),
      lastReview: today,
    };
    this.save();
    return this._data[word];
  },

  isDue(word) {
    const card = this._data[word];
    if (!card) return true; // 新單字永遠到期
    return card.nextReview <= new Date().toISOString().slice(0, 10);
  },

  getDueWords(words) {
    return words.filter(w => this.isDue(w.word));
  },

  getStatus(word) {
    const card = this._data[word];
    if (!card) return 'new';
    if (card.interval >= 21) return 'mastered';
    if (this.isDue(word)) return 'due';
    return 'learning';
  },

  getNextReviewLabel(word) {
    const card = this._data[word];
    if (!card) return '';
    const d = card.interval;
    if (d <= 1) return '明天';
    if (d < 7)  return `${d} 天後`;
    if (d < 30) return `${Math.round(d / 7)} 週後`;
    return `${Math.round(d / 30)} 個月後`;
  },
};

/* =====================
   TTS Module
   ===================== */
const TTSModule = {
  _voices: [],

  init() {
    if (!window.speechSynthesis) return;
    const load = () => { this._voices = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
  },

  speak(text) {
    if (!window.speechSynthesis || !text || text === '—') return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = state.accent;
    const langPrefix = state.accent.split('-')[0];
    const match =
      this._voices.find(v => v.lang === state.accent) ||
      this._voices.find(v => v.lang.startsWith(langPrefix));
    if (match) utter.voice = match;
    window.speechSynthesis.speak(utter);
  },
};

/* =====================
   Data Module
   ===================== */
const DataModule = {
  async load() {
    try {
      const res = await fetch('./words.json');
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      state.words = Array.isArray(data) ? data : [];
    } catch {
      state.words = [];
    }
  },
};

/* =====================
   Library Module
   ===================== */
const LibraryModule = {
  render() {
    const q = state.searchQuery.toLowerCase();

    state.filtered = state.words.filter(w => {
      const matchSearch = (w.word ?? '').toLowerCase().includes(q) ||
                          (w.chinese ?? '').includes(q);
      const matchCat = state.libraryCategory === 'all' ||
                       (w.categories || []).includes(state.libraryCategory);
      return matchSearch && matchCat;
    });

    state.filtered.sort((a, b) => {
      switch (state.sortOrder) {
        case 'alpha-az': return (a.word ?? '').localeCompare(b.word ?? '');
        case 'alpha-za': return (b.word ?? '').localeCompare(a.word ?? '');
        case 'date-new': return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
        case 'date-old': return (a.addedAt ?? '').localeCompare(b.addedAt ?? '');
        default: return 0;
      }
    });

    const grid = document.getElementById('word-grid');
    const count = document.getElementById('word-count');

    // Update count label
    const total = state.words.length;
    const showing = state.filtered.length;
    if (q || state.libraryCategory !== 'all') {
      count.textContent = `找到 ${showing} / ${total} 個單字`;
    } else {
      count.textContent = `共 ${total} 個單字`;
    }

    if (state.filtered.length === 0) {
      if (total === 0) {
        grid.innerHTML = `
          <div class="empty-state">
            <strong>字庫是空的</strong>
            在 Claude Code 輸入「新增單字 xxx」來新增第一個單字
          </div>`;
      } else {
        grid.innerHTML = `<div class="empty-state"><strong>沒有結果</strong>找不到符合「${escapeHtml(state.searchQuery)}」的單字</div>`;
      }
      return;
    }

    const srsLabels = {
      new:      { text: '新單字',  cls: 'srs-new' },
      due:      { text: '待複習',  cls: 'srs-due' },
      learning: { text: '',        cls: 'srs-learning' },
      mastered: { text: '已熟練',  cls: 'srs-mastered' },
    };

    grid.innerHTML = state.filtered.map(w => {
      const status = SRSModule.getStatus(w.word);
      const label  = srsLabels[status];
      const badgeText = status === 'learning'
        ? SRSModule.getNextReviewLabel(w.word)
        : label.text;
      const catBadges = (w.categories || []).map(c => {
        const cat = TOEIC_CATEGORIES.find(t => t.id === c);
        return `<span class="cat-badge">${escapeHtml(cat ? cat.label : c)}</span>`;
      }).join('');
      return `
      <article class="word-card">
        <div class="word-title-row">
          <h2 class="word-title">${escapeHtml(w.word)}</h2>
          <span class="srs-badge ${label.cls}">${escapeHtml(badgeText)}</span>
        </div>
        <p class="word-chinese">${escapeHtml(w.chinese)}</p>
        <p class="word-sentence">${escapeHtml(w.sentence)}</p>
        <p class="word-translation">${escapeHtml(w.translation)}</p>
        <div class="word-footer">
          <div class="word-cats">${catBadges}</div>
          <time class="word-date" datetime="${escapeHtml(w.addedAt)}">${escapeHtml(w.addedAt)}</time>
        </div>
      </article>`;
    }).join('');
  },

  exportCSV() {
    if (state.words.length === 0) {
      alert('字庫是空的，無法匯出。');
      return;
    }
    const header = ['word', 'chinese', 'sentence', 'translation', 'addedAt'];
    const rows = state.words.map(w =>
      header.map(k => `"${(w[k] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toeic-words-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

/* =====================
   Review Module
   ===================== */
const ReviewModule = {

  startSession() {
    state.reviewedIndices.clear();
    state.currentCardIndex = null;
    state.cardFlipped = false;
    state.sentenceRevealed = false;
    if (state.reviewMode === 'due') {
      state.sessionDueCount = SRSModule.getDueWords(state.words).length;
    }
    document.getElementById('srs-feedback').className = 'srs-feedback hidden';
    ReviewModule.updateDueBadge();
    ReviewModule.pickCard();
  },

  pickCard() {
    if (state.words.length === 0) {
      document.getElementById('card-word').textContent = '—';
      document.getElementById('card-chinese').textContent = '—';
      document.getElementById('card-sentence').textContent = '請先新增單字';
      document.getElementById('card-translation').textContent = '';
      document.getElementById('progress-display').textContent = '字庫是空的';
      state.currentCardIndex = null;
      ReviewModule.applyCardState();
      return;
    }

    let pool;
    if (state.reviewMode === 'due') {
      const dueIndices = state.words
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => SRSModule.isDue(w.word))
        .map(({ i }) => i);
      pool = dueIndices.filter(i => !state.reviewedIndices.has(i));
      if (pool.length === 0) {
        state.sessionDueCount === 0
          ? ReviewModule.showNoDueCards()
          : ReviewModule.showDueCompletion();
        return;
      }
    } else {
      pool = state.words.map((_, i) => i).filter(i => !state.reviewedIndices.has(i));
      if (pool.length === 0) {
        ReviewModule.showCompletion();
        return;
      }
    }

    const idx = pool[Math.floor(Math.random() * pool.length)];
    state.currentCardIndex = idx;
    state.reviewedIndices.add(idx);

    const w = state.words[idx];
    document.getElementById('card-word').textContent = w.word ?? '—';
    document.getElementById('card-chinese').textContent = w.chinese ?? '—';
    document.getElementById('card-sentence').textContent = w.sentence ?? '—';
    document.getElementById('card-translation').textContent = w.translation ?? '—';

    state.cardFlipped = false;
    state.sentenceRevealed = false;
    document.getElementById('srs-feedback').className = 'srs-feedback hidden';
    ReviewModule.applyCardState();
    ReviewModule.updateProgress();
  },

  rate(remembered) {
    if (state.currentCardIndex === null || state.words.length === 0) return;
    const word = state.words[state.currentCardIndex].word;
    SRSModule.review(word, remembered);

    const fb = document.getElementById('srs-feedback');
    if (remembered) {
      fb.textContent = `✓ 記住了！下次複習：${SRSModule.getNextReviewLabel(word)}`;
      fb.className = 'srs-feedback srs-good';
    } else {
      fb.textContent = '✗ 沒關係，明天再複習一次';
      fb.className = 'srs-feedback srs-bad';
    }

    ReviewModule.updateDueBadge();
    // 更新字庫頁 SRS badge（若已渲染）
    LibraryModule.render();
    ReviewModule.pickCard();
  },

  flipCard() {
    if (state.words.length === 0 || state.currentCardIndex === null) return;
    state.cardFlipped = !state.cardFlipped;
    ReviewModule.applyCardState();
  },

  revealSentence(e) {
    e.stopPropagation();
    if (!state.cardFlipped || state.words.length === 0) return;
    state.sentenceRevealed = true;
    ReviewModule.applyCardState();
  },

  applyCardState() {
    const flashcard = document.getElementById('flashcard');
    const translationDisplay = document.getElementById('translation-display');
    const ratingActions = document.getElementById('rating-actions');

    flashcard.classList.toggle('flipped', state.cardFlipped);
    translationDisplay.classList.toggle('hidden', !state.sentenceRevealed);
    ratingActions.classList.toggle('hidden', !state.cardFlipped || state.currentCardIndex === null);
  },

  updateProgress() {
    const reviewed = state.reviewedIndices.size;
    if (state.reviewMode === 'due') {
      document.getElementById('progress-display').textContent =
        `今日複習 ${reviewed} / ${state.sessionDueCount} 個單字`;
    } else {
      document.getElementById('progress-display').textContent =
        `已複習 ${reviewed} / ${state.words.length} 個單字`;
    }
  },

  updateDueBadge() {
    document.getElementById('due-count').textContent =
      SRSModule.getDueWords(state.words).length;
  },

  restart() {
    ReviewModule.startSession();
  },

  showCompletion() {
    state.currentCardIndex = null;
    state.cardFlipped = false;
    state.sentenceRevealed = false;
    ReviewModule.applyCardState();
    document.getElementById('card-word').textContent = '全部完成！';
    document.getElementById('card-chinese').textContent = '所有單字已複習完畢';
    document.getElementById('card-sentence').textContent = '';
    document.getElementById('card-translation').textContent = '';
    document.getElementById('progress-display').textContent =
      `已複習全部 ${state.words.length} 個單字`;
  },

  showDueCompletion() {
    state.currentCardIndex = null;
    state.cardFlipped = false;
    state.sentenceRevealed = false;
    ReviewModule.applyCardState();
    document.getElementById('card-word').textContent = '今日完成！🎉';
    document.getElementById('card-chinese').textContent = '所有到期單字已複習完畢';
    document.getElementById('card-sentence').textContent = '';
    document.getElementById('card-translation').textContent = '';
    document.getElementById('progress-display').textContent =
      `今日複習 ${state.sessionDueCount} / ${state.sessionDueCount} 個單字`;
  },

  showNoDueCards() {
    state.currentCardIndex = null;
    state.cardFlipped = false;
    state.sentenceRevealed = false;
    ReviewModule.applyCardState();
    document.getElementById('card-word').textContent = '今天沒有';
    document.getElementById('card-chinese').textContent = '到期的單字 😊';
    document.getElementById('card-sentence').textContent = '';
    document.getElementById('card-translation').textContent = '';
    document.getElementById('progress-display').textContent = '切換到「全部隨機」繼續練習';
  },
};

/* =====================
   Article Module
   ===================== */
const ArticleModule = {
  _words: [],

  selectWords(n = 6) {
    const cat = state.articleCategory;
    let pool = cat === 'all'
      ? [...state.words]
      : state.words.filter(w => {
          const cats = w.categories || [];
          return cats.includes(cat) || cats.includes('common');
        });
    if (pool.length < 3) pool = [...state.words]; // fallback
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this._words = pool.slice(0, Math.min(n, pool.length));
  },

  highlightText(text) {
    const sorted = [...this._words].sort((a, b) => b.word.length - a.word.length);
    const matches = [];
    sorted.forEach(w => {
      const pattern = w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![a-zA-Z])(${pattern})(?![a-zA-Z])`, 'gi');
      let m;
      while ((m = regex.exec(text)) !== null) {
        const start = m.index + m[0].indexOf(m[1]);
        const end = start + m[1].length;
        if (!matches.some(x => x.start <= start && x.end >= end)) {
          matches.push({ start, end, word: m[1], chinese: w.chinese });
        }
      }
    });
    matches.sort((a, b) => a.start - b.start);
    let result = '', pos = 0;
    matches.forEach(m => {
      result += escapeHtml(text.slice(pos, m.start));
      result += `<mark class="word-highlight" title="${escapeHtml(m.chinese)}">${escapeHtml(m.word)}</mark>`;
      pos = m.end;
    });
    result += escapeHtml(text.slice(pos));
    return result;
  },

  buildPrompt() {
    const wordList = this._words.map(w => `"${w.word}"`).join(', ');
    const type = state.articleType;
    if (type === 'dialogue') {
      return `Write a natural TOEIC-style business dialogue (8-12 exchanges) incorporating ALL of these words/phrases: ${wordList}.
Use speaker labels exactly like "A: ..." and "B: ..." on separate lines.
Also provide a Traditional Chinese translation of each line in chinese_body, using the same "A: ..." / "B: ..." format and same number of lines.
Return ONLY valid JSON: {"title": "...", "body": "A: ...\\nB: ...\\n...", "chinese_body": "A: ...\\nB: ...\\n..."}
No markdown, only JSON.`;
    }
    if (type === 'monologue') {
      return `Write a 100-150 word TOEIC-style monologue (voicemail, announcement, or advertisement) incorporating ALL of these words/phrases: ${wordList}.
Also provide a Traditional Chinese translation in chinese_body with the same number of paragraphs.
Return ONLY valid JSON: {"title": "...", "body": "...", "chinese_body": "..."}
Separate paragraphs in body and chinese_body with \\n. No markdown, only JSON.`;
    }
    // double
    return `Write two related TOEIC-style business texts (e.g. an email and its reply, or a notice and a response). Distribute ALL of these words/phrases across both texts: ${wordList}.
Also provide Traditional Chinese translations in chinese_body1 and chinese_body2 with the same paragraph structure.
Return ONLY valid JSON: {"title1": "...", "body1": "...", "chinese_body1": "...", "title2": "...", "body2": "...", "chinese_body2": "..."}
Separate paragraphs with \\n. No markdown, only JSON.`;
  },

  async generate() {
    if (state.words.length === 0) {
      ArticleModule.showEmpty('請先在字庫新增單字');
      return;
    }
    if (!APIKeyModule.has()) {
      ArticleModule.showEmpty('請先設定 Gemini API Key');
      ArticleModule.showModal();
      return;
    }

    ArticleModule.selectWords(6);
    ArticleModule.showLoading();

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${APIKeyModule.get()}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: ArticleModule.buildPrompt() }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );

      if (res.status === 400 || res.status === 403) throw new Error('invalid_key');
      if (res.status === 429) throw new Error('rate_limit');
      if (!res.ok) throw new Error('api_error');

      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const article = JSON.parse(raw);

      const type = state.articleType;
      if (type === 'dialogue') {
        ArticleModule.renderDialogue(article.title || 'Dialogue', article.body || '', article.chinese_body || '');
      } else if (type === 'monologue') {
        ArticleModule.renderSingle(article.title || 'Monologue', article.body || '', article.chinese_body || '');
      } else {
        ArticleModule.renderDouble(
          article.title1 || 'Text 1', article.body1 || '', article.chinese_body1 || '',
          article.title2 || 'Text 2', article.body2 || '', article.chinese_body2 || ''
        );
      }
      ArticleModule.renderWordList();
    } catch (e) {
      if (e.message === 'invalid_key') {
        ArticleModule.showError('API Key 無效，請重新設定。', true);
      } else if (e.message === 'rate_limit') {
        ArticleModule.showError('請求過於頻繁，請稍等 1 分鐘後再試。');
      } else {
        ArticleModule.showError('生成失敗，請稍後再試。');
      }
    }
  },

  renderSingle(title, body, chineseBody = '') {
    const paras = body.split('\n').filter(p => p.trim());
    const cparas = chineseBody.split('\n').filter(p => p.trim());
    const html = paras.map((p, i) => `
      <p>${escapeHtml(p)}</p>
      ${cparas[i] ? `<p class="article-chinese">${escapeHtml(cparas[i])}</p>` : ''}
    `).join('');
    document.getElementById('article-content').innerHTML = `
      <div class="article-body">
        <h2 class="article-title">${escapeHtml(title)}</h2>
        <div class="article-text">${html}</div>
      </div>`;
  },

  renderDialogue(title, body, chineseBody = '') {
    const lines = body.split('\n').filter(l => l.trim());
    const clines = chineseBody.split('\n').filter(l => l.trim());
    const turns = lines.map((line, i) => {
      const m = line.match(/^([A-Z]):\s*(.+)/);
      const cm = clines[i] ? clines[i].match(/^([A-Z]):\s*(.+)/) : null;
      if (m) {
        const isA = m[1] === 'A';
        return `<div class="dialogue-turn ${isA ? 'turn-a' : 'turn-b'}">
          <span class="speaker-label">${escapeHtml(m[1])}</span>
          <div class="turn-content">
            <p class="speaker-text">${escapeHtml(m[2])}</p>
            ${cm ? `<p class="speaker-chinese">${escapeHtml(cm[2])}</p>` : ''}
          </div>
        </div>`;
      }
      return `<p>${escapeHtml(line)}</p>`;
    }).join('');
    document.getElementById('article-content').innerHTML = `
      <div class="article-body">
        <h2 class="article-title">${escapeHtml(title)}</h2>
        <div class="article-dialogue">${turns}</div>
      </div>`;
  },

  renderDouble(title1, body1, chineseBody1 = '', title2, body2, chineseBody2 = '') {
    const render = (body, cbody) => {
      const paras = body.split('\n').filter(p => p.trim());
      const cparas = cbody.split('\n').filter(p => p.trim());
      return paras.map((p, i) => `
        <p>${escapeHtml(p)}</p>
        ${cparas[i] ? `<p class="article-chinese">${escapeHtml(cparas[i])}</p>` : ''}
      `).join('');
    };
    document.getElementById('article-content').innerHTML = `
      <div class="article-body">
        <h2 class="article-title">${escapeHtml(title1)}</h2>
        <div class="article-text">${render(body1, chineseBody1)}</div>
      </div>
      <div class="article-body" style="margin-top:1rem">
        <h2 class="article-title">${escapeHtml(title2)}</h2>
        <div class="article-text">${render(body2, chineseBody2)}</div>
      </div>`;
  },

  renderWordList() {
    const wordList = document.getElementById('article-word-list');
    wordList.hidden = false;
    wordList.innerHTML = `
      <h3 class="word-list-title">本次使用的單字</h3>
      <div class="article-word-chips">
        ${this._words.map(w => `
          <div class="article-chip">
            <span class="chip-word">${escapeHtml(w.word)}</span>
            <span class="chip-chinese">${escapeHtml(w.chinese)}</span>
          </div>`).join('')}
      </div>`;
  },

  showLoading() {
    document.getElementById('article-content').innerHTML = `
      <div class="article-loading">
        <div class="loading-spinner"></div>
        <p>正在生成文章…</p>
      </div>`;
    document.getElementById('article-word-list').hidden = true;
  },

  showEmpty(msg = '選擇類型與分類後，點擊「重新生成」開始') {
    document.getElementById('article-content').innerHTML =
      `<div class="article-empty"><p>${escapeHtml(msg)}</p></div>`;
    document.getElementById('article-word-list').hidden = true;
  },

  showError(msg, showKeyBtn = false) {
    document.getElementById('article-content').innerHTML = `
      <div class="article-empty article-error">
        <p>${escapeHtml(msg)}</p>
        ${showKeyBtn ? '<button class="btn btn-outline" onclick="ArticleModule.showModal()">重新設定 API Key</button>' : ''}
      </div>`;
    document.getElementById('article-word-list').hidden = true;
  },

  showModal() {
    document.getElementById('api-key-input').value = APIKeyModule.get();
    document.getElementById('api-key-modal').classList.remove('hidden');
    document.getElementById('api-key-input').focus();
  },

  hideModal() {
    document.getElementById('api-key-modal').classList.add('hidden');
  },
};

/* =====================
   Router Module
   ===================== */
const RouterModule = {
  switchTo(viewName) {
    state.currentView = viewName;

    document.querySelectorAll('section[id$="-view"]').forEach(s => {
      s.hidden = (s.id !== `${viewName}-view`);
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (viewName === 'review') {
      ReviewModule.updateDueBadge();
      if (state.currentCardIndex === null && state.reviewedIndices.size === 0) {
        ReviewModule.startSession();
      }
    }

    if (viewName === 'article') {
      if (!document.querySelector('#article-content .article-body') &&
          !document.querySelector('#article-content .article-loading')) {
        ArticleModule.showEmpty();
      }
    }
  },
};

/* =====================
   Init
   ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  TTSModule.init();
  SRSModule.load();
  await DataModule.load();
  LibraryModule.render();
  RouterModule.switchTo('library');

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => RouterModule.switchTo(btn.dataset.view));
  });

  // Library: search
  document.getElementById('search-input').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    LibraryModule.render();
  });

  // Library: sort
  document.getElementById('sort-select').addEventListener('change', e => {
    state.sortOrder = e.target.value;
    LibraryModule.render();
  });

  // Library: category filter
  document.getElementById('library-category-select').addEventListener('change', e => {
    state.libraryCategory = e.target.value;
    LibraryModule.render();
  });

  // Library: export CSV
  document.getElementById('export-csv').addEventListener('click', () => {
    LibraryModule.exportCSV();
  });

  // Review: mode toggle
  document.getElementById('mode-btn-due').addEventListener('click', () => {
    if (state.reviewMode === 'due') return;
    state.reviewMode = 'due';
    document.getElementById('mode-btn-due').classList.add('active');
    document.getElementById('mode-btn-all').classList.remove('active');
    ReviewModule.startSession();
  });
  document.getElementById('mode-btn-all').addEventListener('click', () => {
    if (state.reviewMode === 'all') return;
    state.reviewMode = 'all';
    document.getElementById('mode-btn-all').classList.add('active');
    document.getElementById('mode-btn-due').classList.remove('active');
    ReviewModule.startSession();
  });

  // Review: rating buttons
  document.getElementById('btn-remembered').addEventListener('click', () => {
    ReviewModule.rate(true);
  });
  document.getElementById('btn-forgot').addEventListener('click', () => {
    ReviewModule.rate(false);
  });

  // Review: flip card
  document.getElementById('flashcard').addEventListener('click', () => {
    ReviewModule.flipCard();
  });

  // Review: reveal sentence (click on sentence text in card back)
  document.getElementById('card-sentence').addEventListener('click', (e) => {
    ReviewModule.revealSentence(e);
  });

  // Review: skip (no SRS record)
  document.getElementById('next-card').addEventListener('click', () => {
    ReviewModule.pickCard();
  });

  // Review: restart
  document.getElementById('restart-review').addEventListener('click', () => {
    ReviewModule.restart();
  });

  // TTS: library cards (event delegation)
  document.getElementById('word-grid').addEventListener('click', e => {
    const btn = e.target.closest('.speak-btn[data-speak]');
    if (btn) TTSModule.speak(btn.dataset.speak);
  });

  // TTS: review card speak buttons (stopPropagation to avoid flip)
  document.getElementById('speak-word').addEventListener('click', e => {
    e.stopPropagation();
    TTSModule.speak(document.getElementById('card-word').textContent);
  });

  document.getElementById('speak-sentence').addEventListener('click', e => {
    e.stopPropagation();
    TTSModule.speak(document.getElementById('card-sentence').textContent);
  });

  // Accent selector
  document.getElementById('accent-select').addEventListener('change', e => {
    state.accent = e.target.value;
  });

  // Article: type toggle
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.articleType = btn.dataset.type;
    });
  });

  // Article: category select
  document.getElementById('article-category-select').addEventListener('change', e => {
    state.articleCategory = e.target.value;
  });

  // Article: regenerate
  document.getElementById('btn-regenerate').addEventListener('click', () => {
    ArticleModule.generate();
  });

  // Article: open API key modal
  document.getElementById('btn-api-key').addEventListener('click', () => {
    ArticleModule.showModal();
  });

  // Modal: save key
  document.getElementById('btn-save-key').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) { alert('請輸入 API Key'); return; }
    APIKeyModule.set(key);
    ArticleModule.hideModal();
    ArticleModule.generate();
  });

  // Modal: Enter key to save
  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-save-key').click();
  });

  // Modal: close
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    ArticleModule.hideModal();
  });

  // Modal: clear key
  document.getElementById('btn-clear-key').addEventListener('click', () => {
    APIKeyModule.clear();
    document.getElementById('api-key-input').value = '';
  });

  // Modal: click overlay to close
  document.getElementById('api-key-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('api-key-modal')) ArticleModule.hideModal();
  });
});
