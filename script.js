// ═══════════════════════════════════════════════════════════
//  SIPPY'S AI TUTOR  ·  script.js
// ═══════════════════════════════════════════════════════════

const GEMINI_MODEL = "gemini-3.5-flash";

// ── DOM ─────────────────────────────────────────────────────
const el = {
    setupForm:       document.getElementById("setupForm"),
    answerForm:      document.getElementById("answerForm"),
    apiKey:          document.getElementById("apiKey"),
    topic:           document.getElementById("topic"),
    sessionType:     document.getElementById("sessionType"),
    sessionLength:   document.getElementById("sessionLength"),
    startBtn:        document.getElementById("startBtn"),
    stopBtn:         document.getElementById("stopBtn"),
    micBtn:          document.getElementById("micBtn"),
    nextBtn:         document.getElementById("nextBtn"),
    sendBtn:         document.getElementById("sendBtn"),
    answerInput:     document.getElementById("answerInput"),
    chatBox:         document.getElementById("chatBox"),
    status:          document.getElementById("status"),
    timer:           document.getElementById("timer"),
    score:           document.getElementById("score"),
    questionCount:   document.getElementById("questionCount"),
    currentTopic:    document.getElementById("currentTopic"),
    overallProgress: document.getElementById("overallProgress"),
    recordingHint:   document.getElementById("recordingHint"),
    timerBar:        document.getElementById("timerBar"),
};

// ── Speech Recognition ───────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition       = SpeechRecognition ? new SpeechRecognition() : null;

// ── State ────────────────────────────────────────────────────
const state = {
    topic:                "everyday communication",
    sessionType:          "workplace",
    questions:            [],
    currentQuestionIndex: -1,
    questionCount:        0,
    secondsLeft:          15 * 60,
    totalSeconds:         15 * 60,
    timerId:              null,
    isBusy:               false,
    isListening:          false,
    transcript:           [],
    sessionStopped:       false,
    sessionSummary:       [],
    allScores:            [],
};

// ── Fallback questions ───────────────────────────────────────
const fallbackQ = {
    workplace:    [
        "Give a clear one-minute update on this topic — situation, progress, next step.",
        "Explain one challenge related to this topic and how you'd handle it.",
        "Convince a busy manager why this topic matters right now.",
    ],
    interview:    [
        "Tell me about your experience with this topic using a specific example.",
        "Describe a difficult situation connected to this topic and what you learned.",
        "Why should someone trust your communication in this area?",
    ],
    storytelling: [
        "Tell a short story about this topic — beginning, turning point, ending.",
        "Describe the most interesting detail so the listener can picture it clearly.",
        "Share what this topic taught you and why it stayed with you.",
    ],
    daily:        [
        "Explain this topic naturally to a friend in simple, clear English.",
        "Ask and answer two likely follow-up questions about this topic.",
        "Share your opinion on this topic and support it with one clear reason.",
    ],
};

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
function init() {
    const saved = localStorage.getItem("GEMINI_API_KEY") || "";
    if (saved) el.apiKey.value = saved;

    loadOverallProgress();
    initSpeech();
    bindEvents();
}

function initSpeech() {
    if (!recognition) {
        el.micBtn.textContent = "Speech N/A";
        el.micBtn.title       = "Web Speech API not supported here.";
        return;
    }

    recognition.lang           = "en-US";
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalText = "";

    recognition.onstart = () => {
        finalText = "";
        state.isListening = true;

        el.micBtn.textContent = "🛑 Stop Speaking";
        el.micBtn.classList.add("is-listening");
        el.answerInput.classList.add("is-recording");
        el.answerInput.value = "";
        el.recordingHint.classList.remove("hidden");
        el.sendBtn.disabled = true;

        setStatus("🎙️ Listening…", "sp-listening");
    };

    recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) finalText += r[0].transcript + " ";
            else            interim  += r[0].transcript;
        }
        el.answerInput.value = (finalText + interim).trim();
    };

    recognition.onend = () => {
        state.isListening = false;

        el.micBtn.textContent = "🎙️ Speak";
        el.micBtn.classList.remove("is-listening");
        el.answerInput.classList.remove("is-recording");
        el.recordingHint.classList.add("hidden");

        const text = el.answerInput.value.trim();
        if (text && !state.isBusy) {
            el.sendBtn.disabled = false;
            setStatus("✅ Review & Send!", "sp-review");
        } else if (!state.isBusy) {
            setStatus("Your turn", "sp-ready");
        }
    };

    recognition.onerror = (e) => {
        state.isListening = false;
        el.micBtn.textContent = "🎙️ Speak";
        el.micBtn.classList.remove("is-listening");
        el.answerInput.classList.remove("is-recording");
        el.recordingHint.classList.add("hidden");

        const msg = e.error === "not-allowed"
            ? "Mic blocked — check browser permissions"
            : "Speech error — try again";
        setStatus("⚠️ " + msg, "sp-error");
    };
}

function bindEvents() {
    el.setupForm.addEventListener("submit", startSession);
    el.answerForm.addEventListener("submit", submitAnswer);

    el.micBtn.addEventListener("click", () => {
        state.isListening ? stopListening() : startListening();
    });

    el.nextBtn.addEventListener("click", askNextQuestion);
    el.stopBtn.addEventListener("click", stopSession);
}

// ══════════════════════════════════════════════════════════════
//  SESSION  LIFECYCLE
// ══════════════════════════════════════════════════════════════
async function startSession(e) {
    e.preventDefault();

    const key = getApiKey();
    if (!key) {
        setStatus("⚠️ Enter API key", "sp-error");
        el.apiKey.focus();
        return;
    }

    setBusy(true, "🔑 Validating…", "sp-thinking");

    const valid = await validateApiKey(key);
    if (!valid) {
        setBusy(false, "❌ Invalid key", "sp-error");
        addCoachMsg("Oops! 😅 That Gemini key didn't work. Please check it and try again.", false);
        el.apiKey.focus();
        return;
    }

    localStorage.setItem("GEMINI_API_KEY", key);

    // Reset state
    state.topic               = el.topic.value.trim() || "everyday communication";
    state.sessionType         = el.sessionType.value;
    state.totalSeconds        = Number(el.sessionLength.value) * 60;
    state.secondsLeft         = state.totalSeconds;
    state.currentQuestionIndex = -1;
    state.questionCount       = 0;
    state.transcript          = [];
    state.sessionStopped      = false;
    state.sessionSummary      = [];
    state.allScores           = [];

    // Reset UI
    el.currentTopic.textContent = state.topic;
    el.questionCount.textContent = "0";
    el.score.textContent         = "--";
    el.chatBox.innerHTML         = "";
    el.answerInput.value         = "";
    el.recordingHint.classList.add("hidden");
    el.timerBar.style.width      = "100%";
    el.timerBar.className        = "timer-fill";

    setControlsEnabled(false);
    setBusy(true, "✨ Building questions…", "sp-thinking");
    startTimer();

    try {
        state.questions = await createQuestions();
    } catch {
        state.questions = [...fallbackQ[state.sessionType]];
        addCoachMsg("Couldn't reach Gemini — using built-in questions. Let's go! 🏃", false);
    }

    setBusy(false, "Your turn", "sp-ready");
    setControlsEnabled(true);
    el.stopBtn.disabled = false;

    askNextQuestion();
}

function stopSession() {
    if (state.isListening) recognition.stop();

    state.sessionStopped = true;
    stopTimer();
    setControlsEnabled(false);
    el.stopBtn.disabled = true;
    el.recordingHint.classList.add("hidden");
    setStatus("⛔ Stopped", "sp-error");
    saveSession();
    addCoachMsg("Session ended! Great effort today, Jerry! 🐭 See you next time! 💪", false);
}

// ══════════════════════════════════════════════════════════════
//  QUESTIONS
// ══════════════════════════════════════════════════════════════
function askNextQuestion() {
    if (state.isBusy) return;

    state.currentQuestionIndex++;

    if (state.currentQuestionIndex >= state.questions.length) {
        addCoachMsg("🎉 You nailed it, Jerry! All questions done — session saved. Come back to practice more! 🏆", false);
        setControlsEnabled(false);
        stopTimer();
        el.stopBtn.disabled = true;
        setStatus("🏁 Complete!", "sp-done");
        saveSession();
        return;
    }

    state.questionCount++;
    el.questionCount.textContent = String(state.questionCount);

    const q = state.questions[state.currentQuestionIndex];
    addCoachMsg(q, true);
    setStatus("Your turn", "sp-ready");

    el.answerInput.value = "";
    el.sendBtn.disabled  = true;
}

// ══════════════════════════════════════════════════════════════
//  ANSWER SUBMISSION
// ══════════════════════════════════════════════════════════════
async function submitAnswer(e) {
    e.preventDefault();

    const answer = el.answerInput.value.trim();
    if (!answer || state.isBusy) return;

    if (state.isListening) recognition.stop();

    const question = state.questions[state.currentQuestionIndex];

    addUserMsg(answer);
    state.transcript.push({ question, answer });

    el.answerInput.value = "";
    el.sendBtn.disabled  = true;
    setControlsEnabled(false);
    setBusy(true, "🤔 Reviewing…", "sp-thinking");

    try {
        const fb = await reviewAnswer(question, answer);

        state.sessionSummary.push({
            question, answer, feedback: fb,
            createdAt: new Date().toISOString(),
        });

        const scoreNum = parseFloat(fb.score) || 0;
        state.allScores.push(scoreNum);

        popStat(el.score, String(fb.score ?? "--"));
        loadOverallProgress();
        addFeedbackMsg(fb);

        if (fb.followUp && fb.followUp.trim()) {
            state.questions.splice(state.currentQuestionIndex + 1, 0, fb.followUp);
        }
    } catch {
        addCoachMsg("Couldn't review that one — let's keep going! 🐱", false);
    }

    setBusy(false, "Your turn", "sp-ready");
    setControlsEnabled(true);
    el.stopBtn.disabled = false;
    askNextQuestion();
}

// ══════════════════════════════════════════════════════════════
//  SPEECH
// ══════════════════════════════════════════════════════════════
function startListening() {
    if (!recognition || state.isBusy || state.isListening) return;
    try { recognition.start(); } catch { /* already running */ }
}

function stopListening() {
    if (!recognition || !state.isListening) return;
    recognition.stop();
}

// ══════════════════════════════════════════════════════════════
//  API
// ══════════════════════════════════════════════════════════════
async function validateApiKey(key) {
    try {
        // Use the models list endpoint — works with ANY valid API key
        // regardless of which model names are currently available
        const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
            { method: "GET" }
        );
        return r.ok;
    } catch { return false; }
}

async function createQuestions() {
    const prompt = `
Create 6 varied communication practice questions.
Topic: ${state.topic}
Session type: ${state.sessionType}

Return ONLY valid JSON:
{"questions":["Q1","Q2","Q3","Q4","Q5","Q6"]}
`;
    const data   = await callGemini(prompt, 0.8);
    const parsed = parseJson(data);
    const list   = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (!list.length) throw new Error("No questions");
    return list.slice(0, 6);
}

async function reviewAnswer(question, answer) {
    const prompt = `
You are a warm, direct English communication coach.
Topic: ${state.topic}
Question: ${question}
Answer: ${answer}

Return ONLY valid JSON:
{
  "score": <integer 1-10>,
  "strength": "<one specific strength in their answer>",
  "improve": "<one practical, specific improvement>",
  "betterVersion": "<a polished version of their answer in 2-3 sentences>",
  "vocabulary": ["phrase 1","phrase 2","phrase 3"],
  "followUp": "<a short follow-up question, or empty string>"
}
`;
    const data = await callGemini(prompt, 0.4);
    return parseJson(data);
}

async function callGemini(prompt, temperature) {
    const r = await fetch(apiUrl(getApiKey()), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature,
                responseMimeType: "application/json",
            },
        }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Gemini request failed");

    const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) throw new Error("Empty response");
    return text;
}

function apiUrl(key) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
}

function parseJson(text) {
    try { return JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("Invalid JSON");
        return JSON.parse(m[0]);
    }
}

// ══════════════════════════════════════════════════════════════
//  UI  BUILDERS
// ══════════════════════════════════════════════════════════════
function addCoachMsg(text, isQ = false) {
    const a = document.createElement("article");
    a.className = "message ai-msg";
    a.innerHTML = `
        <div class="av av-tom">🐱</div>
        <div class="bubble tom-bubble">
            <div class="bubble-name">Coach Tom${isQ ? " · Question " + state.questionCount : ""}</div>
            <p>${esc(text)}</p>
        </div>`;
    el.chatBox.appendChild(a);
    scrollChat();
}

function addUserMsg(text) {
    const a = document.createElement("article");
    a.className = "message user-msg";
    a.innerHTML = `
        <div class="av av-jerry">🐭</div>
        <div class="bubble jerry-bubble">
            <div class="bubble-name">Jerry (You)</div>
            <p>${esc(text)}</p>
        </div>`;
    el.chatBox.appendChild(a);
    scrollChat();
}

function addFeedbackMsg(fb) {
    const score = parseFloat(fb.score) || 0;
    // Stars — max 10, display up to 10 ⭐
    const stars   = "⭐".repeat(Math.min(10, Math.round(score)));
    const vocabHtml = (Array.isArray(fb.vocabulary) && fb.vocabulary.length)
        ? `<div class="fb-item fb-vocab">
               <span class="fb-lbl">📚 Useful Phrases</span>
               <div class="vocab-pills">
                   ${fb.vocabulary.slice(0,3).map((v) => `<span class="v-pill">${esc(v)}</span>`).join("")}
               </div>
           </div>`
        : "";

    const a = document.createElement("article");
    a.className = "message ai-msg";
    a.innerHTML = `
        <div class="av av-tom">🐱</div>
        <div class="bubble tom-bubble">
            <div class="bubble-name">Coach Tom · Feedback</div>
            <div class="feedback-card">
                <div class="fb-score">
                    <span class="fb-score-num">${esc(String(fb.score ?? "--"))}</span>
                    <span class="fb-score-den">/10</span>
                    <span class="fb-score-stars">${stars}</span>
                </div>
                <div class="fb-item fb-strength">
                    <span class="fb-lbl">💪 Strength</span>
                    <p>${esc(fb.strength || "Good response!")}</p>
                </div>
                <div class="fb-item fb-improve">
                    <span class="fb-lbl">🎯 Improve</span>
                    <p>${esc(fb.improve || "Keep practicing!")}</p>
                </div>
                <div class="fb-item fb-better">
                    <span class="fb-lbl">✨ Better Version</span>
                    <p>${esc(fb.betterVersion || "")}</p>
                </div>
                ${vocabHtml}
            </div>
        </div>`;
    el.chatBox.appendChild(a);
    scrollChat();
}

function esc(str) {
    return String(str)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;");
}

function scrollChat() {
    el.chatBox.scrollTop = el.chatBox.scrollHeight;
}

// ── Status pill ──────────────────────────────────────────────
function setStatus(text, cls = "sp-ready") {
    el.status.textContent = text;
    el.status.className   = `status-pill ${cls}`;
}

// ── Busy state ───────────────────────────────────────────────
function setBusy(busy, label, cls) {
    state.isBusy         = busy;
    el.startBtn.disabled = busy;
    if (label) setStatus(label, cls);
}

// ── Controls enable/disable ──────────────────────────────────
function setControlsEnabled(on) {
    el.answerInput.disabled = !on;
    el.nextBtn.disabled     = !on;
    el.micBtn.disabled      = !on || !recognition;
    el.sendBtn.disabled     = true;   // only enabled after speech stops
}

// ── Stat pop animation ───────────────────────────────────────
function popStat(elStat, value) {
    elStat.textContent = value;
    elStat.classList.remove("pop");
    void elStat.offsetWidth;
    elStat.classList.add("pop");
    setTimeout(() => elStat.classList.remove("pop"), 600);
}

// ══════════════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════════════
function startTimer() {
    stopTimer();
    updateTimer();
    state.timerId = setInterval(() => {
        state.secondsLeft = Math.max(0, state.secondsLeft - 1);
        updateTimer();

        if (state.secondsLeft === 0) {
            stopTimer();
            setControlsEnabled(false);
            el.stopBtn.disabled = true;
            setStatus("⏰ Time's up!", "sp-done");
            saveSession();
            addCoachMsg("⏰ Time's up! Great session, Jerry! 🎉 Practice summary saved!", false);
        }
    }, 1000);
}

function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}

function updateTimer() {
    const m = Math.floor(state.secondsLeft / 60);
    const s = state.secondsLeft % 60;

    el.timer.textContent  = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    el.timer.style.color  = state.secondsLeft <= 60 ? "var(--red)" : "";

    // Progress bar
    const pct = state.totalSeconds > 0
        ? (state.secondsLeft / state.totalSeconds) * 100
        : 100;

    el.timerBar.style.width = pct + "%";
    if      (pct <= 10)  el.timerBar.className = "timer-fill empty";
    else if (pct <= 30)  el.timerBar.className = "timer-fill warn";
    else                 el.timerBar.className = "timer-fill";
}

// ══════════════════════════════════════════════════════════════
//  PERSISTENCE
// ══════════════════════════════════════════════════════════════
function saveSession() {
    const all = JSON.parse(localStorage.getItem("sippys_sessions") || "[]");
    all.unshift({
        topic:      state.topic,
        type:       state.sessionType,
        questions:  state.questionCount,
        date:       new Date().toISOString(),
        summary:    state.sessionSummary,
    });
    localStorage.setItem("sippys_sessions", JSON.stringify(all.slice(0, 50)));
    loadOverallProgress();
}

function loadOverallProgress() {
    const all = JSON.parse(localStorage.getItem("sippys_sessions") || "[]");
    const nums = [
        ...all.flatMap((s) =>
            (s.summary || []).map((i) => parseFloat(i?.feedback?.score) || 0)
        ),
        ...state.allScores,
    ].filter(Boolean);

    if (!nums.length) { el.overallProgress.textContent = "--"; return; }
    const avg = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
    el.overallProgress.textContent = avg;
}

function getApiKey() {
    return (
        el.apiKey.value ||
        localStorage.getItem("GEMINI_API_KEY") ||
        ""
    ).trim();
}

// ══════════════════════════════════════════════════════════════
//  GO
// ══════════════════════════════════════════════════════════════
init();
