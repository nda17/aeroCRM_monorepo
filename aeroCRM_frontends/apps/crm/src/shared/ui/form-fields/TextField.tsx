import clsx from 'clsx'
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

import styles from './FormField.module.scss'
import { joinDescriptionIds } from './field-a11y'

export interface TextFieldProps extends Omit<
	InputHTMLAttributes<HTMLInputElement>,
	'size'
> {
	label: ReactNode
	hint?: ReactNode
	error?: ReactNode
	labelHidden?: boolean
	containerClassName?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
	(
		{
			label,
			hint,
			error,
			labelHidden = false,
			containerClassName,
			className,
			id,
			required,
			type = 'text',
			'aria-describedby': ariaDescribedBy,
			'aria-invalid': ariaInvalid,
			...props
		},
		ref
	) => {
		const generatedId = useId()
		const fieldId = id ?? `text-field-${generatedId}`
		const hasHint = hint !== undefined && hint !== null
		const hasError = error !== undefined && error !== null
		const hintId = hasHint ? `${fieldId}-hint` : undefined
		const errorId = hasError ? `${fieldId}-error` : undefined
		const describedBy = joinDescriptionIds(
			ariaDescribedBy,
			hintId,
			errorId
		)

		return (
			<div className={clsx(styles.field, containerClassName)}>
				<label
					htmlFor={fieldId}
					className={clsx(styles.label, labelHidden && styles.labelHidden)}
				>
					{label}
					{required ? (
						<span className={styles.requiredMark} aria-hidden="true">
							*
						</span>
					) : null}
				</label>
				<input
					ref={ref}
					id={fieldId}
					type={type}
					required={required}
					className={clsx(styles.control, styles.input, className)}
					aria-describedby={describedBy}
					aria-invalid={hasError ? true : ariaInvalid}
					{...props}
				/>
				{hasHint ? (
					<div id={hintId} className={styles.hint}>
						{hint}
					</div>
				) : null}
				{hasError ? (
					<div id={errorId} className={styles.error} role="alert">
						{error}
					</div>
				) : null}
			</div>
		)
	}
)

TextField.displayName = 'TextField'
