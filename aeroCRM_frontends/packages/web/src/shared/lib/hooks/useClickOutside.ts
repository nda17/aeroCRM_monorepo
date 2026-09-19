import { useEffect } from 'react'

const useClickOutside = (
	ref: React.MutableRefObject<HTMLElement | null>,
	callback: () => void
) => {
	useEffect(() => {
		const handleClick = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				callback()
			}
		}

		document.addEventListener('mouseup', handleClick)

		return () => {
			document.removeEventListener('mouseup', handleClick)
		}
	}, [callback, ref])
}

export { useClickOutside }
