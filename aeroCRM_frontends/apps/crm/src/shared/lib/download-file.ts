// Called only after explicit user action and successful domain validation.
export const downloadFile = (
	bytes: Uint8Array<ArrayBuffer>,
	filename: string,
	mediaType: string
) => {
	if (
		!/^[a-z0-9][a-z0-9_-]*\.(?:json|csv)$/.test(filename) ||
		![
			'application/json; charset=utf-8',
			'text/csv; charset=utf-8'
		].includes(mediaType)
	)
		throw new Error('Invalid download metadata')
	const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }))
	const link = document.createElement('a')
	try {
		link.href = url
		link.download = filename
		document.body.appendChild(link)
		link.click()
	} finally {
		link.remove()
		window.setTimeout(() => URL.revokeObjectURL(url), 0)
	}
}
