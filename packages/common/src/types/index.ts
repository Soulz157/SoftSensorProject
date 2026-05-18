export type ResponseType = 'SUCCESS' | 'ERROR' | 'WARNING'

export interface ApiResponse {
  statusCode: number
  message: string
  data?: any
  type: ResponseType
  timestamp: string
  isException: boolean
}
