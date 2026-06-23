import { useEffect, useReducer, useCallback } from 'react'
import { toast } from 'sonner'
import { AIModel, WorkspacePlant } from '@/types'
import { getWorkspacePlants } from '@/services/workspace-plant'
import { getNodes, type CanvasNode } from '@/services/canvas'
import { createModel, updateModel } from '@/services/model'
import { useModelTagSelection } from '@/hooks/model/use-model-tag-selection'

type State = {
  name: string
  workspaceId: string
  plantId: string
  nodeId: string
  plants: WorkspacePlant[]
  nodes: CanvasNode[]
  isSubmitting: boolean
}

type Action =
  | { type: 'INIT'; model?: AIModel | null }
  | { type: 'SET_NAME'; name: string }
  | { type: 'CHANGE_WORKSPACE'; workspaceId: string }
  | { type: 'FETCH_PLANTS_SUCCESS'; plants: WorkspacePlant[] }
  | { type: 'CHANGE_PLANT'; plantId: string }
  | { type: 'FETCH_NODES_SUCCESS'; nodes: CanvasNode[] }
  | { type: 'CHANGE_NODE'; nodeId: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_FINISH' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        name: action.model?.name ?? '',
        workspaceId: action.model?.workspaceId ?? '',
        plantId: action.model?.nodes?.planId ?? '',
        nodeId: action.model?.nodesId ?? '',
        plants: action.model ? state.plants : [],
        nodes: action.model ? state.nodes : [],
        isSubmitting: false,
      }
    case 'SET_NAME':
      return { ...state, name: action.name }

    case 'CHANGE_WORKSPACE':
      return {
        ...state,
        workspaceId: action.workspaceId,
        plantId: '',
        nodeId: '',
        plants: [],
        nodes: [],
      }
    case 'FETCH_PLANTS_SUCCESS':
      return { ...state, plants: action.plants }

    case 'CHANGE_PLANT':
      return {
        ...state,
        plantId: action.plantId,
        nodeId: '',
        nodes: [],
      }
    case 'FETCH_NODES_SUCCESS':
      return { ...state, nodes: action.nodes }

    case 'CHANGE_NODE':
      return { ...state, nodeId: action.nodeId }

    case 'SUBMIT_START':
      return { ...state, isSubmitting: true }
    case 'SUBMIT_FINISH':
      return { ...state, isSubmitting: false }
    default:
      return state
  }
}

const initialState: State = {
  name: '',
  workspaceId: '',
  plantId: '',
  nodeId: '',
  plants: [],
  nodes: [],
  isSubmitting: false,
}

interface UseModelFormProps {
  open: boolean
  model?: AIModel | null
  onSuccess: () => void
  onClose: () => void
}

export function useModelForm({
  open,
  model,
  onSuccess,
  onClose,
}: UseModelFormProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // PI server + tag-role selection (shared with the create flow). Tags are
  // local-only — not loaded from or saved to the model yet (Phase-6 gap).
  const tagSelection = useModelTagSelection()
  const { reset: resetTags } = tagSelection

  useEffect(() => {
    if (open) {
      dispatch({ type: 'INIT', model })
      resetTags()
    }
  }, [open, model, resetTags])

  useEffect(() => {
    if (!state.workspaceId) return

    let ignore = false
    getWorkspacePlants(state.workspaceId)
      .then(data => {
        if (!ignore) dispatch({ type: 'FETCH_PLANTS_SUCCESS', plants: data })
      })
      .catch(() => {
        if (!ignore) dispatch({ type: 'FETCH_PLANTS_SUCCESS', plants: [] })
      })

    return () => {
      ignore = true
    }
  }, [state.workspaceId])

  useEffect(() => {
    if (!state.workspaceId) return

    let ignore = false
    getNodes(state.workspaceId, state.plantId || undefined)
      .then(data => {
        if (!ignore) dispatch({ type: 'FETCH_NODES_SUCCESS', nodes: data })
      })
      .catch(() => {
        if (!ignore) dispatch({ type: 'FETCH_NODES_SUCCESS', nodes: [] })
      })

    return () => {
      ignore = true
    }
  }, [state.workspaceId, state.plantId])

  const submitForm = useCallback(async () => {
    if (!state.name.trim() || !state.workspaceId) {
      toast.error('Name and workspace are required')
      return
    }

    dispatch({ type: 'SUBMIT_START' })
    try {
      const payload = { name: state.name, nodeId: state.nodeId || undefined }

      if (model) {
        await updateModel(model.id, {
          ...payload,
          nodeId: state.nodeId || null,
        })
      } else {
        await createModel({ workspaceId: state.workspaceId, ...payload })
      }

      toast.success(model ? 'Model updated' : 'Model created')
      onSuccess()
      onClose()
    } catch {
      toast.error('Failed to save model')
    } finally {
      dispatch({ type: 'SUBMIT_FINISH' })
    }
  }, [state, model, onSuccess, onClose])

  return {
    state,
    tagSelection,
    actions: {
      setName: (name: string) => dispatch({ type: 'SET_NAME', name }),
      handleWorkspaceChange: (id: string) => {
        dispatch({ type: 'CHANGE_WORKSPACE', workspaceId: id })
        resetTags() // workspace change clears the PI server + picked tags
      },
      handlePlantChange: (id: string) =>
        dispatch({ type: 'CHANGE_PLANT', plantId: id === 'none' ? '' : id }),
      handleNodeChange: (id: string) =>
        dispatch({ type: 'CHANGE_NODE', nodeId: id === 'none' ? '' : id }),
      submitForm,
    },
  }
}
