/** One model prediction at a timestamp (no lab/actual counterpart). */
export interface PredPoint {
  /** ISO 8601 UTC. */
  timestamp: string
  predicted: number
}
