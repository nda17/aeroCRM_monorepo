declare module '*.avif' {
	const value: import('next/image').StaticImageData
	export default value
}

declare module '*.webp' {
	const value: import('next/image').StaticImageData
	export default value
}
