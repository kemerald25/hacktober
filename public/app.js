/**
 * CogniCraft AI — Learning-Science Interactive Study Engine
 * Spaced Repetition, Active Recall, 3D Flashcards, Quiz Arena & Summarization
 */

document.addEventListener('DOMContentLoaded', () => {
  // ========================================================
  // Global Application State
  // ========================================================
  const state = {
    docText: '',
    cardCount: 15,
    difficulty: 'medium',
    deck: [],
    currentCardIndex: 0,
    isCardFlipped: false,
    quiz: [],
    quizIndex: 0,
    quizScore: 0,
    quizAnswered: false,
    summary: null,
    soundEnabled: true,
    settings: {
      apiKey: localStorage.getItem('cognicraft_api_key') || '',
      model: localStorage.getItem('cognicraft_model') || 'google/gemma-2-9b-it',
      baseUrl: localStorage.getItem('cognicraft_base_url') || ''
    }
  };

  // ========================================================
  // Audio Synthesis & Feedback (Web Audio API)
  // ========================================================
  const AudioEngine = {
    ctx: null,
    init() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      } catch (e) {
        console.warn('Web Audio not supported:', e);
      }
    },
    playTone(freq, type, duration, gainVal = 0.1) {
      if (!state.soundEnabled) return;
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (err) {}
    },
    flip() { this.playTone(320, 'sine', 0.12, 0.08); },
    correct() {
      this.playTone(523.25, 'triangle', 0.15, 0.1); // C5
      setTimeout(() => this.playTone(659.25, 'triangle', 0.25, 0.1), 100); // E5
    },
    incorrect() {
      this.playTone(220, 'sawtooth', 0.2, 0.08); // A3
      setTimeout(() => this.playTone(196, 'sawtooth', 0.3, 0.08), 120); // G3
    },
    rate() { this.playTone(440, 'sine', 0.08, 0.06); }
  };

  // ========================================================
  // DOM Elements
  // ========================================================
  const elements = {
    // Nav
    tabs: document.querySelectorAll('.nav-tab'),
    panes: document.querySelectorAll('.tab-pane'),
    cardsBadge: document.getElementById('cards-badge'),
    quizBadge: document.getElementById('quiz-badge'),
    modelIndicator: document.getElementById('model-indicator'),
    btnSound: document.getElementById('btn-sound-toggle'),
    iconSoundOn: document.getElementById('icon-sound-on'),
    iconSoundOff: document.getElementById('icon-sound-off'),

    // Ingest
    dropzone: document.getElementById('pdf-dropzone'),
    fileInput: document.getElementById('file-input'),
    uploadProgress: document.getElementById('upload-progress-bar'),
    sampleButtonsList: document.getElementById('sample-buttons-list'),
    notesTextarea: document.getElementById('notes-textarea'),
    statWords: document.getElementById('stat-words'),
    statTime: document.getElementById('stat-time'),
    btnClearNotes: document.getElementById('btn-clear-notes'),
    cardCountPills: document.querySelectorAll('#card-count-pills .pill-btn'),
    difficultyPills: document.querySelectorAll('#difficulty-pills .pill-btn'),
    btnGenerateAll: document.getElementById('btn-generate-all'),
    btnGenerateCardsOnly: document.getElementById('btn-generate-cards-only'),
    btnGenerateQuizOnly: document.getElementById('btn-generate-quiz-only'),
    btnGenerateSummaryOnly: document.getElementById('btn-generate-summary-only'),

    // Flashcards Stage
    deckTitle: document.getElementById('deck-title'),
    deckMeta: document.getElementById('deck-meta'),
    countBox1: document.getElementById('count-box1'),
    countBox2: document.getElementById('count-box2'),
    countBox3: document.getElementById('count-box3'),
    countBox4: document.getElementById('count-box4'),
    deckProgressBar: document.getElementById('deck-progress-bar'),
    cardContainer: document.getElementById('active-card-container'),
    cardTopic: document.getElementById('card-topic'),
    cardDiff: document.getElementById('card-diff'),
    cardFrontText: document.getElementById('card-front-text'),
    cardBackText: document.getElementById('card-back-text'),
    btnSpeakFront: document.getElementById('btn-speak-front'),
    btnPrevCard: document.getElementById('btn-prev-card'),
    btnNextCard: document.getElementById('btn-next-card'),
    cardIndexText: document.getElementById('card-index-text'),
    btnShuffle: document.getElementById('btn-shuffle'),
    btnExportAnki: document.getElementById('btn-export-anki'),
    btnExportJson: document.getElementById('btn-export-json'),
    filterSearch: document.getElementById('filter-search'),
    filterDiff: document.getElementById('filter-diff'),
    cardsPreviewGrid: document.getElementById('cards-preview-grid'),
    rateButtons: document.querySelectorAll('.btn-rate'),

    // Quiz Arena
    quizTitle: document.getElementById('quiz-title'),
    quizScoreVal: document.getElementById('quiz-score-val'),
    quizQProgress: document.getElementById('quiz-q-progress'),
    quizActiveCard: document.getElementById('quiz-active-card'),
    quizResultsScreen: document.getElementById('quiz-results-screen'),
    quizQDifficulty: document.getElementById('quiz-q-difficulty'),
    quizQTopic: document.getElementById('quiz-q-topic'),
    quizQuestionText: document.getElementById('quiz-question-text'),
    quizOptionsList: document.getElementById('quiz-options-list'),
    quizExplanationBox: document.getElementById('quiz-explanation-box'),
    quizExplanationText: document.getElementById('quiz-explanation-text'),
    btnQuizNext: document.getElementById('btn-quiz-next'),
    resultsSummaryText: document.getElementById('results-summary-text'),
    btnQuizRetry: document.getElementById('btn-quiz-retry'),
    btnGotoCards: document.getElementById('btn-goto-cards'),

    // Summary
    summaryDocTitle: document.getElementById('summary-doc-title'),
    summaryOverviewText: document.getElementById('summary-overview-text'),
    summaryTermsList: document.getElementById('summary-terms-list'),
    summaryCauseEffectList: document.getElementById('summary-cause-effect-list'),
    summaryChecklist: document.getElementById('summary-checklist'),
    btnCopySummary: document.getElementById('btn-copy-summary'),

    // Modals & Toast
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingTitle: document.getElementById('loading-title'),
    loadingDesc: document.getElementById('loading-desc'),
    settingsModal: document.getElementById('settings-modal'),
    btnSettings: document.getElementById('btn-settings'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    inputApiKey: document.getElementById('input-api-key'),
    inputModel: document.getElementById('input-model'),
    inputBaseUrl: document.getElementById('input-base-url'),
    toast: document.getElementById('toast')
  };

  // ========================================================
  // Initialization & Settings
  // ========================================================
  let serverConfig = null;

  async function checkConfigStatus() {
    try {
      const res = await fetch('/api/config-status');
      serverConfig = await res.json();
      const statusSpan = document.getElementById('env-detected-status');
      if (statusSpan) {
        if (serverConfig.hasEnvKey) {
          statusSpan.innerHTML = `<span style="color: #4ade80;">Active (${serverConfig.provider})</span>`;
          if (!state.settings.apiKey) {
            elements.modelIndicator.textContent = serverConfig.provider.split(' ')[0];
          }
        } else {
          statusSpan.innerHTML = `<span style="color: #a1a1aa;">No key in .env (add to .env or enter below)</span>`;
        }
      }
    } catch (e) {
      console.warn('Config status check error:', e);
    }
  }

  function initApp() {
    checkConfigStatus();
    updateModelBadge();
    loadSamples();
    setupEventListeners();
    updateNotesStats();
  }

  function updateModelBadge() {
    if (state.settings.apiKey) {
      const modelShort = state.settings.model.split('/').pop();
      elements.modelIndicator.textContent = modelShort;
    } else if (serverConfig && serverConfig.hasEnvKey) {
      elements.modelIndicator.textContent = serverConfig.provider.split(' ')[0];
    } else {
      elements.modelIndicator.textContent = 'Gemma / Local AI';
    }
  }

  function showToast(msg, duration = 3000) {
    elements.toast.textContent = msg;
    elements.toast.classList.remove('hidden');
    clearTimeout(elements.toast._timeout);
    elements.toast._timeout = setTimeout(() => {
      elements.toast.classList.add('hidden');
    }, duration);
  }

  function showLoading(title, desc) {
    elements.loadingTitle.textContent = title;
    elements.loadingDesc.textContent = desc;
    elements.loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    elements.loadingOverlay.classList.add('hidden');
  }

  // ========================================================
  // Navigation & Tab Switching
  // ========================================================
  function switchTab(targetTabId) {
    elements.tabs.forEach(tab => {
      const isTarget = tab.dataset.tab === targetTabId;
      tab.classList.toggle('active', isTarget);
    });

    elements.panes.forEach(pane => {
      const isTarget = pane.id === `view-${targetTabId}`;
      pane.classList.toggle('active', isTarget);
    });

    if (targetTabId === 'flashcards') {
      renderActiveCard();
      renderCardsPreviewGrid();
    } else if (targetTabId === 'quiz') {
      renderActiveQuizQuestion();
    }
  }

  // ========================================================
  // Load Sample Pre-Built Study Decks
  // ========================================================
  async function loadSamples() {
    try {
      const res = await fetch('/api/samples');
      const data = await res.json();
      if (data.samples && elements.sampleButtonsList) {
        elements.sampleButtonsList.innerHTML = '';
        data.samples.forEach(sample => {
          const btn = document.createElement('button');
          btn.className = 'sample-btn';
          btn.textContent = sample.title;
          btn.title = sample.description;
          btn.addEventListener('click', () => {
            elements.notesTextarea.value = sample.text;
            updateNotesStats();
            showToast(`Loaded: ${sample.title}`);
          });
          elements.sampleButtonsList.appendChild(btn);
        });

        // Pre-populate with first sample (Gemini OpenAI Compatibility guide!)
        if (data.samples[0] && !elements.notesTextarea.value) {
          elements.notesTextarea.value = data.samples[0].text;
          updateNotesStats();
        }
      }
    } catch (e) {
      console.warn('Could not load samples:', e);
    }
  }

  function updateNotesStats() {
    const text = elements.notesTextarea.value.trim();
    state.docText = text;
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const minutes = Math.ceil(words / 200);
    elements.statWords.textContent = `${words.toLocaleString()} words`;
    elements.statTime.textContent = `~${minutes} min read`;
  }

  // ========================================================
  // Drag & Drop / File Extraction
  // ========================================================
  function setupDragAndDrop() {
    const dropzone = elements.dropzone;
    const fileInput = elements.fileInput;

    dropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files.length > 0) handleFileUpload(files[0]);
    });

    fileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
    });
  }

  async function handleFileUpload(file) {
    const validExtensions = ['.pdf', '.txt', '.md'];
    const name = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => name.endsWith(ext));

    if (!isValid) {
      showToast('Please upload a PDF, TXT, or Markdown document.');
      return;
    }

    elements.uploadProgress.classList.remove('hidden');
    showLoading('Extracting Document Text', `Processing ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('document', file);

      const res = await fetch('/api/extract-pdf', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to extract text');
      }

      elements.notesTextarea.value = data.extractedText;
      updateNotesStats();
      showToast(`Successfully extracted ${data.wordCount} words from ${data.filename}!`);
    } catch (err) {
      showToast(`Extraction failed: ${err.message}`);
    } finally {
      elements.uploadProgress.classList.add('hidden');
      hideLoading();
    }
  }

  // ========================================================
  // Flashcard Generation & Study Logic
  // ========================================================
  async function generateFlashcards(autoSwitch = true) {
    const text = elements.notesTextarea.value.trim();
    if (!text || text.length < 30) {
      showToast('Please upload a document or enter lecture notes first.');
      return;
    }

    showLoading('Constructing Active Recall Flashcards', 'Synthesizing key definitions, mechanisms, and application prompts...');

    try {
      const payload = {
        text: text,
        cardCount: state.cardCount,
        difficulty: state.difficulty,
        apiKey: state.settings.apiKey,
        baseUrl: state.settings.baseUrl,
        model: state.settings.model
      };

      const res = await fetch('/api/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      if (data.flashcards && data.flashcards.length > 0) {
        state.deck = data.flashcards.map(card => ({
          ...card,
          leitnerBox: 1, // 1 to 4
          reviews: 0
        }));
        state.currentCardIndex = 0;
        state.isCardFlipped = false;

        elements.deckTitle.textContent = data.title || 'Active Recall Deck';
        elements.deckMeta.textContent = `${state.deck.length} Cards • Target: ${state.difficulty.toUpperCase()}`;
        elements.cardsBadge.textContent = state.deck.length;

        updateLeitnerCounts();
        renderActiveCard();
        renderCardsPreviewGrid();

        showToast(`Generated ${state.deck.length} flashcards!`);
        if (autoSwitch) switchTab('flashcards');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  function renderActiveCard() {
    if (state.deck.length === 0) {
      elements.cardFrontText.textContent = 'Upload or paste notes and click "Synthesize Flashcards" to begin!';
      elements.cardBackText.textContent = 'No cards in deck.';
      elements.cardIndexText.textContent = 'Card 0 of 0';
      elements.cardTopic.textContent = 'Welcome';
      elements.cardDiff.textContent = 'N/A';
      elements.deckProgressBar.style.width = '0%';
      return;
    }

    const card = state.deck[state.currentCardIndex];
    elements.cardFrontText.textContent = card.front;
    elements.cardBackText.textContent = card.back;
    elements.cardTopic.textContent = card.topic || 'Concept';

    elements.cardDiff.textContent = card.difficulty || 'medium';
    elements.cardDiff.className = `card-diff-tag diff-${card.difficulty || 'medium'}`;

    elements.cardIndexText.textContent = `Card ${state.currentCardIndex + 1} of ${state.deck.length}`;

    // Reset flip orientation
    state.isCardFlipped = false;
    elements.cardContainer.classList.remove('flipped');

    // Update progress bar
    const progress = ((state.currentCardIndex + 1) / state.deck.length) * 100;
    elements.deckProgressBar.style.width = `${progress}%`;
  }

  function flipCard() {
    if (state.deck.length === 0) return;
    state.isCardFlipped = !state.isCardFlipped;
    elements.cardContainer.classList.toggle('flipped', state.isCardFlipped);
    AudioEngine.flip();
  }

  function nextCard() {
    if (state.deck.length === 0) return;
    state.currentCardIndex = (state.currentCardIndex + 1) % state.deck.length;
    renderActiveCard();
  }

  function prevCard() {
    if (state.deck.length === 0) return;
    state.currentCardIndex = (state.currentCardIndex - 1 + state.deck.length) % state.deck.length;
    renderActiveCard();
  }

  function rateCard(rating) {
    if (state.deck.length === 0) return;
    const card = state.deck[state.currentCardIndex];
    card.reviews = (card.reviews || 0) + 1;

    // Leitner Box progression
    if (rating === 'again') {
      card.leitnerBox = 1;
    } else if (rating === 'hard') {
      card.leitnerBox = Math.max(1, card.leitnerBox);
    } else if (rating === 'good') {
      card.leitnerBox = Math.min(4, (card.leitnerBox || 1) + 1);
    } else if (rating === 'easy') {
      card.leitnerBox = 4;
    }

    AudioEngine.rate();
    updateLeitnerCounts();
    renderCardsPreviewGrid();

    // Advance to next card smoothly
    setTimeout(() => {
      nextCard();
    }, 180);
  }

  function updateLeitnerCounts() {
    let b1 = 0, b2 = 0, b3 = 0, b4 = 0;
    state.deck.forEach(c => {
      const box = c.leitnerBox || 1;
      if (box === 1) b1++;
      else if (box === 2) b2++;
      else if (box === 3) b3++;
      else if (box >= 4) b4++;
    });

    elements.countBox1.textContent = b1;
    elements.countBox2.textContent = b2;
    elements.countBox3.textContent = b3;
    elements.countBox4.textContent = b4;
  }

  function shuffleDeck() {
    if (state.deck.length < 2) return;
    for (let i = state.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
    }
    state.currentCardIndex = 0;
    renderActiveCard();
    renderCardsPreviewGrid();
    showToast('Deck shuffled!');
  }

  function renderCardsPreviewGrid() {
    const grid = elements.cardsPreviewGrid;
    grid.innerHTML = '';

    const searchTerm = elements.filterSearch.value.toLowerCase().trim();
    const diffFilter = elements.filterDiff.value;

    const filtered = state.deck.filter(card => {
      const matchesSearch = !searchTerm ||
        card.front.toLowerCase().includes(searchTerm) ||
        card.back.toLowerCase().includes(searchTerm) ||
        (card.topic && card.topic.toLowerCase().includes(searchTerm));

      const matchesDiff = diffFilter === 'all' || (card.difficulty || 'medium') === diffFilter;
      return matchesSearch && matchesDiff;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="learning-tip" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No cards match the current filter.</p>';
      return;
    }

    filtered.forEach((card, idx) => {
      const mini = document.createElement('div');
      mini.className = 'mini-card';
      const actualIndex = state.deck.indexOf(card);
      if (actualIndex === state.currentCardIndex) {
        mini.style.borderColor = 'var(--primary)';
      }

      mini.innerHTML = `
        <div class="mini-card-header">
          <span class="card-topic-tag">${card.topic || 'Concept'}</span>
          <span class="card-diff-tag diff-${card.difficulty || 'medium'}">${card.difficulty || 'medium'}</span>
        </div>
        <p class="mini-card-q">${card.front}</p>
        <p class="mini-card-a">${card.back}</p>
      `;

      mini.addEventListener('click', () => {
        state.currentCardIndex = actualIndex;
        renderActiveCard();
        window.scrollTo({ top: elements.cardContainer.offsetTop - 100, behavior: 'smooth' });
      });

      grid.appendChild(mini);
    });
  }

  // ========================================================
  // Speech Synthesis
  // ========================================================
  function speakCurrentPrompt() {
    if (state.deck.length === 0) return;
    const card = state.deck[state.currentCardIndex];
    const textToSpeak = state.isCardFlipped ? card.back : card.front;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } else {
      showToast('Text-to-speech not supported on this browser.');
    }
  }

  // ========================================================
  // Export Deck: Anki & JSON
  // ========================================================
  function exportAnki() {
    if (state.deck.length === 0) {
      showToast('No cards to export.');
      return;
    }
    // Anki TSV format: Front \t Back \t Tags
    const tsvContent = state.deck
      .map(c => `"${c.front.replace(/"/g, '""')}"\t"${c.back.replace(/"/g, '""')}"\t"${c.topic || 'CogniCraft'}"`)
      .join('\n');

    downloadFile(tsvContent, 'cognicraft-anki-deck.txt', 'text/tab-separated-values');
    showToast('Exported Anki-compatible TSV deck!');
  }

  function exportJson() {
    if (state.deck.length === 0) {
      showToast('No cards to export.');
      return;
    }
    const jsonStr = JSON.stringify({
      title: elements.deckTitle.textContent,
      exportedAt: new Date().toISOString(),
      flashcards: state.deck
    }, null, 2);

    downloadFile(jsonStr, 'cognicraft-deck.json', 'application/json');
    showToast('Exported deck JSON!');
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ========================================================
  // Quiz Generation & Interactive Assessment
  // ========================================================
  async function generateQuiz(autoSwitch = true) {
    const text = elements.notesTextarea.value.trim();
    if (!text || text.length < 30) {
      showToast('Please provide notes or a document first.');
      return;
    }

    showLoading('Generating Interactive Quiz', 'Formulating conceptual questions and distractor choices...');

    try {
      const payload = {
        text: text,
        questionCount: 8,
        difficulty: state.difficulty,
        apiKey: state.settings.apiKey,
        baseUrl: state.settings.baseUrl,
        model: state.settings.model
      };

      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Quiz generation failed');

      if (data.questions && data.questions.length > 0) {
        state.quiz = data.questions;
        state.quizIndex = 0;
        state.quizScore = 0;
        state.quizAnswered = false;

        elements.quizTitle.textContent = data.title || 'Knowledge Assessment';
        elements.quizBadge.textContent = state.quiz.length;

        elements.quizActiveCard.classList.remove('hidden');
        elements.quizResultsScreen.classList.add('hidden');

        renderActiveQuizQuestion();
        showToast(`Quiz ready with ${state.quiz.length} questions!`);
        if (autoSwitch) switchTab('quiz');
      }
    } catch (err) {
      showToast(`Quiz Error: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  function renderActiveQuizQuestion() {
    if (state.quiz.length === 0) {
      elements.quizQuestionText.textContent = 'Generate a quiz from the Upload tab to test your mastery!';
      elements.quizOptionsList.innerHTML = '';
      elements.quizQProgress.textContent = '0 / 0';
      elements.quizScoreVal.textContent = '0';
      elements.btnQuizNext.disabled = true;
      elements.quizExplanationBox.classList.add('hidden');
      return;
    }

    state.quizAnswered = false;
    const q = state.quiz[state.quizIndex];

    elements.quizQProgress.textContent = `${state.quizIndex + 1} / ${state.quiz.length}`;
    elements.quizScoreVal.textContent = state.quizScore;
    elements.quizQuestionText.textContent = q.question;
    elements.quizQTopic.textContent = q.topic || 'Concept';
    elements.quizQDifficulty.textContent = q.difficulty || 'Medium';

    elements.quizExplanationBox.classList.add('hidden');
    elements.btnQuizNext.disabled = true;

    // Render options
    elements.quizOptionsList.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    q.options.forEach((optText, optIdx) => {
      const optBtn = document.createElement('button');
      optBtn.className = 'quiz-option';
      optBtn.innerHTML = `
        <span class="opt-letter">${letters[optIdx] || optIdx + 1}</span>
        <span>${optText}</span>
      `;

      optBtn.addEventListener('click', () => handleQuizOptionSelect(optIdx, optBtn));
      elements.quizOptionsList.appendChild(optBtn);
    });
  }

  function handleQuizOptionSelect(selectedIndex, selectedBtn) {
    if (state.quizAnswered) return;
    state.quizAnswered = true;

    const q = state.quiz[state.quizIndex];
    const isCorrect = selectedIndex === q.correctIndex;
    const optionButtons = elements.quizOptionsList.querySelectorAll('.quiz-option');

    if (isCorrect) {
      selectedBtn.classList.add('correct');
      state.quizScore++;
      elements.quizScoreVal.textContent = state.quizScore;
      AudioEngine.correct();
    } else {
      selectedBtn.classList.add('incorrect');
      // Highlight the correct one
      if (optionButtons[q.correctIndex]) {
        optionButtons[q.correctIndex].classList.add('correct');
      }
      AudioEngine.incorrect();
    }

    // Disable all options
    optionButtons.forEach(btn => btn.disabled = true);

    // Show pedagogical explanation
    elements.quizExplanationText.textContent = q.explanation || 'Review the core documentation for this principle.';
    elements.quizExplanationBox.classList.remove('hidden');

    elements.btnQuizNext.disabled = false;
  }

  function nextQuizQuestion() {
    if (state.quizIndex + 1 < state.quiz.length) {
      state.quizIndex++;
      renderActiveQuizQuestion();
    } else {
      // Quiz Finished
      elements.quizActiveCard.classList.add('hidden');
      elements.quizResultsScreen.classList.remove('hidden');
      const pct = Math.round((state.quizScore / state.quiz.length) * 100);
      elements.resultsSummaryText.textContent = `You scored ${state.quizScore} out of ${state.quiz.length} (${pct}% retention score).`;
      AudioEngine.correct();
    }
  }

  // ========================================================
  // Executive Summary & Mind Notes
  // ========================================================
  async function generateSummary(autoSwitch = true) {
    const text = elements.notesTextarea.value.trim();
    if (!text || text.length < 30) {
      showToast('Please provide notes or a document first.');
      return;
    }

    showLoading('Synthesizing Executive Summary', 'Extracting core thesis, definitions, and cause-effect relationships...');

    try {
      const payload = {
        text: text,
        apiKey: state.settings.apiKey,
        baseUrl: state.settings.baseUrl,
        model: state.settings.model
      };

      const res = await fetch('/api/generate-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Summary generation failed');

      state.summary = data;
      renderSummary();
      showToast('Executive summary generated!');
      if (autoSwitch) switchTab('summary');
    } catch (err) {
      showToast(`Summary Error: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  function renderSummary() {
    if (!state.summary) return;

    elements.summaryDocTitle.textContent = state.summary.title || 'Executive Synthesis';
    elements.summaryOverviewText.textContent = state.summary.executiveSummary || 'No overview available.';

    // Terms
    elements.summaryTermsList.innerHTML = '';
    (state.summary.keyConcepts || []).forEach(item => {
      const div = document.createElement('div');
      div.className = 'term-item';
      div.innerHTML = `
        <div class="term-title">${item.term}</div>
        <div class="term-def">${item.definition}</div>
      `;
      elements.summaryTermsList.appendChild(div);
    });

    // Cause & Effect
    elements.summaryCauseEffectList.innerHTML = '';
    (state.summary.causeAndEffect || []).forEach(item => {
      const div = document.createElement('div');
      div.className = 'cause-item';
      div.innerHTML = `
        <span class="cause-tag">Condition / Action:</span>
        <p class="cause-text">${item.cause}</p>
        <span class="cause-tag" style="color: var(--secondary);">Consequence / Result:</span>
        <p class="effect-text">${item.effect}</p>
      `;
      elements.summaryCauseEffectList.appendChild(div);
    });

    // Checklist
    elements.summaryChecklist.innerHTML = '';
    (state.summary.studyChecklist || []).forEach((checkText, idx) => {
      const label = document.createElement('label');
      label.className = 'check-item';
      label.innerHTML = `
        <input type="checkbox" id="check-${idx}">
        <span>${checkText}</span>
      `;
      elements.summaryChecklist.appendChild(label);
    });
  }

  function copySummaryMarkdown() {
    if (!state.summary) {
      showToast('No summary generated yet.');
      return;
    }

    let md = `# ${state.summary.title || 'Executive Summary'}\n\n`;
    md += `## Executive Overview\n${state.summary.executiveSummary}\n\n`;
    md += `## Key Terms & Concepts\n`;
    (state.summary.keyConcepts || []).forEach(t => {
      md += `- **${t.term}**: ${t.definition}\n`;
    });
    md += `\n## Cause and Effect\n`;
    (state.summary.causeAndEffect || []).forEach(c => {
      md += `- If *${c.cause}* -> **${c.effect}**\n`;
    });
    md += `\n## Active Recall Checklist\n`;
    (state.summary.studyChecklist || []).forEach(k => {
      md += `- [ ] ${k}\n`;
    });

    navigator.clipboard.writeText(md).then(() => {
      showToast('Copied summary markdown to clipboard!');
    }).catch(() => {
      showToast('Clipboard copy failed.');
    });
  }

  // ========================================================
  // Synthesize Everything (Master Button)
  // ========================================================
  async function generateAll() {
    const text = elements.notesTextarea.value.trim();
    if (!text || text.length < 30) {
      showToast('Please upload a document or enter lecture notes first.');
      return;
    }

    showLoading('Deep Learning Synthesis in Progress', 'Extracting knowledge representation, active recall cards, assessment questions, and cognitive summaries...');

    try {
      // Run card generation
      await generateFlashcards(false);
      // Run quiz generation
      await generateQuiz(false);
      // Run summary generation
      await generateSummary(false);

      showToast('Full study suite synthesized!');
      switchTab('flashcards');
    } catch (err) {
      showToast(`Synthesis error: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  // ========================================================
  // Event Listeners & Keyboard Shortcuts
  // ========================================================
  function setupEventListeners() {
    // Navigation Tabs
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Notes Editor changes
    elements.notesTextarea.addEventListener('input', updateNotesStats);
    elements.btnClearNotes.addEventListener('click', () => {
      elements.notesTextarea.value = '';
      updateNotesStats();
      showToast('Notes cleared');
    });

    // Card Count Pills
    elements.cardCountPills.forEach(pill => {
      pill.addEventListener('click', () => {
        elements.cardCountPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.cardCount = parseInt(pill.dataset.value, 10);
      });
    });

    // Difficulty Pills
    elements.difficultyPills.forEach(pill => {
      pill.addEventListener('click', () => {
        elements.difficultyPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.difficulty = pill.dataset.value;
      });
    });

    // Primary Action Buttons
    elements.btnGenerateAll.addEventListener('click', generateAll);
    elements.btnGenerateCardsOnly.addEventListener('click', () => generateFlashcards(true));
    elements.btnGenerateQuizOnly.addEventListener('click', () => generateQuiz(true));
    elements.btnGenerateSummaryOnly.addEventListener('click', () => generateSummary(true));

    // Flashcard Interactions
    elements.cardContainer.addEventListener('click', flipCard);
    elements.btnNextCard.addEventListener('click', (e) => { e.stopPropagation(); nextCard(); });
    elements.btnPrevCard.addEventListener('click', (e) => { e.stopPropagation(); prevCard(); });
    elements.btnSpeakFront.addEventListener('click', (e) => { e.stopPropagation(); speakCurrentPrompt(); });
    elements.btnShuffle.addEventListener('click', shuffleDeck);
    elements.btnExportAnki.addEventListener('click', exportAnki);
    elements.btnExportJson.addEventListener('click', exportJson);

    // Rating Buttons on Back of Card
    elements.rateButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        rateCard(btn.dataset.rating);
      });
    });

    // Filters on Flashcard Preview Grid
    elements.filterSearch.addEventListener('input', renderCardsPreviewGrid);
    elements.filterDiff.addEventListener('change', renderCardsPreviewGrid);

    // Quiz Navigation
    elements.btnQuizNext.addEventListener('click', nextQuizQuestion);
    elements.btnQuizRetry.addEventListener('click', () => {
      state.quizIndex = 0;
      state.quizScore = 0;
      elements.quizActiveCard.classList.remove('hidden');
      elements.quizResultsScreen.classList.add('hidden');
      renderActiveQuizQuestion();
    });
    elements.btnGotoCards.addEventListener('click', () => switchTab('flashcards'));

    // Summary Actions
    elements.btnCopySummary.addEventListener('click', copySummaryMarkdown);

    // Sound toggle
    elements.btnSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      elements.iconSoundOn.classList.toggle('hidden', !state.soundEnabled);
      elements.iconSoundOff.classList.toggle('hidden', state.soundEnabled);
      showToast(state.soundEnabled ? 'Audio feedback enabled' : 'Audio feedback muted');
    });

    // Settings Modal
    elements.btnSettings.addEventListener('click', () => {
      elements.inputApiKey.value = state.settings.apiKey;
      elements.inputModel.value = state.settings.model;
      elements.inputBaseUrl.value = state.settings.baseUrl;
      elements.settingsModal.classList.remove('hidden');
    });

    elements.btnCloseSettings.addEventListener('click', () => {
      elements.settingsModal.classList.add('hidden');
    });

    elements.btnSaveSettings.addEventListener('click', () => {
      state.settings.apiKey = elements.inputApiKey.value.trim();
      state.settings.model = elements.inputModel.value;
      state.settings.baseUrl = elements.inputBaseUrl.value.trim();

      localStorage.setItem('cognicraft_api_key', state.settings.apiKey);
      localStorage.setItem('cognicraft_model', state.settings.model);
      localStorage.setItem('cognicraft_base_url', state.settings.baseUrl);

      updateModelBadge();
      elements.settingsModal.classList.add('hidden');
      showToast('Settings saved successfully!');
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts while typing in inputs or textarea
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
        return;
      }

      // Space: Flip Card
      if (e.code === 'Space') {
        e.preventDefault();
        flipCard();
      }
      // Arrow Right: Next Card
      else if (e.code === 'ArrowRight') {
        e.preventDefault();
        nextCard();
      }
      // Arrow Left: Previous Card
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        prevCard();
      }
      // 1, 2, 3, 4: Rate Flashcard (when flipped)
      else if (state.isCardFlipped) {
        if (e.key === '1') rateCard('again');
        else if (e.key === '2') rateCard('hard');
        else if (e.key === '3') rateCard('good');
        else if (e.key === '4') rateCard('easy');
      }
    });

    setupDragAndDrop();
  }

  // Boot Application
  initApp();
});
