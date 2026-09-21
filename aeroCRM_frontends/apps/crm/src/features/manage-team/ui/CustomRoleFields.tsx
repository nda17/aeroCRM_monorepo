import { SelectField, TextField } from '@/shared/ui'
import type { CustomRoleInput } from '@/entities/crm-team'
import {
	normalizeRoleName,
	type CustomRolePermission,
	type CustomRoleScope
} from '@/shared/lib/custom-role'
import styles from './TeamEditor.module.scss'

export const CustomRoleFields = ({
	value,
	onChange,
	disabled
}: {
	value: CustomRoleInput
	onChange: (value: CustomRoleInput) => void
	disabled: boolean
}) => (
	<>
		<TextField
			label="Название роли"
			value={value.name}
			maxLength={80}
			autoCapitalize="sentences"
			placeholder="Старший менеджер"
			required
			disabled={disabled}
			onChange={event => onChange({ ...value, name: event.target.value })}
			onBlur={() =>
				onChange({ ...value, name: normalizeRoleName(value.name) })
			}
		/>
		<p className={styles.muted}>
			На русском, с заглавной буквы. Можно использовать пробелы, цифры и
			дефис.
		</p>
		{(
			[
				['customers', 'Контакты и компании'],
				['intake', 'Обращения'],
				['sales', 'Сделки, задачи и планировщик']
			] as const
		).map(([section, label]) => (
			<SelectField
				key={section}
				label={label}
				disabled={disabled}
				value={
					value.permissions.includes(`${section}:write`)
						? 'write'
						: value.permissions.includes(`${section}:read`)
							? 'read'
							: 'none'
				}
				onChange={event => {
					const level = event.target.value
					const permissions = value.permissions.filter(
						permission =>
							![`${section}:read`, `${section}:write`].includes(permission)
					)
					if (level !== 'none')
						permissions.push(`${section}:read` as CustomRolePermission)
					if (level === 'write')
						permissions.push(`${section}:write` as CustomRolePermission)
					onChange({ ...value, permissions })
				}}
			>
				<option value="none">Нет доступа</option>
				<option value="read">Только просмотр</option>
				<option value="write">Просмотр и изменение</option>
			</SelectField>
		))}
		<label className={styles.check}>
			<input
				type="checkbox"
				disabled={disabled}
				checked={value.permissions.includes('sales:analytics')}
				onChange={event =>
					onChange({
						...value,
						permissions: event.target.checked
							? [...value.permissions, 'sales:analytics']
							: value.permissions.filter(
									permission => permission !== 'sales:analytics'
								)
					})
				}
			/>
			<span>Просмотр аналитики продаж</span>
		</label>
		<SelectField
			label="Какие данные доступны"
			value={value.dataScope}
			disabled={disabled}
			onChange={event =>
				onChange({
					...value,
					dataScope: event.target.value as CustomRoleScope
				})
			}
		>
			<option value="OWN">Свои записи</option>
			<option value="TEAM">Записи своих отделов</option>
			<option value="ALL">Все записи пространства</option>
		</SelectField>
		<p className={styles.muted}>
			Изменение включает создание, редактирование и архивирование в
			выбранном разделе. Для принятия обращения в работу нужны права
			изменения обращений, контактов и сделок. Аналитика без просмотра
			сделок показывает только общие показатели.
		</p>
	</>
)
