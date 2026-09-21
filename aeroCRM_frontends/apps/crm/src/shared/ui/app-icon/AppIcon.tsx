import type { ReactNode, SVGProps } from 'react'

export const appIconNames = [
	'eye',
	'eyeOff',
	'google',
	'yandex',
	'vk',
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
	eye: (
		<g>
			<path d="M2.75 12s3.35-6.25 9.25-6.25S21.25 12 21.25 12 17.9 18.25 12 18.25 2.75 12 2.75 12z" />
			<circle cx="12" cy="12" r="2.7" />
		</g>
	),
	eyeOff: (
		<g>
			<path d="m4 4 16 16" />
			<path d="M10.7 5.9c.42-.1.85-.15 1.3-.15 5.9 0 9.25 6.25 9.25 6.25a17.1 17.1 0 0 1-2.55 3.2" />
			<path d="M14.15 14.2A2.7 2.7 0 0 1 9.8 9.85" />
			<path d="M7.55 7.25C4.45 8.95 2.75 12 2.75 12s3.35 6.25 9.25 6.25c1.55 0 2.9-.42 4.05-1.05" />
		</g>
	),
	google: (
		<g stroke="none">
			<path
				fill="currentColor"
				d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
			/>
		</g>
	),
	yandex: (
		<g stroke="none">
			<path
				fill="currentColor"
				d="M2.04 12c0-5.523 4.476-10 10-10 5.522 0 10 4.477 10 10s-4.478 10-10 10c-5.524 0-10-4.477-10-10z"
			/>
			<path
				fill="#fff"
				d="M13.32 7.666h-.924c-1.694 0-2.585.858-2.585 2.123 0 1.43.616 2.1 1.881 2.959l1.045.704-3.003 4.487H7.49l2.695-4.014c-1.55-1.111-2.42-2.19-2.42-4.015 0-2.288 1.595-3.85 4.62-3.85h3.003v11.868H13.32V7.666z"
			/>
		</g>
	),
	vk: (
		<g stroke="none">
			<path
				fill="currentColor"
				d="m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z"
			/>
		</g>
	),

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
