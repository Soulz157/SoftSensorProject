import { featureColumnName } from '@/lib/feature-engineering'
import type { SavedDataset } from '@/store/datasets'

/**
 * The tags a dataset was built FROM — its saved `tags` minus every column its
 * own feature-engineering step added (lag, rolling, delta, ratio, formula…).
 *
 * The engineered names come from the dataset's recipe through
 * `featureColumnName`, the function the builder itself names them with, so
 * this never guesses from a name pattern: a source tag that happens to
 * contain "lag" stays, and a feature with a custom name (a formula or group
 * output) goes. A legacy recipe with no feature list keeps every tag.
 */
export function sourceTagsOf(
  dataset: Pick<SavedDataset, 'tags' | 'pipelineConfig'>,
): string[] {
  const features = dataset.pipelineConfig?.features ?? []
  if (features.length === 0) return dataset.tags
  const engineered = new Set(features.map(featureColumnName))
  return dataset.tags.filter(tag => !engineered.has(tag))
}
