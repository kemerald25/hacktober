const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max
});

// Helper: Get OpenAI compatible client
function getAIClient(userApiKey, userBaseUrl) {
  const apiKey = userApiKey || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // Default to OpenRouter or Gemini endpoint if provided, or standard OpenRouter endpoint
  let baseURL = userBaseUrl;
  if (!baseURL) {
    if (apiKey.startsWith('sk-or-')) {
      baseURL = 'https://openrouter.ai/api/v1';
    } else if (process.env.GEMINI_API_KEY && apiKey === process.env.GEMINI_API_KEY) {
      baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    } else {
      baseURL = 'https://openrouter.ai/api/v1';
    }
  }

  return new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/kemerald25/hacktober',
      'X-Title': 'CogniCraft Flashcard & Study AI'
    }
  });
}

// Check configuration status from .env
app.get('/api/config-status', (req, res) => {
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim());
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const defaultModel = process.env.DEFAULT_MODEL || 'google/gemma-2-9b-it';

  res.json({
    hasEnvKey: hasOpenRouter || hasGemini,
    provider: hasOpenRouter ? 'OpenRouter (.env)' : (hasGemini ? 'Gemini (.env)' : null),
    defaultModel: defaultModel
  });
});

// ==========================================
// 1. PDF & Document Extraction Endpoint
// ==========================================
app.post('/api/extract-pdf', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document file was uploaded.' });
    }

    const originalName = req.file.originalname;
    const isPdf = originalName.toLowerCase().endsWith('.pdf') || req.file.mimetype === 'application/pdf';

    let text = '';
    let pageCount = 1;

    if (isPdf) {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || '';
      pageCount = parsed.numpages || 1;
    } else {
      // Plain text or markdown
      text = req.file.buffer.toString('utf-8');
    }

    // Clean whitespace and normalized line breaks
    const cleanedText = text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    if (!cleanedText || cleanedText.length < 30) {
      return res.status(422).json({
        error: 'Document text appears empty, scanned, or unreadable. Please upload a searchable PDF or paste notes directly.'
      });
    }

    const words = cleanedText.split(/\s+/).filter(Boolean).length;
    const estimatedReadTime = Math.ceil(words / 200);

    return res.json({
      success: true,
      filename: originalName,
      pageCount: pageCount,
      wordCount: words,
      estimatedReadTimeMinutes: estimatedReadTime,
      extractedText: cleanedText
    });
  } catch (err) {
    console.error('PDF parsing error:', err);
    return res.status(500).json({
      error: 'Failed to extract text from PDF: ' + err.message
    });
  }
});

// ==========================================
// 2. Flashcard Generation (Learning Science)
// ==========================================
const FLASHCARD_SYSTEM_PROMPT = `You are a senior fullstack engineer and learning-science-minded educator with 20+ years of experience building study tools. Your job is to turn a student's uploaded PDF and lecture notes into high-quality flashcards.

## Flashcard rules
1. One concept per card. Never combine multiple ideas in a single card.
2. The front is a clear, specific question or prompt. The back is a short, accurate answer (1-3 sentences max).
3. Cover the full document proportionally: definitions, key terms, processes/steps, cause-and-effect, comparisons, formulas, and important examples.
4. Use only information found in the document. Do not invent facts or add outside knowledge. If something is unclear, skip it.
5. Write questions that test understanding, not just word-matching. Mix recall ("What is...?"), explanation ("Why does...?"), and application ("Given X, what happens?").
6. No duplicate or near-duplicate cards.
7. Skip non-instructional content: tables of contents, page numbers, headers/footers, references, acknowledgements.
8. If the document is scanned, garbled, or has too little content, return an error object instead of guessing.

## Output format
Return ONLY valid JSON, with no markdown fences and no extra text:
{
  "title": "Short title inferred from the document",
  "flashcards": [
    {
      "id": 1,
      "front": "Question or prompt",
      "back": "Concise answer",
      "topic": "Section or concept this belongs to",
      "difficulty": "easy | medium | hard"
    }
  ]
}

On failure, return:
{ "error": "Brief reason, e.g. 'Document text unreadable'" }`;

app.post('/api/generate-flashcards', async (req, res) => {
  const { text, cardCount = 15, difficulty = 'medium', apiKey, baseUrl, model = 'google/gemma-2-9b-it' } = req.body;

  if (!text || text.trim().length < 40) {
    return res.status(400).json({ error: 'Please provide sufficient document text (at least 40 characters).' });
  }

  const client = getAIClient(apiKey, baseUrl);

  if (client) {
    try {
      const userPrompt = `Quantity: Generate exactly ${cardCount} cards.
Target level: ${difficulty} (easy | medium | hard).

## Document content:
${text.slice(0, 30000)}`;

      const response = await client.chat.completions.create({
        model: model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: FLASHCARD_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      });

      const rawContent = response.choices[0]?.message?.content || '{}';
      const parsed = extractJson(rawContent);

      if (parsed && Array.isArray(parsed.flashcards) && parsed.flashcards.length > 0) {
        return res.json({
          source: 'llm',
          model: model,
          ...parsed
        });
      }
    } catch (llmErr) {
      console.warn('LLM call failed, falling back to smart educational engine:', llmErr.message);
    }
  }

  // Smart Educational Heuristic Generator (Zero-setup Fallback)
  const generated = generateHeuristicFlashcards(text, cardCount, difficulty);
  return res.json({
    source: client ? 'llm_fallback' : 'local_learning_science_engine',
    note: client ? 'Generated via smart engine due to remote API limitation' : 'Instant offline learning science engine (Set API key in settings for Gemma/OpenRouter)',
    ...generated
  });
});

// ==========================================
// 3. Quiz Generation Endpoint
// ==========================================
const QUIZ_SYSTEM_PROMPT = `You are a learning science educator. Generate an active-recall multiple-choice quiz based ONLY on the provided text.
Return ONLY valid JSON with no markdown fences:
{
  "title": "Quiz Title",
  "questions": [
    {
      "id": 1,
      "question": "Clear conceptual question testing understanding",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "1-2 sentences explaining why this answer is correct and why other choices fail based strictly on the text.",
      "topic": "Concept / Topic tag",
      "difficulty": "easy | medium | hard"
    }
  ]
}`;

app.post('/api/generate-quiz', async (req, res) => {
  const { text, questionCount = 8, difficulty = 'medium', apiKey, baseUrl, model = 'google/gemma-2-9b-it' } = req.body;

  if (!text || text.trim().length < 40) {
    return res.status(400).json({ error: 'Insufficient text for quiz generation.' });
  }

  const client = getAIClient(apiKey, baseUrl);

  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: QUIZ_SYSTEM_PROMPT },
          { role: 'user', content: `Generate ${questionCount} questions at ${difficulty} level from:\n\n${text.slice(0, 25000)}` }
        ]
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const parsed = extractJson(raw);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return res.json({ source: 'llm', ...parsed });
      }
    } catch (err) {
      console.warn('Quiz LLM failed, using heuristic engine:', err.message);
    }
  }

  const quiz = generateHeuristicQuiz(text, questionCount, difficulty);
  return res.json({ source: 'local_engine', ...quiz });
});

// ==========================================
// 4. Automated Summarization & Cheat Sheet
// ==========================================
const SUMMARY_SYSTEM_PROMPT = `You are an expert educator. Synthesize the provided document into a high-retention structured study summary.
Return ONLY valid JSON with no markdown fences:
{
  "title": "Document Title",
  "executiveSummary": "2-3 paragraph synthesis explaining core thesis, relevance, and high-level mechanisms.",
  "keyConcepts": [
    { "term": "Term or Concept", "definition": "Accurate, concise definition based strictly on the text", "significance": "Why it matters" }
  ],
  "causeAndEffect": [
    { "cause": "Action or Condition", "effect": "Result or Consequence" }
  ],
  "studyChecklist": [
    "I can explain...",
    "I understand the difference between..."
  ]
}`;

app.post('/api/generate-summary', async (req, res) => {
  const { text, apiKey, baseUrl, model = 'google/gemma-2-9b-it' } = req.body;

  if (!text || text.trim().length < 40) {
    return res.status(400).json({ error: 'Insufficient text for summarization.' });
  }

  const client = getAIClient(apiKey, baseUrl);

  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: `Summarize the following document for high retention:\n\n${text.slice(0, 25000)}` }
        ]
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const parsed = extractJson(raw);
      if (parsed && parsed.executiveSummary) {
        return res.json({ source: 'llm', ...parsed });
      }
    } catch (err) {
      console.warn('Summary LLM failed, using heuristic engine:', err.message);
    }
  }

  const summary = generateHeuristicSummary(text);
  return res.json({ source: 'local_engine', ...summary });
});

// ==========================================
// 5. Sample Library Endpoint
// ==========================================
app.get('/api/samples', (req, res) => {
  res.json({
    samples: [
      {
        id: 'gemini-openai-compat',
        title: 'Gemini Models via OpenAI Compatibility SDK',
        category: 'AI Engineering & APIs',
        description: 'Complete guide on routing OpenAI SDK calls to Gemini endpoints, thinking controls, vision, audio, and batch processing.',
        text: `Gemini models are accessible using the OpenAI libraries (Python and TypeScript / Javascript) along with the REST API, by updating three lines of code and using your Gemini API key. If you aren't already using the OpenAI libraries, we recommend that you call the Gemini API directly.

What changed? Just three lines!
- api_key="GEMINI_API_KEY": Replace with your actual Gemini API key from Google AI Studio.
- base_url="https://generativelanguage.googleapis.com/v1beta/openai/": Tells the OpenAI library to send requests to the Gemini API endpoint instead of the default URL.
- model="gemini-3.8-flash": Choose a compatible Gemini model.

Thinking & Reasoning:
Gemini models are trained to think through complex problems. The Gemini API comes with thinking parameters.
- reasoning_effort="minimal" maps to thinking_level low in Gemini 4 Argon, minimal in 3.1 Flash-Lite / 3 Flash, and 1,024 thinking_budget in Gemini 2.5.
- reasoning_effort="low" maps to low and 1,024 budget in 2.5.
- reasoning_effort="medium" maps to medium and 8,192 budget in 2.5.
- reasoning_effort="high" maps to high and 24,576 budget in 2.5.
If no reasoning_effort is specified, Gemini uses the model's default level or budget.
To disable thinking, set reasoning_effort to "none" for 2.5 models. Reasoning cannot be turned off for Gemini 2.5 Pro or Gemini 3 models.
Note that reasoning_effort and thinking_level/thinking_budget overlap functionality, so they cannot be used at the same time. Thought summaries are supported using extra_body with thinking_config.

Multimodal Vision & Audio:
Images are supported via base64 encoded strings in image_url objects.
Audio understanding is supported using input_audio with data in base64 and format="wav". If using curl, large files can cause an "Argument list too long" error.

Image & Video Generation:
Generate images using gemini-2.5-flash-image or gemini-3-pro-image-preview. Grounding with Google Search is only available on Gemini 3 and newer models.
Veo 3.1 Preview was shut down on October 22, 2026. Video generation with gemini-omni-1.1-flash is not supported on the OpenAI-compatible /v1/videos endpoint.

Structured Output:
Structured JSON is supported using client.beta.chat.completions.parse with Pydantic in Python or zodResponseFormat with Zod in JavaScript.

Embeddings:
Use gemini-embedding-001 for text-only embeddings, and gemini-embedding-2 for multimodal embeddings.

Batch API & Service Tiers:
Batch creation, monitoring, and results are supported. File upload and download are not supported via OpenAI compatibility; use the regular Google genai client for file management.
Service tiers match OpenAI: "priority" and "flex", with default "standard" matching OpenAI default.`
      },
      {
        id: 'neural-networks-foundations',
        title: 'Deep Learning & Neural Network Fundamentals',
        category: 'Computer Science',
        description: 'Core concepts in deep learning: Perceptrons, Backpropagation, Gradient Descent, Overfitting, and Activation Functions.',
        text: `Deep learning is a subset of machine learning based on artificial neural networks with multiple representation layers.

1. Artificial Neurons & Architecture:
A perceptron receives multiple inputs, applies weights and a bias, and passes the sum through an activation function.
Feedforward networks transmit information in one forward direction from input nodes through hidden layers to output nodes without cycles.

2. Activation Functions:
Activation functions introduce non-linearity into neural networks, enabling them to approximate arbitrary non-linear functions.
- Sigmoid: Maps values to (0, 1). Suffers from vanishing gradients when inputs are very large or small.
- ReLU (Rectified Linear Unit): f(x) = max(0, x). Computationally efficient and mitigates vanishing gradient, but can suffer from the 'dying ReLU' problem when neurons permanently output zero.
- Softmax: Normalizes output logits into a probability distribution summing to 1, standard for multi-class classification.

3. Optimization & Backpropagation:
Backpropagation uses the chain rule of calculus to compute the partial derivative of the loss function with respect to each weight.
Gradient descent iteratively updates weights in the opposite direction of the gradient: W = W - learning_rate * dL/dW.
Stochastic Gradient Descent (SGD) updates weights using single samples or mini-batches, introducing noise that helps escape saddle points.
Adam (Adaptive Moment Estimation) combines momentum and RMSprop to adapt individual learning rates for each parameter.

4. Overfitting and Regularization:
Overfitting occurs when a model learns training noise rather than general patterns, resulting in low training loss but high validation loss.
- Dropout: Randomly deactivates a fraction of neurons during training, preventing co-adaptation.
- L2 Regularization (Weight Decay): Adds a penalty proportional to the sum of squared weights to the loss function, encouraging smaller weights.
- Early Stopping: Halts training when validation loss stops improving.`
      },
      {
        id: 'cellular-respiration',
        title: 'Cellular Respiration & Bioenergetics',
        category: 'Biology & Biochemistry',
        description: 'The metabolic pathways converting biochemical energy from nutrients into ATP: Glycolysis, Krebs Cycle, and Oxidative Phosphorylation.',
        text: `Cellular respiration is the biochemical process by which eukaryotic organisms break down organic nutrients into adenosine triphosphate (ATP), releasing carbon dioxide and water as byproducts.

1. Glycolysis:
Occurs in the cytoplasm and requires no oxygen (anaerobic).
One molecule of glucose (6 carbons) is broken down into two molecules of pyruvate (3 carbons).
Net yield per glucose: 2 ATP (via substrate-level phosphorylation) and 2 NADH.

2. Pyruvate Oxidation (The Link Reaction):
Each pyruvate enters the mitochondrial matrix and is converted into Acetyl-CoA by pyruvate dehydrogenase.
Yield per glucose: 2 Acetyl-CoA, 2 NADH, and 2 CO2 molecules.

3. The Citric Acid Cycle (Krebs Cycle):
Takes place in the mitochondrial matrix. Acetyl-CoA combines with oxaloacetate (4 carbons) to form citrate (6 carbons).
Through a cyclical series of redox reactions, citrate is regenerated into oxaloacetate.
Yield per glucose (two turns): 6 NADH, 2 FADH2, 2 ATP (or GTP), and 4 CO2.

4. Oxidative Phosphorylation:
Occurs along the inner mitochondrial membrane (cristae).
- Electron Transport Chain (ETC): High-energy electrons from NADH and FADH2 are transferred through Complexes I-IV to molecular oxygen (the terminal electron acceptor), producing water.
- Chemiosmosis & Proton Gradient: As electrons flow, protons (H+) are pumped from the matrix into the intermembrane space, generating an electrochemical proton motive force.
- ATP Synthase: Protons flow down their concentration gradient back into the matrix through ATP Synthase, driving rotary phosphorylation of ADP into ATP.
Total theoretical ATP yield per glucose molecule is approximately 30 to 32 ATP.`
      }
    ]
  });
});

// ==========================================
// Utility: Robust JSON Extraction from LLM
// ==========================================
function extractJson(text) {
  if (!text) return null;
  // Remove markdown fences if present
  let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    // Attempt to locate first { and last }
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.substring(firstBrace, lastBrace + 1));
      } catch (inner) {
        return null;
      }
    }
    return null;
  }
}

// ==========================================
// Learning Science Heuristic Generators
// (Guarantees immediate zero-config study)
// ==========================================
function generateHeuristicFlashcards(text, count = 15, targetDifficulty = 'medium') {
  const sentences = text
    .split(/(?<=[.?!])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(s => s.length > 25 && s.length < 300);

  const cards = [];
  let cardId = 1;

  // Pattern match definitions, steps, contrasts, causes
  const patterns = [
    {
      regex: /^(.*?)\s+(?:is|are|refers to|means|is defined as)\s+(.*)$/i,
      makeCard: (m) => ({
        front: `What is ${m[1].replace(/[-*•]/g, '').trim()}?`,
        back: `${m[1].trim()} is ${m[2].trim()}`,
        topic: 'Core Definition',
        difficulty: 'easy'
      })
    },
    {
      regex: /(.*)\s+(?:because|due to|as a result of|leads to|causes)\s+(.*)/i,
      makeCard: (m) => ({
        front: `Why does ${m[1].replace(/[-*•]/g, '').trim()} happen?`,
        back: `It occurs because ${m[2].trim()}`,
        topic: 'Cause & Effect',
        difficulty: 'medium'
      })
    },
    {
      regex: /(?:to|in order to)\s+(.*?),\s+(?:you must|one must|set|use)\s+(.*)/i,
      makeCard: (m) => ({
        front: `How do you ${m[1].trim()}?`,
        back: `You must ${m[2].trim()}`,
        topic: 'Process & Implementation',
        difficulty: 'medium'
      })
    },
    {
      regex: /(?:unlike|in contrast to|compared to)\s+(.*?),\s+(.*)/i,
      makeCard: (m) => ({
        front: `How does ${m[1].trim()} compare to related concepts?`,
        back: `Unlike ${m[1].trim()}, ${m[2].trim()}`,
        topic: 'Conceptual Comparison',
        difficulty: 'hard'
      })
    }
  ];

  // Try extracting from patterns first
  for (const sentence of sentences) {
    if (cards.length >= count) break;
    for (const pat of patterns) {
      const match = sentence.match(pat.regex);
      if (match && match[1] && match[2]) {
        const card = pat.makeCard(match);
        if (card.front.length > 12 && card.back.length > 15) {
          card.id = cardId++;
          cards.push(card);
          break;
        }
      }
    }
  }

  // Supplement with targeted sentence extractions to reach the desired card count
  for (const sentence of sentences) {
    if (cards.length >= count) break;
    // Skip if already in cards
    if (cards.some(c => c.back.includes(sentence.slice(0, 30)))) continue;

    const words = sentence.split(' ');
    if (words.length >= 8) {
      const subject = words.slice(0, 4).join(' ').replace(/[-*•:#]/g, '').trim();
      cards.push({
        id: cardId++,
        front: `Explain the key principle regarding: "${subject}"?`,
        back: sentence,
        topic: 'Key Concept',
        difficulty: cardId % 3 === 0 ? 'hard' : (cardId % 2 === 0 ? 'medium' : 'easy')
      });
    }
  }

  // Infer title
  const firstLine = text.split('\n')[0].replace(/[#*_-]/g, '').trim();
  const title = firstLine.length > 5 && firstLine.length < 80 ? firstLine : 'Active Recall Flashcards';

  return {
    title: title,
    flashcards: cards.slice(0, count)
  };
}

function generateHeuristicQuiz(text, count = 8, difficulty = 'medium') {
  const cardsObj = generateHeuristicFlashcards(text, count * 2, difficulty);
  const flashcards = cardsObj.flashcards;

  const questions = [];
  const total = Math.min(count, Math.floor(flashcards.length / 2));

  for (let i = 0; i < total; i++) {
    const target = flashcards[i];
    // Gather 3 distractors
    const distractors = flashcards
      .filter((_, idx) => idx !== i)
      .map(c => c.back)
      .slice(0, 3);

    while (distractors.length < 3) {
      distractors.push('None of the listed principles apply to this mechanism.');
    }

    const options = [target.back, ...distractors].sort(() => Math.random() - 0.5);
    const correctIndex = options.indexOf(target.back);

    questions.push({
      id: i + 1,
      question: target.front,
      options: options,
      correctIndex: correctIndex,
      explanation: `Correct: ${target.back}`,
      topic: target.topic,
      difficulty: target.difficulty
    });
  }

  return {
    title: cardsObj.title + ' — Practice Assessment',
    questions: questions
  };
}

function generateHeuristicSummary(text) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 50);
  const firstLine = text.split('\n')[0].replace(/[#*_-]/g, '').trim();
  const title = firstLine.length > 5 && firstLine.length < 80 ? firstLine : 'Study Synthesis & Key Insights';

  const executiveSummary = paragraphs.slice(0, 3).join('\n\n') || text.slice(0, 500);

  // Extract key terms
  const terms = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^[-*•]?\s*([A-Za-z0-9 _-]{3,30})[:\-—]\s*(.+)$/);
    if (match && terms.length < 6) {
      terms.push({
        term: match[1].trim(),
        definition: match[2].trim(),
        significance: 'Core operational construct within the subject matter.'
      });
    }
  }

  if (terms.length === 0) {
    terms.push(
      { term: 'Primary Mechanism', definition: 'The central theoretical framework described across the lecture notes.', significance: 'Foundation for understanding advanced topics.' },
      { term: 'Input Specifications', definition: 'The parameters and data structures required for proper execution.', significance: 'Critical for operational accuracy.' }
    );
  }

  return {
    title: title,
    executiveSummary: executiveSummary,
    keyConcepts: terms,
    causeAndEffect: [
      { cause: 'Adherence to learning-science active recall', effect: 'Significantly higher long-term knowledge retention.' },
      { cause: 'Targeted difficulty progression', effect: 'Optimizes cognitive load and prevents study fatigue.' }
    ],
    studyChecklist: [
      'I can articulate the primary concept without looking at the notes.',
      'I understand how each mechanism leads to its respective output.',
      'I can distinguish between the fundamental definitions and their edge cases.'
    ]
  };
}

// Start Server
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 CogniCraft Study Tool is LIVE on http://localhost:${PORT}`);
  console.log(`📚 Learning-Science Flashcards, Quizzes & Summaries`);
  console.log(`🤖 Gemma & OpenRouter OpenAI-Compatible Integration Ready`);
  console.log(`==================================================\n`);
});
