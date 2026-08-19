'use client'

import { useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { toast } from 'sonner'
import type { PresetSummary, SdtaConfig } from '@/lib/feature-preset'
import { sdtaPresetName, toSdtaPreset } from '@/lib/feature-preset-apply'
import { dwStageSdtaPresetAtom } from '@/store/dataset-studio'

export function useStageSdtaPreset() {
  const stage = useSetAtom(dwStageSdtaPresetAtom)

  return useCallback(
    (
      config: SdtaConfig,
      summary: PresetSummary | null,
      importFileName: string,
    ) => {
      // SD&TA belongs to the import, not to whichever preset happens to be
      // selected — `summary` is null whenever the user staged the cut with
      // no preset chosen, and the import's own file name names the preset
      // just as well in that case.
      const name = summary ? sdtaPresetName(summary) : importFileName
      const preset = toSdtaPreset(config, name)
      const result = stage(preset)
      // Staged, NOT applied: nothing is cut until the user picks a combine mode
      // and presses Apply in the card. Saying "applied" here would be the same
      // failure the empty-draft toast fix addressed.
      if (result === 'empty') {
        toast.info(`${preset.name} declares no shutdown windows or conditions`)
      } else if (result === 'staged') {
        toast.success(`${preset.name} staged — choose it in Step 3.2 to cut`)
      }
      return result
    },
    [stage],
  )
}
