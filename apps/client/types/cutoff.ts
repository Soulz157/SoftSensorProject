export type CutoffOp = '>' | '>=' | '<' | '<=' | '==' | '!='
export type CutoffMode = 'highlight' | 'clip'

export interface CutoffRule {
  id: string
  tag: string
  op: CutoffOp
  value: number | ''
  mode: CutoffMode
  enabled: boolean
}
