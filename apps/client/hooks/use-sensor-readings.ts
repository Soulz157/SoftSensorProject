/** One merged-by-timestamp row: `{ timestamp, [piTag]: value }`. */
export interface SensorChartRow {
  timestamp: string
  [piTag: string]: string | number | null
}
