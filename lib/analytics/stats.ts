/**
 * The statistics the insight suite is built out of, as pure functions.
 *
 * Nothing here knows about training. It exists because every insight in
 * `lib/analytics/` has to ship an n and an interval, and an interval computed
 * three slightly different ways in three modules is three chances to be wrong in
 * only one of them.
 *
 * The methods are chosen for the shape of the data rather than for fashion. One
 * athlete, series that are autocorrelated and short, and confounds everywhere:
 * that rules out anything that needs a held-out fold of thousands of rows, and
 * leaves ordinary and robust regression, correlation with a stated interval,
 * logistic regression on a handful of weeks, and shrinkage toward a prior. Every
 * estimator here therefore reports its own uncertainty, and every one of them
 * returns `null` rather than a number when there is not enough data, because a
 * point estimate with no n behind it is the thing this whole layer exists to
 * avoid producing.
 *
 * Two conventions hold throughout:
 *
 * - **A two-sided p is always the p for "the effect is zero".** Insights that care
 *   about a different null say so themselves by checking their interval.
 * - **Intervals are 95 percent** unless a caller passes something else, and they
 *   are the interval of the *estimate*, not a prediction interval for the next
 *   observation.
 */

export type Point = { x: number; y: number };

// -----------------------------------------------------------------------------
// Descriptives
// -----------------------------------------------------------------------------

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation, n-1. Zero for a single value rather than NaN. */
export function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Linear-interpolated quantile, `p` in 0 to 1. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/**
 * Z scores against the series' own mean and spread.
 *
 * All zeros when the series does not vary, which is the right answer: a reading
 * that is always the same carries no information about any particular day, and
 * dividing by a zero spread would turn that into `Infinity` and poison whatever
 * index it fed.
 */
export function zScores(values: readonly number[]): number[] {
  const m = mean(values);
  const sd = sampleSd(values);
  if (sd === 0) return values.map(() => 0);
  return values.map((value) => (value - m) / sd);
}

// -----------------------------------------------------------------------------
// Distributions
// -----------------------------------------------------------------------------

/** Lanczos log-gamma, good to about 15 digits over the range used here. */
function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}

/**
 * The regularized incomplete beta function, by the modified Lentz continued
 * fraction. It is here only because Student's t tail needs it, and a t tail read
 * off a table would cap every p value at the coarsest row of the table.
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front =
    Math.exp(
      logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
    ) / a;

  // Converges quickly for x < (a+1)/(a+b+2); the symmetry handles the rest.
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  // The recurrence starts at i = 0 with a numerator of 1, and `f` therefore carries a
  // leading 1 that `front * (f - 1)` takes back off at the end. Both of those go with
  // the `front / a` above and with these numerators; the other common form of this
  // function divides differently and returns the fraction as it stands. Mixing the two
  // does not fail loudly - it returns plausible-looking numbers, and negative p values
  // for a t statistic near the 95% threshold.
  const tiny = 1e-30;
  let f = 1;
  let c = 1;
  let d = 0;

  for (let i = 0; i <= 300; i += 1) {
    const m = Math.floor(i / 2);
    const numerator =
      i === 0
        ? 1
        : i % 2 === 0
          ? (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
          : -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));

    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return front * (f - 1);
}

/** Two-sided p for a t statistic. 1 when `df` is too small to say anything. */
export function studentTP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** The critical t for a two-sided interval, found by bisecting its own tail. */
export function tCritical(df: number, confidence = 0.95): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  const target = 1 - confidence;
  let low = 0;
  let high = 1000;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (studentTP(mid, df) > target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Standard normal CDF, Abramowitz and Stegun 7.1.26 on the error function. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/** The z for a two-sided interval. 1.96 at the default. */
export function zCritical(confidence = 0.95): number {
  const target = 1 - (1 - confidence) / 2;
  let low = 0;
  let high = 10;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (normalCdf(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// -----------------------------------------------------------------------------
// Intervals on simple summaries
// -----------------------------------------------------------------------------

export type Estimate = {
  value: number;
  n: number;
  ciLow: number;
  ciHigh: number;
  /** Null when the summary has no meaningful null hypothesis to test. */
  p: number | null;
};

/**
 * The mean with a t interval, and the p for it differing from `nullValue`.
 *
 * `nullValue` defaults to zero because the common use is a *difference* - actual
 * RPE minus target, best attempt minus mean attempt - where zero is the claim
 * worth testing.
 */
export function meanEstimate(
  values: readonly number[],
  options: { confidence?: number; nullValue?: number } = {},
): Estimate | null {
  if (values.length < 2) return null;
  const n = values.length;
  const m = mean(values);
  const se = sampleSd(values) / Math.sqrt(n);
  const half = tCritical(n - 1, options.confidence ?? 0.95) * se;
  const nullValue = options.nullValue ?? 0;
  return {
    value: m,
    n,
    ciLow: m - half,
    ciHigh: m + half,
    // A series with no spread at all is either one repeated reading or a
    // measurement that cannot move; either way it has no standard error and
    // claiming p = 0 from it would be an artefact.
    p: se === 0 ? null : studentTP((m - nullValue) / se, n - 1),
  };
}

/**
 * A proportion with a Wilson score interval.
 *
 * Wilson rather than the normal approximation because these proportions are
 * things like "sessions that actually happened on a Tuesday" over a handful of
 * Tuesdays, where the textbook interval runs off the end of 0 to 1 and reports a
 * negative adherence rate.
 */
export function proportionEstimate(
  successes: number,
  n: number,
  confidence = 0.95,
): Estimate | null {
  if (n <= 0) return null;
  const z = zCritical(confidence);
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return {
    value: p,
    n,
    ciLow: Math.max(0, centre - half),
    ciHigh: Math.min(1, centre + half),
    p: null,
  };
}

// -----------------------------------------------------------------------------
// Regression
// -----------------------------------------------------------------------------

export type LinearFit = {
  slope: number;
  intercept: number;
  n: number;
  /** Standard error of the slope, which is what the interval is built from. */
  slopeSe: number;
  slopeCiLow: number;
  slopeCiHigh: number;
  /** Two-sided p for a zero slope. */
  p: number;
  r2: number;
  /** Residual standard deviation, the scale of what the line does not explain. */
  residualSd: number;
  at: (x: number) => number;
  /**
   * The interval on the *mean response* at an x, which widens away from the centre
   * of the data the way it should.
   *
   * Needed because several insights read a value off the line rather than reading
   * its slope - maintenance calories are the intake at zero weight change - and the
   * slope interval says nothing about how well that particular point is pinned down.
   * A reader given `at(0)` with no interval will treat an extrapolation as a
   * measurement.
   */
  interval: (x: number, confidence?: number) => { low: number; high: number };
};

/**
 * Ordinary least squares through the points, with an interval on the slope.
 *
 * Three or more points with at least two distinct x values, or null. Two points
 * define a line exactly and therefore have no residual and no honest interval,
 * which would make every two-point trend look certain.
 */
export function linearFit(points: readonly Point[], confidence = 0.95): LinearFit | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (usable.length < 3) return null;
  const n = usable.length;
  const meanX = mean(usable.map((point) => point.x));
  const meanY = mean(usable.map((point) => point.y));

  let sxy = 0;
  let sxx = 0;
  for (const point of usable) {
    sxy += (point.x - meanX) * (point.y - meanY);
    sxx += (point.x - meanX) ** 2;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const residuals = usable.map((point) => point.y - (intercept + slope * point.x));
  const sse = residuals.reduce((sum, residual) => sum + residual * residual, 0);
  const sst = usable.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const df = n - 2;
  const residualVariance = sse / df;
  const slopeSe = Math.sqrt(residualVariance / sxx);
  const half = tCritical(df, confidence) * slopeSe;

  return {
    slope,
    intercept,
    n,
    slopeSe,
    slopeCiLow: slope - half,
    slopeCiHigh: slope + half,
    p: slopeSe === 0 ? (slope === 0 ? 1 : 0) : studentTP(slope / slopeSe, df),
    r2: sst === 0 ? 0 : Math.max(0, 1 - sse / sst),
    residualSd: Math.sqrt(residualVariance),
    at: (x: number) => intercept + slope * x,
    interval: (x: number, intervalConfidence = confidence) => {
      const se = Math.sqrt(residualVariance * (1 / n + (x - meanX) ** 2 / sxx));
      const spread = tCritical(df, intervalConfidence) * se;
      const at = intercept + slope * x;
      return { low: at - spread, high: at + spread };
    },
  };
}

/**
 * Theil-Sen: the median of the pairwise slopes.
 *
 * Used where one bad reading would otherwise steer the answer, which for this app
 * is most strength series - a mistyped load or a set logged against the wrong
 * exercise moves an OLS slope a long way and moves this one not at all. The
 * interval is Sen's: ranks into the sorted pairwise slopes set by the variance of
 * Kendall's S, so it narrows as points accumulate the way a slope interval should.
 */
export type RobustFit = {
  slope: number;
  intercept: number;
  n: number;
  slopeCiLow: number;
  slopeCiHigh: number;
  at: (x: number) => number;
};

export function theilSen(points: readonly Point[], confidence = 0.95): RobustFit | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (usable.length < 3) return null;

  const slopes: number[] = [];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const dx = usable[j].x - usable[i].x;
      if (dx === 0) continue;
      slopes.push((usable[j].y - usable[i].y) / dx);
    }
  }
  if (slopes.length === 0) return null;

  const slope = median(slopes);
  const intercept = median(usable.map((point) => point.y - slope * point.x));
  const n = usable.length;
  const sorted = [...slopes].sort((a, b) => a - b);
  const count = sorted.length;
  const reach = zCritical(confidence) * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  return {
    slope,
    intercept,
    n,
    slopeCiLow: sorted[Math.max(0, Math.floor((count - reach) / 2) - 1)],
    slopeCiHigh: sorted[Math.min(count - 1, Math.ceil((count + reach) / 2))],
    at: (x: number) => intercept + slope * x,
  };
}

export type QuadraticFit = {
  a: number;
  b: number;
  c: number;
  n: number;
  r2: number;
  /**
   * The x at the turning point, or null when the curve has no maximum: a
   * non-negative `a` opens upward, so its vertex is a minimum and taking it as an
   * optimum would recommend the worst available height rather than the best.
   */
  vertexX: number | null;
  at: (x: number) => number;
};

/**
 * Least squares on `y = ax² + bx + c`, for the one relationship in the app that
 * is genuinely curved: jump height against drop height, which rises to a peak and
 * then falls away as the landing exceeds what can be absorbed.
 *
 * Four points and three distinct x values minimum. Three points fit a parabola
 * exactly, so its vertex is an interpolation dressed up as a measurement.
 */
export function quadraticFit(points: readonly Point[]): QuadraticFit | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (usable.length < 4) return null;
  if (new Set(usable.map((point) => point.x)).size < 3) return null;

  // Centred on the mean x before solving. The normal equations for a quadratic on
  // raw box heights in centimetres carry an x⁴ term in the thousands of millions,
  // and that is enough conditioning loss to flip the sign of `a`.
  const centre = mean(usable.map((point) => point.x));
  const design = usable.map((point) => {
    const x = point.x - centre;
    return [x * x, x, 1];
  });
  const solved = solveNormalEquations(
    design,
    usable.map((point) => point.y),
  );
  if (!solved) return null;
  const [a, bCentred, cCentred] = solved;

  // Back out of the centred basis so the caller gets coefficients in its own units.
  const b = bCentred - 2 * a * centre;
  const c = cCentred - bCentred * centre + a * centre * centre;
  const at = (x: number) => a * x * x + b * x + c;

  const meanY = mean(usable.map((point) => point.y));
  const sse = usable.reduce((sum, point) => sum + (point.y - at(point.x)) ** 2, 0);
  const sst = usable.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);

  return {
    a,
    b,
    c,
    n: usable.length,
    r2: sst === 0 ? 0 : Math.max(0, 1 - sse / sst),
    vertexX: a < 0 ? -b / (2 * a) : null,
    at,
  };
}

export type RidgeFit = {
  /** One per predictor, intercept first. */
  coefficients: number[];
  n: number;
  /** In-sample r squared, which for a penalised fit is a ceiling rather than a score. */
  r2: number;
  at: (x: readonly number[]) => number;
};

/**
 * Ridge-penalised least squares, intercept added here and left unpenalised.
 *
 * Used where several predictors are wanted from very few observations and the
 * predictors are correlated with each other - WHOOP's HRV, resting heart rate and
 * sleep performance all measure overlapping things, and unpenalised least squares
 * over six of them across thirty days produces enormous coefficients of opposite sign
 * that cancel. The penalty is what makes the fit answer "how much do these inputs
 * jointly say" instead of "which arbitrary linear combination best interpolates
 * these thirty days".
 *
 * Callers are expected to standardise their predictors first, because a single ridge
 * constant applied to predictors in milliseconds and predictors in minutes penalises
 * them by wildly different amounts.
 */
export function ridgeFit(
  rows: readonly { x: readonly number[]; y: number }[],
  options: { ridge?: number } = {},
): RidgeFit | null {
  if (rows.length < 4) return null;
  const width = rows[0].x.length + 1;
  if (rows.some((row) => row.x.length + 1 !== width)) return null;
  if (rows.length < width + 1) return null;

  const design = rows.map((row) => [1, ...row.x]);
  const y = rows.map((row) => row.y);
  const solved = solveNormalEquations(design, y, options.ridge ?? 1);
  if (!solved) return null;

  const at = (x: readonly number[]) => dot([1, ...x], solved);
  const meanY = mean(y);
  const sse = rows.reduce((sum, row) => sum + (row.y - at(row.x)) ** 2, 0);
  const sst = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);

  return {
    coefficients: solved,
    n: rows.length,
    r2: sst === 0 ? 0 : Math.max(0, 1 - sse / sst),
    at,
  };
}

/**
 * The share of variance a set of predictions explains, which unlike an r squared from
 * a fit can be negative.
 *
 * That is the feature. A model validated on data it did not see can be *worse* than
 * predicting the mean, and a negative number says so plainly where a squared
 * correlation would quietly report the model as somewhat useful.
 */
export function predictiveR2(
  actual: readonly number[],
  predicted: readonly number[],
): number | null {
  if (actual.length < 2 || actual.length !== predicted.length) return null;
  const meanActual = mean(actual);
  const sst = actual.reduce((sum, value) => sum + (value - meanActual) ** 2, 0);
  if (sst === 0) return null;
  const sse = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  return 1 - sse / sst;
}

// -----------------------------------------------------------------------------
// Correlation
// -----------------------------------------------------------------------------

export type Correlation = {
  r: number;
  n: number;
  p: number;
  ciLow: number;
  ciHigh: number;
};

/**
 * Pearson r with a Fisher-z interval.
 *
 * The interval is transformed rather than symmetric because r is bounded: a
 * symmetric interval around r = 0.8 with n = 10 reaches past 1, and an insight
 * that claims a correlation above one is worse than no insight.
 */
export function correlation(
  pairs: readonly Point[],
  confidence = 0.95,
): Correlation | null {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y),
  );
  if (usable.length < 4) return null;
  const n = usable.length;
  const meanX = mean(usable.map((pair) => pair.x));
  const meanY = mean(usable.map((pair) => pair.y));

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const pair of usable) {
    sxy += (pair.x - meanX) * (pair.y - meanY);
    sxx += (pair.x - meanX) ** 2;
    syy += (pair.y - meanY) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;

  const r = Math.max(-0.999999, Math.min(0.999999, sxy / Math.sqrt(sxx * syy)));
  const z = Math.atanh(r);
  const half = zCritical(confidence) / Math.sqrt(n - 3);
  const t = (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);

  return {
    r,
    n,
    p: studentTP(t, n - 2),
    ciLow: Math.tanh(z - half),
    ciHigh: Math.tanh(z + half),
  };
}

export type LaggedCorrelation = Correlation & { lag: number };

/**
 * `correlation` at each lag from 0 to `maxLag`, cause leading effect.
 *
 * At lag k, `x` on day d is paired with `y` on day d + k, so a positive lag means
 * the x series happened first. Every lag is returned rather than only the best
 * one, because the caller has to correct for having looked at all of them: taking
 * the maximum of five correlations and reporting its own p is the classic way to
 * manufacture a finding out of noise.
 */
export function laggedCorrelations(
  x: ReadonlyMap<string, number>,
  y: ReadonlyMap<string, number>,
  options: { maxLag: number; shiftDay: (day: string, offset: number) => string },
): LaggedCorrelation[] {
  const out: LaggedCorrelation[] = [];
  for (let lag = 0; lag <= options.maxLag; lag += 1) {
    const pairs: Point[] = [];
    for (const [day, value] of x) {
      const effect = y.get(options.shiftDay(day, lag));
      if (effect === undefined) continue;
      pairs.push({ x: value, y: effect });
    }
    const fit = correlation(pairs);
    if (fit) out.push({ ...fit, lag });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Logistic regression
// -----------------------------------------------------------------------------

export type LogisticFit = {
  /** One per column of the design matrix, intercept first. */
  coefficients: number[];
  standardErrors: number[];
  /** Two-sided p per coefficient, from the Wald statistic. */
  p: number[];
  n: number;
  converged: boolean;
};

/**
 * Ridge-penalised logistic regression by iteratively reweighted least squares.
 *
 * The penalty is not optional here. The data this is asked about - next-day
 * patellar pain against last week's contact count, over maybe fifteen weeks - is
 * frequently separable, and unpenalised maximum likelihood on separable data
 * sends a coefficient to infinity and its standard error with it. A small ridge
 * keeps the estimate finite and shrinks it toward zero, which is the conservative
 * direction for a model whose output is a load ceiling.
 *
 * `rows` carry the design row *without* the intercept; the intercept is added
 * here so no caller can forget it.
 */
export function logisticFit(
  rows: readonly { x: readonly number[]; y: number }[],
  options: { ridge?: number; maxIterations?: number } = {},
): LogisticFit | null {
  if (rows.length < 6) return null;
  const width = rows[0].x.length + 1;
  if (width < 2 || rows.some((row) => row.x.length + 1 !== width)) return null;
  // One class only: there is nothing to separate, and IRLS would report a
  // confident intercept and no information about anything else.
  if (new Set(rows.map((row) => (row.y > 0 ? 1 : 0))).size < 2) return null;
  // Fewer observations than parameters plus a margin is a fit with no degrees of
  // freedom left to be wrong in.
  if (rows.length < width + 3) return null;

  const design = rows.map((row) => [1, ...row.x]);
  const outcomes = rows.map((row) => (row.y > 0 ? 1 : 0));
  const ridge = options.ridge ?? 1e-3;
  let beta = new Array<number>(width).fill(0);
  let converged = false;
  let information: number[][] | null = null;

  for (let iteration = 0; iteration < (options.maxIterations ?? 50); iteration += 1) {
    const probabilities = design.map((row) => logistic(dot(row, beta)));
    const gradient = new Array<number>(width).fill(0);
    const hessian = Array.from({ length: width }, () => new Array<number>(width).fill(0));

    for (let i = 0; i < design.length; i += 1) {
      const residual = outcomes[i] - probabilities[i];
      // Floored, because a weight of exactly zero at a saturated probability
      // makes the information matrix singular and the solve fails outright.
      const weight = Math.max(probabilities[i] * (1 - probabilities[i]), 1e-8);
      for (let a = 0; a < width; a += 1) {
        gradient[a] += design[i][a] * residual;
        for (let b = 0; b < width; b += 1) {
          hessian[a][b] += design[i][a] * design[i][b] * weight;
        }
      }
    }
    // The penalty leaves the intercept alone: shrinking it would pull the fitted
    // base rate toward one half, which is a claim about the data, not a prior.
    for (let a = 1; a < width; a += 1) {
      gradient[a] -= ridge * beta[a];
      hessian[a][a] += ridge;
    }

    const step = solveLinear(hessian, gradient);
    if (!step) return null;
    beta = beta.map((value, index) => value + step[index]);
    information = hessian;
    if (step.every((value) => Math.abs(value) < 1e-8)) {
      converged = true;
      break;
    }
  }
  if (!information) return null;

  const covariance = invert(information);
  const standardErrors = covariance
    ? covariance.map((row, index) => Math.sqrt(Math.max(0, row[index])))
    : new Array<number>(width).fill(Number.POSITIVE_INFINITY);

  return {
    coefficients: beta,
    standardErrors,
    p: beta.map((value, index) =>
      standardErrors[index] > 0 && Number.isFinite(standardErrors[index])
        ? 2 * (1 - normalCdf(Math.abs(value / standardErrors[index])))
        : 1,
    ),
    n: rows.length,
    converged,
  };
}

export function logistic(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/**
 * The x at which a one-predictor logistic model crosses `probability`.
 *
 * This is what turns a coefficient into a ceiling the owner can act on: "pain the
 * next day becomes more likely than not above 212 contacts" is a number, and
 * "the log odds rise 0.014 per contact" is not.
 */
export function logisticThreshold(
  fit: LogisticFit,
  probability = 0.5,
): number | null {
  if (fit.coefficients.length !== 2) return null;
  const [intercept, slope] = fit.coefficients;
  if (slope === 0 || !Number.isFinite(slope)) return null;
  return (Math.log(probability / (1 - probability)) - intercept) / slope;
}

// -----------------------------------------------------------------------------
// Multiple comparisons
// -----------------------------------------------------------------------------

/**
 * Benjamini-Hochberg adjusted p values, in the input order.
 *
 * The suite computes a few dozen statements from one athlete's history, and at the
 * usual threshold one or two of them are expected to look real purely because
 * several were looked at. Controlling the false discovery rate rather than the
 * family-wise error rate is the right trade here: the cost of a missed insight is
 * a plan that is a little less tailored, and the cost of a false one is the app
 * confidently telling its owner something untrue about their own body.
 *
 * The enforced monotonicity - each adjusted value capped by the next larger one -
 * is what makes the result usable as a threshold rather than only as a ranking.
 */
export function benjaminiHochberg(ps: readonly number[]): number[] {
  const m = ps.length;
  if (m === 0) return [];
  const order = ps
    .map((p, index) => ({ p, index }))
    .sort((a, b) => a.p - b.p);

  const adjusted = new Array<number>(m).fill(1);
  let running = 1;
  for (let rank = m; rank >= 1; rank -= 1) {
    const entry = order[rank - 1];
    running = Math.min(running, (entry.p * m) / rank);
    adjusted[entry.index] = Math.min(1, running);
  }
  return adjusted;
}

// -----------------------------------------------------------------------------
// Smoothing
// -----------------------------------------------------------------------------

/** Exponentially weighted mean, one output per input. */
export function ewma(values: readonly number[], alpha: number): number[] {
  const out: number[] = [];
  let level: number | null = null;
  for (const value of values) {
    level = level === null ? value : alpha * value + (1 - alpha) * level;
    out.push(level);
  }
  return out;
}

/**
 * A scalar Kalman filter over a random-walk level, smoothed backward.
 *
 * Preferred over an EWMA wherever the *level today* is what matters, because an
 * EWMA lags by about its own memory length and that lag is exactly the size of the
 * effect a bodyweight trend is trying to measure. The backward pass removes the
 * lag; the forward-only estimate is what a live readout would use.
 *
 * `processVariance` is how much the true level is allowed to move per step and
 * `observationVariance` is how noisy one reading is. Their ratio is the only thing
 * that matters, which is why both are given rather than a single smoothing
 * constant: a morning bodyweight is noisy against a level that barely moves, and
 * stating both makes that assumption visible.
 */
export function kalmanLevel(
  values: readonly number[],
  options: { processVariance: number; observationVariance: number },
): number[] {
  const n = values.length;
  if (n === 0) return [];
  const { processVariance, observationVariance } = options;

  const filtered = new Array<number>(n).fill(0);
  const filteredVariance = new Array<number>(n).fill(0);
  const predicted = new Array<number>(n).fill(0);
  const predictedVariance = new Array<number>(n).fill(0);

  let level = values[0];
  let variance = observationVariance;
  for (let i = 0; i < n; i += 1) {
    predicted[i] = level;
    predictedVariance[i] = variance + processVariance;
    const gain = predictedVariance[i] / (predictedVariance[i] + observationVariance);
    level = predicted[i] + gain * (values[i] - predicted[i]);
    variance = (1 - gain) * predictedVariance[i];
    filtered[i] = level;
    filteredVariance[i] = variance;
  }

  // Rauch-Tung-Striebel backward pass.
  const smoothed = [...filtered];
  for (let i = n - 2; i >= 0; i -= 1) {
    const gain = filteredVariance[i] / predictedVariance[i + 1];
    smoothed[i] = filtered[i] + gain * (smoothed[i + 1] - predicted[i + 1]);
  }
  return smoothed;
}

// -----------------------------------------------------------------------------
// Shrinkage
// -----------------------------------------------------------------------------

/**
 * A per-item estimate pulled toward a prior in proportion to how little data
 * stands behind it.
 *
 * This is the whole reason an exercise with two logged sets does not get to have
 * an opinion. `priorWeight` is in the same units as n and reads as "how many
 * observations the prior is worth", so a prior weight of 8 means an exercise needs
 * eight sets before its own number outweighs the class it belongs to.
 */
export function shrink(input: {
  value: number;
  n: number;
  priorValue: number;
  priorWeight: number;
}): number {
  const total = input.n + input.priorWeight;
  if (total === 0) return input.priorValue;
  return (input.value * input.n + input.priorValue * input.priorWeight) / total;
}

// -----------------------------------------------------------------------------
// Small linear algebra, only as much as the fits above need
// -----------------------------------------------------------------------------

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** Gaussian elimination with partial pivoting. Null when the matrix is singular. */
function solveLinear(
  matrix: readonly (readonly number[])[],
  vector: readonly number[],
): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);

  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column] / augmented[column][column];
      for (let k = column; k <= n; k += 1) {
        augmented[row][k] -= factor * augmented[column][k];
      }
    }
  }
  return augmented.map((row, i) => row[n] / row[i]);
}

/**
 * `(XᵀX + λI)⁻¹Xᵀy`, by solving rather than inverting.
 *
 * `ridge` defaults to none. When given it is added to every diagonal entry *except*
 * the first, on the convention that column zero is the intercept: penalising the
 * intercept shrinks the fitted mean toward zero, which is not a prior about anything,
 * just an error.
 */
function solveNormalEquations(
  design: readonly (readonly number[])[],
  y: readonly number[],
  ridge = 0,
): number[] | null {
  const width = design[0].length;
  const normal = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  const rhs = new Array<number>(width).fill(0);
  for (let i = 0; i < design.length; i += 1) {
    for (let a = 0; a < width; a += 1) {
      rhs[a] += design[i][a] * y[i];
      for (let b = 0; b < width; b += 1) {
        normal[a][b] += design[i][a] * design[i][b];
      }
    }
  }
  for (let a = 1; a < width; a += 1) normal[a][a] += ridge;
  return solveLinear(normal, rhs);
}

/** Inverse by solving against each basis vector. Null when singular. */
function invert(matrix: readonly (readonly number[])[]): number[][] | null {
  const n = matrix.length;
  const columns: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const basis = new Array<number>(n).fill(0);
    basis[i] = 1;
    const solved = solveLinear(matrix, basis);
    if (!solved) return null;
    columns.push(solved);
  }
  // `columns[i]` is the i-th column of the inverse; transpose into rows.
  return Array.from({ length: n }, (_, row) => columns.map((column) => column[row]));
}
