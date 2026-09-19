export enum UserRole {
	USER = 'USER',
	ADMIN = 'ADMIN',
	DEV = 'DEV'
}

export interface ITokenInside {
	sub: string
	sid: string
	roles: UserRole[]
	token_use: 'access'
	iss: string
	aud: string
	jti: string
	iat: number
	nbf: number
	exp: number
}

export interface TProtectUserData {
	id: string
	rights: UserRole[]
}
