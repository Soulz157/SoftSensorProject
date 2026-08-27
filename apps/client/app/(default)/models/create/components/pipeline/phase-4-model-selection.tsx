import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase4ModelSelection({ nav }: Props) {
  const { selectedDataset, algorithms, findBestModel, findBestParams } = nav
  return <div className="space-y-6">asd</div>
}
