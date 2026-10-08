import type { CorrelationMatrix } from '@/lib/data-quality'

/**
 * DS-LAKE-031-D07. Distance between two tags for grouping: `1 − |r|`. Sign is
 * ignored — a strong negative pair moves together just as tightly as a
 * strong positive one (the heatmap's colour still shows which). A non-finite
 * r (a server NaN arrives as JSON null) counts as unrelated.
 */
function distance(r: number | null | undefined): number {
  return typeof r === 'number' && Number.isFinite(r) ? 1 - Math.abs(r) : 1
}

interface Cluster {
  /** Leaf order inside this cluster. */
  members: number[]
  /** Lowest original index — the tie-break and the left/right rule. */
  first: number
}

/**
 * Heatmap order that puts similar tags next to each other: agglomerative
 * clustering with AVERAGE linkage on `1 − |r|`, read off as the dendrogram's
 * leaf order. Returns indices into `m.tags`.
 *
 * Deterministic, so the same matrix always draws the same picture: the
 * cluster list stays sorted by each cluster's lowest original index, the
 * closest pair is found scanning in that order with a strict `<` (first pair
 * wins a tie), and a merge always puts the cluster holding the lower index on
 * the left.
 *
 * O(n³) — fine at the server's capped column count.
 */
export function clusterOrder(m: CorrelationMatrix): number[] {
  const n = m.tags.length
  if (n <= 2) return m.tags.map((_, i) => i)

  let clusters: Cluster[] = m.tags.map((_, i) => ({ members: [i], first: i }))
  // `dist[a][b]` between CURRENT clusters a and b (positions in `clusters`).
  let dist: number[][] = clusters.map((_, i) =>
    clusters.map((__, j) => (i === j ? 0 : distance(m.matrix[i]?.[j]))),
  )

  while (clusters.length > 1) {
    let bestA = 0
    let bestB = 1
    let best = Infinity
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        if (dist[a]![b]! < best) {
          best = dist[a]![b]!
          bestA = a
          bestB = b
        }
      }
    }

    const left = clusters[bestA]!
    const right = clusters[bestB]!
    const merged: Cluster = {
      members: [...left.members, ...right.members],
      first: left.first,
    }
    const sizeA = left.members.length
    const sizeB = right.members.length

    // Average linkage (Lance–Williams): the merged cluster's distance to any
    // other cluster k is the size-weighted mean of its parts' distances.
    const mergedRow = clusters.map(
      (_, k) =>
        (sizeA * dist[bestA]![k]! + sizeB * dist[bestB]![k]!) / (sizeA + sizeB),
    )

    // `bestA < bestB` and the list is sorted by `first`, so the merged cluster
    // takes `bestA`'s slot and the order stays sorted.
    const keep = clusters.map((_, k) => k).filter(k => k !== bestB)
    clusters = keep.map(k => (k === bestA ? merged : clusters[k]!))
    dist = keep.map(i =>
      keep.map(j => {
        if (i === j) return 0
        if (i === bestA) return mergedRow[j]!
        if (j === bestA) return mergedRow[i]!
        return dist[i]![j]!
      }),
    )
  }

  return clusters[0]!.members
}

/** Rows and columns permuted by `order` — symmetric, so the diagonal stays
 * on the diagonal. */
export function reorderMatrix(
  m: CorrelationMatrix,
  order: number[],
): CorrelationMatrix {
  return {
    tags: order.map(i => m.tags[i]!),
    matrix: order.map(i => order.map(j => m.matrix[i]?.[j] ?? 0)),
  }
}
