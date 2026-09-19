export interface INavItem {
	title: string
	link: string
	option?: string | undefined
	devOnly?: boolean
}

export interface IAdminNavGroup {
	id: string
	title: string
	description: string
	items: INavItem[]
}
