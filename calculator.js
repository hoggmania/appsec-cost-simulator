export const defaults = {
  codebaseKloc: 500,
  buildsPerDay: 80,
  workingDays: 250,
  developersPerBuild: 1,
  sastLicence: 150000,
  sastPerScan: 1.5,
  sastMinutes: 4,
  llmMinutes: 14,
  developerHourlyCost: 90,
  criticalPathPercent: 35,
  llmCostMode: "tokens",
  tokensPerKloc: 7000,
  tokenPricePerMillion: 8,
  llmFixedPerScan: 28,
  falsePositivesPerBuild: 6,
  reviewMinutesPerFp: 12,
  llmFpReduction: 45,
  suppressionEfficacy: 85,
  triageRunsPerWeek: 1,
  triageCostPerRun: 120,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function calculate(raw) {
  const a = { ...defaults, ...raw };
  const annualBuilds = Math.max(0, a.buildsPerDay) * Math.max(0, a.workingDays);
  const delayMultiplier = Math.max(0, a.developersPerBuild) * clamp(a.criticalPathPercent, 0, 100) / 100;
  const baselineFpHours = annualBuilds * Math.max(0, a.falsePositivesPerBuild) * Math.max(0, a.reviewMinutesPerFp) / 60;
  const sastDirect = Math.max(0, a.sastLicence) + annualBuilds * Math.max(0, a.sastPerScan);
  const sastDelayHours = annualBuilds * Math.max(0, a.sastMinutes) / 60 * delayMultiplier;
  const sastDelay = sastDelayHours * Math.max(0, a.developerHourlyCost);
  const sastReview = baselineFpHours * Math.max(0, a.developerHourlyCost);

  const llmPerScan = a.llmCostMode === "fixed"
    ? Math.max(0, a.llmFixedPerScan)
    : Math.max(0, a.codebaseKloc) * Math.max(0, a.tokensPerKloc) / 1_000_000 * Math.max(0, a.tokenPricePerMillion);
  const llmDirect = annualBuilds * llmPerScan;
  const llmDelayHours = annualBuilds * Math.max(0, a.llmMinutes) / 60 * delayMultiplier;
  const llmDelay = llmDelayHours * Math.max(0, a.developerHourlyCost);
  const llmFpFactor = 1 - clamp(a.llmFpReduction, 0, 100) / 100;
  const llmReviewHours = baselineFpHours * llmFpFactor;
  const llmReview = llmReviewHours * Math.max(0, a.developerHourlyCost);

  const annualTriageRuns = Math.max(0.1, a.triageRunsPerWeek) * 52;
  const buildsPerTriage = annualBuilds > 0 ? Math.max(1, annualBuilds / annualTriageRuns) : 1;
  const reusableShare = clamp(a.suppressionEfficacy, 0, 100) / 100;
  const hybridFpFactor = 1 - reusableShare * (1 - 1 / buildsPerTriage);
  const hybridReviewHours = baselineFpHours * hybridFpFactor;
  const hybridTriageSpend = annualTriageRuns * Math.max(0, a.triageCostPerRun);
  const hybridDirect = sastDirect + hybridTriageSpend;
  const hybridDelay = sastDelay;
  const hybridReview = hybridReviewHours * Math.max(0, a.developerHourlyCost);

  const strategies = [
    makeStrategy("traditional", "Traditional SAST", sastDirect, sastDelay, sastReview, baselineFpHours, sastDelayHours),
    makeStrategy("llm", "LLM in every CI build", llmDirect, llmDelay, llmReview, llmReviewHours, llmDelayHours),
    makeStrategy("hybrid", "SAST + weekly AI triage", hybridDirect, hybridDelay, hybridReview, hybridReviewHours, sastDelayHours),
  ].sort((x, y) => x.total - y.total);

  const winner = strategies[0];
  const runnerUp = strategies[1];
  const traditional = strategies.find((x) => x.id === "traditional");
  const llm = strategies.find((x) => x.id === "llm");
  const hybrid = strategies.find((x) => x.id === "hybrid");
  const recoveredHours = traditional.reviewHours - hybrid.reviewHours;
  const annualHybridSavingsVsTraditional = traditional.total - hybrid.total;
  const monthlyGrossReviewSaving = Math.max(0, (sastReview - hybridReview) / 12);
  const paybackMonths = monthlyGrossReviewSaving > 0 ? hybridTriageSpend / monthlyGrossReviewSaving : Infinity;

  const llmNonDirect = llmDelay + llmReview;
  const llmBreakEvenPerScan = annualBuilds > 0 ? (hybrid.total - llmNonDirect) / annualBuilds : Infinity;
  const suppressionDenominator = sastReview * (1 - 1 / buildsPerTriage);
  const suppressionBreakEven = suppressionDenominator > 0
    ? hybridTriageSpend / suppressionDenominator * 100
    : Infinity;

  const sensitivity = [];
  for (let efficacy = 0; efficacy <= 100; efficacy += 10) {
    const factor = 1 - efficacy / 100 * (1 - 1 / buildsPerTriage);
    sensitivity.push({ efficacy, total: hybridDirect + hybridDelay + baselineFpHours * factor * a.developerHourlyCost });
  }

  return {
    annualBuilds,
    annualTriageRuns,
    buildsPerTriage,
    llmPerScan,
    strategies,
    winner,
    runnerUp,
    recoveredHours,
    annualHybridSavingsVsTraditional,
    paybackMonths,
    llmBreakEvenPerScan,
    suppressionBreakEven,
    sensitivity,
    currentSuppression: clamp(a.suppressionEfficacy, 0, 100),
  };
}

function makeStrategy(id, name, direct, delay, review, reviewHours, delayHours) {
  return {
    id,
    name,
    direct,
    delay,
    review,
    reviewHours,
    delayHours,
    total: direct + delay + review,
  };
}
