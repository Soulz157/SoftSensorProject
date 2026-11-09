/**
 * Which tag chips a crowded filter row shows. Pure (no React / IO).
 *
 * A workspace's datasets can hold hundreds of distinct source tags; drawn all
 * at once the chip row buries the dataset cards under it. The row shows the
 * first `limit` and a "Show more" for the rest.
 *
 * A tag the user has switched ON is never hidden by the cut: it is a filter in
 * force, and a chip that disappears while its filter still applies would leave
 * "Showing 3 of 40 datasets" with nothing on screen to explain or undo it.
 * Those chips are kept, after the first `limit`, in the same order.
 */

/** Chips shown before "Show more" (the user asked for 10-15). */
export const TAG_CHIP_LIMIT = 12

export interface TagChips {
  /** The tags to draw, in the input order. */
  visible: string[]
  /** Tags left out — what "Show more" would reveal. */
  hiddenCount: number
  /** True when there is anything to expand. */
  collapsible: boolean
}

export function visibleTagChips(
  all: readonly string[],
  active: readonly string[],
  expanded: boolean,
  limit: number = TAG_CHIP_LIMIT,
): TagChips {
  if (expanded || all.length <= limit) {
    return {
      visible: [...all],
      hiddenCount: 0,
      collapsible: all.length > limit,
    }
  }
  const pinned = new Set(active)
  const visible = all.filter((tag, index) => index < limit || pinned.has(tag))
  return {
    visible,
    hiddenCount: all.length - visible.length,
    collapsible: true,
  }
}
