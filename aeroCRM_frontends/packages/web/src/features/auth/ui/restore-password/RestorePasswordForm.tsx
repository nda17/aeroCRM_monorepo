'use client'
import styles from '@/features/auth/ui/AuthForm.module.scss'
import useRestorePasswordForm from '@/features/auth/model/useRestorePasswordForm'
import useAuthReturnUrl from '@/features/auth/model/useAuthReturnUrl'
import FieldEmail from '@/shared/ui/form-elements/auth-page/field-email/FieldEmail'
import FieldPhone from '@/shared/ui/form-elements/auth-page/field-phone/FieldPhone'
import { validEmail, validPhone } from '@/shared/regex'
import clsx from 'clsx'
import { NextPage } from 'next'

interface IRestorePasswordFormProps {
	authReturnUrl?: string | null
}

const RestorePasswordForm: NextPage<IRestorePasswordFormProps> = ({
	authReturnUrl: initialAuthReturnUrl
}) => {
	const authReturnUrl = useAuthReturnUrl(initialAuthReturnUrl)
	const {
		handleSubmit,
		isLoading,
		onSubmit,
		onInvalid,
		register,
		formState: { errors, touchedFields, isSubmitted },
		authMethod,
		setAuthMethod,
		phoneInputRef,
		phoneMask
	} = useRestorePasswordForm(authReturnUrl)

	return (
		<form
			onSubmit={handleSubmit(onSubmit, onInvalid)}
			className={styles.form}
		>
			<div className={styles['auth-method-toggle']}>
				<button
					type="button"
					className={clsx(
						styles['method-button'],
						authMethod === 'email' && styles['method-button-active']
					)}
					onClick={() => setAuthMethod('email')}
				>
					Email
				</button>
				<button
					type="button"
					className={clsx(
						styles['method-button'],
						authMethod === 'phone' && styles['method-button-active']
					)}
					onClick={() => setAuthMethod('phone')}
				>
					Телефон
				</button>
			</div>

			{authMethod === 'email' ? (
				<FieldEmail
					{...register('email', {
						required: 'Введите email',
						pattern: {
							value: validEmail,
							message: 'Проверьте правильность ввода email'
						}
					})}
					placeholder="Email:"
					type="email"
					error={errors.email}
					data-validated={
						touchedFields.email || isSubmitted ? 'true' : undefined
					}
				/>
			) : (
				(() => {
					const phoneRegister = register('phone', {
						required: 'Введите номер телефона',
						pattern: {
							value: validPhone,
							message: 'Проверьте правильность ввода номера телефона'
						}
					})

					return (
						<FieldPhone
							{...phoneRegister}
							placeholder="Телефон:"
							type="tel"
							error={errors.phone}
							data-validated={
								touchedFields.phone || isSubmitted ? 'true' : undefined
							}
							data-mask-empty={phoneMask.isMaskEmpty ? 'true' : undefined}
							onFocus={phoneMask.onFocus}
							onClick={phoneMask.onClick}
							onKeyDown={phoneMask.onKeyDown}
							onBeforeInput={phoneMask.onBeforeInput}
							onInput={phoneMask.onInput}
							onPaste={phoneMask.onPaste}
							onBlur={phoneMask.onBlur}
							ref={element => {
								phoneRegister.ref(element)
								phoneInputRef.current = element
							}}
						/>
					)
				})()
			)}

			<div className={clsx(styles['wrapper-button'])}>
				<button
					type="submit"
					className={clsx(styles['button-primary'])}
					disabled={isLoading}
				>
					Восстановить пароль
				</button>
			</div>
		</form>
	)
}

export default RestorePasswordForm
