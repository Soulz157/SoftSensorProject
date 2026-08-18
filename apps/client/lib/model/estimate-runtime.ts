// Relative training cost per algorithm, normalised to LightGBM = 1.0
const ALGO_COST: Record<string, number> = {
  ols: 0.15,
  ridge: 0.15,
  lasso: 0.2,
  elasticnet: 0.2,
  dt: 0.4,
  knn: 0.5,
  lightgbm: 1.0,
  xgboost: 1.3,
  gbr: 1.6,
  et: 1.5,
  rf: 1.8,
  catboost: 2.0,
  mlp: 2.5,
  svr: 3.0,
}

export const ALGO_LABEL: Record<string, string> = {
  ols: 'OLS',
  ridge: 'Ridge',
  lasso: 'Lasso',
  elasticnet: 'ElasticNet',
  dt: 'Decision Tree',
  knn: 'KNN',
  lightgbm: 'LightGBM',
  xgboost: 'XGBoost',
  gbr: 'Gradient Boosting',
  et: 'Extra Trees',
  rf: 'Random Forest',
  catboost: 'CatBoost',
  mlp: 'Neural Net',
  svr: 'SVR',
}

const ALL_ALGO_COST = Object.values(ALGO_COST).reduce((s, v) => s + v, 0)

export const SUPERLINEAR = new Set(['svr', 'knn', 'mlp'])

export interface AlgoShare {
  id: string
  label: string
  seconds: number
  pct: number
}

export function breakdownRuntime(input: RuntimeInput): AlgoShare[] {
  const ids = input.findBestModel ? Object.keys(ALGO_COST) : input.algorithms
  if (ids.length === 0) return []

  // Reuse the single-algorithm path so shares always sum to the headline number
  const rows = ids.map(id => ({
    id,
    label: ALGO_LABEL[id] ?? id,
    seconds: estimateRuntimeSeconds({
      ...input,
      algorithms: [id],
      findBestModel: false,
    }),
  }))

  const total = rows.reduce((s, r) => s + r.seconds, 0) || 1
  return rows
    .map(r => ({ ...r, pct: (r.seconds / total) * 100 }))
    .sort((a, b) => b.seconds - a.seconds)
}

const SEC_PER_CELL = 1 / 2_000_000

export interface RuntimeInput {
  rows: number
  features: number
  algorithms: string[]
  targets: number
  findBestModel: boolean
  findBestParams: boolean
  nEstimators?: number
}

export function estimateRuntimeSeconds({
  rows,
  features,
  algorithms,
  targets,
  findBestModel,
  findBestParams,
  nEstimators,
}: RuntimeInput): number {
  const cells = Math.max(rows, 1) * Math.max(features, 1)
  const trees = (nEstimators ?? 100) / 100

  const algoCost = findBestModel
    ? ALL_ALGO_COST
    : algorithms.reduce((s, a) => s + (ALGO_COST[a] ?? 1), 0) || 1

  // Random search ≈ 10 candidates × 5-fold CV, but folds are on smaller splits
  const tuning = findBestParams ? 10 : 1

  return Math.max(
    2,
    cells * SEC_PER_CELL * trees * algoCost * tuning * Math.max(targets, 1),
  )
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return s ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}
