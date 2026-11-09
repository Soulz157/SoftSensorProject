/** Lab tags are sampled by hand, so they are absent from a PI-only catalogue
 *  and their value is carried forward between samples. Identified by the
 *  `.lab` suffix every lab tag in this system carries. Kept in its own
 *  dependency-free module so pure libs (`data-quality.ts`) can use it without
 *  pulling in `feature-preset.ts`'s hook imports. */
export function isLabTag(tag: string): boolean {
  return tag.toLowerCase().endsWith('.lab')
}
