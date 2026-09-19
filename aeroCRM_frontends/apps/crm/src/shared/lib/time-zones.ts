export const isIanaTimeZone = (value: unknown): value is string => {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 100 ||
		/^[+-]/.test(value)
	)
		return false
	try {
		new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
		return true
	} catch {
		return false
	}
}

const russianZones = [
	['Europe/Kaliningrad', 'Калининград'],
	['Europe/Moscow', 'Москва, Санкт-Петербург'],
	['Europe/Kirov', 'Киров'],
	['Europe/Volgograd', 'Волгоград'],
	['Europe/Samara', 'Самара'],
	['Europe/Astrakhan', 'Астрахань'],
	['Europe/Saratov', 'Саратов'],
	['Europe/Ulyanovsk', 'Ульяновск'],
	['Asia/Yekaterinburg', 'Екатеринбург'],
	['Asia/Omsk', 'Омск'],
	['Asia/Novosibirsk', 'Новосибирск'],
	['Asia/Barnaul', 'Барнаул'],
	['Asia/Tomsk', 'Томск'],
	['Asia/Novokuznetsk', 'Новокузнецк'],
	['Asia/Krasnoyarsk', 'Красноярск'],
	['Asia/Irkutsk', 'Иркутск'],
	['Asia/Chita', 'Чита'],
	['Asia/Yakutsk', 'Якутск'],
	['Asia/Khandyga', 'Хандыга'],
	['Asia/Vladivostok', 'Владивосток'],
	['Asia/Ust-Nera', 'Усть-Нера'],
	['Asia/Magadan', 'Магадан'],
	['Asia/Sakhalin', 'Сахалин'],
	['Asia/Srednekolymsk', 'Среднеколымск'],
	['Asia/Kamchatka', 'Петропавловск-Камчатский'],
	['Asia/Anadyr', 'Анадырь']
] as const
const internationalZones = [
	['UTC', 'Всемирное время (UTC)'],
	['Europe/Minsk', 'Минск'],
	['Europe/Kyiv', 'Киев'],
	['Asia/Almaty', 'Алматы'],
	['Asia/Tashkent', 'Ташкент'],
	['Asia/Tbilisi', 'Тбилиси'],
	['Asia/Yerevan', 'Ереван'],
	['Asia/Dubai', 'Дубай'],
	['Europe/Istanbul', 'Стамбул'],
	['Europe/London', 'Лондон'],
	['Europe/Berlin', 'Берлин'],
	['Europe/Paris', 'Париж'],
	['Asia/Bangkok', 'Бангкок'],
	['Asia/Shanghai', 'Шанхай'],
	['Asia/Singapore', 'Сингапур'],
	['Asia/Tokyo', 'Токио'],
	['America/New_York', 'Нью-Йорк'],
	['America/Los_Angeles', 'Лос-Анджелес'],
	['Australia/Sydney', 'Сидней']
] as const

export interface WorkdayTimeZoneOption {
	value: string
	label: string
	disabled?: boolean
}
export interface WorkdayTimeZoneGroup {
	label: string
	options: WorkdayTimeZoneOption[]
}

/** Called only after hydration. Older Intl implementations retain the popular
 * choices and the exact saved valid alias; they must not reset that value. */
export const browserWorkdayTimeZones = (): readonly string[] => {
	try {
		return typeof Intl.supportedValuesOf === 'function'
			? Intl.supportedValuesOf('timeZone')
			: []
	} catch {
		return []
	}
}

export const workdayTimeZoneGroups = (
	current: string,
	browserZones: readonly string[] | null
): WorkdayTimeZoneGroup[] => {
	// null is the deterministic server/initial hydration snapshot, independent
	// of ICU versions or the device's timezone. Never infer/change the selection.
	const supported = (value: string) =>
		browserZones === null || isIanaTimeZone(value)
	const seen = new Set<string>()
	const popular = (
		rows: readonly (readonly [string, string])[]
	): WorkdayTimeZoneOption[] =>
		rows
			.filter(([value]) => supported(value))
			.map(([value, label]) => {
				seen.add(value)
				return { value, label }
			})
	const groups: WorkdayTimeZoneGroup[] = [
		{ label: 'Россия', options: popular(russianZones) },
		{
			label: 'Популярные в других странах',
			options: popular(internationalZones)
		}
	]
	const other = [...new Set(browserZones ?? [])]
		.filter(value => !seen.has(value) && supported(value))
		.sort()
		.map(value => ({ value, label: value.replaceAll('_', ' ') }))
	for (const option of other) seen.add(option.value)
	if (other.length)
		groups.push({ label: 'Все остальные часовые пояса', options: other })
	if (current && !seen.has(current)) {
		groups.unshift({
			label: 'Текущий часовой пояс',
			options: [
				{
					value: current,
					label: current,
					// A saved alias not returned by supportedValuesOf remains selectable
					// after browser validation; an invalid value is visible but disabled.
					disabled: browserZones === null || !isIanaTimeZone(current)
				}
			]
		})
	}
	return groups
}
