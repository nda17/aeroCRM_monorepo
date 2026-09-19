import styles from '@/shared/ui/form-elements/admin-page/field-phone/FieldPhone.module.scss'
import { IField } from '@/shared/ui/form-elements/form.interface'
import clsx from 'clsx'
import { forwardRef, useId } from 'react'

const FieldPhone = forwardRef<HTMLInputElement, IField>(
	({ error, type = 'tel', style, ...rest }, ref) => {
		const generatedId = useId()
		const inputId = rest.id || generatedId
		const errorId = error?.message ? `${inputId}-error` : undefined

		return (
			<div className={clsx(styles['wrapper-input'])} style={style}>
				<label className={clsx(styles['label-input'])}>
					<input
						className={clsx(styles['input-field'])}
						ref={ref}
						id={inputId}
						type={type}
						{...rest}
						autoComplete="on"
						aria-invalid={Boolean(error?.message)}
						aria-describedby={errorId}
						aria-label={
							rest['aria-label'] || rest.placeholder || rest.name
						}
					/>
				</label>
				{error?.message && (
					<p id={errorId} className={clsx(styles['error-message'])}>
						{String(error.message)}
					</p>
				)}
			</div>
		)
	}
)

FieldPhone.displayName = 'FieldPhone'

export default FieldPhone
