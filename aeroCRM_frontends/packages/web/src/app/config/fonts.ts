import localFont from 'next/font/local'

export const brandUnbounded = localFont({
	src: [
		{
			path: '../fonts/unbounded/Unbounded-SemiBold.woff2',
			weight: '600',
			style: 'normal'
		},
		{
			path: '../fonts/unbounded/Unbounded-Bold.woff2',
			weight: '700',
			style: 'normal'
		}
	],
	variable: '--font-unbounded',
	display: 'swap',
	preload: false,
	fallback: ['system-ui', 'sans-serif']
})
