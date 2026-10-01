import type { ImportEntity } from '@/entities/crm-import/model/import.contract'

const field = (key: string, label: string, aliases: string[] = []) => ({
	key,
	label,
	aliases: [key.toLowerCase(), label.toLowerCase(), ...aliases]
})
const externalId = field('externalId', 'ID в исходной системе', [
	'id',
	'ид',
	'внешний код',
	'external id'
])
const name = field('name', 'Название / полное имя', [
	'name',
	'название',
	'имя',
	'фио',
	'наименование',
	'full name'
])
const notes = field('notes', 'Заметки', [
	'комментарий',
	'комментарии',
	'description',
	'описание'
])
export const importFields = {
	companies: [
		externalId,
		name,
		field('inn', 'ИНН'),
		field('website', 'Сайт', ['web', 'website 1 - value']),
		field('legalName', 'Юридическое наименование'),
		field('kpp', 'КПП'),
		field('ogrn', 'ОГРН'),
		field('legalAddress', 'Юридический адрес'),
		field('entityType', 'Тип организации'),
		notes
	],
	contacts: [
		externalId,
		field('name', 'Полное имя', ['name', 'фио', 'full name']),
		field('firstName', 'Имя', ['first name', 'given name']),
		field('middleName', 'Отчество', ['middle name', 'additional name']),
		field('lastName', 'Фамилия', ['last name', 'family name']),
		field('phone', 'Телефон', [
			'phone 1 - value',
			'phone',
			'mobile phone',
			'мобильный телефон',
			'рабочий телефон'
		]),
		field('email', 'Email', [
			'email 1 - value',
			'e-mail 1 - value',
			'e-mail',
			'электронная почта',
			'рабочий e-mail'
		]),
		field('companyExternalId', 'ID компании в исходной системе', [
			'company id'
		]),
		field('companyId', 'ID компании в aeroCRM'),
		notes,
		field('timeZone', 'Часовой пояс'),
		field('preferredCallStart', 'Звонки с'),
		field('preferredCallEnd', 'Звонки до')
	],
	deals: [
		externalId,
		field('title', 'Название сделки', ['название', 'name', 'title']),
		field('amount', 'Сумма', ['сумма сделки', 'opportunity', 'amount']),
		field('currency', 'Валюта'),
		field('contactExternalId', 'ID контакта в исходной системе', [
			'contact id',
			'ид контакта'
		]),
		field('contactId', 'ID контакта в aeroCRM'),
		field('stageKey', 'Код этапа в исходной системе', [
			'stage_id',
			'stage id'
		]),
		field('stageName', 'Название этапа в исходной системе', [
			'стадия сделки',
			'этап',
			'стадия',
			'stage'
		]),
		field('stageId', 'ID этапа в aeroCRM'),
		field('createdAt', 'Дата создания', ['created at', 'date_create'])
	]
} satisfies Record<ImportEntity, ReturnType<typeof field>[]>

export const suggestImportMapping = (
	entity: ImportEntity,
	headers: string[]
) => {
	const used = new Set<string>()
	return Object.fromEntries(
		importFields[entity].map(item => {
			const header = headers.find(
				value =>
					!used.has(value) &&
					item.aliases.includes(value.trim().toLowerCase())
			)
			if (header) used.add(header)
			return [item.key, header || '']
		})
	)
}

export const importLabels = {
	companies: 'компаний',
	contacts: 'контактов',
	deals: 'сделок'
}
export const importTemplates = {
	companies:
		'externalId;name;inn;website;notes\r\ncompany-001;Компания-пример;;;Образец: удалите строку перед импортом\r\n',
	contacts:
		'externalId;name;phone;email;companyExternalId;notes\r\ncontact-001;Иван Петров;+79991234567;example@example.com;company-001;Образец: удалите строку перед импортом\r\n',
	deals:
		'externalId;title;amount;currency;contactExternalId;stageName;createdAt\r\ndeal-001;Пример сделки;5000;RUB;contact-001;Новая;2026-10-01T09:00:00Z\r\n'
}
