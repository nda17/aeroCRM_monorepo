import { IUser } from '@/entities/user/model/user.types'

export interface IUserInfo extends Pick<IUser, 'avatarPath' | 'name'> {
	isLoading: boolean
}
