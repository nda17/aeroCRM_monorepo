import type { ReactNode, SVGProps } from 'react'

export const appIconNames = [
	'inbox',
	'bell',
	'deals',
	'tasks',
	'contacts',
	'analytics',
	'settings',
	'moon',
	'monitor',
	'products',
	'menu',
	'search',
	'plus',
	'filter',
	'chevronDown',
	'close',
	'refresh',
	'lock',
	'alert',
	'check',
	'clock',
	'more'
] as const

export type AppIconName = (typeof appIconNames)[number]

export interface AppIconProps extends Omit<
	SVGProps<SVGSVGElement>,
	'children'
> {
	name: AppIconName
	size?: number
	title?: string
}

const iconRegistry: Record<AppIconName, ReactNode> = {
	bell: (
		<>
			<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
		</>
	),
	inbox: (
		<>
			<path d="M4 5.5h16v13H4z" />
			<path d="M4 13h4l1.5 2h5L16 13h4" />
		</>
	),
	deals: (
		<>
			<path d="M4 7.5h16v11H4z" />
			<path d="M9 7.5V5.25h6V7.5M4 11.5h16M10 11.5v2h4v-2" />
		</>
	),
	tasks: (
		<>
			<path d="M8 4h8v3H8z" />
			<path d="M7 5.5H5.5v15h13v-15H17" />
			<path d="m8.25 13 2 2 5-5" />
		</>
	),
	contacts: (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3.5 19c.5-3.3 2.3-5 5.5-5s5 1.7 5.5 5" />
			<path d="M15 6.2a3 3 0 0 1 0 5.6M16 14c2.6.2 4 1.9 4.5 5" />
		</>
	),
	analytics: (
		<>
			<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M3 20h18" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3.25" />
			<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" />
		</>
	),
	menu: <path d="M4 7h16M4 12h16M4 17h16" />,
	products: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1.5" />
			<rect x="14" y="3" width="7" height="7" rx="1.5" />
			<rect x="3" y="14" width="7" height="7" rx="1.5" />
			<rect x="14" y="14" width="7" height="7" rx="1.5" />
		</>
	),
	moon: <path d="M20 14.4A8.5 8.5 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4Z" />,
	monitor: (
		<>
			<rect x="3" y="4" width="18" height="13" rx="2" />
			<path d="M8 21h8M12 17v4" />
		</>
	),
	search: (
		<>
			<circle cx="10.5" cy="10.5" r="6.5" />
			<path d="m15.5 15.5 4.5 4.5" />
		</>
	),
	plus: <path d="M12 5v14M5 12h14" />,
	filter: <path d="M4 6h16l-6.25 7v5l-3.5 1.5V13z" />,
	chevronDown: <path d="m6 9 6 6 6-6" />,
	close: <path d="m6 6 12 12M18 6 6 18" />,
	refresh: (
		<>
			<path d="M20 6v5h-5" />
			<path d="M18.2 16a8 8 0 1 1 .9-7.8L20 11" />
		</>
	),
	lock: (
		<>
			<rect x="5" y="10" width="14" height="10" rx="2" />
			<path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
		</>
	),
	alert: (
		<>
			<path d="M12 4 21 20H3z" />
			<path d="M12 9v5M12 17.25v.25" />
		</>
	),
	check: <path d="m5 12 4.5 4.5L19 7" />,
	clock: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7v5l3.5 2" />
		</>
	),
	more: (
		<>
			<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
			<circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
		</>
	)
}

export const AppIcon = ({
	name,
	size = 20,
	title,
	...props
}: AppIconProps) => {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			focusable="false"
			role={title ? 'img' : undefined}
			aria-hidden={title ? undefined : true}
			aria-label={title}
			{...props}
		>
			{iconRegistry[name]}
		</svg>
	)
}
