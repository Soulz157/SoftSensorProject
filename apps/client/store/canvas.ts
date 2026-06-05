import { atom } from 'jotai'
import { useAtomValue } from 'jotai'

export const isBuildModeAtom = atom(false)

export const nodeToDeleteIdAtom = atom<string | null>(null)

export const canvasActionsAtom = atom<{
  onRequestDeleteNode: (nodeId: string) => void
  onConfirmDeleteNode: (nodeId: string) => void
  onCancelDeleteNode: () => void
} | null>(null)

export const useCanvasContext = () => {
  const isBuildMode = useAtomValue(isBuildModeAtom)
  const actions = useAtomValue(canvasActionsAtom)
  const nodeToDeleteId = useAtomValue(nodeToDeleteIdAtom)
  return {
    isBuildMode,
    nodeToDeleteId,
    onRequestDeleteNode: actions?.onRequestDeleteNode ?? (() => {}),
    onConfirmDeleteNode: actions?.onConfirmDeleteNode ?? (() => {}),
    onCancelDeleteNode: actions?.onCancelDeleteNode ?? (() => {}),
  }
}
