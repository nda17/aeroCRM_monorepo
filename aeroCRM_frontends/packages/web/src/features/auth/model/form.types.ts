import type { IUser } from '@/entities/user'

export interface IFormData extends Pick<IUser, 'email' | 'phone'> {
	password: string
	code?: string
}

export interface IEmail {
	email: string
}

export interface IRestorePassword {
	email?: string
	phone?: string
}
