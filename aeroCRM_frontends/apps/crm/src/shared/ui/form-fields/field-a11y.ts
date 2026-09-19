export const joinDescriptionIds = (
	...ids: Array<string | undefined>
): string | undefined => {
	const descriptionIds = ids.filter((id): id is string => Boolean(id))
	return descriptionIds.length ? descriptionIds.join(' ') : undefined
}
