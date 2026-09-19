import styles from '@/shared/ui/form-elements/admin-page/field-email/FieldEmail.module.scss'
import { IField } from '@/shared/ui/form-elements/form.interface'
import clsx from 'clsx'
import { forwardRef, useId } from 'react'

const FieldEmail = forwardRef<HTMLInputElement, IField>(
	({ error, placeholder, type = 'text', style, ...rest }, ref) => {
		const generatedId = useId()
		const inputId = rest.id || generatedId
		const errorId = error?.message ? `${inputId}-error` : undefined

		return (
			<div className={clsx(styles['wrapper-input'])} style={style}>
				<label className={clsx(styles['label-input'])}>
					<input
						placeholder={placeholder}
						className={clsx(styles['input-field'])}
						ref={ref}
						id={inputId}
						type={type}
						{...rest}
						autoComplete="on"
						aria-invalid={Boolean(error?.message)}
						aria-describedby={errorId}
						aria-label={rest['aria-label'] || placeholder || rest.name}
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

FieldEmail.displayName = 'FieldEmail'

export default FieldEmail
