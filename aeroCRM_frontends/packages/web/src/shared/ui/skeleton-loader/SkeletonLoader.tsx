import clsx from 'clsx'
import { FC } from 'react'
import Skeleton, { SkeletonProps } from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'

const SkeletonLoader: FC<SkeletonProps> = ({ className, ...rest }) => {
	return (
		<Skeleton
			{...rest}
			baseColor="#ede7f8"
			highlightColor="#f8f5ff"
			className={clsx(['rounded-lg', 'select-none'], className)}
		/>
	)
}

export default SkeletonLoader
