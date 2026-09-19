import { IUser } from '@/entities/user/model/user.types'

export interface IUserEditInput extends Omit<
	IUser,
	'createdAt' | 'rights' | 'avatarPath'
> {
	isPhoneVerified?: boolean
	isUser?: boolean
	isAdmin?: boolean
	isDev?: boolean
}
