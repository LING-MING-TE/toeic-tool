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
  reviewedIndices: new Set(),
  currentCardIndex: null,
  cardFlipped: false,
  sentenceRevealed: false,
  accent: 'en-US',
};

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

    state.filtered = state.words.filter(w =>
      (w.word ?? '').toLowerCase().includes(q) ||
      (w.chinese ?? '').includes(q)
    );

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
    if (q) {
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

    grid.innerHTML = state.filtered.map(w => `
      <article class="word-card">
        <div class="word-title-row">
          <h2 class="word-title">${escapeHtml(w.word)}</h2>
          <button class="speak-btn" data-speak="${escapeHtml(w.word)}" title="朗讀單字">🔊</button>
        </div>
        <p class="word-chinese">${escapeHtml(w.chinese)}</p>
        <div class="word-sentence-row">
          <p class="word-sentence">${escapeHtml(w.sentence)}</p>
          <button class="speak-btn" data-speak="${escapeHtml(w.sentence)}" title="朗讀例句">🔊</button>
        </div>
        <p class="word-translation">${escapeHtml(w.translation)}</p>
        <time class="word-date" datetime="${escapeHtml(w.addedAt)}">${escapeHtml(w.addedAt)}</time>
      </article>
    `).join('');
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
  pickCard() {
    if (state.words.length === 0) {
      document.getElementById('card-word').textContent = '—';
      document.getElementById('card-chinese').textContent = '—';
      document.getElementById('card-sentence').textContent = '請先新增單字';
      document.getElementById('card-translation').textContent = '';
      document.getElementById('progress-display').textContent = '字庫是空的';
      return;
    }

    const available = state.words
      .map((_, i) => i)
      .filter(i => !state.reviewedIndices.has(i));

    if (available.length === 0) {
      ReviewModule.showCompletion();
      return;
    }

    const idx = available[Math.floor(Math.random() * available.length)];
    state.currentCardIndex = idx;
    state.reviewedIndices.add(idx);

    const w = state.words[idx];
    document.getElementById('card-word').textContent = w.word ?? '—';
    document.getElementById('card-chinese').textContent = w.chinese ?? '—';
    document.getElementById('card-sentence').textContent = w.sentence ?? '—';
    document.getElementById('card-translation').textContent = w.translation ?? '—';

    // Reset visual state
    state.cardFlipped = false;
    state.sentenceRevealed = false;
    ReviewModule.applyCardState();
    ReviewModule.updateProgress();
  },

  flipCard() {
    if (state.words.length === 0 || state.currentCardIndex === null) return;
    state.cardFlipped = !state.cardFlipped;
    ReviewModule.applyCardState();
  },

  revealSentence(e) {
    e.stopPropagation(); // 避免觸發翻牌
    if (!state.cardFlipped || state.words.length === 0) return;
    state.sentenceRevealed = true;
    ReviewModule.applyCardState();
  },

  applyCardState() {
    const flashcard = document.getElementById('flashcard');
    const translationDisplay = document.getElementById('translation-display');

    flashcard.classList.toggle('flipped', state.cardFlipped);
    translationDisplay.classList.toggle('hidden', !state.sentenceRevealed);
  },

  updateProgress() {
    const total = state.words.length;
    const reviewed = state.reviewedIndices.size;
    document.getElementById('progress-display').textContent =
      `已複習 ${reviewed} / ${total} 個單字`;
  },

  restart() {
    state.reviewedIndices.clear();
    state.currentCardIndex = null;
    ReviewModule.pickCard();
  },

  showCompletion() {
    state.currentCardIndex = null;
    state.cardFlipped = false;
    state.sentenceRevealed = false;
    ReviewModule.applyCardState();

    document.getElementById('card-word').textContent = '全部完成！';
    document.getElementById('card-chinese').textContent = '';
    document.getElementById('card-sentence').textContent = '';
    document.getElementById('card-translation').textContent = '';
    document.getElementById('progress-display').textContent =
      `已複習全部 ${state.words.length} 個單字`;
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

    if (viewName === 'review' && state.currentCardIndex === null && state.reviewedIndices.size === 0) {
      ReviewModule.pickCard();
    }
  },
};

/* =====================
   Init
   ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  TTSModule.init();
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

  // Library: export CSV
  document.getElementById('export-csv').addEventListener('click', () => {
    LibraryModule.exportCSV();
  });

  // Review: flip card
  document.getElementById('flashcard').addEventListener('click', () => {
    ReviewModule.flipCard();
  });

  // Review: reveal sentence (click on sentence text in card back)
  document.getElementById('card-sentence').addEventListener('click', (e) => {
    ReviewModule.revealSentence(e);
  });

  // Review: next card
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
});
