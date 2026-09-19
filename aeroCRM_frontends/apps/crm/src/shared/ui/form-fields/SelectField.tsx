import clsx from 'clsx'
import { forwardRef, useId } from 'react'
import type { ReactNode, SelectHTMLAttributes } from 'react'

import { AppIcon } from '../app-icon'
import styles from './FormField.module.scss'
import { joinDescriptionIds } from './field-a11y'

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
	label: ReactNode
	hint?: ReactNode
	error?: ReactNode
	labelHidden?: boolean
	containerClassName?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
	(
		{
			label,
			hint,
			error,
			labelHidden = false,
			containerClassName,
			className,
			children,
			id,
			required,
			'aria-describedby': ariaDescribedBy,
			'aria-invalid': ariaInvalid,
			...props
		},
		ref
	) => {
		const generatedId = useId()
		const fieldId = id ?? `select-field-${generatedId}`
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
				<div className={styles.selectWrapper}>
					<select
						ref={ref}
						id={fieldId}
						required={required}
						className={clsx(styles.control, styles.select, className)}
						aria-describedby={describedBy}
						aria-invalid={hasError ? true : ariaInvalid}
						{...props}
					>
						{children}
					</select>
					<span className={styles.selectIcon} aria-hidden="true">
						<AppIcon name="chevronDown" size={18} />
					</span>
				</div>
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

SelectField.displayName = 'SelectField'
