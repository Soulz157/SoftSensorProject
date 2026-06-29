import { fetchClient } from '@/lib/fetcher'
import { AIModel } from '@/types'
import type { ModelConfig } from '@/lib/model-config'

export async function getModels(workspaceId: string): Promise<AIModel[]> {
  const res: { data: AIModel[] } = await fetchClient(
    `/api/v1/authorized/model?workspaceId=${workspaceId}`,
  )
  return res.data
}

export async function getModelById(
  workspaceId: string,
  modelId: string,
): Promise<AIModel | null> {
  const models = await getModels(workspaceId)
  return models.find(m => m.id === modelId) ?? null
}

export async function createModel(dto: {
  workspaceId: string
  name: string
  nodeId?: string
  config?: ModelConfig
}): Promise<AIModel> {
  const res: { data: AIModel } = await fetchClient('/api/v1/authorized/model', {
    method: 'POST',
    body: JSON.stringify(dto),
  })
  return res.data
}

export async function updateModel(
  modelId: string,
  dto: {
    name?: string
    nodeId?: string | null
    deployStatus?: 'stopped' | 'running' | 'error' | 'initializing'
    prodStatus?: 'normal' | 'warning' | 'alert' | 'offline' | 'frozen'
    statusDetail?: string | null
    config?: ModelConfig
  },
): Promise<AIModel> {
  const res: { data: AIModel } = await fetchClient(
    `/api/v1/authorized/model/${modelId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    },
  )
  return res.data
}

export async function deleteModel(modelId: string): Promise<void> {
  await fetchClient('/api/v1/authorized/model', {
    method: 'DELETE',
    body: JSON.stringify({ modelId }),
  })
}

export async function appendModelLog(
  modelId: string,
  dto: { level: 'info' | 'warn' | 'error'; message: string },
): Promise<AIModel> {
  const res: { data: AIModel } = await fetchClient(
    `/api/v1/authorized/model/${modelId}/log`,
    { method: 'POST', body: JSON.stringify(dto) },
  )
  return res.data
}
