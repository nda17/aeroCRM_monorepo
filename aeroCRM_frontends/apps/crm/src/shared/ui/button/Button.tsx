'use client'

import clsx from 'clsx'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import styles from './Button.module.scss'
import { useTooltip } from '../tooltip/use-tooltip'

export type ButtonVariant =
	| 'primary'
	| 'accent'
	| 'secondary'
	| 'ghost'
	| 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant
	size?: ButtonSize
	fullWidth?: boolean
	isLoading?: boolean
	leadingIcon?: ReactNode
	trailingIcon?: ReactNode
	tooltip?: string
	disabledTooltip?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			variant = 'primary',
			size = 'md',
			fullWidth = false,
			isLoading = false,
			leadingIcon,
			trailingIcon,
			tooltip,
			disabledTooltip,
			className,
			children,
			disabled,
			type = 'button',
			...props
		},
		ref
	) => {
		const description = isLoading
			? tooltip || disabledTooltip
				? 'Запрос выполняется. Дождитесь результата, прежде чем повторять действие.'
				: undefined
			: disabled
				? (disabledTooltip ?? tooltip)
				: tooltip
		const hint = useTooltip<HTMLButtonElement>(description)
		const hintProps: typeof hint.triggerProps = description
			? hint.triggerProps
			: {}
		return (
			<>
				<button
					ref={ref}
					type={type}
					className={clsx(
						styles.button,
						styles[variant],
						styles[size],
						fullWidth && styles.fullWidth,
						className
					)}
					disabled={disabled || isLoading}
					aria-busy={isLoading || undefined}
					{...props}
					aria-describedby={
						[props['aria-describedby'], hintProps['aria-describedby']]
							.filter(Boolean)
							.join(' ') || undefined
					}
					onPointerEnter={event => {
						hintProps.onPointerEnter?.(event)
						props.onPointerEnter?.(event)
					}}
					onPointerLeave={event => {
						hintProps.onPointerLeave?.(event)
						props.onPointerLeave?.(event)
					}}
					onPointerDown={event => {
						hintProps.onPointerDown?.(event)
						props.onPointerDown?.(event)
					}}
					onKeyDown={event => {
						hintProps.onKeyDown?.(event)
						props.onKeyDown?.(event)
					}}
					onFocus={event => {
						hintProps.onFocus?.(event)
						props.onFocus?.(event)
					}}
					onBlur={event => {
						hintProps.onBlur?.(event)
						props.onBlur?.(event)
					}}
					onClick={event => {
						hint.close()
						props.onClick?.(event)
					}}
				>
					{isLoading ? (
						<span className={styles.spinner} aria-hidden="true" />
					) : (
						leadingIcon
					)}
					<span className={styles.label}>{children}</span>
					{isLoading ? null : trailingIcon}
				</button>
				{hint.tooltip}
			</>
		)
	}
)

Button.displayName = 'Button'
