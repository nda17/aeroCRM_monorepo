import styles from '@/shared/ui/form-elements/auth-page/field-password/FieldPassword.module.scss'
import { IField } from '@/shared/ui/form-elements/form.interface'
import AppIcon from '@/shared/ui/icons/AppIcon'
import clsx from 'clsx'
import { forwardRef, useId, useState } from 'react'

const FieldPassword = forwardRef<HTMLInputElement, IField>(
	({ error, type = 'password', style, ...rest }, ref) => {
		const [typeInputPassword, setTypeInputPassword] = useState(true)
		const generatedId = useId()
		const inputId = rest.id || generatedId
		const errorId = error?.message ? `${inputId}-error` : undefined

		const toggleVisiblePassword = () => {
			setTypeInputPassword(!typeInputPassword)
		}

		return (
			<div className={clsx(styles['wrapper-input'])} style={style}>
				<div className={clsx(styles['label-input'])}>
					<input
						className={clsx(styles['input-field'])}
						ref={ref}
						id={inputId}
						type={typeInputPassword ? type : 'text'}
						{...rest}
						autoComplete="on"
						aria-invalid={Boolean(error?.message)}
						aria-describedby={errorId}
						aria-label={
							rest['aria-label'] || rest.placeholder || rest.name
						}
					/>
					<button
						type="button"
						className={clsx(styles['toggle-visible-password'])}
						onClick={toggleVisiblePassword}
						aria-label={
							typeInputPassword ? 'Показать пароль' : 'Скрыть пароль'
						}
					>
						{typeInputPassword ? (
							<AppIcon name="eye" />
						) : (
							<AppIcon name="eye-off" />
						)}
					</button>
				</div>
				{error?.message && (
					<p id={errorId} className={clsx(styles['error-message'])}>
						{String(error.message)}
					</p>
				)}
			</div>
		)
	}
)

FieldPassword.displayName = 'FieldPassword'

export default FieldPassword
