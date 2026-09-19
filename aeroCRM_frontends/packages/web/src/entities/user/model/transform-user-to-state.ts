import {
	type ITokenInside,
	UserRole,
	type TProtectUserData
} from '@/entities/user/model/auth.types'

export type TUserDataState = {
	id: string
	rights: UserRole[]
	isLoggedIn: boolean
	isAdmin: boolean
	isDev: boolean
}

export const transformUserToState = (
	user: TProtectUserData | ITokenInside
): TUserDataState | null => {
	const id = 'sub' in user ? user.sub : user.id
	const rights = 'roles' in user ? user.roles : user.rights

	return {
		id,
		rights,
		isLoggedIn: true,
		isAdmin: rights.includes(UserRole.ADMIN),
		isDev: rights.includes(UserRole.DEV)
	}
}
