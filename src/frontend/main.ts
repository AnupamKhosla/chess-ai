import { createBoard } from "./board";
import { BrowserEngine, EvalInfo, MultiPVInfo } from "./eval";
import { GameController, PromotionPiece } from "./game";
import {
  ChatMessage,
  CoachingData,
  CodexSandboxEvent,
  GITHUB_PAGES_DEMO,
  TeachableLine,
  buildLocalTeachableLine,
  composeCodexChessPrompt,
  configureProvider,
  fetchTeachableLine,
  getProviders,
  rememberCodexExchange,
  sendChat,
  startProviderLogin,
} from "./api";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { createOrb } from "./coach-orb";
import type { CoachOrb } from "./coach-orb";
import { RemoteUCI } from "./remote";

/** Generate a chessground-compatible board SVG with the given square colors. */
function makeBoardSvg(lightHex: string, darkHex: string): string {
  // SVG checkerboard: 8x8 grid, light squares = background, dark squares = fill
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">
<rect width="8" height="8" fill="${lightHex}"/>
<g fill="${darkHex}">
<rect x="1" y="0" width="1" height="1"/><rect x="3" y="0" width="1" height="1"/><rect x="5" y="0" width="1" height="1"/><rect x="7" y="0" width="1" height="1"/>
<rect x="0" y="1" width="1" height="1"/><rect x="2" y="1" width="1" height="1"/><rect x="4" y="1" width="1" height="1"/><rect x="6" y="1" width="1" height="1"/>
<rect x="1" y="2" width="1" height="1"/><rect x="3" y="2" width="1" height="1"/><rect x="5" y="2" width="1" height="1"/><rect x="7" y="2" width="1" height="1"/>
<rect x="0" y="3" width="1" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="4" y="3" width="1" height="1"/><rect x="6" y="3" width="1" height="1"/>
<rect x="1" y="4" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/>
<rect x="0" y="5" width="1" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/>
<rect x="1" y="6" width="1" height="1"/><rect x="3" y="6" width="1" height="1"/><rect x="5" y="6" width="1" height="1"/><rect x="7" y="6" width="1" height="1"/>
<rect x="0" y="7" width="1" height="1"/><rect x="2" y="7" width="1" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="6" y="7" width="1" height="1"/>
</g>
</svg>`;
  return `url('data:image/svg+xml;base64,${btoa(svg)}')`;
}

function updateBoardColors() {
  const style = getComputedStyle(document.documentElement);
  const boardDark = style.getPropertyValue("--board-dark").trim();
  const boardLight = style.getPropertyValue("--board-light").trim();
  if (!boardDark || !boardLight) return;

  const cgBoard = document.querySelector("cg-board") as HTMLElement | null;
  if (cgBoard) {
    cgBoard.style.backgroundColor = boardLight;
    cgBoard.style.backgroundImage = makeBoardSvg(boardLight, boardDark);
  }
}

interface CustomTheme {
  label: string;
  mode: "dark" | "light";
  bg: {
    body: string; header: string; panel: string; input: string;
    button: string; buttonHover: string; rowOdd: string; rowEven: string;
  };
  border: { subtle: string; normal: string; strong: string };
  text: { primary: string; muted: string; dim: string; accent: string };
  board: { light: string; dark: string };
  lastUsed: number; // timestamp
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: any) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const CUSTOM_THEMES_KEY = "chess-teacher-custom-themes";
const MAX_CUSTOM_THEMES = 5;

function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const themes = JSON.parse(raw) as CustomTheme[];
    // Sort by lastUsed descending (most recent first)
    return themes.sort((a, b) => b.lastUsed - a.lastUsed);
  } catch {
    return [];
  }
}

function saveCustomTheme(theme: CustomTheme): CustomTheme[] {
  let themes = loadCustomThemes();
  // Remove existing with same label (case-insensitive) to avoid duplicates
  themes = themes.filter(t => t.label.toLowerCase() !== theme.label.toLowerCase());
  themes.unshift(theme);
  // Evict oldest if over limit
  if (themes.length > MAX_CUSTOM_THEMES) {
    themes = themes.slice(0, MAX_CUSTOM_THEMES);
  }
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  return themes;
}

function touchCustomTheme(label: string): void {
  const themes = loadCustomThemes();
  const theme = themes.find(t => t.label.toLowerCase() === label.toLowerCase());
  if (theme) {
    theme.lastUsed = Date.now();
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(
      themes.sort((a, b) => b.lastUsed - a.lastUsed)
    ));
  }
}

/** Dark-mode coaching severity variables */
const DARK_COACHING: Record<string, string> = {
  "--brilliant-bg": "rgba(74, 222, 128, 0.1)",
  "--brilliant-border": "#4ade80", "--brilliant-text": "#4ade80",
  "--inaccuracy-bg": "rgba(251, 191, 36, 0.1)",
  "--inaccuracy-border": "#fbbf24", "--inaccuracy-text": "#fbbf24",
  "--mistake-bg": "rgba(251, 146, 60, 0.1)",
  "--mistake-border": "#fb923c", "--mistake-text": "#fb923c",
  "--blunder-bg": "rgba(248, 113, 113, 0.1)",
  "--blunder-border": "#f87171", "--blunder-text": "#f87171",
  "--status-connected": "#4ade80", "--status-error": "#f87171", "--status-thinking": "#fbbf24",
};

/** Light-mode coaching severity variables */
const LIGHT_COACHING: Record<string, string> = {
  "--brilliant-bg": "rgba(22, 163, 74, 0.1)",
  "--brilliant-border": "#16a34a", "--brilliant-text": "#15803d",
  "--inaccuracy-bg": "rgba(202, 138, 4, 0.1)",
  "--inaccuracy-border": "#ca8a04", "--inaccuracy-text": "#a16207",
  "--mistake-bg": "rgba(234, 88, 12, 0.1)",
  "--mistake-border": "#ea580c", "--mistake-text": "#c2410c",
  "--blunder-bg": "rgba(220, 38, 38, 0.1)",
  "--blunder-border": "#dc2626", "--blunder-text": "#b91c1c",
  "--status-connected": "#15803d", "--status-error": "#dc2626", "--status-thinking": "#a16207",
};

function applyCustomTheme(theme: CustomTheme) {
  const root = document.documentElement;
  // Remove data-theme so built-in vars don't interfere
  root.removeAttribute("data-theme");

  const vars: Record<string, string> = {
    "--bg-body": theme.bg.body, "--bg-header": theme.bg.header,
    "--bg-panel": theme.bg.panel, "--bg-input": theme.bg.input,
    "--bg-button": theme.bg.button, "--bg-button-hover": theme.bg.buttonHover,
    "--bg-row-odd": theme.bg.rowOdd, "--bg-row-even": theme.bg.rowEven,
    "--border-subtle": theme.border.subtle, "--border": theme.border.normal,
    "--border-strong": theme.border.strong,
    "--text": theme.text.primary, "--text-muted": theme.text.muted,
    "--text-dim": theme.text.dim, "--accent": theme.text.accent,
    "--accent-glow": theme.text.accent.replace(/^#(..)(..)(..)$/, (_, r, g, b) =>
      `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, 0.15)`),
    "--board-light": theme.board.light, "--board-dark": theme.board.dark,
    "--move-hover": theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    "--move-active": theme.text.accent.replace(/^#(..)(..)(..)$/, (_, r, g, b) =>
      `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, 0.15)`),
    "--debug-bg": theme.mode === "dark" ? "rgba(100,100,140,0.12)" : "rgba(80,80,100,0.08)",
    ...(theme.mode === "dark" ? DARK_COACHING : LIGHT_COACHING),
  };

  for (const [prop, val] of Object.entries(vars)) {
    root.style.setProperty(prop, val);
  }

  updateBoardColors();
}

function clearCustomThemeVars() {
  const root = document.documentElement;
  // Remove all inline CSS variables so data-theme takes over again
  root.removeAttribute("style");
}

function init() {
  const root = document.getElementById("app");
  if (!root) return;

  // Restore custom theme if previously selected
  const savedTheme = localStorage.getItem("chess-teacher-theme") || "dark";
  if (savedTheme.startsWith("custom:")) {
    const label = savedTheme.slice(7);
    const themes = loadCustomThemes();
    const theme = themes.find(t => t.label === label);
    if (theme) {
      // Will be applied after board is created (needs cg-board element)
      requestAnimationFrame(() => applyCustomTheme(theme));
    }
  }

  // --- Header ---
  const header = document.createElement("header");
  header.className = "app-header";
  root.appendChild(header);

  const title = document.createElement("h1");
  title.textContent = "Chess Teacher";
  header.appendChild(title);

  // Broadcast bug: this room always feels live, because the coach is alive.
  const liveBadge = document.createElement("span");
  liveBadge.className = "live-header-badge";
  liveBadge.title = "Your coach is in the room";
  liveBadge.textContent = "● LIVE";
  header.appendChild(liveBadge);

  const headerTools = document.createElement("div");
  headerTools.className = "header-tools";
  header.appendChild(headerTools);

  const themeToggleBtn = document.createElement("button");
  themeToggleBtn.className = "theme-toggle-btn";
  themeToggleBtn.type = "button";
  themeToggleBtn.title = "Switch between dark and light mode";
  themeToggleBtn.setAttribute("aria-label", "Switch theme");
  headerTools.appendChild(themeToggleBtn);

  const sidebarToggleBtn = document.createElement("button");
  sidebarToggleBtn.className = "sidebar-toggle-btn";
  sidebarToggleBtn.type = "button";
  sidebarToggleBtn.textContent = "▸ Panel";
  sidebarToggleBtn.title = "Collapse or expand the analysis panel";
  sidebarToggleBtn.setAttribute("aria-label", "Collapse or expand analysis panel");
  headerTools.appendChild(sidebarToggleBtn);

  const hamburgerBtn = document.createElement("button");
  hamburgerBtn.className = "settings-btn";
  hamburgerBtn.type = "button";
  hamburgerBtn.textContent = "AI settings ⚙";
  hamburgerBtn.title = "Open AI, theme, and coaching settings";
  hamburgerBtn.setAttribute("aria-label", "Open AI settings");
  headerTools.appendChild(hamburgerBtn);

  // Hamburger menu dropdown
  const hamburgerMenu = document.createElement("div");
  hamburgerMenu.className = "hamburger-menu";
  header.appendChild(hamburgerMenu);

  const menuFenInput = document.createElement("input");
  menuFenInput.type = "text";
  menuFenInput.placeholder = "Load FEN\u2026";
  menuFenInput.className = "fen-input";
  hamburgerMenu.appendChild(menuFenInput);

  // Verbosity tabs
  const verbosityLabel = document.createElement("div");
  verbosityLabel.className = "menu-label";
  verbosityLabel.textContent = "coaching verbosity";
  hamburgerMenu.appendChild(verbosityLabel);

  const verbosityTabs = document.createElement("div");
  verbosityTabs.className = "verbosity-tabs";
  hamburgerMenu.appendChild(verbosityTabs);

  const savedVerbosity = localStorage.getItem("chess-teacher-verbosity") || "normal";
  for (const level of ["terse", "normal", "verbose"] as const) {
    const tab = document.createElement("button");
    tab.className = "verbosity-tab";
    tab.textContent = level.charAt(0).toUpperCase() + level.slice(1);
    tab.dataset.level = level;
    if (level === savedVerbosity) tab.classList.add("active");
    tab.addEventListener("click", () => {
      verbosityTabs.querySelectorAll(".verbosity-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      localStorage.setItem("chess-teacher-verbosity", level);
    });
    verbosityTabs.appendChild(tab);
  }

  // Theme selector
  const themeLabel = document.createElement("div");
  themeLabel.className = "menu-label";
  themeLabel.textContent = "theme";
  hamburgerMenu.appendChild(themeLabel);

  const themeSelect = document.createElement("select");
  themeSelect.className = "elo-select"; // reuse same styling as ELO select in menu
  const builtInThemes: [string, string][] = [
    ["dark", "Dark"],
    ["light", "Light"],
    ["wood", "Wood"],
    ["marble", "Marble"],
    ["rose", "Rose"],
    ["clean", "Clean"],
  ];
  for (const [value, label] of builtInThemes) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    themeSelect.appendChild(opt);
  }

  hamburgerMenu.appendChild(themeSelect);

  function syncThemeToggle() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    themeToggleBtn.textContent = isLight ? "☾ Dark" : "☼ Light";
    themeToggleBtn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
  }

  themeToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextTheme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    clearCustomThemeVars();
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("chess-teacher-theme", nextTheme);
    themeSelect.value = nextTheme;
    syncThemeToggle();
    updateBoardColors();
  });
  syncThemeToggle();

  const themeDescInput = document.createElement("input");
  themeDescInput.type = "text";
  themeDescInput.placeholder = "Describe a theme\u2026";
  themeDescInput.className = "fen-input"; // reuse FEN input styling
  hamburgerMenu.appendChild(themeDescInput);

  const generateBtn = document.createElement("button");
  generateBtn.textContent = "Generate";
  hamburgerMenu.appendChild(generateBtn);

  generateBtn.addEventListener("click", async () => {
    const desc = themeDescInput.value.trim();
    if (!desc) return;

    generateBtn.textContent = "Generating\u2026";
    generateBtn.disabled = true;

    try {
      const resp = await fetch("/api/theme/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      if (!resp.ok) {
        throw new Error("Generation failed");
      }
      const palette = await resp.json() as CustomTheme;
      palette.lastUsed = Date.now();

      // Save and apply
      const themes = saveCustomTheme(palette);
      applyCustomTheme(palette);

      // Update dropdown
      localStorage.setItem("chess-teacher-theme", `custom:${palette.label}`);
      rebuildThemeOptions(themes);
      themeSelect.value = `custom:${palette.label}`;

      themeDescInput.value = "";
    } catch {
      generateBtn.style.borderColor = "#f87171";
      setTimeout(() => { generateBtn.style.borderColor = ""; }, 1500);
    } finally {
      generateBtn.textContent = "Generate";
      generateBtn.disabled = false;
    }
  });

  // Also generate on Enter in the description input
  themeDescInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      generateBtn.click();
    }
  });

  // AI provider setup. Secrets are sent only when the user presses Save and
  // are held by the local server for this run; they are never put in storage.
  const providerSectionLabel = document.createElement("div");
  providerSectionLabel.className = "menu-label provider-section-label";
  providerSectionLabel.textContent = "AI connection";
  hamburgerMenu.appendChild(providerSectionLabel);

  const providerSelect = document.createElement("select");
  providerSelect.className = "elo-select provider-field";
  providerSelect.setAttribute("aria-label", "AI provider");
  hamburgerMenu.appendChild(providerSelect);

  const providerModelLabel = document.createElement("div");
  providerModelLabel.className = "menu-label provider-field-label";
  providerModelLabel.textContent = "Model preset";
  hamburgerMenu.appendChild(providerModelLabel);

  const providerModelSelect = document.createElement("select");
  providerModelSelect.className = "elo-select provider-field";
  providerModelSelect.setAttribute("aria-label", "AI model preset");
  hamburgerMenu.appendChild(providerModelSelect);

  const providerModelInput = document.createElement("input");
  providerModelInput.type = "text";
  providerModelInput.className = "fen-input provider-field";
  providerModelInput.placeholder = "Custom model ID";
  providerModelInput.setAttribute("aria-label", "AI model");
  hamburgerMenu.appendChild(providerModelInput);

  const providerEffortLabel = document.createElement("div");
  providerEffortLabel.className = "menu-label provider-field-label";
  providerEffortLabel.textContent = "Reasoning effort";
  hamburgerMenu.appendChild(providerEffortLabel);

  const providerEffortSelect = document.createElement("select");
  providerEffortSelect.className = "elo-select provider-field";
  providerEffortSelect.setAttribute("aria-label", "AI reasoning effort");
  hamburgerMenu.appendChild(providerEffortSelect);

  const providerBaseInput = document.createElement("input");
  providerBaseInput.type = "url";
  providerBaseInput.className = "fen-input provider-field";
  providerBaseInput.placeholder = "Base URL (for API/local providers)";
  providerBaseInput.setAttribute("aria-label", "AI base URL");
  hamburgerMenu.appendChild(providerBaseInput);

  const providerKeyInput = document.createElement("input");
  providerKeyInput.type = "password";
  providerKeyInput.className = "fen-input provider-field";
  providerKeyInput.placeholder = "API key (never saved)";
  providerKeyInput.autocomplete = "off";
  providerKeyInput.setAttribute("aria-label", "AI API key");
  hamburgerMenu.appendChild(providerKeyInput);

  const providerSaveBtn = document.createElement("button");
  providerSaveBtn.textContent = "Use this connection";
  hamburgerMenu.appendChild(providerSaveBtn);

  const providerLoginBtn = document.createElement("button");
  providerLoginBtn.className = "provider-login-btn";
  providerLoginBtn.type = "button";
  providerLoginBtn.hidden = true;
  hamburgerMenu.appendChild(providerLoginBtn);

  const providerStatus = document.createElement("div");
  providerStatus.className = "provider-status";
  providerStatus.textContent = "Loading connections…";
  hamburgerMenu.appendChild(providerStatus);

  let providerPresets: Array<{
    id: string;
    label: string;
    base_url: string;
    model: string;
    requires_key: boolean;
    kind: string;
    installed: boolean | null;
    authenticated: boolean | null;
    help: string;
    effort_options: string[];
  }> = [];
  let activeProviderLabel = "";
  let activeProviderModel = "stockfish-local-v1";
  let activeProviderEffort = "auto";
  let syncAgentStatus: ((label: string) => void) | null = null;

  function isFreeWeakProvider(providerId: string): boolean {
    return providerId === "opencode-free" || providerId === "llm7-free";
  }

  function displayProviderLabel(providerId: string, label: string): string {
    // Keep implementation details out of the student-facing UI. The server
    // still uses the stable provider/model IDs internally.
    return isFreeWeakProvider(providerId) ? "Free Weak AI" : label;
  }

  function displayProviderHelp(providerId: string, help: string): string {
    return isFreeWeakProvider(providerId)
      ? "Free hosted chess explainer · no key needed · availability and limits may vary."
      : help;
  }

  function studentFacingProviderText(text: string): string {
    return text
      .replace(/OpenCode Big Pickle · free trial \(no key\)/g, "Free Weak AI")
      .replace(/Big Pickle/g, "Free Weak AI")
      .replace(/OpenCode/g, "free hosted provider");
  }

  function syncProviderFieldVisibility(providerId: string): void {
    const hideImplementation = isFreeWeakProvider(providerId);
    providerModelInput.hidden = hideImplementation;
    providerBaseInput.hidden = hideImplementation;
  }

  const modelChoices: Record<string, Array<{ model: string; label: string }>> = {
    local: [
      { model: "stockfish-local-v1", label: "Stockfish-backed player · instant / no key" },
    ],
    "opencode-free": [
      { model: "big-pickle", label: "Free Weak AI" },
    ],
    "llm7-free": [
      { model: "mistral-Nemo-Instruct-2407", label: "Free Weak AI" },
    ],
    gemini: [
      { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash · free tier / fast" },
      { model: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite · free tier / fastest" },
    ],
    groq: [
      { model: "openai/gpt-oss-120b", label: "GPT-OSS 120B · Groq free tier / strong" },
      { model: "openai/gpt-oss-20b", label: "GPT-OSS 20B · Groq free tier / fastest" },
    ],
    openai: [
      { model: "gpt-5.6-luna", label: "GPT-5.6 Luna · fastest / lowest cost" },
      { model: "gpt-5.6-terra", label: "GPT-5.6 Terra · balanced" },
      { model: "gpt-5.6-sol", label: "GPT-5.6 Sol · flagship / deepest" },
      { model: "gpt-5.4", label: "GPT-5.4 · strong previous flagship" },
    ],
    deepseek: [
      { model: "deepseek-v4-flash", label: "DeepSeek V4 Flash · fast" },
      { model: "deepseek-v4-pro", label: "DeepSeek V4 Pro · deeper" },
    ],
    openrouter: [
      { model: "openrouter/free", label: "OpenRouter Free Router · free tier" },
      { model: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B · free / fast" },
      { model: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash · hosted" },
    ],
    codex: [
      { model: "default", label: "Codex default · account-selected" },
      { model: "gpt-5.6-luna", label: "GPT-5.6 Luna · fast" },
      { model: "gpt-5.6-terra", label: "GPT-5.6 Terra · balanced" },
      { model: "gpt-5.6-sol", label: "GPT-5.6 Sol · deepest" },
    ],
    ollama: [
      { model: "llama3.2", label: "Llama 3.2 · local default" },
      { model: "qwen3:8b", label: "Qwen 3 8B · local reasoning" },
      { model: "deepseek-r1:8b", label: "DeepSeek R1 8B · local thinking" },
    ],
    lmstudio: [{ model: "local-model", label: "LM Studio current model" }],
    anthropic: [
      { model: "claude-sonnet-4-6", label: "Claude Sonnet · balanced" },
      { model: "claude-opus-4-6", label: "Claude Opus · deepest" },
    ],
    claude: [
      { model: "sonnet", label: "Claude Sonnet · balanced" },
      { model: "opus", label: "Claude Opus · deepest" },
    ],
  };

  const effortLabels: Record<string, string> = {
    auto: "Auto · provider default",
    none: "None · lowest latency",
    minimal: "Minimal · very fast",
    low: "Low · fast",
    medium: "Medium · balanced",
    high: "High · deeper calculation",
    xhigh: "XHigh · very deep",
    max: "Max · quality first",
  };

  function renderModelChoices(providerId: string, currentModel: string) {
    providerModelSelect.innerHTML = "";
    const choices = modelChoices[providerId] || [];
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.model;
      option.textContent = choice.label;
      providerModelSelect.appendChild(option);
    }
    const custom = document.createElement("option");
    custom.value = "__custom__";
    custom.textContent = "Custom model ID…";
    providerModelSelect.appendChild(custom);
    providerModelSelect.value = choices.some((choice) => choice.model === currentModel)
      ? currentModel : "__custom__";
  }

  function renderEffortChoices(preset: (typeof providerPresets)[number], current = "auto") {
    providerEffortSelect.innerHTML = "";
    for (const effort of preset.effort_options || ["auto", "low", "medium", "high"]) {
      const option = document.createElement("option");
      option.value = effort;
      option.textContent = effortLabels[effort] || effort;
      providerEffortSelect.appendChild(option);
    }
    providerEffortSelect.value = preset.effort_options.includes(current) ? current : "auto";
  }

  function syncProviderLoginButton(
    preset: (typeof providerPresets)[number] | undefined,
    authenticated: boolean | null = preset?.authenticated ?? null,
  ) {
    const isCli = preset?.kind === "codex-cli" || preset?.kind === "claude-cli";
    providerLoginBtn.hidden = !isCli;
    if (!isCli || !preset) return;
    const service = preset.id === "codex" ? "ChatGPT" : "Claude";
    providerLoginBtn.textContent = authenticated
      ? `Use ${service} login`
      : `Sign in with ${service}`;
  }

  // NOTE: we deliberately do NOT pre-open a blank popup window. An
  // about:blank tab opened here often never navigates (popup blockers,
  // noopener handling) and looks like phishing. Instead the login step shows
  // an inline link to the official OpenAI page that the user clicks.
  function codexEventHandler(
    target: HTMLElement,
    callbacks?: {
      onLoginRequired?: (verificationUrl: string, userCode: string) => void;
      onComplete?: (text: string) => void;
    },
  ) {
    let streamedText = "";
    return (event: CodexSandboxEvent) => {
      if (event.type === "login_required") {
        const link = document.createElement("a");
        link.href = event.verificationUrl;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.textContent = "Open ChatGPT login (official OpenAI page)";
        const code = document.createElement("code");
        code.textContent = event.userCode;
        target.replaceChildren(
          link,
          document.createTextNode(` · enter code `),
          code,
          document.createTextNode(` · waiting… (we never ask for your password)`),
        );
        callbacks?.onLoginRequired?.(event.verificationUrl, event.userCode);
      } else if (event.type === "authenticated") {
        target.textContent = "ChatGPT authenticated · Codex is coaching…";
      } else if (event.type === "delta") {
        streamedText += event.text;
        target.textContent = streamedText ? `Codex: ${streamedText}` : "Codex is answering…";
      } else if (event.type === "complete") {
        if (event.text) {
          target.textContent = `Codex: ${event.text}`;
          callbacks?.onComplete?.(event.text);
        }
      } else if (event.type === "error") {
        target.textContent = event.message;
      }
    };
  }

  function fillProviderFields(providerId: string) {
    const preset = providerPresets.find((item) => item.id === providerId);
    if (!preset) return;
    providerModelInput.value = preset.model;
    renderModelChoices(providerId, preset.model);
    renderEffortChoices(preset);
    providerBaseInput.value = preset.base_url;
    providerKeyInput.value = "";
    providerKeyInput.placeholder = preset.requires_key
      ? "API key (held in memory only)"
      : "No key needed for this connection";
    providerKeyInput.disabled = !preset.requires_key;
    providerBaseInput.disabled = preset.kind === "codex-cli" || preset.kind === "claude-cli" || preset.kind === "builtin";
    providerStatus.textContent = displayProviderHelp(providerId, preset.help);
    if (preset.installed === false) {
      providerStatus.textContent += " CLI not found on this machine.";
    }
    syncProviderFieldVisibility(providerId);
    syncProviderLoginButton(preset);
  }

  async function loadProviderSetup() {
    try {
      const data = await getProviders();
      providerPresets = data.providers;
      activeProviderLabel = displayProviderLabel(data.active.provider, data.active.label);
      activeProviderModel = data.active.model;
      activeProviderEffort = data.active.effort;
      syncAgentStatus?.(activeProviderLabel);
      providerSelect.innerHTML = "";
      for (const preset of providerPresets) {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = displayProviderLabel(preset.id, preset.label);
        providerSelect.appendChild(option);
      }
      providerSelect.value = data.active.provider;
      providerModelInput.value = data.active.model;
      renderModelChoices(data.active.provider, data.active.model);
      syncProviderFieldVisibility(data.active.provider);
      const activePreset = providerPresets.find((item) => item.id === data.active.provider);
      if (activePreset) renderEffortChoices(activePreset, data.active.effort);
      providerBaseInput.value = data.active.base_url;
      providerKeyInput.disabled = activePreset ? !activePreset.requires_key :
        data.active.kind === "codex-cli" || data.active.kind === "claude-cli" || data.active.kind === "builtin";
      providerKeyInput.placeholder = activePreset && !activePreset.requires_key
        ? "No key needed for this connection"
        : data.active.has_api_key
          ? "Key already configured (leave blank to clear)"
          : "API key (held in memory only)";
      providerStatus.textContent = `${activeProviderLabel} · ${data.active.effort} effort · ${data.key_storage}`;
      syncProviderLoginButton(
        providerPresets.find((item) => item.id === data.active.provider),
        data.active.authenticated ?? null,
      );
      // Reflect a server-side Codex session so a refresh doesn't suggest a
      // login is needed when one isn't.
      if (!GITHUB_PAGES_DEMO && data.active.provider === "codex" && data.active.authenticated) {
        quickLoginBtn.textContent = "ChatGPT active";
      }
    } catch {
      providerStatus.textContent = "Provider setup unavailable until the server is running.";
    }
  }

  providerModelSelect.addEventListener("change", () => {
    if (providerModelSelect.value !== "__custom__") {
      providerModelInput.value = providerModelSelect.value;
    }
  });

  providerSelect.addEventListener("change", () => fillProviderFields(providerSelect.value));
  providerLoginBtn.addEventListener("click", async () => {
    const providerId = providerSelect.value;
    const preset = providerPresets.find((item) => item.id === providerId);
    if (!preset || (preset.kind !== "codex-cli" && preset.kind !== "claude-cli")) return;
    providerLoginBtn.disabled = true;
    try {
      if (preset.authenticated) {
        const response = await configureProvider({
          provider: providerId,
          model: providerModelInput.value.trim() || preset.model,
          effort: providerEffortSelect.value,
        });
        activeProviderLabel = displayProviderLabel(response.active.provider, response.active.label);
        activeProviderModel = response.active.model;
        activeProviderEffort = response.active.effort;
        syncAgentStatus?.(activeProviderLabel);
        providerStatus.textContent = `${activeProviderLabel} active · local login selected`;
      } else {
        const response = await startProviderLogin(
          providerId,
          providerId === "codex" ? codexEventHandler(providerStatus) : undefined,
        );
        providerStatus.textContent = response.message || "Login started in a browser window.";
        if (providerId === "codex" && GITHUB_PAGES_DEMO) {
          providerLoginBtn.textContent = "Ask Codex again";
        }
      }
    } catch (error) {
      providerStatus.textContent = studentFacingProviderText(error instanceof Error ? error.message : "Login failed");
    } finally {
      providerLoginBtn.disabled = false;
    }
  });
  providerSaveBtn.addEventListener("click", async () => {
    providerSaveBtn.disabled = true;
    providerSaveBtn.textContent = "Connecting…";
    try {
      const response = await configureProvider({
        provider: providerSelect.value,
        model: providerModelInput.value.trim(),
        base_url: providerBaseInput.value.trim(),
        api_key: providerKeyInput.value.trim() || undefined,
        effort: providerEffortSelect.value,
      });
      activeProviderLabel = displayProviderLabel(response.active.provider, response.active.label);
      activeProviderModel = response.active.model;
      activeProviderEffort = response.active.effort;
      syncAgentStatus?.(activeProviderLabel);
      providerStatus.textContent = `${activeProviderLabel} active · key stored in memory only`;
      providerKeyInput.value = "";
    } catch (error) {
      providerStatus.textContent = studentFacingProviderText(error instanceof Error ? error.message : "Connection failed");
    } finally {
      providerSaveBtn.disabled = false;
      providerSaveBtn.textContent = "Use this connection";
    }
  });
  void loadProviderSetup();

  // Theme change handler
  themeSelect.addEventListener("change", () => {
    const val = themeSelect.value;

    if (val.startsWith("custom:")) {
      const label = val.slice(7); // strip "custom:" prefix
      const themes = loadCustomThemes();
      const theme = themes.find(t => t.label === label);
      if (theme) {
        touchCustomTheme(label);
        applyCustomTheme(theme);
        localStorage.setItem("chess-teacher-theme", val);
        syncThemeToggle();
      }
    } else {
      // Built-in theme
      clearCustomThemeVars();
      document.documentElement.setAttribute("data-theme", val);
      localStorage.setItem("chess-teacher-theme", val);
      syncThemeToggle();
      updateBoardColors();
    }
  });

  function rebuildThemeOptions(customThemes: CustomTheme[]) {
    // Remove all options
    themeSelect.innerHTML = "";

    // Built-in themes
    for (const [value, label] of builtInThemes) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      themeSelect.appendChild(opt);
    }

    // Separator + custom themes
    if (customThemes.length > 0) {
      const sep = document.createElement("option");
      sep.disabled = true;
      sep.textContent = "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500";
      themeSelect.appendChild(sep);

      for (const ct of customThemes) {
        const opt = document.createElement("option");
        opt.value = `custom:${ct.label}`;
        opt.textContent = ct.label;
        themeSelect.appendChild(opt);
      }
    }
  }

  // Initialize dropdown with any saved custom themes
  rebuildThemeOptions(loadCustomThemes());

  // Set correct initial value (may be custom theme)
  themeSelect.value = savedTheme;

  const shortcutsRef = document.createElement("div");
  shortcutsRef.className = "shortcuts-ref";
  shortcutsRef.innerHTML =
    "<kbd>\u2190</kbd> <kbd>\u2192</kbd> navigate moves<br>" +
    "<kbd>\u2191</kbd> <kbd>\u2193</kbd> <kbd>Home</kbd> <kbd>End</kbd> first / last<br>" +
    "<kbd>n</kbd> new game";
  hamburgerMenu.appendChild(shortcutsRef);

  // Debug toggle
  const debugLabel = document.createElement("div");
  debugLabel.className = "menu-label";
  debugLabel.textContent = "developer";
  hamburgerMenu.appendChild(debugLabel);

  const debugToggle = document.createElement("label");
  debugToggle.className = "debug-toggle";
  const debugCheckbox = document.createElement("input");
  debugCheckbox.type = "checkbox";
  debugCheckbox.checked = localStorage.getItem("chess-teacher-debug") === "true";
  debugToggle.appendChild(debugCheckbox);
  debugToggle.appendChild(document.createTextNode(" Show LLM Prompts"));
  hamburgerMenu.appendChild(debugToggle);

  debugCheckbox.addEventListener("change", () => {
    localStorage.setItem("chess-teacher-debug", String(debugCheckbox.checked));
  });

  hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hamburgerMenu.classList.toggle("open");
  });
  document.addEventListener("click", () => {
    hamburgerMenu.classList.remove("open");
  });
  hamburgerMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // --- Layout wrapper (centers the grid vertically) ---
  const layoutWrap = document.createElement("div");
  layoutWrap.className = "layout-wrap";
  root.appendChild(layoutWrap);

  // --- Layout grid ---
  const layout = document.createElement("div");
  layout.className = "layout";
  layoutWrap.appendChild(layout);

  // --- Footer: source, trust, privacy (bottom nav) ---
  // BUILD_ID is the visible proof you're running fresh code. Bump it on
  // every user-facing ship so "looks the same" is checkable, not a feeling.
  const BUILD_ID = "coachcast-3 · neural-voice";
  const footer = document.createElement("footer");
  footer.className = "app-footer";
  const footerNav = document.createElement("nav");
  footerNav.setAttribute("aria-label", "About and privacy");
  const repoLink = document.createElement("a");
  repoLink.href = "https://github.com/AnupamKhosla/chess-ai";
  repoLink.target = "_blank";
  repoLink.rel = "noreferrer noopener";
  repoLink.textContent = "Open source";
  const sandboxLink = document.createElement("a");
  sandboxLink.href = "https://github.com/AnupamKhosla/chess-ai-codex-sandbox";
  sandboxLink.target = "_blank";
  sandboxLink.rel = "noreferrer noopener";
  sandboxLink.textContent = "Login backend source";
  sandboxLink.title = "Public code behind the ChatGPT login test — verify we never see your password";
  const privacyBtn = document.createElement("button");
  privacyBtn.className = "quick-login-btn";
  privacyBtn.type = "button";
  privacyBtn.textContent = "Privacy";
  const privacyPanel = document.createElement("div");
  privacyPanel.className = "line-display";
  privacyPanel.hidden = true;
  privacyPanel.textContent =
    "Privacy: no accounts, no analytics, no tracking. Your game and chat live only in this browser " +
    "(localStorage) and, in the local app, in a database file on your own machine. API keys you enter " +
    "stay in server memory for that run and are never written anywhere. ChatGPT login happens only on " +
    "the official OpenAI page; our pages never see your password, and the one-shot login backend deletes " +
    "its temporary session after each reply. The free browser chat sends your question plus the board " +
    "position (FEN) to its hosted model endpoint. Not affiliated with OpenAI or Anthropic.";
  privacyBtn.addEventListener("click", () => {
    privacyPanel.hidden = !privacyPanel.hidden;
  });
  footerNav.append(repoLink, document.createTextNode(" · "), sandboxLink, document.createTextNode(" · "), privacyBtn);
  const buildBadge = document.createElement("span");
  buildBadge.className = "build-badge";
  buildBadge.title = "Frontend build running in this tab";
  buildBadge.textContent = `· build ${BUILD_ID}`;
  footerNav.append(document.createTextNode(" "), buildBadge);
  footer.appendChild(footerNav);
  footer.appendChild(privacyPanel);
  root.appendChild(footer);

  let rightPanelCollapsed = localStorage.getItem("chess-teacher-right-panel") === "collapsed";
  function setRightPanelCollapsed(collapsed: boolean) {
    rightPanelCollapsed = collapsed;
    layout.classList.toggle("right-collapsed", collapsed);
    sidebarToggleBtn.textContent = collapsed ? "◂ Panel" : "▸ Panel";
    sidebarToggleBtn.setAttribute("aria-label", collapsed ? "Expand analysis panel" : "Collapse analysis panel");
    localStorage.setItem("chess-teacher-right-panel", collapsed ? "collapsed" : "open");
  }
  setRightPanelCollapsed(rightPanelCollapsed);
  sidebarToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setRightPanelCollapsed(!rightPanelCollapsed);
  });

  // 1. Coach column (left)
  const coachColumn = document.createElement("div");
  coachColumn.className = "coach-column";
  layout.appendChild(coachColumn);

  // The orb outlives every panel: declared before the dock so speech,
  // offers, and playback can all drive its attention states.
  let orb: CoachOrb | null = null;

  // --- Coach dock: the coach as a presence, not a panel ---
  // Original motif: a pawn fused with a neural node — human game, AI mind.
  const coachDock = document.createElement("div");
  coachDock.className = "coach-dock";
  const coachAvatar = document.createElement("span");
  coachAvatar.className = "coach-avatar";
  const orbCanvas = document.createElement("canvas");
  orbCanvas.className = "coach-orb";
  orbCanvas.setAttribute("aria-label", "Coach presence. Activate to talk.");
  orbCanvas.setAttribute("role", "button");
  orbCanvas.tabIndex = 0;
  coachAvatar.appendChild(orbCanvas);
  orb = createOrb(orbCanvas);
  const orbTalk = () => {
    // Tapping the orb repeats the last thing said, or invites speech.
    if (lastSpokenText) speakText(lastSpokenText, true);
    else setCoachStatus("I'm here — ask me anything.");
  };
  orbCanvas.addEventListener("click", orbTalk);
  orbCanvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      orbTalk();
    }
  });
  const coachMeta = document.createElement("div");
  coachMeta.className = "coach-meta";
  const coachNameEl = document.createElement("div");
  coachNameEl.className = "coach-name";
  const coachStatusEl = document.createElement("div");
  coachStatusEl.className = "coach-status";
  const liveDot = document.createElement("span");
  liveDot.className = "live-dot";
  coachStatusEl.append(liveDot, document.createTextNode("watching…"));
  coachMeta.append(coachNameEl, coachStatusEl);
  coachDock.append(coachAvatar, coachMeta);
  coachColumn.appendChild(coachDock);
  const coachOffer = document.createElement("div");
  coachOffer.className = "coach-offer";
  coachOffer.hidden = true;
  coachColumn.appendChild(coachOffer);

  function coachDisplayName(): string {
    try {
      const full = personaSelect.value || savedCoach;
      const words = full.split(" ").filter(Boolean);
      if (words.length === 0) return "Coach";
      return /^(gm|im|fm|cm|wgm)$/i.test(words[0]) && words.length > 1 ? words[1] : words[0];
    } catch {
      return "Coach";
    }
  }

  function setCoachStatus(text: string) {
    coachStatusEl.replaceChildren(liveDot, document.createTextNode(text));
  }

  // --- Coach commentary: lively, human, never the same twice ---
  // Strictly factual inputs (the coded ply flags), human texture on top.
  let commentFlip = Math.floor(Math.random() * 997);
  function pickLine<T>(items: T[]): T {
    commentFlip += 1;
    return items[commentFlip % items.length];
  }

  function narratePly(
    ply: { san: string; uci: string; check: boolean; checkmate: boolean; capture: boolean; castle: boolean },
    index: number,
    total: number,
    verdict: string,
  ): { text: string; mood: "chat" | "sharp" | "verdict" } {
    const last = index === total - 1;
    const tail = last ? ` ${verdict}` : "";
    if (ply.checkmate) {
      return {
        text: pickLine([`${ply.san} — and that's mate!`, `There it is — ${ply.san}. Checkmate.`]),
        mood: "sharp",
      };
    }
    if (ply.check) {
      return {
        text: `${pickLine(["Look —", "Watch —", "See it?", "Oh!"])} ${ply.san}, check!${last ? tail : ""}`,
        mood: "sharp",
      };
    }
    if (ply.capture) {
      return {
        text: `${pickLine(["Takes —", "Grabs —", "Snaps it off —", "Eats —"])} ${ply.san}, on ${ply.uci.slice(2, 4)}.${last ? tail : ""}`,
        mood: "sharp",
      };
    }
    if (ply.castle) {
      return {
        text: `${ply.san} — king tucked away.${last ? tail : ""}`,
        mood: "chat",
      };
    }
    return {
      text: `${pickLine(["", "Look — ", "Now — ", "Next — ", "And — "])}${ply.san}.${last ? tail : ""}`,
      mood: last ? "verdict" : "chat",
    };
  }

  // --- Proactive offers: the coach taps you on the shoulder ---
  let lastOfferPly = -100;
  function showOffer(text: string) {
    coachOffer.innerHTML = "";
    const bubble = document.createElement("span");
    bubble.textContent = text;
    const showBtn = document.createElement("button");
    showBtn.className = "quick-login-btn";
    showBtn.type = "button";
    showBtn.textContent = "▶ Show me";
    showBtn.addEventListener("click", () => {
      coachOffer.hidden = true;
      orb?.setState("idle");
      void openExplorer();
    });
    const laterBtn = document.createElement("button");
    laterBtn.className = "quick-login-btn";
    laterBtn.type = "button";
    laterBtn.textContent = "Not now";
    laterBtn.addEventListener("click", () => {
      coachOffer.hidden = true;
      orb?.setState("idle");
      setCoachStatus("watching…");
    });
    coachOffer.append(bubble, showBtn, laterBtn);
    coachOffer.hidden = false;
    setCoachStatus("has an idea…");
    orb?.setState("watching");
    speakText(text, false, "offer");
  }

  function maybeOfferIdea(coaching: CoachingData) {
    if (explorer || document.hidden) return;
    let ply = 0;
    try {
      ply = gc.getCurrentPly();
    } catch {
      return;
    }
    // Initiative dial: chill only fires on hot moments with a long
    // cooldown; proactive offers tours almost every few moves.
    const cooldown = initiative === "chill" ? 20 : initiative === "proactive" ? 6 : 8;
    const idleEvery = initiative === "chill" ? Number.POSITIVE_INFINITY : initiative === "proactive" ? 6 : 12;
    if (ply - lastOfferPly < cooldown) return;
    const hot = coaching.quality === "mistake" || coaching.quality === "blunder" ||
      coaching.quality === "brilliant";
    if (!hot && ply - lastOfferPly < idleEvery) return;
    lastOfferPly = ply;
    let lastSan = "";
    try {
      const hist = gc.history();
      lastSan = hist.length > 0 ? hist[hist.length - 1] : "";
    } catch {
      lastSan = "";
    }
    showOffer(
      hot && lastSan
        ? `Hmm, ${lastSan} — there's something here. Want me to show you?`
        : "This position has an idea worth seeing — want the tour?",
    );
  }

  const coachHeader = document.createElement("div");
  coachHeader.className = "coach-header";
  const coachLabel = document.createElement("div");
  coachLabel.className = "coach-column-label";
  coachLabel.textContent = "Coach room";
  coachHeader.appendChild(coachLabel);
  const coachHeaderActions = document.createElement("div");
  coachHeaderActions.className = "coach-header-actions";
  coachHeader.appendChild(coachHeaderActions);
  const quickLoginBtn = document.createElement("button");
  quickLoginBtn.className = "quick-login-btn";
  quickLoginBtn.type = "button";
  quickLoginBtn.textContent = activeProviderLabel === "ChatGPT / Codex login"
    ? "ChatGPT active"
    : "ChatGPT login";
  quickLoginBtn.title = "Ask Codex about this position. Login happens only on the official OpenAI page; backend source is public.";
  coachHeaderActions.appendChild(quickLoginBtn);
  coachColumn.appendChild(coachHeader);

  const savedCoach = localStorage.getItem("chess-teacher-coach") || "Anna Cramling";
  const coachOptions: [string, string][] = [
    ["Anna Cramling", "Anna Cramling · friendly trainer"],
    ["Daniel Naroditsky", "Daniel Naroditsky · precise teacher"],
    ["GothamChess", "GothamChess · energetic analyst"],
    ["GM Ben Finegold", "GM Ben Finegold · fundamentals"],
    ["Hikaru", "Hikaru · practical fighter"],
    ["Judit Polgar", "Judit Polgar · attacking ideas"],
    ["Magnus Carlsen", "Magnus Carlsen · practical pressure"],
    ["Vishy Anand", "Vishy Anand · calm calculation"],
    ["Garry Kasparov", "Garry Kasparov · dynamic initiative"],
    ["Mikhail Botvinnik", "Mikhail Botvinnik · structured plans"],
    ["Paul Morphy", "Paul Morphy · rapid development"],
    ["Mikhail Tal", "Mikhail Tal · tactical imagination"],
    ["Jose Raul Capablanca", "Jose Raul Capablanca · clarity"],
    ["Faustino Oro", "Faustino Oro · modern calculation"],
  ];

  const personaRow = document.createElement("div");
  personaRow.className = "chat-persona-row";
  const personaLabel = document.createElement("span");
  personaLabel.className = "chat-persona-label";
  personaLabel.textContent = "AI persona";
  personaRow.appendChild(personaLabel);
  const personaSelect = document.createElement("select");
  personaSelect.className = "chat-persona-select";
  personaSelect.setAttribute("aria-label", "AI coach persona");
  for (const [value, label] of coachOptions) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === savedCoach) opt.selected = true;
    personaSelect.appendChild(opt);
  }
  personaRow.appendChild(personaSelect);
  coachColumn.appendChild(personaRow);
  coachNameEl.textContent = coachDisplayName();

  const responseModeRow = document.createElement("div");
  responseModeRow.className = "chat-persona-row";
  const responseModeLabel = document.createElement("span");
  responseModeLabel.className = "chat-persona-label";
  responseModeLabel.textContent = "Response speed";
  responseModeRow.appendChild(responseModeLabel);
  const chatModeSelect = document.createElement("select");
  chatModeSelect.className = "chat-persona-select";
  chatModeSelect.setAttribute("aria-label", "Chat response speed");
  for (const [value, label] of [["fast", "Fast · realtime coach"], ["deep", "Deep · longer lesson"]]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === (localStorage.getItem("chess-teacher-response-mode") || "fast")) opt.selected = true;
    chatModeSelect.appendChild(opt);
  }
  responseModeRow.appendChild(chatModeSelect);
  coachColumn.appendChild(responseModeRow);

  // Coach initiative: how often the coach taps your shoulder unprompted.
  const INITIATIVE_KEY = "chess-teacher-initiative";
  let initiative: "chill" | "balanced" | "proactive" =
    (localStorage.getItem(INITIATIVE_KEY) as "chill" | "balanced" | "proactive" | null) || "balanced";
  if (!["chill", "balanced", "proactive"].includes(initiative)) initiative = "balanced";
  const initiativeRow = document.createElement("div");
  initiativeRow.className = "chat-persona-row";
  const initiativeLabel = document.createElement("span");
  initiativeLabel.className = "chat-persona-label";
  initiativeLabel.textContent = "Coach initiative";
  initiativeRow.appendChild(initiativeLabel);
  const initiativeSelect = document.createElement("select");
  initiativeSelect.className = "chat-persona-select";
  initiativeSelect.setAttribute("aria-label", "How often the coach speaks up on its own");
  for (const [value, label] of [
    ["chill", "Chill · only big moments"],
    ["balanced", "Balanced · interesting moments"],
    ["proactive", "Proactive · running commentary"],
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === initiative) opt.selected = true;
    initiativeSelect.appendChild(opt);
  }
  initiativeSelect.addEventListener("change", () => {
    initiative = initiativeSelect.value as "chill" | "balanced" | "proactive";
    localStorage.setItem(INITIATIVE_KEY, initiative);
  });
  initiativeRow.appendChild(initiativeSelect);
  coachColumn.appendChild(initiativeRow);

  // Pages chat voice: Free Weak AI (no login) or the user's own ChatGPT via
  // Codex (one device-code login per reply, grounded in browser Stockfish).
  // One voice at a time — this is what stops the two bots talking over
  // each other.
  const PAGES_CHAT_MODE_KEY = "chess-teacher-pages-chat-mode";
  let pagesChatMode: "free" | "codex" =
    localStorage.getItem(PAGES_CHAT_MODE_KEY) === "codex" ? "codex" : "free";
  const askRow = document.createElement("div");
  askRow.className = "chat-persona-row";
  const askLabel = document.createElement("span");
  askLabel.className = "chat-persona-label";
  askLabel.textContent = "Ask";
  askRow.appendChild(askLabel);
  const freeBtn = document.createElement("button");
  freeBtn.className = "quick-login-btn";
  freeBtn.type = "button";
  freeBtn.textContent = "Free Weak AI";
  freeBtn.title = "No login. Small hosted explainer, short answers.";
  const codexBtn = document.createElement("button");
  codexBtn.className = "quick-login-btn";
  codexBtn.type = "button";
  codexBtn.textContent = "Codex";
  codexBtn.title = "Your ChatGPT via Codex, grounded in browser Stockfish. One login per reply.";
  function syncAskRow() {
    for (const [btn, active] of [[freeBtn, pagesChatMode === "free"], [codexBtn, pagesChatMode === "codex"]] as const) {
      btn.style.fontWeight = active ? "800" : "400";
      btn.style.opacity = active ? "1" : "0.65";
      btn.setAttribute("aria-pressed", String(active));
    }
    chatHint.textContent = pagesChatMode === "codex"
      ? "Chat answers by Codex (login each reply) · grounded in browser Stockfish"
      : "Board-aware · saved locally";
  }
  freeBtn.addEventListener("click", () => {
    pagesChatMode = "free";
    localStorage.setItem(PAGES_CHAT_MODE_KEY, "free");
    syncAskRow();
  });
  codexBtn.addEventListener("click", () => {
    pagesChatMode = "codex";
    localStorage.setItem(PAGES_CHAT_MODE_KEY, "codex");
    syncAskRow();
  });
  askRow.appendChild(freeBtn);
  askRow.appendChild(codexBtn);
  askRow.hidden = !GITHUB_PAGES_DEMO;
  coachColumn.appendChild(askRow);

  const coachMessages = document.createElement("div");
  coachMessages.className = "coach-messages";
  coachColumn.appendChild(coachMessages);

  const chatComposer = document.createElement("form");
  chatComposer.className = "chat-composer";
  const chatInput = document.createElement("textarea");
  chatInput.className = "chat-input";
  chatInput.rows = 2;
  chatInput.placeholder = "Ask about this position… (Enter to send)";
  chatInput.setAttribute("aria-label", "Message your chess coach");
  const chatInputWrap = document.createElement("div");
  chatInputWrap.className = "chat-input-wrap";
  chatInputWrap.appendChild(chatInput);
  chatComposer.appendChild(chatInputWrap);

  const voiceOutputBtn = document.createElement("button");
  voiceOutputBtn.className = "voice-btn";
  voiceOutputBtn.type = "button";
  voiceOutputBtn.title = "Speak coach replies and play move sounds";
  voiceOutputBtn.setAttribute("aria-label", "Toggle spoken coaching and move sounds");
  coachHeaderActions.insertBefore(voiceOutputBtn, quickLoginBtn);

  const voiceInputBtn = document.createElement("button");
  voiceInputBtn.className = "voice-btn voice-input-btn";
  voiceInputBtn.type = "button";
  voiceInputBtn.textContent = "🎙 Talk";
  voiceInputBtn.title = "Speak a question to your coach";
  voiceInputBtn.setAttribute("aria-label", "Talk to the chess coach");
  coachHeaderActions.insertBefore(voiceInputBtn, quickLoginBtn);
  const composerVoiceBtn = document.createElement("button");
  composerVoiceBtn.className = "composer-talk-btn";
  composerVoiceBtn.type = "button";
  composerVoiceBtn.textContent = "🎙";
  composerVoiceBtn.title = "Talk to the chess coach";
  composerVoiceBtn.setAttribute("aria-label", "Talk to the chess coach");
  chatInputWrap.appendChild(composerVoiceBtn);

  let voiceOutputEnabled = localStorage.getItem("chess-teacher-voice") === "true";
  let audioContext: AudioContext | null = null;
  let recognition: SpeechRecognitionLike | null = null;
  let lastSpokenText = "";
  let speechRate = Number(localStorage.getItem("chess-teacher-speech-rate") || "1");
  if (!Number.isFinite(speechRate)) speechRate = 1;
  let availableVoices: SpeechSynthesisVoice[] = [];
  // Neural voice engine: "system" = OS speech, "neural" = local Piper voice
  // served by our own backend (offline, human), "auto" picks neural when
  // the backend reports it ready. Static demo has no backend → system.
  let voiceEngine: "auto" | "system" | "neural" =
    (localStorage.getItem("chess-teacher-voice-engine") as "auto" | "system" | "neural" | null) || "auto";
  if (voiceEngine !== "auto" && voiceEngine !== "system" && voiceEngine !== "neural") voiceEngine = "auto";
  let neuralReady = false;
  let neuralAudio: HTMLAudioElement | null = null;
  let neuralBeat: number | null = null;

  function stopNeural() {
    if (neuralBeat !== null) {
      window.clearInterval(neuralBeat);
      neuralBeat = null;
    }
    if (neuralAudio) {
      try {
        neuralAudio.pause();
        const src = neuralAudio.src;
        neuralAudio.removeAttribute("src");
        neuralAudio.load();
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      } catch {
        // Best effort; a stuck blip is better than a stuck sentence.
      }
      neuralAudio = null;
    }
  }

  function stopAllSpeech() {
    stopNeural();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function neuralActive(): boolean {
    if (voiceEngine === "neural") return neuralReady;
    if (voiceEngine === "system") return false;
    return neuralReady; // auto
  }

  function syncVoiceButton() {
    voiceOutputBtn.textContent = voiceOutputEnabled ? "🔊 Voice on" : "🔊 Start voice";
    voiceOutputBtn.classList.toggle("active", voiceOutputEnabled);
  }

  function chooseHumanVoice(): SpeechSynthesisVoice | null {
    const savedName = localStorage.getItem("chess-teacher-voice-name");
    if (savedName) {
      const saved = availableVoices.find((voice) => voice.name === savedName);
      if (saved) return saved;
    }
    // Score voices like a casting director: natural/neural/premium system
    // voices first, robotic/espeak/compact ones last.
    const scored = availableVoices
      .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
      .map((voice) => {
        const name = voice.name.toLowerCase();
        let score = 0;
        if (/samantha|aria|jenny|guy|zira|david|mark|siri|karen|daniel|moira|tessa|fiona/.test(name)) score += 4;
        if (/google/.test(name)) score += 3;
        if (/natural|neural|premium|enhanced|studio/.test(name)) score += 5;
        if (/compact|robot|espeak|sp inj|whisper/.test(name)) score -= 6;
        if (voice.localService) score += 1;
        if (voice.lang.toLowerCase().startsWith("en-us")) score += 1;
        return { voice, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored.length > 0 ? scored[0].voice : null;
  }

  function syncVoiceChoices() {
    availableVoices = window.speechSynthesis?.getVoices?.() || [];
    if (!voiceSelect) return;
    const selected = localStorage.getItem("chess-teacher-voice-name") || "auto";
    voiceSelect.innerHTML = "";
    const automatic = document.createElement("option");
    automatic.value = "auto";
    automatic.textContent = "Natural voice · automatic";
    voiceSelect.appendChild(automatic);
    const voices = availableVoices
      .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
      .slice(0, 16);
    for (const voice of voices) {
      const option = document.createElement("option");
      option.value = voice.name;
      option.textContent = voice.name;
      voiceSelect.appendChild(option);
    }
    voiceSelect.value = voices.some((voice) => voice.name === selected) ? selected : "auto";
  }

  function syncSpeechControls() {
    repeatSpeechBtn.disabled = !lastSpokenText;
    const neuralSpeaking = neuralAudio !== null && !neuralAudio.paused && !neuralAudio.ended;
    const speaking = neuralSpeaking || ("speechSynthesis" in window && window.speechSynthesis.speaking);
    pauseSpeechBtn.disabled = !speaking && !lastSpokenText;
    pauseSpeechBtn.textContent = speaking && window.speechSynthesis?.paused ? "▶ Resume" : "⏸ Pause";
    stopSpeechBtn.disabled = !speaking;
    speechRateLabel.textContent = `${speechRate.toFixed(1)}×`;
  }

  type SpeakMood = "chat" | "sharp" | "verdict" | "offer";

  async function speakNeural(text: string, mood: SpeakMood): Promise<void> {
    const cleanText = text.replace(/[*_#`]/g, "").slice(0, 1200);
    if (!cleanText) return;
    lastSpokenText = cleanText;
    stopAllSpeech();
    orb?.setState(mood === "sharp" ? "excited" : "speaking");
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
      });
      if (!res.ok) throw new Error(`voice HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      neuralAudio = audio;
      audio.playbackRate = speechRate;
      // No word-boundary events from a WAV: drive the orb with a beat
      // timer scaled to speech instead — motion sells the humanity.
      neuralBeat = window.setInterval(() => orb?.beat(mood === "sharp" ? 1.4 : 1), 170);
      audio.onended = () => {
        stopNeural();
        orb?.setState("idle");
        syncSpeechControls();
      };
      audio.onerror = () => {
        stopNeural();
        orb?.setState("idle");
        syncSpeechControls();
      };
      await audio.play();
    } catch {
      // Backend voice failed mid-flight: say it with the system voice
      // rather than going silent. Never leave the orb hanging.
      stopNeural();
      speakSystem(cleanText, mood);
      return;
    }
    syncSpeechControls();
  }

  function speakSystem(text: string, mood: SpeakMood) {
    if (!("speechSynthesis" in window)) {
      orb?.setState("idle");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = chooseHumanVoice();
    if (voice) utterance.voice = voice;
    // Prosody is the difference between robotic and alive: tactics snap a
    // little faster and higher, verdicts slow down, offers stay warm.
    const moodTune: Record<SpeakMood, { rate: number; pitch: number }> = {
      chat: { rate: 1.0, pitch: 1.0 },
      sharp: { rate: 1.08, pitch: 1.15 },
      verdict: { rate: 0.94, pitch: 0.95 },
      offer: { rate: 1.0, pitch: 1.08 },
    };
    utterance.rate = speechRate * moodTune[mood].rate;
    utterance.pitch = moodTune[mood].pitch;
    utterance.volume = 1;
    orb?.setState(mood === "sharp" ? "excited" : "speaking");
    const settleOrb = () => {
      orb?.setState("idle");
      syncSpeechControls();
    };
    utterance.onend = settleOrb;
    utterance.onerror = settleOrb;
    utterance.onboundary = () => orb?.beat();
    window.speechSynthesis.speak(utterance);
    syncSpeechControls();
  }

  function speakText(text: string, force = false, mood: SpeakMood = "chat") {
    if (!voiceOutputEnabled && !force) return;
    const cleanText = text.replace(/[*_#`]/g, "").slice(0, 1200);
    if (!cleanText) return;
    // Barge-in across engines: a new line always kills the old one first.
    stopAllSpeech();
    if (neuralActive()) {
      lastSpokenText = cleanText;
      void speakNeural(cleanText, mood);
      return;
    }
    if (!("speechSynthesis" in window)) return;
    lastSpokenText = cleanText;
    speakSystem(cleanText, mood);
  }

  function speakCoach(text: string) {
    speakText(text);
  }

  function playMoveSound(kind: "player" | "ai") {
    if (!voiceOutputEnabled) return;
    const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass = window.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    void audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "ai" ? 520 : 390, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.14);
  }

  syncVoiceButton();
  const voiceControls = document.createElement("div");
  voiceControls.className = "voice-controls";
  const repeatSpeechBtn = document.createElement("button");
  repeatSpeechBtn.className = "speech-control";
  repeatSpeechBtn.type = "button";
  repeatSpeechBtn.textContent = "↻ Repeat";
  repeatSpeechBtn.title = "Repeat the latest coach message aloud";
  voiceControls.appendChild(repeatSpeechBtn);
  const pauseSpeechBtn = document.createElement("button");
  pauseSpeechBtn.className = "speech-control";
  pauseSpeechBtn.type = "button";
  pauseSpeechBtn.textContent = "⏸ Pause";
  pauseSpeechBtn.title = "Pause or resume spoken coaching";
  voiceControls.appendChild(pauseSpeechBtn);
  const stopSpeechBtn = document.createElement("button");
  stopSpeechBtn.className = "speech-control";
  stopSpeechBtn.type = "button";
  stopSpeechBtn.textContent = "■ Stop";
  stopSpeechBtn.title = "Stop spoken coaching";
  voiceControls.appendChild(stopSpeechBtn);
  const speechRateLabel = document.createElement("span");
  speechRateLabel.className = "speech-rate-label";
  speechRateLabel.textContent = "1.0×";
  voiceControls.appendChild(speechRateLabel);
  const speechRateInput = document.createElement("input");
  speechRateInput.className = "speech-rate";
  speechRateInput.type = "range";
  speechRateInput.min = "0.7";
  speechRateInput.max = "1.4";
  speechRateInput.step = "0.1";
  speechRateInput.value = speechRate.toFixed(1);
  speechRateInput.title = "Speech speed";
  speechRateInput.setAttribute("aria-label", "Speech speed");
  voiceControls.appendChild(speechRateInput);
  const voiceSelect = document.createElement("select");
  voiceSelect.className = "speech-voice-select";
  voiceSelect.title = "Choose the installed voice used by the coach";
  voiceSelect.setAttribute("aria-label", "Coach voice");
  voiceControls.appendChild(voiceSelect);
  // Voice engine pill: System (OS speech, everywhere) vs Neural (our own
  // offline human voice, local app only). Auto-detected, one tap to switch.
  const enginePill = document.createElement("button");
  enginePill.className = "speech-control engine-pill";
  enginePill.type = "button";
  enginePill.title = "Voice engine: OS speech or local neural voice";
  enginePill.setAttribute("aria-label", "Voice engine");
  voiceControls.appendChild(enginePill);

  function syncEnginePill() {
    const label = voiceEngine === "neural" ? "Neural" : voiceEngine === "system" ? "System" : "Auto";
    const resolved = neuralActive() ? "Neural" : "System";
    enginePill.textContent = `🎙 ${label} → ${resolved}`;
    enginePill.disabled = !neuralReady && voiceEngine !== "auto";
    enginePill.title = neuralReady
      ? `Voice engine ${label} (resolving to ${resolved}). Tap to cycle.`
      : "Neural voice needs the local app running. Tap to cycle anyway.";
  }

  enginePill.addEventListener("click", () => {
    voiceEngine = voiceEngine === "auto" ? "system" : voiceEngine === "system" ? "neural" : "auto";
    localStorage.setItem("chess-teacher-voice-engine", voiceEngine);
    syncEnginePill();
    if (voiceOutputEnabled) speakText(`Voice engine: ${neuralActive() ? "neural" : "system"}.`, true);
  });

  async function probeNeuralVoice() {
    try {
      const res = await fetch("/api/voice/status");
      if (!res.ok) throw new Error("no backend voice");
      const data = (await res.json()) as { ready?: boolean };
      neuralReady = data.ready === true;
    } catch {
      neuralReady = false;
    }
    syncEnginePill();
  }

  chatComposer.appendChild(voiceControls);

  repeatSpeechBtn.addEventListener("click", () => {
    if (lastSpokenText) speakText(lastSpokenText, true);
  });
  pauseSpeechBtn.addEventListener("click", () => {
    if (neuralAudio && !neuralAudio.paused && !neuralAudio.ended) {
      neuralAudio.pause();
      setTimeout(syncSpeechControls, 0);
      return;
    }
    if (neuralAudio && neuralAudio.paused) {
      void neuralAudio.play().catch(() => undefined);
      setTimeout(syncSpeechControls, 0);
      return;
    }
    if (!("speechSynthesis" in window)) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
    } else if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    } else if (lastSpokenText) {
      speakText(lastSpokenText, true);
    }
    setTimeout(syncSpeechControls, 0);
  });
  stopSpeechBtn.addEventListener("click", () => {
    stopAllSpeech();
    orb?.setState("idle");
    syncSpeechControls();
  });
  speechRateInput.addEventListener("input", () => {
    speechRate = Number(speechRateInput.value);
    localStorage.setItem("chess-teacher-speech-rate", speechRate.toFixed(1));
    syncSpeechControls();
  });
  voiceSelect.addEventListener("change", () => {
    if (voiceSelect.value === "auto") localStorage.removeItem("chess-teacher-voice-name");
    else localStorage.setItem("chess-teacher-voice-name", voiceSelect.value);
  });
  if ("speechSynthesis" in window) {
    syncVoiceChoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", syncVoiceChoices);
  }
  syncEnginePill();
  void probeNeuralVoice();
  syncSpeechControls();
  voiceOutputBtn.addEventListener("click", () => {
    voiceOutputEnabled = !voiceOutputEnabled;
    localStorage.setItem("chess-teacher-voice", String(voiceOutputEnabled));
    syncVoiceButton();
    if (voiceOutputEnabled) {
      playMoveSound("player");
      speakCoach("Voice coaching is on. I will speak explanations and play a sound for each move.");
    } else {
      stopAllSpeech();
      orb?.setState("idle");
    }
  });

  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  const SpeechRecognitionClass = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!SpeechRecognitionClass) {
    voiceInputBtn.title = "Voice input is not supported by this browser";
    voiceInputBtn.disabled = true;
    voiceInputBtn.textContent = "🎙 Unavailable";
    composerVoiceBtn.title = "Voice input is not supported by this browser";
    composerVoiceBtn.disabled = true;
    composerVoiceBtn.textContent = "🎙";
  } else {
    const syncTalkButtons = (listening: boolean) => {
      voiceInputBtn.textContent = listening ? "⏹ Stop" : "🎙 Talk";
      voiceInputBtn.classList.toggle("active", listening);
      composerVoiceBtn.textContent = listening ? "⏹" : "🎙";
      composerVoiceBtn.classList.toggle("active", listening);
    };
    composerVoiceBtn.addEventListener("click", () => voiceInputBtn.click());
    voiceInputBtn.addEventListener("click", () => {
      // Barge-in: the coach stops mid-sentence and listens. Real
      // conversation means being interruptible.
      stopAllSpeech();
      if (recognition) {
        recognition.stop();
        return;
      }
      recognition = new SpeechRecognitionClass();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || "en-US";
      recognition.onstart = () => {
        syncTalkButtons(true);
      };
      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          chatInput.value = transcript;
          void submitChat();
        }
      };
      recognition.onerror = () => {
        chatHint.textContent = "Voice input was not available; you can still type here.";
      };
      recognition.onend = () => {
        recognition = null;
        syncTalkButtons(false);
      };
      recognition.start();
    });
  }

  const chatActions = document.createElement("div");
  chatActions.className = "chat-actions";
  const chatHint = document.createElement("span");
  chatHint.className = "chat-hint";
  chatHint.textContent = "Board-aware · saved locally";
  chatActions.appendChild(chatHint);
  if (GITHUB_PAGES_DEMO) syncAskRow();
  const chatSend = document.createElement("button");
  chatSend.className = "chat-send";
  chatSend.type = "submit";
  chatSend.textContent = "Send";
  chatActions.appendChild(chatSend);
  chatComposer.appendChild(chatActions);

  const chatMoveActions = document.createElement("div");
  chatMoveActions.className = "chat-move-actions";
  const chatAiMoveBtn = document.createElement("button");
  chatAiMoveBtn.className = "chat-ai-move-btn";
  chatAiMoveBtn.type = "button";
  chatAiMoveBtn.textContent = "▶ Play AI move";
  chatAiMoveBtn.disabled = true;
  chatAiMoveBtn.title = "Let the selected AI play the pending opponent move";
  chatMoveActions.appendChild(chatAiMoveBtn);
  const chatMoveHint = document.createElement("span");
  chatMoveHint.className = "chat-move-hint";
  chatMoveHint.textContent = "After your move, the AI waits here.";
  chatMoveActions.appendChild(chatMoveHint);
  chatComposer.appendChild(chatMoveActions);
  coachColumn.appendChild(chatComposer);

  // This button configures the local Codex/ChatGPT subscription directly in
  // the chat room. It deliberately does not open the hamburger menu, so the
  // board and right panel do not jump while a login is being checked.
  quickLoginBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    quickLoginBtn.disabled = true;
    quickLoginBtn.textContent = "Connecting…";
    try {
      if (!providerPresets.some((preset) => preset.id === "codex")) {
        await loadProviderSetup();
      }
      const codex = providerPresets.find((preset) => preset.id === "codex");
      if (!codex) throw new Error("Codex login is not available on this server.");
      if (codex.authenticated) {
        const response = await configureProvider({ provider: "codex", model: codex.model });
        activeProviderLabel = response.active.label;
        activeProviderModel = response.active.model;
        activeProviderEffort = response.active.effort;
        syncAgentStatus?.(activeProviderLabel);
        chatHint.textContent = `${response.active.label} active · AI directs opponent moves`;
        quickLoginBtn.textContent = "ChatGPT active";
      } else {
        // Coach the actual board on the live site, not a generic ping.
        // The login stays one-shot: a fresh device-code login per response.
        // No popup is opened: the login step renders an inline link to the
        // official OpenAI page that the user clicks (popup blockers and
        // blank-tab handling made auto-opened tabs unreliable).
        let codexPrompt: string | undefined;
        try {
          const fen = gc.viewedFen();
          const moves = gc.history().join(" ") || "(starting position)";
          codexPrompt = `Coach this chess position for a club player in one or two short sentences. FEN: ${fen}. Moves so far: ${moves}.`;
        } catch {
          codexPrompt = undefined;
        }
        const codexCallbacks = GITHUB_PAGES_DEMO
          ? {
              onLoginRequired: (verificationUrl: string, userCode: string) =>
                addChatBubble(
                  "assistant",
                  `ChatGPT login: open ${verificationUrl} and enter code ${userCode}. That page is run by OpenAI — our site never sees your password. I'm waiting…`,
                  "Codex login",
                  false,
                ),
              onComplete: (text: string) => {
                addChatBubble("assistant", text, "Codex");
                try {
                  const sessionId = gc.getSessionId();
                  if (sessionId) rememberCodexExchange(sessionId, text);
                } catch {
                  // Display already succeeded; history persistence is best-effort.
                }
              },
            }
          : undefined;
        const response = await startProviderLogin(
          "codex",
          GITHUB_PAGES_DEMO ? codexEventHandler(chatHint, codexCallbacks) : undefined,
          codexPrompt,
        );
        // Keep the hint short: the full Codex reply already lives in a Codex
        // bubble above (and in saved history). Also say plainly who the chat
        // box talks to, so nobody mistakes Free Weak AI for ChatGPT.
        chatHint.textContent = GITHUB_PAGES_DEMO
          ? "Codex replied above (one reply per login) · the chat box below still talks to Free Weak AI"
          : response.message || "Finish ChatGPT login, then click here again.";
        quickLoginBtn.textContent = GITHUB_PAGES_DEMO ? "Ask Codex again" : "Finish ChatGPT login";
      }
    } catch (error) {
      chatHint.textContent = error instanceof Error ? error.message : "ChatGPT login failed";
      quickLoginBtn.textContent = "ChatGPT login";
    } finally {
      quickLoginBtn.disabled = false;
    }
  });

  // 2. Eval bar
  const evalBarWrap = document.createElement("div");
  evalBarWrap.className = "eval-bar-wrap";
  layout.appendChild(evalBarWrap);

  const evalBarBlack = document.createElement("div");
  evalBarBlack.className = "eval-bar-black";
  evalBarBlack.style.height = "50%";
  evalBarWrap.appendChild(evalBarBlack);

  const evalBarWhite = document.createElement("div");
  evalBarWhite.className = "eval-bar-white";
  evalBarWhite.style.height = "50%";
  evalBarWrap.appendChild(evalBarWhite);

  const evalBarLabel = document.createElement("div");
  evalBarLabel.className = "eval-bar-label";
  evalBarLabel.textContent = "0.0";
  evalBarWrap.appendChild(evalBarLabel);

  // 3. Board
  const boardShell = document.createElement("div");
  boardShell.className = "board-shell";
  layout.appendChild(boardShell);

  const boardWrap = document.createElement("div");
  boardWrap.className = "board-wrap";
  boardShell.appendChild(boardWrap);

  const boardControls = document.createElement("div");
  boardControls.className = "board-controls";
  const firstBtn = document.createElement("button");
  firstBtn.className = "nav-btn";
  firstBtn.type = "button";
  firstBtn.textContent = "|‹";
  firstBtn.title = "Go to start";
  const backBtn = document.createElement("button");
  backBtn.className = "nav-btn nav-btn-wide";
  backBtn.type = "button";
  backBtn.textContent = "← Back";
  const plyCounter = document.createElement("span");
  plyCounter.className = "ply-counter";
  plyCounter.textContent = "Start";
  const forwardBtn = document.createElement("button");
  forwardBtn.className = "nav-btn nav-btn-wide";
  forwardBtn.type = "button";
  forwardBtn.textContent = "Forward →";
  const lastBtn = document.createElement("button");
  lastBtn.className = "nav-btn";
  lastBtn.type = "button";
  lastBtn.textContent = "›|";
  lastBtn.title = "Go to latest move";
  for (const control of [firstBtn, backBtn, plyCounter, forwardBtn, lastBtn]) {
    boardControls.appendChild(control);
  }
  boardShell.appendChild(boardControls);

  // 4. Right panel
  const rightPanel = document.createElement("div");
  rightPanel.className = "right-panel";
  layout.appendChild(rightPanel);

  const rightPanelTop = document.createElement("div");
  rightPanelTop.className = "right-panel-top";
  const rightPanelTitle = document.createElement("div");
  rightPanelTitle.className = "right-panel-title";
  rightPanelTitle.textContent = "Analysis panel";
  rightPanelTop.appendChild(rightPanelTitle);
  const closeRightPanelBtn = document.createElement("button");
  closeRightPanelBtn.className = "close-panel-btn";
  closeRightPanelBtn.type = "button";
  closeRightPanelBtn.textContent = "×";
  closeRightPanelBtn.title = "Close analysis panel";
  closeRightPanelBtn.setAttribute("aria-label", "Close analysis panel");
  rightPanelTop.appendChild(closeRightPanelBtn);
  rightPanel.appendChild(rightPanelTop);
  closeRightPanelBtn.addEventListener("click", () => setRightPanelCollapsed(true));

  // New Game button
  const newGameBtn = document.createElement("button");
  newGameBtn.className = "new-game-btn";
  newGameBtn.textContent = "New Game";
  rightPanel.appendChild(newGameBtn);

  const evalControls = document.createElement("label");
  evalControls.className = "eval-controls";
  const evalToggle = document.createElement("input");
  evalToggle.type = "checkbox";
  evalToggle.checked = localStorage.getItem("chess-teacher-eval-bar") !== "false";
  evalControls.appendChild(evalToggle);
  evalControls.appendChild(document.createTextNode(" Tension meter"));
  evalControls.title = "Live engine evaluation, reframed as game tension";
  rightPanel.appendChild(evalControls);

  function setEvalBarEnabled(enabled: boolean) {
    evalBarWrap.classList.toggle("disabled", !enabled);
    localStorage.setItem("chess-teacher-eval-bar", String(enabled));
  }
  setEvalBarEnabled(evalToggle.checked);
  evalToggle.addEventListener("change", () => setEvalBarEnabled(evalToggle.checked));

  // Opponent rating controls the AI's target playing strength. The existing
  // coaching profile is derived from this number for analysis depth.
  const ratingLabel = document.createElement("div");
  ratingLabel.className = "section-label";
  ratingLabel.textContent = "Opponent rating";
  rightPanel.appendChild(ratingLabel);

  const ratingSelect = document.createElement("select");
  ratingSelect.className = "elo-select-main";
  ratingSelect.setAttribute("aria-label", "Opponent rating");
  const ratingOptions: [string, string][] = [
    ["1000", "1000"],
    ["1200", "1200"],
    ["2000", "2000"],
    ["custom", "Custom rating…"],
  ];
  for (const [value, label] of ratingOptions) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    ratingSelect.appendChild(opt);
  }
  rightPanel.appendChild(ratingSelect);

  const customRatingInput = document.createElement("input");
  customRatingInput.type = "number";
  customRatingInput.className = "rating-custom-input";
  customRatingInput.min = "400";
  customRatingInput.max = "3000";
  customRatingInput.step = "1";
  customRatingInput.placeholder = "Enter rating (400–3000)";
  customRatingInput.setAttribute("aria-label", "Custom opponent rating");
  rightPanel.appendChild(customRatingInput);

  function profileForRating(rating: number): string {
    if (rating < 900) return "beginner";
    if (rating < 1100) return "intermediate";
    if (rating < 1300) return "advancing";
    if (rating < 1600) return "club";
    return "competitive";
  }

  function clampRating(value: number): number {
    return Math.max(400, Math.min(3000, Math.round(value)));
  }

  let opponentRating = clampRating(Number(localStorage.getItem("chess-teacher-opponent-rating") || 1200));

  function setRatingControl(rating: number) {
    opponentRating = clampRating(rating);
    const preset = [1000, 1200, 2000].includes(opponentRating);
    ratingSelect.value = preset ? String(opponentRating) : "custom";
    customRatingInput.value = String(opponentRating);
    customRatingInput.hidden = preset;
  }
  setRatingControl(opponentRating);

  const agentStatus = document.createElement("div");
  agentStatus.className = "opponent-agent-status";
  syncAgentStatus = (label: string) => {
    agentStatus.textContent = label === "Free Weak AI"
      ? `${label} coach active · browser Stockfish plays the practice reply`
      : `${label} active · only AI can make the opponent move`;
    agentStatus.className = "opponent-agent-status ai-active";
    syncAiIdentity(label);
  };
  if (activeProviderLabel) {
    syncAgentStatus(activeProviderLabel);
  } else {
    agentStatus.textContent = "Free local engine-backed player ready · no key or login needed";
  }
  rightPanel.appendChild(agentStatus);

  const aiMoveBtn = document.createElement("button");
  aiMoveBtn.className = "ai-move-btn";
  aiMoveBtn.type = "button";
  aiMoveBtn.textContent = "Make AI move";
  aiMoveBtn.disabled = true;
  aiMoveBtn.title = "Ask the selected AI to make one legal move";
  rightPanel.appendChild(aiMoveBtn);

  const aiIdentityCard = document.createElement("div");
  aiIdentityCard.className = "ai-identity-card";
  const aiIdentityTitle = document.createElement("div");
  aiIdentityTitle.className = "ai-identity-title";
  aiIdentityTitle.textContent = "AI player status";
  aiIdentityCard.appendChild(aiIdentityTitle);
  const aiIdentityText = document.createElement("div");
  aiIdentityText.className = "ai-identity-text";
  aiIdentityText.textContent = "Free local engine-backed player · stockfish-local-v1 · instant · no key";
  aiIdentityCard.appendChild(aiIdentityText);
  const aiIdentityNote = document.createElement("div");
  aiIdentityNote.className = "ai-identity-note";
  aiIdentityNote.textContent = "Stockfish: analysis only, never the opponent.";
  aiIdentityCard.appendChild(aiIdentityNote);
  rightPanel.appendChild(aiIdentityCard);

  function syncAiIdentity(label = activeProviderLabel, model = activeProviderModel, effort = activeProviderEffort) {
    activeProviderLabel = label;
    activeProviderModel = model;
    activeProviderEffort = effort;
    const local = label.toLowerCase().includes("engine-backed") || model === "local-policy-v1" || model === "stockfish-local-v1" || model === "stockfish-browser-v1";
    const browserFreeWeak = model === "mistral-Nemo-Instruct-2407";
    const freeWeak = label === "Free Weak AI" || model === "big-pickle" || browserFreeWeak;
    aiIdentityText.textContent = local
      ? `Free local engine-backed player · ${model} · instant · no key`
      : freeWeak
        ? "Free Weak AI · short chess explanations"
      : `${label} · ${model} · ${effort} effort`;
    aiIdentityNote.textContent = local
      ? "Stockfish chooses the move locally or in the browser. No language model is connected in guest mode."
      : freeWeak
        ? browserFreeWeak
          ? "Free AI explains the position; browser Stockfish plays the practice reply on GitHub Pages."
          : "Free AI explains the move; Stockfish remains analysis-only and cannot play it by itself."
      : "Selected AI chooses the move; Stockfish is analysis-only and cannot play it.";
  }

  // Game status
  const statusDisplay = document.createElement("div");
  statusDisplay.className = "game-status";
  rightPanel.appendChild(statusDisplay);

  // Analysis section label
  const analysisLabel = document.createElement("div");
  analysisLabel.className = "section-label";
  analysisLabel.textContent = "Analysis";
  rightPanel.appendChild(analysisLabel);

  // Eval display
  const evalDisplay = document.createElement("div");
  evalDisplay.className = "eval-display";
  evalDisplay.textContent = "Eval: \u2014";
  rightPanel.appendChild(evalDisplay);

  // MultiPV line display
  const lineDisplay = document.createElement("div");
  lineDisplay.className = "line-display";
  lineDisplay.textContent = "Lines: \u2014";
  rightPanel.appendChild(lineDisplay);

  // --- Line explorer ("Show me the idea") ---
  // Steps through a ~10 half-move engine line on the board with arrows and
  // a spoken factual comment per move. Board preview only: the real game is
  // untouched until you press Live (or make a move after exiting).
  const ideaBtn = document.createElement("button");
  ideaBtn.className = "quick-login-btn";
  ideaBtn.type = "button";
  ideaBtn.textContent = "\u{1F4A1} Show me the idea";
  ideaBtn.title = "Preview the engine's idea line step by step with arrows and commentary";
  rightPanel.appendChild(ideaBtn);

  const explorerPanel = document.createElement("div");
  explorerPanel.className = "line-display";
  explorerPanel.hidden = true;
  rightPanel.appendChild(explorerPanel);

  let explorer: {
    line: TeachableLine;
    views: Array<{ label: string; hook: string; line: TeachableLine }>;
    activeView: number;
    cursor: number;
    playing: boolean;
    timer: number | null;
    speed: number;
  } | null = null;

  function stopPlayback() {
    if (!explorer) return;
    explorer.playing = false;
    if (explorer.timer !== null) {
      window.clearTimeout(explorer.timer);
      explorer.timer = null;
    }
  }

  function exitExplorer() {
    if (!explorer) return;
    stopPlayback();
    hideHand();
    explorer = null;
    explorerPanel.hidden = true;
    explorerPanel.innerHTML = "";
    ideaBtn.disabled = false;
    ideaBtn.textContent = "\u{1F4A1} Show me the idea";
    setCoachStatus("watching…");
    gc.jumpToPly(gc.getMaxPly());
  }

  // --- Ghost hand: the coach's touch taking over the board ---
  let handEl: HTMLDivElement | null = null;
  function squareCenter(sq: string): { x: number; y: number } | null {
    const boardEl = document.querySelector("cg-board") as HTMLElement | null;
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const size = rect.width / 8;
    let file = sq.charCodeAt(0) - 97;
    let rank = 8 - parseInt(sq[1], 10);
    let orientation = "white";
    try {
      orientation = (board as unknown as { state?: { orientation?: string } })
        .state?.orientation || "white";
    } catch {
      orientation = "white";
    }
    if (orientation === "black") {
      file = 7 - file;
      rank = 7 - rank;
    }
    return { x: rect.left + (file + 0.5) * size, y: rect.top + (rank + 0.5) * size };
  }

  function hideHand() {
    if (handEl) handEl.style.opacity = "0";
  }

  function glideHand(fromSq: string, toSq: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const a = squareCenter(fromSq);
      const b = squareCenter(toSq);
      if (!a || !b) {
        resolve();
        return;
      }
      if (!handEl) {
        handEl = document.createElement("div");
        handEl.className = "ghost-hand";
        handEl.innerHTML =
          `<svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true">` +
          `<g fill="rgba(20,24,40,0.92)" stroke="#4ade80" stroke-width="1.6">` +
          `<rect x="13" y="2.5" width="4.6" height="12" rx="2.3"/>` +
          `<rect x="18.2" y="7" width="4" height="9" rx="2"/>` +
          `<rect x="8.6" y="8.5" width="4" height="8.5" rx="2"/>` +
          `<rect x="9" y="13" width="13" height="13" rx="6"/>` +
          `<path d="M9 17 L3.5 13.5 L5.5 10.5 L10 13.5 Z"/>` +
          `</g></svg>`;
        document.body.appendChild(handEl);
      }
      handEl.style.opacity = "1";
      handEl.style.transition = "none";
      handEl.style.transform = `translate(${a.x - 18}px, ${a.y - 22}px)`;
      void handEl.offsetWidth;
      handEl.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1), opacity 250ms`;
      handEl.style.transform = `translate(${b.x - 18}px, ${b.y - 22}px)`;
      window.setTimeout(() => {
        if (handEl) handEl.style.opacity = "0";
        resolve();
      }, ms);
    });
  }

  function renderExplorer() {
    if (!explorer) return;
    const { line, cursor } = explorer;
    explorerPanel.innerHTML = "";
    const active = explorer.views[explorer.activeView];
    if (explorer.views.length > 1) {
      const tabs = document.createElement("div");
      explorer.views.forEach((view, index) => {
        const tab = document.createElement("button");
        tab.className = "quick-login-btn";
        tab.type = "button";
        tab.textContent = view.label;
        tab.style.fontWeight = explorer!.activeView === index ? "800" : "400";
        tab.style.opacity = explorer!.activeView === index ? "1" : "0.65";
        tab.addEventListener("click", () => {
          if (!explorer) return;
          stopPlayback();
          explorer.activeView = index;
          explorer.line = explorer.views[index].line;
          goExplorerPly(0, false);
        });
        tabs.appendChild(tab);
      });
      explorerPanel.appendChild(tabs);
    }
    const verdict = document.createElement("div");
    verdict.textContent = active && active.hook ? active.hook : line.verdict;
    explorerPanel.appendChild(verdict);
    const movesRow = document.createElement("div");
    line.moves.forEach((ply, index) => {
      const chip = document.createElement("button");
      chip.className = "quick-login-btn";
      chip.type = "button";
      chip.style.fontWeight = cursor === index + 1 ? "800" : "400";
      chip.style.opacity = cursor === index + 1 ? "1" : "0.75";
      // Heat: mate burns red, checks orange, captures amber, quiet default.
      if (ply.checkmate) chip.style.borderColor = "#f87171";
      else if (ply.check) chip.style.borderColor = "#fb923c";
      else if (ply.capture) chip.style.borderColor = "#fbbf24";
      const moveNo = Math.floor(index / 2) + 1;
      chip.textContent = (index % 2 === 0 ? `${moveNo}. ` : "") + ply.san;
      chip.title = ply.comment;
      chip.addEventListener("click", () => void goExplorerPly(index + 1, true));
      movesRow.appendChild(chip);
    });
    explorerPanel.appendChild(movesRow);
    const controls = document.createElement("div");
    const prevBtn = document.createElement("button");
    prevBtn.className = "quick-login-btn";
    prevBtn.type = "button";
    prevBtn.textContent = "\u25C0 Prev";
    prevBtn.addEventListener("click", () => void goExplorerPly(cursor - 1, true));
    const nextBtn = document.createElement("button");
    nextBtn.className = "quick-login-btn";
    nextBtn.type = "button";
    nextBtn.textContent = "Next \u25B6";
    nextBtn.addEventListener("click", () => void goExplorerPly(cursor + 1, true));
    const playBtn = document.createElement("button");
    playBtn.className = "quick-login-btn";
    playBtn.type = "button";
    playBtn.textContent = explorer.playing ? "\u23F8 Pause" : "\u25B6 Play";
    playBtn.title = "Auto-play the line with commentary";
    playBtn.addEventListener("click", () => togglePlayback());
    const speedBtn = document.createElement("button");
    speedBtn.className = "quick-login-btn";
    speedBtn.type = "button";
    speedBtn.textContent = `${explorer.speed}\u00D7`;
    speedBtn.title = "Playback speed";
    speedBtn.addEventListener("click", () => {
      if (!explorer) return;
      explorer.speed = explorer.speed >= 2 ? 1 : explorer.speed + 0.5;
      if (explorer.playing) {
        stopPlayback();
        startPlayback();
      } else {
        renderExplorer();
      }
    });
    const speakBtn = document.createElement("button");
    speakBtn.className = "quick-login-btn";
    speakBtn.type = "button";
    speakBtn.textContent = "\u{1F50A} Line";
    speakBtn.title = "Speak the whole line";
    speakBtn.addEventListener("click", () => {
      if (!explorer) return;
      const text = explorer.line.moves
        .map((ply, i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? "." : "…"} ${ply.san}. ${ply.comment}`)
        .join(" ");
      speakText(text, true);
    });
    const liveBtn = document.createElement("button");
    liveBtn.className = "quick-login-btn";
    liveBtn.type = "button";
    liveBtn.textContent = "Live";
    liveBtn.title = "Back to the live game";
    liveBtn.addEventListener("click", exitExplorer);
    controls.append(prevBtn, nextBtn, playBtn, speedBtn, speakBtn, liveBtn);
    explorerPanel.appendChild(controls);
    const comment = document.createElement("div");
    comment.textContent = cursor === 0
      ? "Start of the idea — press Next (or →) to walk it."
      : line.moves[cursor - 1].comment;
    explorerPanel.appendChild(comment);
  }

  async function goExplorerPly(next: number, speak: boolean, glide = true, fromPlayback = false) {
    if (!explorer) return;
    if (explorer.playing && !fromPlayback) {
      // Manual navigation always wins over autoplay.
      stopPlayback();
      setCoachStatus("watching…");
    }
    const clamped = Math.max(0, Math.min(next, explorer.line.moves.length));
    explorer.cursor = clamped;
    if (clamped === 0) {
      board.set({ fen: explorer.line.fen });
      board.setAutoShapes([]);
      hideHand();
    } else {
      const ply = explorer.line.moves[clamped - 1];
      if (glide) {
        setCoachStatus("my board for a minute…");
        await glideHand(ply.uci.slice(0, 2), ply.uci.slice(2, 4), 480);
        if (!explorer || explorer.cursor !== clamped) return;
      }
      const turn = ply.fen_after.split(" ")[1] === "b" ? "black" : "white";
      board.set({
        fen: ply.fen_after,
        turnColor: turn as "white" | "black",
        movable: { color: undefined },
        lastMove: [ply.uci.slice(0, 2) as Key, ply.uci.slice(2, 4) as Key],
      });
      const heat = ply.checkmate || ply.check ? "red" : ply.capture ? "yellow" : "green";
      board.setAutoShapes([{
        orig: ply.uci.slice(0, 2) as Key,
        dest: ply.uci.slice(2, 4) as Key,
        brush: heat as "green",
      }]);
      if (speak) {
        const narration = narratePly(
          ply, clamped - 1, explorer.line.moves.length, explorer.line.verdict,
        );
        orb?.setState(narration.mood === "sharp" ? "excited" : "speaking");
        speakText(narration.text, false, narration.mood);
        setCoachStatus(`showing idea ${clamped}/${explorer.line.moves.length}`);
      }
    }
    renderExplorer();
  }

  function schedulePlaybackStep() {
    if (!explorer?.playing) return;
    explorer.timer = window.setTimeout(() => {
      if (!explorer || !explorer.playing) return;
      if (explorer.cursor >= explorer.line.moves.length) {
        stopPlayback();
        speakText("Your board again — your move.", false, "verdict");
        setCoachStatus("watching…");
        renderExplorer();
        return;
      }
      void goExplorerPly(explorer.cursor + 1, true, true, true).then(() => schedulePlaybackStep());
    }, Math.round(3400 / explorer.speed));
  }

  function startPlayback() {
    if (!explorer) return;
    stopPlayback();
    explorer.playing = true;
    if (explorer.cursor >= explorer.line.moves.length) explorer.cursor = 0;
    speakText("Alright — my board for a minute. Watch.", false, "offer");
    setCoachStatus("playing the idea… (Live takes it back anytime)");
    renderExplorer();
    schedulePlaybackStep();
  }

  function togglePlayback() {
    if (!explorer) return;
    if (explorer.playing) {
      stopPlayback();
      setCoachStatus("watching…");
      renderExplorer();
    } else {
      startPlayback();
    }
  }

  async function openExplorer() {
    if (explorer) {
      exitExplorer();
      return;
    }
    ideaBtn.disabled = true;
    ideaBtn.textContent = "Reading the idea…";
    try {
      const fen = gc.viewedFen();
      let line: TeachableLine;
      if (GITHUB_PAGES_DEMO) {
        const info = await Promise.race([
          engine.evaluateMultiPVAsync(fen, 5, 14),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 25000)),
        ]);
        if (!info || info.length === 0) throw new Error("Browser engine returned no lines");
        const sorted = [...info].sort((a, b) => a.multipv - b.multipv);
        line = buildLocalTeachableLine(
          fen,
          sorted.map((entry) => ({ pv: entry.pv, scoreCp: entry.scoreCp, scoreMate: entry.scoreMate })),
          14,
          10,
        );
      } else {
        line = await fetchTeachableLine(fen, 10);
      }
      if (line.moves.length === 0) throw new Error("Engine returned an empty line");
      const views = [{ label: "Best", hook: "", line }];
      for (const trap of line.traps || []) {
        views.push({
          label: `Trap: ${trap.move_san}`,
          hook: `Most humans play ${trap.move_san} here — ${trap.tempting_because}. And that's the trap (−${trap.win_drop}%):`,
          line: trap.line,
        });
      }
      explorer = { line, views, activeView: 0, cursor: 0, playing: false, timer: null, speed: 1 };
      explorerPanel.hidden = false;
      board.set({ movable: { color: undefined } });
      renderExplorer();
      ideaBtn.textContent = "Close idea";
    } catch (error) {
      explorerPanel.hidden = false;
      explorerPanel.textContent = error instanceof Error ? error.message : "Idea unavailable";
      setTimeout(() => {
        if (!explorer) explorerPanel.hidden = true;
      }, 4000);
      ideaBtn.textContent = "\u{1F4A1} Show me the idea";
    } finally {
      ideaBtn.disabled = false;
    }
  }

  ideaBtn.addEventListener("click", () => void openExplorer());

  // Moves section label
  const movesLabel = document.createElement("div");
  movesLabel.className = "section-label";
  movesLabel.textContent = "Moves";
  rightPanel.appendChild(movesLabel);

  // Move history
  const moveHistory = document.createElement("div");
  moveHistory.className = "move-history";
  rightPanel.appendChild(moveHistory);

  // Viewing indicator
  const viewingIndicator = document.createElement("div");
  viewingIndicator.className = "viewing-indicator";
  rightPanel.appendChild(viewingIndicator);

  // FEN display (click to copy)
  const fenDisplay = document.createElement("input");
  fenDisplay.type = "text";
  fenDisplay.readOnly = true;
  fenDisplay.className = "fen-display";
  fenDisplay.placeholder = "Position FEN";
  fenDisplay.title = "Click to copy FEN";
  rightPanel.appendChild(fenDisplay);

  function updateFenDisplay(fen: string) {
    fenDisplay.value = fen;
  }

  fenDisplay.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(fenDisplay.value);
      const originalBorder = fenDisplay.style.borderColor;
      fenDisplay.style.borderColor = "#4ade80";
      setTimeout(() => {
        fenDisplay.style.borderColor = originalBorder;
      }, 300);
    } catch (err) {
      // Fallback for older browsers
      fenDisplay.select();
      document.execCommand("copy");
    }
  });

  // PGN export (click to copy). Built from the live game, not the server,
  // so it works identically in the local app and the static demo.
  const pgnBtn = document.createElement("button");
  pgnBtn.className = "quick-login-btn";
  pgnBtn.type = "button";
  pgnBtn.textContent = "Copy PGN";
  pgnBtn.title = "Copy this game as PGN";
  pgnBtn.addEventListener("click", async () => {
    try {
      const replay = new Chess();
      for (const san of gc.history()) replay.move(san);
      const pgn = replay.pgn();
      await navigator.clipboard.writeText(pgn);
      pgnBtn.textContent = "Copied!";
      setTimeout(() => {
        pgnBtn.textContent = "Copy PGN";
      }, 1500);
    } catch {
      pgnBtn.textContent = "Failed";
      setTimeout(() => {
        pgnBtn.textContent = "Copy PGN";
      }, 1500);
    }
  });
  rightPanel.appendChild(pgnBtn);

  // --- Promotion UI ---
  function showPromotionChooser(
    isWhite: boolean,
  ): Promise<PromotionPiece> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "promotion-overlay";

      const choices = document.createElement("div");
      choices.className = "promotion-choices";
      overlay.appendChild(choices);

      const pieces: { piece: PromotionPiece; symbol: string }[] = isWhite
        ? [
            { piece: "q", symbol: "\u2655" },
            { piece: "r", symbol: "\u2656" },
            { piece: "b", symbol: "\u2657" },
            { piece: "n", symbol: "\u2658" },
          ]
        : [
            { piece: "q", symbol: "\u265B" },
            { piece: "r", symbol: "\u265C" },
            { piece: "b", symbol: "\u265D" },
            { piece: "n", symbol: "\u265E" },
          ];

      for (const { piece, symbol } of pieces) {
        const btn = document.createElement("button");
        btn.textContent = symbol;
        btn.addEventListener("click", () => {
          overlay.remove();
          resolve(piece);
        });
        choices.appendChild(btn);
      }

      document.body.appendChild(overlay);
    });
  }

  // --- Eval bar update ---
  function updateEvalBar(scoreCp: number | null, scoreMate: number | null) {
    let whitePct: number;
    let label: string;

    if (scoreMate !== null) {
      whitePct = scoreMate > 0 ? 100 : 0;
      label = `M${Math.abs(scoreMate)}`;
    } else if (scoreCp !== null) {
      whitePct = 50 + 50 * (2 / (1 + Math.exp(-scoreCp / 300)) - 1);
      const score = scoreCp / 100;
      label = `${score > 0 ? "+" : ""}${score.toFixed(1)}`;
    } else {
      whitePct = 50;
      label = "0.0";
    }

    evalBarWhite.style.height = `${whitePct}%`;
    evalBarBlack.style.height = `${100 - whitePct}%`;
    evalBarLabel.textContent = label;
  }

  // --- MultiPV display ---
  function updateMultiEval(info: MultiPVInfo) {
    const line1 = info.lines[0];
    if (line1) {
      if (line1.scoreCp !== null) {
        const score = (line1.scoreCp / 100).toFixed(2);
        evalDisplay.textContent = `Eval: ${line1.scoreCp > 0 ? "+" : ""}${score} (depth ${info.depth})`;
      } else if (line1.scoreMate !== null) {
        evalDisplay.textContent = `Mate in ${Math.abs(line1.scoreMate)} (depth ${info.depth})`;
      }
      updateEvalBar(line1.scoreCp, line1.scoreMate);
    }

    lineDisplay.innerHTML = "";
    for (const line of info.lines) {
      const div = document.createElement("div");
      div.className = "pv-line";

      const scoreSpan = document.createElement("span");
      scoreSpan.className = "pv-score";
      if (line.scoreMate !== null) {
        scoreSpan.textContent = `M${Math.abs(line.scoreMate)}`;
      } else if (line.scoreCp !== null) {
        const s = (line.scoreCp / 100).toFixed(1);
        scoreSpan.textContent = `${line.scoreCp > 0 ? "+" : ""}${s}`;
      }
      div.appendChild(scoreSpan);

      const san = gc.uciToSan(line.pv.slice(0, 6));
      div.appendChild(document.createTextNode(san.join(" ")));

      lineDisplay.appendChild(div);
    }
  }

  // --- Move history rendering (grid) ---
  function renderMoveList(moves: string[]) {
    moveHistory.innerHTML = "";
    const activePly = gc.getCurrentPly();
    // Noctie-style instant grades: tint each played move by its coaching
    // quality so patterns jump out while scrolling.
    const gradeColor: Record<string, string> = {
      brilliant: "#4ade80",
      good: "transparent",
      inaccuracy: "#fbbf24",
      mistake: "#fb923c",
      blunder: "#f87171",
    };
    const paintGrade = (el: HTMLElement, ply: number) => {
      try {
        const quality = gc.getCoachingAtPly(ply)?.quality;
        const color = quality ? gradeColor[quality] : undefined;
        if (color && color !== "transparent") {
          el.style.boxShadow = `inset 3px 0 0 ${color}`;
          el.title = `Coach graded this: ${quality}`;
        }
      } catch {
        // Grades are decorative; the list must always render.
      }
    };
    for (let i = 0; i < moves.length; i += 2) {
      const row = document.createElement("div");
      row.className = "move-row";

      const numEl = document.createElement("span");
      numEl.className = "move-number";
      numEl.textContent = `${Math.floor(i / 2) + 1}.`;
      row.appendChild(numEl);

      // White move
      const whitePly = i + 1;
      const whiteEl = document.createElement("span");
      whiteEl.className = "move";
      if (whitePly === activePly) whiteEl.classList.add("active");
      whiteEl.textContent = moves[i];
      paintGrade(whiteEl, whitePly);
      whiteEl.addEventListener("click", () => gc.jumpToPly(whitePly));
      row.appendChild(whiteEl);

      // Black move (or empty cell)
      if (i + 1 < moves.length) {
        const blackPly = i + 2;
        const blackEl = document.createElement("span");
        blackEl.className = "move";
        if (blackPly === activePly) blackEl.classList.add("active");
        blackEl.textContent = moves[i + 1];
        paintGrade(blackEl, blackPly);
        blackEl.addEventListener("click", () => gc.jumpToPly(blackPly));
        row.appendChild(blackEl);
      } else {
        row.appendChild(document.createElement("span"));
      }

      moveHistory.appendChild(row);
    }
    moveHistory.scrollTop = moveHistory.scrollHeight;

    // Update FEN display
    updateFenDisplay(gc.fen());
  }

  // --- Ply change handler ---
  function onPlyChange(ply: number, maxPly: number) {
    firstBtn.disabled = ply <= 0;
    backBtn.disabled = ply <= 0;
    forwardBtn.disabled = ply >= maxPly;
    lastBtn.disabled = ply >= maxPly;
    plyCounter.textContent = maxPly === 0 ? "Start" : `Move ${ply} / ${maxPly}`;
    const moveSpans = moveHistory.querySelectorAll(".move");
    moveSpans.forEach((span) => {
      const el = span as HTMLElement;
      if (el.dataset.ply === String(ply)) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });

    const activeEl = moveHistory.querySelector(".move.active");
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }

    if (ply < maxPly) {
      viewingIndicator.textContent = `Viewing move ${ply} of ${maxPly}`;
      boardWrap.classList.add("viewing-history");
    } else {
      viewingIndicator.textContent = "";
      boardWrap.classList.remove("viewing-history");
    }

    // Update FEN display
    updateFenDisplay(gc.fen());
  }

  // --- Markdown helper ---
  function makeCopyButton(text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "copy";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "copied";
        setTimeout(() => { btn.textContent = "copy"; }, 1500);
      }).catch(() => {
        btn.textContent = "failed";
        setTimeout(() => { btn.textContent = "copy"; }, 1500);
      });
    });
    return btn;
  }

  function parseSimpleMarkdown(text: string): string {
    // Escape HTML to prevent XSS
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    // Convert **bold** to <strong>, then *italic* to <em>
    return escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }

  function addChatBubble(
    role: "user" | "assistant",
    text: string,
    label?: string,
    speak = role === "assistant",
  ): HTMLDivElement {
    const bubble = document.createElement("div");
    bubble.className = `chat-message ${role}`;
    const roleLabel = document.createElement("div");
    roleLabel.className = "chat-role";
    roleLabel.textContent = label || (role === "user" ? "You" : "Coach");
    bubble.appendChild(roleLabel);
    const body = document.createElement("div");
    body.className = "chat-message-body";
    body.innerHTML = parseSimpleMarkdown(text);
    bubble.appendChild(body);
    if (role === "assistant") bubble.appendChild(makeCopyButton(text));
    coachMessages.appendChild(bubble);
    coachMessages.scrollTop = coachMessages.scrollHeight;
    if (speak) speakCoach(text);
    return bubble;
  }

  function renderChatHistory(history: ChatMessage[]) {
    coachMessages.innerHTML = "";
    for (const entry of history) {
      if (entry.role === "assistant" && entry.text.startsWith("[Codex] ")) {
        addChatBubble(entry.role, entry.text.slice("[Codex] ".length), "Codex", false);
      } else {
        addChatBubble(entry.role, entry.text, undefined, false);
      }
    }
  }

  /** Convert engine UCI plies to SAN for a human-readable facts line. */
  function uciLineToSan(fen: string, pv: string[], maxPlies = 6): string[] {
    const sans: string[] = [];
    try {
      const board = new Chess(fen);
      for (const uci of pv.slice(0, maxPlies)) {
        let move = null;
        try {
          move = board.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined,
          });
        } catch {
          break;
        }
        if (!move) break;
        sans.push(move.san);
      }
    } catch {
      // Leave whatever prefix converted; facts stay best-effort.
    }
    return sans;
  }

  /** One-line authoritative Stockfish summary for grounding a Codex reply. */
  function stockfishFactsText(fen: string, info: EvalInfo): string {
    const side = fen.split(" ")[1] === "b" ? "Black" : "White";
    let score: string;
    if (info.scoreMate !== null && info.scoreMate !== undefined) {
      score = info.scoreMate > 0
        ? `mate in ${info.scoreMate} for ${side}`
        : `${side} is getting mated in ${Math.abs(info.scoreMate)}`;
    } else if (info.scoreCp !== null && info.scoreCp !== undefined) {
      const pawns = (info.scoreCp / 100).toFixed(2);
      score = `${pawns} pawns for ${side}`;
    } else {
      score = "no score";
    }
    const line = uciLineToSan(fen, info.pv).join(" ") || "(no line)";
    return `Depth ${info.depth}, side to move ${side}: ${score}. Best line: ${line}.`;
  }

  /**
   * Pages Codex chat path: ground the student's question with a quick
   * browser-Stockfish eval, then one-shot it to Codex. The thinking bubble
   * doubles as the SSE status target and is replaced by the Codex bubble.
   */
  async function submitCodexChat(
    sessionId: string,
    message: string,
    thinkingBubble: HTMLDivElement,
  ): Promise<void> {
    const fen = gc.viewedFen();
    let moves = "(starting position)";
    try {
      moves = gc.history().join(" ") || "(starting position)";
    } catch {
      // Keep the default; facts stay best-effort.
    }
    let facts: string | null = null;
    let trapText: string | null = null;
    try {
      const multi = await Promise.race([
        engine.evaluateMultiPVAsync(fen, 3, 14),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (multi && multi.length > 0) {
        const sorted = [...multi].sort((a, b) => a.multipv - b.multipv);
        const best = sorted[0];
        facts = stockfishFactsText(fen, {
          depth: 14,
          scoreCp: best.scoreCp,
          scoreMate: best.scoreMate,
          pv: best.pv,
        });
        try {
          const pack = buildLocalTeachableLine(
            fen,
            sorted.map((entry) => ({ pv: entry.pv, scoreCp: entry.scoreCp, scoreMate: entry.scoreMate })),
            14,
            10,
          );
          const bits = (pack.traps || []).slice(0, 2).map((trap) =>
            `${trap.move_san} tempts because ${trap.tempting_because}; refutation ${trap.line.moves.slice(0, 4).map((ply) => ply.san).join(" ")}`
          );
          if (bits.length > 0) trapText = bits.join(" | ");
        } catch {
          trapText = null;
        }
      }
    } catch {
      facts = null;
      trapText = null;
    }
    const prompt = composeCodexChessPrompt({ question: message, fen, moves, engineFacts: facts, traps: trapText });
    const response = await startProviderLogin(
      "codex",
      codexEventHandler(thinkingBubble, {
        onLoginRequired: (verificationUrl: string, userCode: string) =>
          addChatBubble(
            "assistant",
            `ChatGPT login: open ${verificationUrl} and enter code ${userCode}. That page is run by OpenAI — our site never sees your password. I'm waiting…`,
            "Codex login",
            false,
          ),
        onComplete: (text: string) => {
          thinkingBubble.remove();
          addChatBubble("assistant", text, "Codex");
          try {
            rememberCodexExchange(sessionId, text);
          } catch {
            // Display already succeeded; history persistence is best-effort.
          }
        },
      }),
      prompt,
    );
    void response;
  }

  async function submitChat() {
    const message = chatInput.value.trim();
    if (!message || chatSend.disabled) return;
    const sessionId = gc.getSessionId();
    if (!sessionId) {
      addChatBubble("assistant", "The game session is still starting. Try again in a moment.");
      return;
    }

    chatInput.value = "";
    addChatBubble("user", message);
    const thinkingBubble = addChatBubble("assistant", "Thinking about the position…", undefined, false);
    thinkingBubble.classList.add("typing");
    chatSend.disabled = true;
    chatInput.disabled = true;
    // Pages Codex mode: single grounded voice (GPT wording, Stockfish
    // facts). The template coaching bubbles stay off in this mode so the
    // two bots never talk over each other.
    if (GITHUB_PAGES_DEMO && pagesChatMode === "codex") {
      try {
        await submitCodexChat(sessionId, message, thinkingBubble);
      } catch (error) {
        thinkingBubble.remove();
        const detail = error instanceof Error ? error.message : "Chat request failed";
        addChatBubble("assistant", `I couldn't answer: ${detail}`);
      } finally {
        chatSend.disabled = false;
        chatInput.disabled = false;
        chatInput.focus();
      }
      return;
    }
    try {
      const response = await sendChat(
        sessionId,
        message,
        gc.viewedFen(),
        chatModeSelect.value as "fast" | "deep",
      );
      thinkingBubble.remove();
      // Label by actual provider so Codex answers are never mistaken for
      // Free Weak AI (or vice versa) on any host.
      const answerProvider = response.provider?.provider;
      addChatBubble(
        "assistant",
        studentFacingProviderText(response.message),
        answerProvider === "codex"
          ? "Codex"
          : answerProvider === "claude"
            ? "Claude"
            : response.source === "ai"
              ? "Free Weak AI"
              : response.source === "local"
                ? "Free local coach"
                : "Coach",
      );
    } catch (error) {
      thinkingBubble.remove();
      const detail = studentFacingProviderText(error instanceof Error ? error.message : "Chat request failed");
      addChatBubble("assistant", `I couldn't answer: ${detail}`);
    } finally {
      chatSend.disabled = false;
      chatInput.disabled = false;
      chatInput.focus();
    }
  }

  chatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitChat();
  });
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitChat();
    }
  });
  chatModeSelect.addEventListener("change", () => {
    localStorage.setItem("chess-teacher-response-mode", chatModeSelect.value);
  });

  // --- Coaching display ---
  // --- Memory: the coach remembers YOUR habits, not just this move ---
  // Counts tactical themes in your mistakes per calendar day (local only).
  // On the 3rd repeat of a theme, the coach names the pattern instead of
  // the move — that is the difference between a tool and a coach.
  const MOTIF_KEY = "chess-teacher-motif-counts";
  const MOTIF_WORDS: Array<{ motif: string; words: string[]; label: string }> = [
    { motif: "fork", words: ["fork"], label: "forks" },
    { motif: "hanging", words: ["hanging"], label: "hung pieces" },
    { motif: "pin", words: ["pinned", "pin"], label: "pins" },
    { motif: "skewer", words: ["skewer"], label: "skewers" },
  ];

  function loadMotifCounts(): { date: string; counts: Record<string, number> } {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const raw = localStorage.getItem(MOTIF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { date?: string; counts?: Record<string, number> };
        if (parsed.date === today && parsed.counts) return { date: today, counts: parsed.counts };
      }
    } catch {
      // Start fresh on corrupt data.
    }
    return { date: today, counts: {} };
  }

  function noteMistakeMotifs(summary: string): string | null {
    const text = (summary || "").toLowerCase();
    if (!text) return null;
    const store = loadMotifCounts();
    let repeated: string | null = null;
    for (const { motif, words, label } of MOTIF_WORDS) {
      if (words.some((word) => text.includes(word))) {
        const count = (store.counts[motif] || 0) + 1;
        store.counts[motif] = count;
        if (count >= 3 && !repeated) {
          repeated = `That's the ${count === 3 ? "third" : `${count}th`} time today — ${label}. Pattern, not accident. Let's fix the habit, not the move.`;
        }
      }
    }
    try {
      localStorage.setItem(MOTIF_KEY, JSON.stringify(store));
    } catch {
      // Counts are nice-to-have; coaching must never break.
    }
    return repeated;
  }

  function showCoaching(coaching: CoachingData) {
    const debugEnabled = localStorage.getItem("chess-teacher-debug") === "true";

    // Debug: log the grounded prompt to console
    if (coaching.debug_prompt && debugEnabled) {
      console.group(`%c[Coach Prompt] ply ${gc.getCurrentPly()}`, "color: #4ade80; font-weight: bold");
      console.log(coaching.debug_prompt);
      console.groupEnd();
    }

    // Collapsible debug bubble showing the prompt sent to LLM
    if (coaching.debug_prompt && debugEnabled) {
      const debugBubble = document.createElement("details");
      debugBubble.className = "coach-debug";
      const summary = document.createElement("summary");
      summary.textContent = "LLM prompt";
      debugBubble.appendChild(summary);
      debugBubble.appendChild(makeCopyButton(coaching.debug_prompt!));
      const pre = document.createElement("pre");
      pre.textContent = coaching.debug_prompt;
      debugBubble.appendChild(pre);
      coachMessages.appendChild(debugBubble);
    }

    const msg = document.createElement("div");
    msg.className = `coach-message ${coaching.quality}`;
    msg.innerHTML = parseSimpleMarkdown(coaching.message);
    const sourceTag = document.createElement("span");
    sourceTag.className = "coach-source";
    sourceTag.textContent = coaching.source === "ai+stockfish"
      ? "AI explanation · Stockfish facts"
      : coaching.source === "local-ai+stockfish"
        ? "Free local coach · Stockfish facts"
        : "Stockfish facts · local analysis";
    msg.prepend(sourceTag);
    msg.dataset.ply = String(gc.getCurrentPly());
    msg.addEventListener("click", () => {
      const ply = parseInt(msg.dataset.ply!, 10);
      gc.jumpToPly(ply);
    });
    msg.appendChild(makeCopyButton(coaching.message));
    coachMessages.appendChild(msg);
    coachMessages.scrollTop = coachMessages.scrollHeight;
    speakCoach(coaching.message);

    // Memory callback: on repeated personal themes, name the pattern.
    if (coaching.quality === "mistake" || coaching.quality === "blunder") {
      try {
        const memory = noteMistakeMotifs(coaching.tactics_summary || "");
        if (memory) {
          const memoryBubble = addChatBubble("assistant", memory, coachDisplayName(), false);
          memoryBubble.classList.add("coach-memory");
          speakCoach(memory);
        }
      } catch {
        // Memory is decorative; coaching must never break.
      }
    }

    // Show eval bar when coaching fires
    evalBarWrap.classList.add("visible");
  }

  // --- Game status ---
  function showStatus(status: string, result: string | null) {
    if (status === "checkmate") {
      const winner = result === "1-0" ? "White" : "Black";
      statusDisplay.textContent = `Checkmate \u2014 ${winner} wins`;
    } else if (status === "stalemate") {
      statusDisplay.textContent = "Stalemate \u2014 Draw";
    } else if (status === "draw") {
      statusDisplay.textContent = "Draw";
    }
    statusDisplay.style.color = "#f87171";
  }

  // --- New game reset ---
  function resetUI() {
    exitExplorer();
    gc.newGame().then(() => {
      const sessionId = gc.getSessionId();
      if (sessionId) localStorage.setItem("chess-teacher-session-id", sessionId);
      statusDisplay.textContent = "";
      statusDisplay.style.color = "#4ade80";
      evalDisplay.textContent = "Eval: \u2014";
      lineDisplay.innerHTML = "";
      lineDisplay.textContent = "Lines: \u2014";
      coachMessages.innerHTML = "";
      viewingIndicator.textContent = "";
      updateEvalBar(null, null);
      setEvalBarEnabled(evalToggle.checked);

      // Update FEN display
      updateFenDisplay(gc.fen());
    });
  }

  // --- Initialize ---
  const staticDemo = window.location.hostname.endsWith(".github.io") ||
    window.location.search.includes("demo=1");
  const engine = new BrowserEngine();
  // The public demo shares one serialized worker for continuous analysis and
  // the explicit AI move. Browser WASM builds can fail when multiple
  // Stockfish workers search concurrently; BrowserEngine queues hand-offs.
  const aiMoveEngine = staticDemo ? engine : null;

  const board = createBoard(boardWrap, (orig, dest) => {
    playMoveSound("player");
    gc.handleMove(orig, dest);
  });

  const gc = new GameController(board, engine, aiMoveEngine);

  gc.setMoveListCallback(renderMoveList);
  gc.setMultiPVCallback(updateMultiEval);
  gc.setPromotionCallback((_orig, dest) => {
    const isWhite = dest[1] === "8";
    return showPromotionChooser(isWhite);
  });
  gc.setStatusCallback(showStatus);
  gc.setCoachingCallback((coaching) => {
    // The coach notices interesting moments in every mode (offers are just
    // a quiet bubble, never a popup).
    try {
      maybeOfferIdea(coaching);
    } catch {
      // Offers are decorative; coaching must never break.
    }
    // Repaint move grades now that this ply has one (only when watching
    // live, so we never yank a scrolled-back history view).
    try {
      if (gc.isAtLatest()) renderMoveList(gc.history());
    } catch {
      // Grades are decorative; coaching must never break.
    }
    // Codex mode on Pages is single-voice: board arrows/highlights still
    // draw (game.ts), but the template text bubble stays off so it never
    // talks over the Codex reply.
    if (GITHUB_PAGES_DEMO && pagesChatMode === "codex") return;
    showCoaching(coaching);
  });
  gc.setPlyChangeCallback(onPlyChange);
  gc.setOpponentMoveCallback((san, method, reason) => {
    if (!san) return;
    playMoveSound("ai");
    if (method === "llm") {
      agentStatus.textContent = `AI played ${san} · Stockfish was analysis-only`;
      agentStatus.className = "opponent-agent-status ai-active";
      addChatBubble(
        "assistant",
        `I played **${san}**. ${reason || "It fits the opponent style and keeps the position challenging."}`,
        "AI opponent",
      );
    } else if (method === "local-engine" || method === "local") {
      agentStatus.textContent = `Local engine-backed player played ${san} · Stockfish selected it`;
      agentStatus.className = "opponent-agent-status ai-active";
      addChatBubble(
        "assistant",
        `The local engine-backed player played **${san}**. ${reason || "Stockfish selected a legal move for this practice level."}`,
        "Local engine player",
      );
    } else {
      agentStatus.textContent = "Unexpected engine move refused — no AI move was accepted";
      agentStatus.className = "opponent-agent-status ai-refused";
      addChatBubble(
        "assistant",
        "I refused an engine-only move. Stockfish is analysis-only; connect or select an AI player and try again.",
        "AI move refused",
      );
    }
  });

  function updateAiMoveButton(state: { awaiting: boolean; thinking: boolean; error?: string | null }) {
    const buttons = [aiMoveBtn, chatAiMoveBtn];
    if (state.thinking) {
      for (const button of buttons) {
        button.disabled = true;
        button.textContent = "AI thinking…";
      }
      chatMoveHint.textContent = "The AI is calculating a teaching move…";
      statusDisplay.textContent = "AI is thinking…";
      statusDisplay.classList.add("thinking");
      return;
    }
    statusDisplay.classList.remove("thinking");
    if (state.awaiting) {
      for (const button of buttons) {
        button.disabled = false;
        button.textContent = "▶ Play AI move";
      }
      chatMoveHint.textContent = "Your move is reviewed. Let the AI play its reply.";
        statusDisplay.textContent = state.error
        ? `AI did not move: ${studentFacingProviderText(state.error)}`
        : "Your move is reviewed. The AI is ready to play.";
      if (state.error) {
        addChatBubble(
          "assistant",
          `No opponent move was made. ${studentFacingProviderText(state.error)} Stockfish remains analysis-only. Try **Make AI move** again or choose another AI provider.`,
          "AI unavailable",
        );
      }
    } else {
      for (const button of buttons) {
        button.disabled = true;
        button.textContent = "Your turn";
      }
      chatMoveHint.textContent = "After your move, the AI waits here.";
      if (!state.error) statusDisplay.textContent = "Your turn";
    }
  }

  gc.setAiTurnCallback(updateAiMoveButton);
  aiMoveBtn.addEventListener("click", () => {
    void gc.requestAiMove();
  });
  chatAiMoveBtn.addEventListener("click", () => {
    void gc.requestAiMove();
  });
  updateAiMoveButton({ awaiting: false, thinking: false });

  firstBtn.addEventListener("click", () => gc.jumpToPly(0));
  backBtn.addEventListener("click", () => gc.stepBack());
  forwardBtn.addEventListener("click", () => gc.stepForward());
  lastBtn.addEventListener("click", () => gc.jumpToPly(gc.getMaxPly()));
  onPlyChange(0, 0);

  // Initialize coach from localStorage before creating session
  gc.setCoachName(savedCoach);
  gc.setOpponentRating(opponentRating);

  // Resume the current local session across a browser refresh. The server
  // keeps it in memory, so a full server restart intentionally starts fresh.
  const savedSessionId = localStorage.getItem("chess-teacher-session-id");
  void (async () => {
    const restored = savedSessionId ? await gc.restoreGame(savedSessionId) : null;
    if (restored) {
      setRatingControl(restored.opponent_rating ?? 1200);
      personaSelect.value = restored.coach_name;
      renderChatHistory(restored.chat_history);
      localStorage.setItem("chess-teacher-session-id", restored.session_id);
    } else {
      await gc.newGame();
      const sessionId = gc.getSessionId();
      if (sessionId) localStorage.setItem("chess-teacher-session-id", sessionId);
      // First-run greeting: an empty room feels dead. The coach introduces
      // itself once (never speaks uninvited — voice only if already on).
      if (!localStorage.getItem("chess-teacher-greeted")) {
        localStorage.setItem("chess-teacher-greeted", "true");
        const hello =
          `Hey — ${coachDisplayName()} here. Play your move and I'll coach it live. ` +
          `Ask me anything, hit “Show me the idea” for a guided line, or press Talk and just speak.`;
        addChatBubble("assistant", hello, coachDisplayName(), false);
        // Layout may still be settling (board/WASM sizing); scroll twice so
        // the greeting is actually visible, not cut off above the fold.
        requestAnimationFrame(() => {
          coachMessages.scrollTop = coachMessages.scrollHeight;
        });
        setTimeout(() => {
          coachMessages.scrollTop = coachMessages.scrollHeight;
        }, 900);
        if (voiceOutputEnabled) speakText(hello, true);
      }
    }
  })();

  requestAnimationFrame(() => updateBoardColors());

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        if (explorer) goExplorerPly(explorer.cursor - 1, true);
        else gc.stepBack();
        break;
      case "ArrowRight":
        e.preventDefault();
        if (explorer) goExplorerPly(explorer.cursor + 1, true);
        else gc.stepForward();
        break;
      case "Escape":
        if (explorer) {
          e.preventDefault();
          exitExplorer();
        }
        break;
      case "ArrowUp":
      case "Home":
        e.preventDefault();
        gc.jumpToPly(0);
        break;
      case "ArrowDown":
      case "End":
        e.preventDefault();
        gc.jumpToPly(gc.getMaxPly());
        break;
      case "n":
        e.preventDefault();
        resetUI();
        break;
    }
  });

  // New game button
  newGameBtn.addEventListener("click", () => {
    resetUI();
  });

  // Opponent rating select
  ratingSelect.addEventListener("change", () => {
    if (ratingSelect.value === "custom") {
      customRatingInput.hidden = false;
      customRatingInput.focus();
      return;
    }
    setRatingControl(Number(ratingSelect.value));
    localStorage.setItem("chess-teacher-opponent-rating", String(opponentRating));
    gc.setOpponentRating(opponentRating);
    gc.setEloProfile(profileForRating(opponentRating));
    resetUI();
  });

  customRatingInput.addEventListener("change", () => {
    const parsed = Number(customRatingInput.value);
    if (!Number.isFinite(parsed)) {
      setRatingControl(opponentRating);
      return;
    }
    setRatingControl(parsed);
    localStorage.setItem("chess-teacher-opponent-rating", String(opponentRating));
    gc.setOpponentRating(opponentRating);
    gc.setEloProfile(profileForRating(opponentRating));
    resetUI();
  });

  // AI persona lives beside the conversation because it affects both coaching
  // language and the opponent's teaching choices.
  personaSelect.addEventListener("change", () => {
    gc.setCoachName(personaSelect.value);
    localStorage.setItem("chess-teacher-coach", personaSelect.value);
    coachNameEl.textContent = coachDisplayName();
    resetUI();
  });

  // Menu: FEN input
  menuFenInput.addEventListener("change", () => {
    const fen = menuFenInput.value.trim();
    if (fen) {
      const valid = gc.setPosition(fen);
      if (!valid) {
        menuFenInput.style.borderColor = "#f87171";
        setTimeout(() => { menuFenInput.style.borderColor = "#333"; }, 1500);
      } else {
        hamburgerMenu.classList.remove("open");
      }
    }
  });

  // Initialize browser engine
  const stockfishPath = staticDemo
    ? "./vendor/stockfish/stockfish.js"
    : "/static/vendor/stockfish/stockfish.js";

  engine
    .init(stockfishPath)
    .then(() => {
      console.info("Browser Stockfish ready");
      engine.evaluateMultiPV(gc.fen(), updateMultiEval);
    })
    .catch((err) => {
      console.warn("Browser Stockfish unavailable:", err);
      evalDisplay.textContent = "Eval: (engine unavailable)";
    });

  // Remote engine worker for server-dispatched analysis
  if (!staticDemo) {
    const remoteEngine = new BrowserEngine();
    remoteEngine.init(stockfishPath).then(() => {
      const remote = new RemoteUCI(remoteEngine);
      remote.connect();
      console.log("[RemoteUCI] Remote engine worker initialized");
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
