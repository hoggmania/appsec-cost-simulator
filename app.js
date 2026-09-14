import { calculate, defaults } from "./calculator.js";

const ids = Object.keys(defaults);
const inputs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", notation: "compact", maximumFractionDigits: 1 });
const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

function readAssumptions() {
  return Object.fromEntries(ids.map((id) => {
    const el = inputs[id];
    return [id, el.type === "hidden" ? el.value : Number(el.value) || 0];
  }));
}

function render() {
  const result = calculate(readAssumptions());
  const winnerSaving = result.runnerUp.total - result.winner.total;
  setText("winnerName", result.winner.name);
  setText("winnerCost", `${formatter.format(result.winner.total)} / year`);
  setText("winnerDelta", `${formatter.format(Math.max(0, winnerSaving))} below the next-best option`);
  setText("annualSaving", formatter.format(Math.max(0, winnerSaving)));
  setText("savingAgainst", `vs. ${result.runnerUp.name}`);
  setText("hoursRecovered", `${numberFormatter.format(Math.max(0, result.recoveredHours))} hrs`);
  setText("annualBuilds", numberFormatter.format(result.annualBuilds));
  setText("paybackPeriod", Number.isFinite(result.paybackMonths) ? `${result.paybackMonths.toFixed(1)} mo` : "No payback");
  setText("currentSuppressionLabel", `Current: ${Math.round(result.currentSuppression)}%`);

  renderStrategyCards(result);
  renderCostChart(result);
  renderBreakEven(result);
  renderSensitivity(result);
  window.currentResult = result;
}

function renderStrategyCards(result) {
  const order = ["traditional", "llm", "hybrid"];
  const ranked = Object.fromEntries(result.strategies.map((strategy, index) => [strategy.id, index + 1]));
  const cards = order.map((id) => result.strategies.find((strategy) => strategy.id === id));
  document.getElementById("strategyCards").innerHTML = cards.map((strategy) => {
    const delta = strategy.total - result.winner.total;
    return `
      <article class="strategy-card ${strategy.id === result.winner.id ? "winner" : ""}">
        <div class="rank">0${ranked[strategy.id]}</div>
        <div class="strategy-name">${strategy.name}</div>
        <strong>${compactFormatter.format(strategy.total)}</strong>
        <span class="strategy-delta">${delta <= 1 ? "Lowest cost" : `+${compactFormatter.format(delta)} vs. lowest`}</span>
        <div class="strategy-hours">
          <span><b>${numberFormatter.format(strategy.reviewHours)}</b> review hrs</span>
          <span><b>${numberFormatter.format(strategy.delayHours)}</b> CI-delay hrs</span>
        </div>
      </article>`;
  }).join("");
}

function renderCostChart(result) {
  const max = Math.max(...result.strategies.map((strategy) => strategy.total), 1);
  const order = ["traditional", "llm", "hybrid"];
  const strategies = order.map((id) => result.strategies.find((strategy) => strategy.id === id));
  document.getElementById("costChart").innerHTML = strategies.map((strategy) => {
    const direct = strategy.direct / max * 100;
    const delay = strategy.delay / max * 100;
    const review = strategy.review / max * 100;
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${strategy.name}</span><b>${compactFormatter.format(strategy.total)}</b></div>
        <div class="bar-track" aria-label="${strategy.name}: direct ${formatter.format(strategy.direct)}, delay ${formatter.format(strategy.delay)}, review ${formatter.format(strategy.review)}">
          <span class="bar-segment direct" style="width:${direct}%" title="Direct spend: ${formatter.format(strategy.direct)}"></span>
          <span class="bar-segment delay" style="width:${delay}%" title="CI delay: ${formatter.format(strategy.delay)}"></span>
          <span class="bar-segment review" style="width:${review}%" title="Human review: ${formatter.format(strategy.review)}"></span>
        </div>
        <div class="bar-values">
          <span>${compactFormatter.format(strategy.direct)} direct</span>
          <span>${compactFormatter.format(strategy.delay)} delay</span>
          <span>${compactFormatter.format(strategy.review)} review</span>
        </div>
      </div>`;
  }).join("");
}

function renderBreakEven(result) {
  const currentCost = result.llmPerScan;
  const breakEven = result.llmBreakEvenPerScan;
  if (Number.isFinite(breakEven) && breakEven >= 0) {
    setText("llmBreakEven", `${formatter.format(breakEven)} / scan`);
    const difference = currentCost - breakEven;
    setText("llmBreakEvenCopy", difference > 0
      ? `Current modelled price is ${formatter.format(difference)} too high per build to beat the hybrid.`
      : `Current modelled price is ${formatter.format(Math.abs(difference))} below parity with the hybrid.`);
  } else if (Number.isFinite(breakEven)) {
    setText("llmBreakEven", "Below £0 / scan");
    setText("llmBreakEvenCopy", "Even zero-cost LLM scans would not offset the modelled CI delay and review burden.");
  } else {
    setText("llmBreakEven", "Not available");
    setText("llmBreakEvenCopy", "Enter a non-zero build frequency to calculate this threshold.");
  }

  const suppression = result.suppressionBreakEven;
  if (Number.isFinite(suppression)) {
    setText("suppressionBreakEven", `${Math.max(0, suppression).toFixed(1)}% efficacy`);
    setText("suppressionBreakEvenCopy", suppression <= 100
      ? `Above this point, AI-triage savings exceed its annual run cost versus traditional SAST.`
      : `Triage cost is too high to break even within 100% suppression under these assumptions.`);
  } else {
    setText("suppressionBreakEven", "Not available");
    setText("suppressionBreakEvenCopy", "Add false positives and review cost to calculate this threshold.");
  }
}

function renderSensitivity(result) {
  const traditional = result.strategies.find((strategy) => strategy.id === "traditional");
  const llm = result.strategies.find((strategy) => strategy.id === "llm");
  const allValues = [...result.sensitivity.map((point) => point.total), traditional.total, llm.total];
  const min = Math.min(...allValues) * 0.9;
  const max = Math.max(...allValues) * 1.08;
  const width = 760;
  const height = 280;
  const margin = { top: 24, right: 28, bottom: 42, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = (efficacy) => margin.left + efficacy / 100 * innerWidth;
  const y = (value) => margin.top + (max - value) / (max - min || 1) * innerHeight;
  const path = result.sensitivity.map((point, index) => `${index ? "L" : "M"}${x(point.efficacy)},${y(point.total)}`).join(" ");
  const currentTotal = interpolateSensitivity(result.sensitivity, result.currentSuppression);

  const grid = [0, 0.5, 1].map((step) => {
    const value = min + (max - min) * (1 - step);
    const py = margin.top + step * innerHeight;
    return `<line x1="${margin.left}" x2="${width - margin.right}" y1="${py}" y2="${py}" class="grid-line"/><text x="${margin.left - 12}" y="${py + 4}" text-anchor="end">${compactFormatter.format(value)}</text>`;
  }).join("");
  const xLabels = [0, 25, 50, 75, 100].map((value) => `<text x="${x(value)}" y="${height - 12}" text-anchor="middle">${value}%</text>`).join("");
  const referenceLine = (value, className, label, offset) => `
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}" class="reference-line ${className}"/>
    <text x="${width - margin.right}" y="${y(value) + offset}" text-anchor="end" class="reference-label ${className}">${label} ${compactFormatter.format(value)}</text>`;
  const markerX = x(result.currentSuppression);
  const markerY = y(currentTotal);

  document.getElementById("sensitivityChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="presentation">
      ${grid}
      ${xLabels}
      ${referenceLine(traditional.total, "traditional", "Traditional", -7)}
      ${referenceLine(llm.total, "llm", "LLM", 15)}
      <path d="${path}" class="sensitivity-area"/>
      <path d="${path}" class="sensitivity-line"/>
      <line x1="${markerX}" x2="${markerX}" y1="${margin.top}" y2="${height - margin.bottom}" class="current-line"/>
      <circle cx="${markerX}" cy="${markerY}" r="6" class="current-dot"/>
      <g class="current-bubble" transform="translate(${Math.min(width - 128, Math.max(72, markerX))},${Math.max(18, markerY - 20)})">
        <rect x="-52" y="-15" width="104" height="26" rx="13"/>
        <text text-anchor="middle" y="3">${compactFormatter.format(currentTotal)}</text>
      </g>
    </svg>`;
}

function interpolateSensitivity(points, efficacy) {
  const clamped = Math.min(100, Math.max(0, efficacy));
  const lowerIndex = Math.min(points.length - 2, Math.floor(clamped / 10));
  const lower = points[lowerIndex];
  const upper = points[lowerIndex + 1];
  const ratio = (clamped - lower.efficacy) / (upper.efficacy - lower.efficacy || 1);
  return lower.total + (upper.total - lower.total) * ratio;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function reset() {
  ids.forEach((id) => {
    inputs[id].value = defaults[id];
  });
  setMode(defaults.llmCostMode);
  render();
}

function setMode(mode) {
  inputs.llmCostMode.value = mode;
  document.querySelectorAll(".segment").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  document.querySelectorAll(".mode-panel").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== mode));
  render();
}

function buildSummary(result) {
  const lines = [
    "AppSec cost comparison — annualised",
    "",
    ...result.strategies.map((strategy, index) => `${index + 1}. ${strategy.name}: ${formatter.format(strategy.total)} (${numberFormatter.format(strategy.reviewHours)} review hours)`),
    "",
    `Lowest cost: ${result.winner.name}`,
    `Saving vs next-best: ${formatter.format(result.runnerUp.total - result.winner.total)}`,
    `Hybrid recovered review time vs traditional: ${numberFormatter.format(result.recoveredHours)} hours`,
    `LLM per-scan break-even vs hybrid: ${Number.isFinite(result.llmBreakEvenPerScan) ? formatter.format(result.llmBreakEvenPerScan) : "N/A"}`,
    `Suppression efficacy break-even: ${Number.isFinite(result.suppressionBreakEven) ? result.suppressionBreakEven.toFixed(1) + "%" : "N/A"}`,
  ];
  return lines.join("\n");
}

document.querySelectorAll("input[type=number]").forEach((input) => input.addEventListener("input", render));
document.querySelectorAll(".segment").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
document.getElementById("resetButton").addEventListener("click", reset);
document.getElementById("copySummaryButton").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildSummary(window.currentResult));
    const toast = document.getElementById("toast");
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 1800);
  } catch {
    document.getElementById("copySummaryButton").textContent = "Copy unavailable";
  }
});

document.querySelectorAll(".info").forEach((button) => {
  button.addEventListener("click", () => {
    const open = button.classList.toggle("open");
    button.setAttribute("aria-label", open ? button.dataset.tip : "More information");
  });
});

render();
