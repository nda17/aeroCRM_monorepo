import { UserRole } from '@/entities/user/model/auth.types'

export type UserLoginMethod =
	| 'EMAIL'
	| 'PHONE'
	| 'GOOGLE'
	| 'GITHUB'
	| 'YANDEX'
	| 'VK'
	| 'TELEGRAM'

export type UserStatus = 'ACTIVE' | 'DEACTIVATED'

export interface IUser {
	id: string
	name?: string
	email?: string | null
	phone?: string | null
	isPhoneVerified?: boolean
	loginMethods?: UserLoginMethod[]
	password?: string
	avatarPath: string | null
	status: UserStatus
	personalDataConsentRevokedAt?: string | null
	deletedAt?: string | null
	rights: UserRole[]
	createdAt: string
	updatedAt: string
}
