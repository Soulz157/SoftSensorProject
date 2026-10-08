import { useEffect, useReducer, useCallback } from 'react'
import { toast } from 'sonner'
import { AIModel, WorkspacePlant } from '@/types'
import { getWorkspacePlants } from '@/services/workspace-plant'
import { getNodes, type CanvasNode } from '@/services/canvas'
import { createModel, updateModel } from '@/services/model'

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
  /**
   * MODEL-SERVE-013-T06. The Data Source relink, OWNED BY THE DIALOG and
   * passed in — this hook does not fetch it. The binding lives on the
   * model's InferenceSchedule, not on the model row, so it is a second,
   * independent write that `submitForm` sequences after the model update
   * (see there for what happens when one of the two fails).
   */
  dataSource?: { isDirty: boolean; save: () => Promise<void> }
}

export function useModelForm({
  open,
  model,
  onSuccess,
  onClose,
  dataSource,
}: UseModelFormProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    if (open) {
      dispatch({ type: 'INIT', model })
    }
  }, [open, model])

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

      /**
       * MODEL-SERVE-013-T06. TWO INDEPENDENT WRITES, and they are reported
       * as two. The model row and the InferenceSchedule are different
       * records behind different endpoints; there is no transaction across
       * them and faking one would be worse than saying what happened.
       *
       * Attempted only AFTER the model update succeeded, and only when the
       * user actually changed the source. If it fails, the model edit
       * still landed — so this reports both halves and DELIBERATELY leaves
       * the dialog open (no `onSuccess`/`onClose`) so the relink can be
       * retried without retyping the rest.
       */
      if (dataSource?.isDirty) {
        try {
          await dataSource.save()
        } catch (err) {
          toast.error(
            `Model saved, but the data source was not changed: ${
              err instanceof Error && err.message
                ? err.message
                : 'unknown error'
            }`,
          )
          return
        }
      }

      toast.success(model ? 'Model updated' : 'Model created')
      onSuccess()
      onClose()
    } catch {
      toast.error('Failed to save model')
    } finally {
      dispatch({ type: 'SUBMIT_FINISH' })
    }
  }, [state, model, onSuccess, onClose, dataSource])

  return {
    state,
    actions: {
      setName: (name: string) => dispatch({ type: 'SET_NAME', name }),
      handleWorkspaceChange: (id: string) =>
        dispatch({ type: 'CHANGE_WORKSPACE', workspaceId: id }),
      handlePlantChange: (id: string) =>
        dispatch({ type: 'CHANGE_PLANT', plantId: id === 'none' ? '' : id }),
      handleNodeChange: (id: string) =>
        dispatch({ type: 'CHANGE_NODE', nodeId: id === 'none' ? '' : id }),
      submitForm,
    },
  }
}
