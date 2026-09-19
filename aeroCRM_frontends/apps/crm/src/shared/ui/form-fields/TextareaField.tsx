import clsx from 'clsx'
import { forwardRef, useId } from 'react'
import type { ReactNode, TextareaHTMLAttributes } from 'react'

import styles from './FormField.module.scss'
import { joinDescriptionIds } from './field-a11y'

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	label: ReactNode
	hint?: ReactNode
	error?: ReactNode
	labelHidden?: boolean
	containerClassName?: string
}

export const TextareaField = forwardRef<
	HTMLTextAreaElement,
	TextareaFieldProps
>(
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
			rows = 4,
			'aria-describedby': ariaDescribedBy,
			'aria-invalid': ariaInvalid,
			...props
		},
		ref
	) => {
		const generatedId = useId()
		const fieldId = id ?? `textarea-field-${generatedId}`
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
				<textarea
					ref={ref}
					id={fieldId}
					required={required}
					rows={rows}
					className={clsx(styles.control, styles.textarea, className)}
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

TextareaField.displayName = 'TextareaField'
