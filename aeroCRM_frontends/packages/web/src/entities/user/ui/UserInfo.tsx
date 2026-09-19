import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import styles from '@/entities/user/ui/UserInfo.module.scss'
import { IUserInfo } from '@/entities/user/ui/user-info.interface'
import { NextPage } from 'next'
import Image from 'next/image'

const UserInfo: NextPage<IUserInfo> = ({
	avatarPath,
	name,
	isLoading
}: IUserInfo) => {
	const DEFAULT_AVATAR = '/avatar-default.png'
	const imageSrc = encodeURI(avatarPath || DEFAULT_AVATAR)

	return (
		<div className={styles.wrapper}>
			{isLoading ? (
				<div className="w-[4.375rem] h-[4.375rem] rounded-full">
					<SkeletonLoader count={1} circle className="w-full h-full" />
				</div>
			) : (
				<Image
					className={styles.image}
					src={imageSrc}
					alt="Avatar"
					width={70}
					height={70}
					unoptimized
					onError={e => {
						;(e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR
					}}
				/>
			)}

			{isLoading ? (
				<div className="w-[10rem] h-5">
					<SkeletonLoader count={1} className="w-full h-full" />
				</div>
			) : (
				<h2 className={styles.subtitle}>{name || 'Пользователь'}</h2>
			)}
		</div>
	)
}

export default UserInfo
