export interface Model {
  id: string
  name: string
  status: 'running' | 'warning' | 'error' | 'stopped'
  accuracy?: string
  runStatus: 'running' | 'error' | 'stopped' | 'initializing'
  productionStatus: 'running' | 'warning' | 'alert' | 'offline'
  errorMessage?: string
  anomalyCause?: string
  lastUpdated: string
  version: string
  cpu?: string
  memory?: string
  latency?: string
}

export interface Node {
  id: string
  name: string
  type: 'machine' | 'sensor' | 'controller'
  status: 'normal' | 'warning' | 'alarm' | 'offline'
  models: Model[]
}

export interface Workspace {
  id: string
  name: string
  description: string
  nodes: Node[]
  lastUpdated: string
}

export interface FlatModel extends Model {
  workspaceId: string
  workspaceName: string
  nodeId: string
  nodeName: string
  nodeType: 'machine' | 'sensor' | 'controller'
}

const MODEL_NAMES = [
  'Temperature Anomaly Detector',
  'Vibration Pattern Analyzer',
  'Pressure Forecaster',
  'Energy Consumption Monitor',
  'Quality Defect Classifier',
  'Predictive Maintenance Model',
  'Time Series Analyzer',
  'Neural Predictor',
  'Random Forest Classifier',
  'LSTM Predictor',
  'Transformer Model',
  'Autoencoder',
]

const ERROR_MESSAGES = [
  'Model inference timeout: GPU memory allocation failed after 30s',
  'Critical failure: Connection lost. Unable to retrieve data.',
  'TensorFlow session crashed: CUDA driver version mismatch',
  'Network timeout: API endpoint unreachable after 60s retry',
]

const ANOMALY_CAUSES = [
  'Increased vibration frequency detected on bearing assembly.',
  'Prediction drift detected. Model accuracy degraded by 4.2%.',
  'Temperature exceeded safety threshold by 15°C.',
  'Power consumption anomaly: 23% higher than expected baseline.',
  'Sensor reading inconsistency detected across multiple channels.',
]

type RunStatus = Model['runStatus']
type ProdStatus = Model['productionStatus']
type NodeStatus = Node['status']
type NodeType = Node['type']

const RUN_STATUSES: RunStatus[] = [
  'running',
  'running',
  'running',
  'running',
  'error',
  'stopped',
  'initializing',
  'running',
]
const PROD_STATUSES: ProdStatus[] = [
  'running',
  'running',
  'running',
  'warning',
  'alert',
  'offline',
  'running',
  'warning',
]
const NODE_TYPES: NodeType[] = ['machine', 'sensor', 'controller']
const NODE_STATUSES: NodeStatus[] = [
  'normal',
  'normal',
  'warning',
  'alarm',
  'offline',
]

function pickCycle<T>(arr: T[], idx: number): T {
  return arr[idx % arr.length] as T
}

function generateMockModels(): Workspace[] {
  const workspaceDefs = [
    {
      id: '1',
      name: 'Acme Corporation',
      description: 'Main production facility',
    },
    {
      id: '2',
      name: 'iPAD Mega DS Dashboard',
      description: 'Data Science Dashboard',
    },
    {
      id: '3',
      name: 'Smart Factory Alpha',
      description: 'Automated manufacturing',
    },
    { id: '4', name: 'Precision Labs', description: 'Quality control' },
  ]

  let modelIdx = 0

  return workspaceDefs.map((wsDef, wsIdx) => {
    const nodeCount = 6 + (wsIdx % 3)
    const nodes: Node[] = []

    for (let i = 0; i < nodeCount; i++) {
      const nodeType = pickCycle(NODE_TYPES, wsIdx * 7 + i)
      const nodeStatus = pickCycle(NODE_STATUSES, wsIdx * 5 + i)
      const typeName = nodeType.charAt(0).toUpperCase() + nodeType.slice(1)
      const nodeName = `${typeName} ${String.fromCharCode(65 + i)}${wsIdx + 1}`

      const modelCount = 1 + ((wsIdx + i) % 3)
      const models: Model[] = []

      for (let j = 0; j < modelCount; j++) {
        const runStatus = pickCycle(RUN_STATUSES, modelIdx)
        const productionStatus: ProdStatus =
          runStatus === 'error'
            ? 'alert'
            : runStatus === 'stopped'
              ? 'offline'
              : pickCycle(PROD_STATUSES, modelIdx)

        const hasError = runStatus === 'error'
        const hasAnomaly =
          productionStatus === 'warning' || productionStatus === 'alert'
        const isRunning = runStatus === 'running'

        const status: Model['status'] =
          runStatus === 'running'
            ? productionStatus === 'warning'
              ? 'warning'
              : 'running'
            : runStatus === 'error'
              ? 'error'
              : 'stopped'

        models.push({
          id: `m${modelIdx + 1}`,
          name: pickCycle(MODEL_NAMES, modelIdx) as string,
          status,
          accuracy:
            runStatus !== 'stopped'
              ? `${(85 + (modelIdx % 14)).toFixed(1)}%`
              : undefined,
          runStatus,
          productionStatus,
          errorMessage: hasError
            ? pickCycle(ERROR_MESSAGES, modelIdx)
            : undefined,
          anomalyCause: hasAnomaly
            ? pickCycle(ANOMALY_CAUSES, modelIdx)
            : undefined,
          lastUpdated: `${(modelIdx % 59) + 1} min ago`,
          version: `v${(modelIdx % 4) + 1}.${modelIdx % 10}.${modelIdx % 8}`,
          cpu: isRunning ? `${5 + (modelIdx % 60)}%` : '0%',
          memory: isRunning ? `${128 + (modelIdx % 1500)}MB` : '0MB',
          latency: isRunning ? `${20 + (modelIdx % 150)}ms` : '-',
        })

        modelIdx++
      }

      nodes.push({
        id: `n${wsIdx}-${i}`,
        name: nodeName,
        type: nodeType,
        status: nodeStatus,
        models,
      })
    }

    return {
      ...wsDef,
      nodes,
      lastUpdated: `${(wsIdx + 1) * 2} min ago`,
    }
  })
}

function getAllModels(): FlatModel[] {
  return generateMockModels().flatMap(ws =>
    ws.nodes.flatMap(node =>
      node.models.map(model => ({
        ...model,
        workspaceId: ws.id,
        workspaceName: ws.name,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
      })),
    ),
  )
}

export const allWorkspaces = generateMockModels()
export const allModels = getAllModels()
