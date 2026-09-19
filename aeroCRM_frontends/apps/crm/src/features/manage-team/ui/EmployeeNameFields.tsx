import type { EmployeeName } from '@/entities/crm-team'
import { TextField } from '@/shared/ui'

export const EmployeeNameFields = ({
	value,
	disabled,
	onChange
}: {
	value: EmployeeName
	disabled: boolean
	onChange: (value: EmployeeName) => void
}) => (
	<>
		{(['lastName', 'firstName', 'middleName'] as const).map(field => (
			<TextField
				key={field}
				label={
					{
						lastName: 'Фамилия',
						firstName: 'Имя',
						middleName: 'Отчество (необязательно)'
					}[field]
				}
				value={value[field] ?? ''}
				autoComplete="off"
				maxLength={100}
				required={field !== 'middleName'}
				disabled={disabled}
				onChange={event =>
					onChange({ ...value, [field]: event.target.value })
				}
			/>
		))}
	</>
)
