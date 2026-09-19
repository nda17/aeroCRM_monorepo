import { axiosInterceptorsRequest } from '@/shared/api'

export type AdminHealthStatus = 'ok' | 'warning' | 'down' | 'disabled'

export type AdminHealthCheck = {
	id: string
	title: string
	status: AdminHealthStatus
	message: string
	latencyMs?: number
}

export type AdminHealthResponse = {
	generatedAt: string
	mode: string
	uptimeSeconds: number
	checks: AdminHealthCheck[]
}

class AdminHealthService {
	async get() {
		const { data } =
			await axiosInterceptorsRequest.get<AdminHealthResponse>(
				'/health/admin'
			)

		return data
	}
}

const adminHealthService = new AdminHealthService()

export default adminHealthService
