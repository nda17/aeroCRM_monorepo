/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	headers: () => [],
	images: {
		remotePatterns: [
			{
				protocol: 'https',
				hostname: 'lh3.googleusercontent.com',
				port: '',
				pathname: '/**'
			},
			{
				protocol: 'https',
				hostname: 'avatars.yandex.net',
				port: '',
				pathname: '/**'
			},
			{
				protocol: 'https',
				hostname: 's3.twcstorage.ru',
				port: '',
				pathname: '/**'
			},
			{
				protocol: 'https',
				hostname: 'cdn.aerocrm.space',
				port: '',
				pathname: '/**'
			}
		]
	}
}

export default nextConfig
