import { adminMiddleware } from '@/app/middlewares/adminMiddleware'
import { NextRequest } from 'next/server'

export const config = { matcher: ['/admin/:path*'] }
export const middleware = (request: NextRequest) =>
	adminMiddleware(request)
