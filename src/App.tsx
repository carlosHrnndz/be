import { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Bookmark,
  CheckCircle2,
  Clock,
  History,
  Moon,
  Sun,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  X,
  Check
} from "lucide-react";
import rawQuestions from "./data/questions.json";

// Types
interface Question {
  id: string;
  question: string;
  options: {
    a: string;
    b: string;
    c: string;
    d: string;
  };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string; // Struct: [theory]\n\n\nEjemplo: [example]
  source: string;
}

interface TestHistoryEntry {
  id: string;
  date: string;
  score: number;
  correct: number;
  incorrect: number;
  blank: number;
  timeSpent: number; // in seconds
  questions: Question[];
  userAnswers: { [qId: string]: string };
  passed: boolean;
  type: "random" | "mistakes" | "all" | "study";
}

interface QuestionStats {
  [qId: string]: {
    attempts: number;
    failures: number;
  };
}

export default function App() {
  // Database state
  const [dbQuestions] = useState<Question[]>(rawQuestions as Question[]);
  const [dbLoading] = useState(false);
  const [dbError] = useState(
    rawQuestions.length === 0
      ? "Aún no se han generado las preguntas. Ejecuta el generador de preguntas para empezar."
      : ""
  );

  // UI view state
  // 'dashboard' | 'test' | 'results' | 'history_detail'
  const [view, setView] = useState<"dashboard" | "test" | "results" | "history_detail">("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Active Test state
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<{ [qId: string]: string }>({});
  const [markedForLater, setMarkedForLater] = useState<{ [qId: string]: boolean }>({});
  const [timeLeft, setTimeLeft] = useState(5400); // 1h 30m in seconds
  const [isTestActive, setIsTestActive] = useState(false);
  const [testType, setTestType] = useState<"random" | "mistakes" | "all" | "study">("random");
  
  // History and Stats states
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);
  const [questionStats, setQuestionStats] = useState<QuestionStats>({});
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<TestHistoryEntry | null>(null);

  // Accordion state for explanations (in results review)
  const [expandedExplanations, setExpandedExplanations] = useState<{ [qId: string]: boolean }>({});
  const [toastMessage, setToastMessage] = useState("");

  // Timer ref
  const timerRef = useRef<any>(null);
  const testStartTimeRef = useRef<number>(0);

  // Swipe gesture detection refs and handlers
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;

    const diffX = e.changedTouches[0].clientX - touchStartXRef.current;
    const diffY = e.changedTouches[0].clientY - touchStartYRef.current;
    const minSwipeDistance = 50;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > minSwipeDistance) {
      if (diffX > 0) {
        // Swipe Right -> Previous question
        setCurrentIdx((prev) => Math.max(0, prev - 1));
      } else {
        // Swipe Left -> Next question
        setCurrentIdx((prev) => Math.min(activeQuestions.length - 1, prev + 1));
      }
    }

    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // Load questions and local storage on mount
  useEffect(() => {
    // 1. Load theme
    const savedTheme = localStorage.getItem("bde_theme") as "dark" | "light";
    if (savedTheme === "light") {
      setTheme("light");
      document.body.classList.add("light-theme");
    } else {
      setTheme("dark");
      document.body.classList.remove("light-theme");
    }

    // 3. Load history
    const savedHistory = localStorage.getItem("bde_test_history");
    if (savedHistory) {
      try { setHistory(jsonParseSafely(savedHistory)); } catch (e) { console.error(e); }
    }

    // 4. Load stats
    const savedStats = localStorage.getItem("bde_question_stats");
    if (savedStats) {
      try { setQuestionStats(jsonParseSafely(savedStats)); } catch (e) { console.error(e); }
    }
  }, []);

  // Timer effect
  useEffect(() => {
    if (isTestActive && testType !== "study" && timeLeft > 0) {
      timerRef.current = setTimeout(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isTestActive && testType !== "study" && timeLeft === 0) {
      finishTest(true); // Auto-finish when time is up
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isTestActive, timeLeft]);

  // Safe JSON Parse
  const jsonParseSafely = (str: string) => {
    return JSON.parse(str);
  };

  // Toggle Theme
  const toggleTheme = () => {
    if (theme === "dark") {
      setTheme("light");
      localStorage.setItem("bde_theme", "light");
      document.body.classList.add("light-theme");
    } else {
      setTheme("dark");
      localStorage.setItem("bde_theme", "dark");
      document.body.classList.remove("light-theme");
    }
  };

  // Show a temp toast message
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage("");
    }, 2000);
  };

  // Start Test
  const startNewTest = (type: "random" | "mistakes" | "all" | "study") => {
    if (dbQuestions.length === 0) return;

    let selectedQuestions: Question[] = [];

    if (type === "random") {
      // Shuffle and pick 50
      const shuffled = [...dbQuestions].sort(() => 0.5 - Math.random());
      selectedQuestions = shuffled.slice(0, Math.min(50, shuffled.length));
    } else if (type === "all" || type === "study") {
      // All questions sequential (sorted by ID or source for clean order)
      selectedQuestions = [...dbQuestions].sort((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        return a.id.localeCompare(b.id);
      });
    } else {
      // Mistakes mode: pick top failed questions
      // Sort questions by failure count, minimum 1 failure
      const failedQuestions = dbQuestions
        .filter((q) => questionStats[q.id] && questionStats[q.id].failures > 0)
        .sort((a, b) => {
          const failuresA = questionStats[a.id]?.failures || 0;
          const failuresB = questionStats[b.id]?.failures || 0;
          return failuresB - failuresA; // descending
        });

      if (failedQuestions.length === 0) {
        triggerToast("¡No tienes preguntas falladas registradas aún!");
        return;
      }

      // Pick up to 50 failed questions (fill with random if less than 10 to make it challenging, or just do failed)
      selectedQuestions = failedQuestions.slice(0, Math.min(50, failedQuestions.length));
      
      // If we have fewer than 20 failed, let's complement with random questions to make it a 50-q test if possible
      if (selectedQuestions.length < 50 && dbQuestions.length > selectedQuestions.length) {
        const remainingCount = 50 - selectedQuestions.length;
        const usedIds = new Set(selectedQuestions.map(q => q.id));
        const restShuffled = dbQuestions
          .filter(q => !usedIds.has(q.id))
          .sort(() => 0.5 - Math.random());
        
        selectedQuestions = [...selectedQuestions, ...restShuffled.slice(0, Math.min(remainingCount, restShuffled.length))];
      }
    }

    setActiveQuestions(selectedQuestions);
    setUserAnswers({});
    setMarkedForLater({});
    setCurrentIdx(0);
    setTimeLeft(5400); // 1h 30m
    setTestType(type);
    setIsTestActive(true);
    testStartTimeRef.current = Date.now();
    setView("test");
    setExpandedExplanations({});
  };

  // Handle option select
  const selectOption = (questionId: string, optionKey: string) => {
    // Toggle: if click the same, unselect
    setUserAnswers((prev) => {
      const newAnswers = { ...prev };
      if (newAnswers[questionId] === optionKey) {
        delete newAnswers[questionId];
      } else {
        newAnswers[questionId] = optionKey;
      }
      return newAnswers;
    });
  };

  // Toggle Bookmark
  const toggleBookmark = (questionId: string) => {
    setMarkedForLater((prev) => {
      const updated = { ...prev, [questionId]: !prev[questionId] };
      triggerToast(updated[questionId] ? "Marcada para responder al final" : "Desmarcada");
      return updated;
    });
  };

  // Score Calculation
  const calculateScore = (questions: Question[], answers: { [qId: string]: string }) => {
    let correct = 0;
    let incorrect = 0;
    let blank = 0;

    questions.forEach((q) => {
      const answer = answers[q.id];
      if (!answer) {
        blank++;
      } else if (answer === q.correctAnswer) {
        correct++;
      } else {
        incorrect++;
      }
    });

    // Score formula: correct * 0.2 - incorrect * (0.2 / 3)
    const penaltyPerWrong = 0.2 / 3.0;
    let rawScore = (correct * 0.2) - (incorrect * penaltyPerWrong);
    
    // Clamp score between 0 and 10
    const score = Math.min(10, Math.max(0, parseFloat(rawScore.toFixed(3))));

    return {
      score: parseFloat(score.toFixed(2)),
      correct,
      incorrect,
      blank,
      passed: score >= 6.5
    };
  };

  // Finish Test
  const finishTest = (_timeExpired = false) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsTestActive(false);

    if (testType === "study") {
      setView("dashboard");
      return;
    }

    const timeSpent = Math.floor((Date.now() - testStartTimeRef.current) / 1000);
    const results = calculateScore(activeQuestions, userAnswers);

    // Update stats for each question
    const updatedStats = { ...questionStats };
    activeQuestions.forEach((q) => {
      const answer = userAnswers[q.id];
      if (!updatedStats[q.id]) {
        updatedStats[q.id] = { attempts: 0, failures: 0 };
      }
      
      if (answer) {
        updatedStats[q.id].attempts += 1;
        if (answer !== q.correctAnswer) {
          updatedStats[q.id].failures += 1;
        }
      }
    });
    setQuestionStats(updatedStats);
    localStorage.setItem("bde_question_stats", JSON.stringify(updatedStats));

    // Save history entry
    const newEntry: TestHistoryEntry = {
      id: `hist_${Date.now()}`,
      date: new Date().toISOString(),
      score: results.score,
      correct: results.correct,
      incorrect: results.incorrect,
      blank: results.blank,
      timeSpent,
      questions: activeQuestions,
      userAnswers,
      passed: results.passed,
      type: testType
    };

    const updatedHistory = [newEntry, ...history];
    setHistory(updatedHistory);
    localStorage.setItem("bde_test_history", JSON.stringify(updatedHistory));

    // Open results
    setSelectedHistoryEntry(newEntry);
    setView("results");
  };

  // Time Formatter
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const formattedMins = mins.toString().padStart(2, "0");
    const formattedSecs = secs.toString().padStart(2, "0");

    if (hrs > 0) {
      return `${hrs}:${formattedMins}:${formattedSecs}`;
    }
    return `${formattedMins}:${formattedSecs}`;
  };

  // Split explanation into explanation and example
  const parseExplanation = (explanationText: string) => {
    const parts = explanationText.split("\n\n\n");
    const theory = parts[0]?.trim() || "";
    const example = parts[1]?.replace(/^Ejemplo:\s*/i, "").trim() || "";
    return { theory, example };
  };

  // Calculate General Statistics
  const getOverallStats = () => {
    if (history.length === 0) return { totalTests: 0, avgScore: 0, passRate: 0, totalQuestionsSolved: 0 };
    
    const totalTests = history.length;
    const totalScore = history.reduce((sum, entry) => sum + entry.score, 0);
    const passedTests = history.filter((entry) => entry.passed).length;
    const totalQuestionsSolved = history.reduce((sum, entry) => sum + (entry.correct + entry.incorrect), 0);

    return {
      totalTests,
      avgScore: parseFloat((totalScore / totalTests).toFixed(2)),
      passRate: Math.round((passedTests / totalTests) * 100),
      totalQuestionsSolved
    };
  };

  const overallStats = getOverallStats();

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-section">
          <img src="/favicon.ico" alt="Logo" className="logo-img" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <h1 className="app-title">OpoTest BdE</h1>
        </div>
        <div className="header-actions">
          <button onClick={toggleTheme} className="theme-toggle-btn" title="Cambiar tema">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Loading Database */}
        {dbLoading && (
          <div className="card" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
            <RotateCcw className="animate-spin" size={32} style={{ margin: "0 auto 1rem", color: "var(--color-gold)" }} />
            <p>Cargando banco de preguntas...</p>
          </div>
        )}

        {/* Database Error (Questions not generated yet) */}
        {!dbLoading && dbError && (
          <div className="card" style={{ textAlign: "center", borderColor: "var(--color-error)", padding: "2.5rem 1.5rem" }}>
            <AlertCircle size={40} style={{ color: "var(--color-error)", margin: "0 auto 1rem" }} />
            <h3>Banco de preguntas vacío</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0.5rem 0 1.5rem" }}>
              {dbError}
            </p>
            <div className="explanation-content" style={{ textAlign: "left", fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
              <strong>Instrucciones para generar las preguntas:</strong>
              <ol style={{ paddingLeft: "1.25rem", marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <li>Asegúrate de haber configurado tu API Key en el archivo <code style={{color: "var(--color-gold)"}}>~/.env</code>.</li>
                <li>Ejecuta el script generador ejecutando en tu terminal local:
                  <pre style={{ backgroundColor: "var(--bg-secondary)", padding: "0.5rem", borderRadius: "4px", marginTop: "0.25rem", overflowX: "auto" }}>
                    python3 generate_questions.py
                  </pre>
                </li>
                <li>Una vez finalizado, recarga esta página para ver las preguntas disponibles.</li>
              </ol>
            </div>
          </div>
        )}

        {/* 1. DASHBOARD VIEW */}
        {!dbLoading && !dbError && view === "dashboard" && (
          <div>
            {/* Hero Welcome Card */}
            <div className="card hero-card">
              <h2 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Oposición Banco de España</h2>
              <p className="hero-subtitle">Preparador de Cuestionarios Tipo Test</p>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                Practica con un banco de <strong>{dbQuestions.length} preguntas</strong> detalladas de todo el temario oficial. Cada test contiene 50 preguntas aleatorias con penalización de -1/3 por fallo.
              </p>
              
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-val highlight">{overallStats.passRate}%</div>
                  <div className="stat-label">Tasa de Aprobado</div>
                </div>
                <div className="stat-item">
                  <div className="stat-val">{overallStats.avgScore}</div>
                  <div className="stat-label">Nota Media</div>
                </div>
                <div className="stat-item">
                  <div className="stat-val">{overallStats.totalTests}</div>
                  <div className="stat-label">Tests Realizados</div>
                </div>
                <div className="stat-item">
                  <div className="stat-val">{overallStats.totalQuestionsSolved}</div>
                  <div className="stat-label">Preguntas Respondidas</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <button onClick={() => startNewTest("random")} className="action-btn action-btn-primary" style={{ gridColumn: "span 2" }}>
                  <BookOpen size={18} /> Iniciar Test Rápido (50 preg.)
                </button>
                
                <button onClick={() => startNewTest("all")} className="action-btn action-btn-secondary">
                  <BookOpen size={18} /> Test Completo ({dbQuestions.length} preg.)
                </button>

                <button onClick={() => startNewTest("study")} className="action-btn action-btn-secondary">
                  <BookOpen size={18} style={{ color: "var(--color-gold)" }} /> Modo Estudio
                </button>
                
                <button
                  onClick={() => startNewTest("mistakes")}
                  className="action-btn action-btn-secondary"
                  style={{ gridColumn: "span 2" }}
                  disabled={!Object.values(questionStats).some((s) => s.failures > 0)}
                >
                  <AlertCircle size={18} /> Repasar Fallos Comunes
                </button>
              </div>
            </div>

            {/* History List */}
            <h2 className="history-title">Historial de Exámenes</h2>
            {history.length === 0 ? (
              <div className="card" style={{ textAlign: "center", color: "var(--text-secondary)", padding: "2rem" }}>
                <History size={32} style={{ margin: "0 auto 0.75rem", opacity: 0.5 }} />
                <p style={{ fontSize: "0.9rem" }}>No has presentado ningún test todavía. ¡Toma tu primer examen arriba!</p>
              </div>
            ) : (
              <div className="history-list">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => {
                      setSelectedHistoryEntry(entry);
                      setView("history_detail");
                    }}
                    className="history-card"
                  >
                    <div className="history-meta">
                      <div className="history-date">
                        {new Date(entry.date).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </div>
                      <div className="history-subtitle">
                        {entry.type === "random"
                          ? "Test Rápido"
                          : entry.type === "all"
                          ? "Test Completo"
                          : "Repaso de Fallos"} • {formatTime(entry.timeSpent)}
                      </div>
                    </div>
                    
                    <div className="history-score-box">
                      <div className="history-score" style={{ color: entry.passed ? "var(--color-success)" : "var(--color-error)" }}>
                        {entry.score.toFixed(2)}
                      </div>
                      <span className={`badge ${entry.passed ? "badge-success" : "badge-error"}`} style={{ fontSize: "0.6rem", padding: "0.15rem 0.4rem", margin: 0 }}>
                        {entry.passed ? "Aprobado" : "Suspenso"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. TEST VIEW */}
        {!dbLoading && view === "test" && activeQuestions.length > 0 && (
          <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <div className="test-header" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>Pregunta</span>
                <input
                  type="number"
                  min={1}
                  max={activeQuestions.length}
                  value={currentIdx + 1}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val <= activeQuestions.length) {
                      setCurrentIdx(val - 1);
                    }
                  }}
                  className="jump-input"
                  style={{
                    width: "55px",
                    textAlign: "center",
                    padding: "0.25rem",
                    borderRadius: "var(--border-radius-sm)",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                    fontWeight: "600"
                  }}
                />
                <span>de {activeQuestions.length}</span>
              </div>
              
              {testType !== "study" ? (
                <div className={`timer-box ${timeLeft < 600 ? "timer-warning" : ""}`}>
                  <Clock size={14} />
                  <span>{formatTime(timeLeft)}</span>
                </div>
              ) : (
                <div className="timer-box" style={{ background: "var(--color-gold-bg)", color: "var(--color-gold)", borderColor: "var(--color-gold)" }}>
                  <BookOpen size={14} />
                  <span>Modo Estudio</span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${((currentIdx + 1) / activeQuestions.length) * 100}%` }}
              ></div>
            </div>

            {/* Question Card */}
            {(() => {
              const q = activeQuestions[currentIdx];
              const selectedOpt = userAnswers[q.id];
              const isStudyMode = testType === "study";
              const isAnswered = isStudyMode ? true : !!selectedOpt;
              const { theory, example } = parseExplanation(q.explanation);

              return (
                <div className="card" style={{ marginBottom: "1.5rem" }}>
                  {/* Question ID and Source */}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.75rem", borderBottom: "1px dashed var(--border-color)", paddingBottom: "0.5rem" }}>
                    <span>ID: <strong style={{ color: "var(--text-secondary)" }}>{q.id}</strong></span>
                    <span>Temario: {q.source.replace(".md", "").replace(/_/g, " ").toUpperCase()}</span>
                  </div>

                  <div className="question-text">
                    {q.question}
                  </div>

                  <div className="options-list">
                    {(["a", "b", "c", "d"] as const).map((key) => {
                      const isCurrentCorrect = key === q.correctAnswer;
                      const isCurrentSelected = key === selectedOpt;
                      
                      let optionClass = "option-item";
                      if (isAnswered) {
                        if (isCurrentCorrect) {
                          optionClass += " correct-feedback";
                        } else if (isCurrentSelected) {
                          optionClass += " incorrect-feedback";
                        } else {
                          optionClass += " disabled-feedback";
                        }
                      } else if (isCurrentSelected) {
                        optionClass += " selected";
                      }

                      return (
                        <div
                          key={key}
                          onClick={() => {
                            if (!isAnswered) {
                              selectOption(q.id, key);
                            }
                          }}
                          className={optionClass}
                          style={isAnswered ? { cursor: "default" } : undefined}
                        >
                          <div className="option-prefix">{key.toUpperCase()}</div>
                          <div className="option-content">{q.options[key]}</div>
                          {isAnswered && isCurrentCorrect && (
                            <Check size={16} style={{ marginLeft: "auto", color: "var(--color-success)", flexShrink: 0 }} />
                          )}
                          {isAnswered && isCurrentSelected && !isCurrentCorrect && (
                            <X size={16} style={{ marginLeft: "auto", color: "var(--color-error)", flexShrink: 0 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Immediate Explanation Feedback */}
                  {isAnswered && (
                    <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border-color)", paddingTop: "1.25rem" }}>
                      <div className="explanation-content" style={{ display: "block", borderRadius: "var(--border-radius-sm)", margin: 0 }}>
                        <div style={{ marginBottom: "1rem" }}>
                          <strong style={{ color: "var(--text-primary)" }}>Justificación Teórica:</strong>
                          <p style={{ marginTop: "0.25rem", color: "var(--text-secondary)" }}>{theory}</p>
                        </div>
                        {example && (
                          <div>
                            <strong style={{ color: "var(--text-primary)" }}>Ejemplo Práctico:</strong>
                            <p style={{ marginTop: "0.25rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                              {example}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Navigation Bar */}
            <div className="navigation-bar">
              <button
                onClick={() => setCurrentIdx((prev) => Math.max(0, prev - 1))}
                disabled={currentIdx === 0}
                className="bookmark-btn"
                title="Pregunta anterior"
              >
                <ChevronLeft size={18} />
              </button>

              <button
                onClick={() => toggleBookmark(activeQuestions[currentIdx].id)}
                className={`bookmark-btn ${markedForLater[activeQuestions[currentIdx].id] ? "bookmarked" : ""}`}
                style={{ justifySelf: "center", width: "100%", maxWidth: "200px" }}
              >
                <Bookmark size={16} />
                <span>{markedForLater[activeQuestions[currentIdx].id] ? "Marcada" : "Marcar al final"}</span>
              </button>

              {currentIdx < activeQuestions.length - 1 ? (
                <button
                  onClick={() => setCurrentIdx((prev) => prev + 1)}
                  className="bookmark-btn"
                  title="Siguiente pregunta"
                >
                  <ChevronRight size={18} />
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (testType === "study") {
                      finishTest();
                    } else if (window.confirm("¿Estás seguro de que deseas finalizar y corregir el examen?")) {
                      finishTest();
                    }
                  }}
                  className="action-btn action-btn-primary"
                  style={{ padding: "0.6rem 1.2rem", width: "auto" }}
                >
                  <CheckCircle2 size={16} />
                  <span>{testType === "study" ? "Salir" : "Finalizar"}</span>
                </button>
              )}
            </div>

            {/* Quick Dot Grid */}
            <div className="question-grid">
              {activeQuestions.map((q, idx) => {
                let dotClass = "grid-dot";
                if (idx === currentIdx) dotClass += " current";
                else if (markedForLater[q.id]) dotClass += " marked";
                else if (userAnswers[q.id]) dotClass += " answered";

                return (
                  <div
                    key={q.id}
                    onClick={() => setCurrentIdx(idx)}
                    className={dotClass}
                  >
                    {idx + 1}
                  </div>
                );
              })}
            </div>
            
            {/* Quick action to force end */}
            <button
              onClick={() => {
                const confirmMsg = testType === "study"
                  ? "¿Deseas salir del modo estudio y volver al menú principal?"
                  : "¿Estás seguro de que deseas salir del test? No se guardará tu progreso.";
                if (window.confirm(confirmMsg)) {
                  setIsTestActive(false);
                  setView("dashboard");
                }
              }}
              className="action-btn action-btn-secondary"
              style={{ marginTop: "2rem", borderColor: "rgba(239, 68, 68, 0.4)", color: "var(--color-error)" }}
            >
              <X size={16} /> {testType === "study" ? "Salir del Estudio" : "Cancelar Examen"}
            </button>
          </div>
        )}

        {/* 3. RESULTS AND REVIEW DETAIL */}
        {!dbLoading && (view === "results" || view === "history_detail") && selectedHistoryEntry && (
          <div>
            {/* Result Header */}
            <div className={`card result-header-card ${selectedHistoryEntry.passed ? "" : "failed"}`}>
              <span className={`badge ${selectedHistoryEntry.passed ? "badge-success" : "badge-error"}`}>
                {selectedHistoryEntry.passed ? "Aprobado" : "Suspenso"}
              </span>
              <div className="result-score">
                {selectedHistoryEntry.score.toFixed(2)}
                <span className="result-score-max">/10</span>
              </div>
              <div className={`result-verdict ${selectedHistoryEntry.passed ? "verdict-passed" : "verdict-failed"}`}>
                {selectedHistoryEntry.passed ? "¡Enhorabuena, has superado la nota de corte!" : "No has alcanzado la nota de corte (6.5)"}
              </div>

              <div className="detailed-stats-grid">
                <div className="detailed-stat-item">
                  <div className="detailed-stat-val success">{selectedHistoryEntry.correct}</div>
                  <div className="detailed-stat-label">Aciertos (+0.2)</div>
                </div>
                <div className="detailed-stat-item">
                  <div className="detailed-stat-val error">{selectedHistoryEntry.incorrect}</div>
                  <div className="detailed-stat-label">Fallos (-0.07)</div>
                </div>
                <div className="detailed-stat-item">
                  <div className="detailed-stat-val warning">{selectedHistoryEntry.blank}</div>
                  <div className="detailed-stat-label">En Blanco (0)</div>
                </div>
              </div>

              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                Tiempo invertido: {formatTime(selectedHistoryEntry.timeSpent)}
              </p>

              <button
                onClick={() => setView("dashboard")}
                className="action-btn action-btn-primary"
                style={{ maxWidth: "250px", margin: "0 auto" }}
              >
                Volver al Panel Principal
              </button>
            </div>

            {/* List of Questions with answers and explanations */}
            <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Revisión Detallada de Preguntas</h2>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {selectedHistoryEntry.questions.map((q, idx) => {
                const userAnswer = selectedHistoryEntry.userAnswers[q.id];
                const isCorrect = userAnswer === q.correctAnswer;
                const isSkipped = !userAnswer;
                
                let cardClass = "review-question-card";
                if (isSkipped) cardClass += " skipped";
                else if (isCorrect) cardClass += " correct";
                else cardClass += " incorrect";

                const isExpanded = !!expandedExplanations[q.id];
                const { theory, example } = parseExplanation(q.explanation);

                return (
                  <div key={q.id} className={cardClass}>
                    <div className="review-question-header">
                      <span>Pregunta {idx + 1}</span>
                      <span style={{ fontWeight: 600, color: isSkipped ? "var(--text-secondary)" : isCorrect ? "var(--color-success)" : "var(--color-error)" }}>
                        {isSkipped ? "En blanco" : isCorrect ? "Correcta" : "Incorrecta"}
                      </span>
                    </div>

                    <div className="question-text" style={{ fontSize: "1rem", marginBottom: "1rem" }}>
                      {q.question}
                    </div>

                    <div className="review-options">
                      {(["a", "b", "c", "d"] as const).map((key) => {
                        let optClass = "review-option";
                        if (key === q.correctAnswer) {
                          optClass += " correct";
                        } else if (key === userAnswer && !isCorrect) {
                          optClass += " user-incorrect";
                        }

                        return (
                          <div key={key} className={optClass}>
                            <span style={{ fontWeight: 700 }}>{key.toUpperCase()})</span>
                            <span>{q.options[key]}</span>
                            {key === q.correctAnswer && <Check size={16} style={{ marginLeft: "auto", flexShrink: 0 }} />}
                            {key === userAnswer && !isCorrect && <X size={16} style={{ marginLeft: "auto", flexShrink: 0 }} />}
                          </div>
                        );
                      })}
                    </div>

                    {/* Explanations Accordion */}
                    <div style={{ marginTop: "1rem" }}>
                      <div
                        onClick={() => setExpandedExplanations(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
                        className="explanation-trigger"
                      >
                        <span>Explicación y Ejemplo Práctico</span>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      {isExpanded && (
                        <div className="explanation-content">
                          <div style={{ marginBottom: "1.5rem" }}>
                            <strong>Justificación Teórica:</strong>
                            <p style={{ marginTop: "0.25rem" }}>{theory}</p>
                          </div>
                          
                          {example && (
                            <div>
                              <strong>Ejemplo Práctico:</strong>
                              <p style={{ marginTop: "0.25rem", fontStyle: "italic" }}>
                                {example}
                              </p>
                            </div>
                          )}

                          <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-tertiary)", borderTop: "1px solid var(--border-color)", paddingTop: "0.5rem" }}>
                            Documento origen: <strong>{q.source}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <button
              onClick={() => setView("dashboard")}
              className="action-btn action-btn-secondary"
              style={{ marginTop: "1.5rem" }}
            >
              Volver al Panel Principal
            </button>
          </div>
        )}
      </main>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
