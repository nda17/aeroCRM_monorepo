import { AppIconName } from '@/shared/types/icon.types'

export interface IMenuItem {
	icon: AppIconName
	title: string
	link: string
	disabled?: boolean
	tooltip?: string
}
