'use client'

import {
	type BillingOperation,
	type BillingRoute
} from '@/entities/crm-billing'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button, Drawer, ScreenState } from '@/shared/ui'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { billingDate, billingMoney } from '../model/billing-display'
import { useBillingCommand } from '../model/use-billing-command'
import { useBillingContext } from '../model/use-billing-context'
import { BillingComposer } from './BillingComposer'
import { BillingHistoryPanel } from './BillingHistoryPanel'
import { BillingOrderPanel } from './BillingOrderPanel'
import styles from './BillingFlow.module.scss'

const renewalLabels = {
	NONE: 'Автопродление не подключено',
	ACTIVE: 'Автопродление включено',
	USER_DISABLED: 'Автопродление отключено',
	TECHNICAL_PAUSE: 'Автопродление приостановлено',
	PRICE_CONFIRMATION_REQUIRED: 'Новая цена ожидает вашего согласия',
	REVOKED: 'Способ автопродления отозван'
}
const periodLabels = {
	SCHEDULED: 'Начнётся после бесплатного периода',
	ACTIVE: 'Оплаченный период действует',
	GRACE: 'Льготные 3 дня после оплаченного периода',
	EXPIRED: 'Оплаченный период завершён'
}

export const BillingFlow = ({
	route,
	onReference
}: {
	route: BillingRoute
	onReference: (
		reference?: { commandId: string } | { orderId: string }
	) => void
}) => {
	const context = useBillingContext(route.workspaceId)
	const { actor, query } = context
	const [dialog, setDialog] = useState<
		'SEAT_CHANGE' | 'RENEWAL' | 'DISABLE' | null
	>(null)
	const [lastResult, setLastResult] = useState<string | null>(null)
	const [confirmedCommandId, setConfirmedCommandId] = useState<
		string | null
	>(null)
	const confirmed = (operation: BillingOperation) => {
		if (!actor.current()) return
		const orderId = operation.billing?.order?.id
		setConfirmedCommandId(operation.commandId)
		onReference(orderId ? { orderId } : undefined)
		const message =
			operation.state === 'NOT_STARTED'
				? 'Сервер подтвердил: команда не запускалась и закрыта. Старый запрос уже не сможет создать платёж.'
				: operation.state === 'CANCELLED'
					? 'Сервер подтвердил закрытие операции. Проверьте актуальный статус подписки.'
					: 'Операция подтверждена сервером. Статус платежа и оплаченного периода отображается отдельно.'
		setLastResult(message)
		setDialog(null)
		toast.success(message)
		context.refreshRelated()
	}
	const command = useBillingCommand(
		context,
		commandId => onReference({ commandId }),
		confirmed
	)
	const refresh = async () => {
		if (
			!actor.current() ||
			!actor.online ||
			query.isFetching ||
			command.running
		)
			return
		const toastId = toast.loading('Пожалуйста, подождите')
		const result = await query.refetch()
		if (!actor.current()) {
			toast.dismiss(toastId)
			return
		}
		if (result.isError)
			toast.error('Актуальные условия доступа не подтверждены', {
				id: toastId
			})
		else toast.success('Состояние подписки обновлено', { id: toastId })
	}
	const data = context.ready ? query.data : undefined
	const commandId =
		command.snapshot.commandId && command.uncertain
			? command.snapshot.commandId
			: [route.commandId, data?.capacity.pendingOperationId].find(
					id => id && id !== confirmedCommandId
				) || null
	const orderId = route.orderId ?? data?.billing.pendingOrder?.id ?? null
	const formLocked = command.locked || !!commandId
	const closeDialog = () => {
		if (command.locked) {
			toast('Сначала подтвердите результат отправленной команды.')
			return
		}
		setDialog(null)
	}
	if (!data)
		return (
			<div className={styles.content}>
				{command.uncertain ? (
					<p className={styles.notice}>
						Результат ранее отправленной команды пока не подтверждён. Она
						сохранена в памяти этой вкладки; новая команда не создаётся.
					</p>
				) : null}
				<ScreenState
					variant={
						query.isPending || query.isFetching
							? 'loading'
							: query.error instanceof AuthenticatedApiError &&
								  query.error.kind === 'forbidden'
								? 'permission'
								: 'error'
					}
					title={
						query.isPending || query.isFetching
							? 'Проверяем владельца и подписку aeroCRM'
							: 'Управление оплатой пока недоступно'
					}
					description="Настройки оплаты доступны только текущему владельцу рабочего пространства. Доступ только для чтения не мешает оплате и отключению автопродления. Сбой проверки не изменяет подписку."
					action={
						<Button
							onClick={() => void refresh()}
							disabled={!actor.online || command.running}
							isLoading={query.isFetching}
						>
							Проверить доступ к оплате
						</Button>
					}
				/>
			</div>
		)
	const { billing } = data
	const { renewal, period, policy, trial } = billing
	const recoveryControls = commandId ? (
		<div className={styles.actions}>
			{command.uncertain ? (
				<Button
					variant="secondary"
					tooltip="Повторно отправить прежнюю команду с тем же идентификатором и неизменёнными данными"
					disabled={command.running || !actor.online}
					onClick={() => void command.execute()}
				>
					Повторить исходную команду
				</Button>
			) : null}
			<Button
				tooltip="Запросить результат прежней операции по её идентификатору без создания нового заказа"
				disabled={command.running || !actor.online}
				isLoading={command.running}
				onClick={() => void command.recoverReference(commandId)}
			>
				Восстановить результат
			</Button>
		</div>
	) : null
	return (
		<div className={styles.content}>
			<div className={styles.actions}>
				<Button
					variant="secondary"
					tooltip="Загрузить актуальные условия доступа, оплаченный период и состояние автопродления aeroCRM"
					onClick={() => void refresh()}
					disabled={!context.ready || command.running}
					isLoading={query.isFetching}
				>
					Обновить подписку
				</Button>
				<a
					className={styles.link}
					href={`/inbox?workspaceId=${route.workspaceId}`}
				>
					Открыть CRM
				</a>
			</div>
			{lastResult ? (
				<p className={styles.notice} role="status">
					{lastResult}
				</p>
			) : null}
			{command.error ? (
				<p className={styles.error} role="alert">
					{command.error.message}
				</p>
			) : null}
			{commandId ? (
				<section
					className={styles.notice}
					aria-label="Восстановление операции"
				>
					<h2>Сначала подтвердите прежнюю операцию</h2>
					<p>
						Не создавайте второй платёж при неизвестном результате.
						Проверка использует тот же идентификатор команды. Ответ «не
						найдено» сам по себе не означает отмену.
					</p>
					<div className={styles.actions}>
						{command.uncertain ? (
							<Button
								variant="secondary"
								tooltip="Повторно отправить прежнюю команду с тем же идентификатором и неизменёнными данными"
								disabled={command.running || !actor.online}
								onClick={() => void command.execute()}
							>
								Повторить исходную команду
							</Button>
						) : null}
						<Button
							tooltip="Запросить результат прежней операции по её идентификатору без создания нового заказа"
							disabled={command.running || !actor.online}
							isLoading={command.running}
							onClick={() => void command.recoverReference(commandId)}
						>
							Восстановить результат
						</Button>
					</div>
				</section>
			) : null}
			<div className={styles.columns}>
				<section className={styles.card}>
					<div className={styles.sectionHeading}>
						<h2>Ваша подписка</h2>
						<span className={styles.tag}>aeroCRM</span>
					</div>
					{trial ? (
						<>
							<h3>Бесплатный период — 10 дней</h3>
							<dl className={styles.facts}>
								<div>
									<dt>До</dt>
									<dd>{billingDate(trial.expiresAt)}</dd>
								</div>
								<div>
									<dt>Места Trial, включая владельца</dt>
									<dd>{trial.seatLimit}</dd>
								</div>
							</dl>
						</>
					) : (
						<p className={styles.note}>
							Бесплатный период здесь автоматически не запускается.
						</p>
					)}
					{period ? (
						<>
							<h3>{periodLabels[period.state]}</h3>
							<dl className={styles.facts}>
								<div>
									<dt>Начало</dt>
									<dd>{billingDate(period.startsAt)}</dd>
								</div>
								<div>
									<dt>Окончание</dt>
									<dd>{billingDate(period.expiresAt)}</dd>
								</div>
								<div>
									<dt>Всего оплаченных мест</dt>
									<dd>{period.totalSeats}</dd>
								</div>
								<div>
									<dt>Занято, включая владельца</dt>
									<dd>{data.capacity.usedSeats}</dd>
								</div>
							</dl>
							<p className={styles.note}>
								Цены этого периода сохранены отдельно от текущих
								опубликованных условий. Pending и отключённые сотрудники
								место не занимают.
							</p>
							{data.capabilities.changeSeats ? (
								<Button
									variant="secondary"
									tooltip="Рассчитать новое количество мест и срок подписки на основе стоимости оставшегося периода"
									disabled={formLocked}
									onClick={() => setDialog('SEAT_CHANGE')}
								>
									Изменить количество мест
								</Button>
							) : null}
						</>
					) : (
						<p className={styles.note}>
							Подтверждённого оплаченного периода пока нет.
						</p>
					)}
				</section>
				<section className={styles.card}>
					<div className={styles.sectionHeading}>
						<h2>Автопродление</h2>
					</div>
					<h3>{renewalLabels[renewal.state]}</h3>
					<dl className={styles.facts}>
						{renewal.nextChargeAt ? (
							<div>
								<dt>Следующее списание</dt>
								<dd>{billingDate(renewal.nextChargeAt)}</dd>
							</div>
						) : null}
						{renewal.nextRetryAt ? (
							<div>
								<dt>Следующая попытка</dt>
								<dd>{billingDate(renewal.nextRetryAt)}</dd>
							</div>
						) : null}
						{renewal.methodLast4 ? (
							<div>
								<dt>Способ оплаты</dt>
								<dd>•••• {renewal.methodLast4}</dd>
							</div>
						) : null}
					</dl>
					<p className={styles.note}>
						Управление автопродлением подписки aeroCRM.
					</p>
					{renewal.dispatchPending ? (
						<p className={styles.notice}>
							Платёж уже мог быть передан провайдеру. Его результат будет
							проверен отдельно даже после отключения автопродления.
						</p>
					) : null}
					<div className={styles.actions}>
						{data.capabilities.disableAutoRenew && renewal.canDisable ? (
							<Button
								variant="secondary"
								tooltip="Открыть подтверждение отключения будущих автосписаний aeroCRM"
								disabled={formLocked}
								onClick={() => setDialog('DISABLE')}
							>
								Отключить автопродление
							</Button>
						) : null}
						{data.capabilities.confirmRenewalPrice ? (
							<Button
								tooltip="Получить новые условия следующего автопродления перед подтверждением согласия"
								disabled={formLocked || !period}
								onClick={() => setDialog('RENEWAL')}
							>
								Проверить новую цену
							</Button>
						) : null}
					</div>
				</section>
			</div>
			{orderId ? (
				<BillingOrderPanel
					key={orderId}
					context={context}
					orderId={orderId}
					onRefreshContext={context.refreshRelated}
					locked={formLocked}
					onVerify={order =>
						command.submit(commandId => ({
							action: 'orders/verify',
							body: {
								schemaVersion: 1,
								workspaceId: route.workspaceId,
								commandId,
								expectedBillingVersion: billing.billingVersion,
								orderId: order.id,
								expectedOrderVersion: order.version
							}
						}))
					}
				/>
			) : null}
			<section className={styles.card}>
				<div className={styles.sectionHeading}>
					<h2>Текущие опубликованные условия</h2>
					<span className={styles.tag}>Версия {policy.policyVersion}</span>
				</div>
				<dl className={styles.facts}>
					<div>
						<dt>Месяц</dt>
						<dd>{billingMoney(String(policy.monthlyPriceMinor))}</dd>
					</div>
					<div>
						<dt>Год</dt>
						<dd>{billingMoney(String(policy.yearlyPriceMinor))}</dd>
					</div>
					<div>
						<dt>Дополнительное место / месяц</dt>
						<dd>
							{billingMoney(
								String(policy.additionalSeatMonthlyPriceMinor)
							)}
						</dd>
					</div>
					<div>
						<dt>Дополнительное место / год</dt>
						<dd>
							{billingMoney(String(policy.additionalSeatYearlyPriceMinor))}
						</dd>
					</div>
					<div>
						<dt>Включено мест, считая владельца</dt>
						<dd>{policy.includedSeats}</dd>
					</div>
				</dl>
				<p className={styles.note}>
					Это не сумма к оплате и не условия уже начатого периода. Для
					покупки получите отдельный актуальный расчёт сервера.
				</p>
			</section>
			{data.capabilities.checkout ? (
				<section className={styles.card}>
					<div className={styles.sectionHeading}>
						<h2>Оплата aeroCRM</h2>
					</div>
					<BillingComposer
						context={context}
						data={data}
						intent="CHECKOUT"
						locked={formLocked}
						onSubmit={command.submit}
					/>
				</section>
			) : (
				<p className={styles.notice}>
					Новый заказ сейчас недоступен. Проверьте существующий платёж или
					актуальный период. Отключение автопродления остаётся отдельным
					действием.
				</p>
			)}
			<BillingHistoryPanel
				context={context}
				onSelect={selected => onReference({ orderId: selected })}
			/>
			<Drawer
				isOpen={dialog !== null}
				onClose={closeDialog}
				footer={recoveryControls}
				title={
					dialog === 'SEAT_CHANGE'
						? 'Изменить места и оставшееся время'
						: dialog === 'RENEWAL'
							? 'Подтвердить новую цену автопродления'
							: 'Отключить автопродление aeroCRM'
				}
			>
				{command.error ? (
					<p className={styles.error} role="alert">
						{command.error.message}
					</p>
				) : null}
				{dialog === 'DISABLE' ? (
					<div className={styles.form}>
						<p className={styles.notice}>
							После подтверждения отключения новые автосписания не
							создаются. Уже отправленный провайдеру платёж может
							завершиться; его результат не отменяется этой командой.
						</p>
						<p>Оплаченный период сохраняется.</p>
						<Button
							variant="danger"
							disabled={
								formLocked ||
								!data.capabilities.disableAutoRenew ||
								!renewal.canDisable
							}
							isLoading={command.running}
							onClick={() =>
								void command.submit(commandId => ({
									action: 'renewal/disable',
									body: {
										schemaVersion: 1,
										workspaceId: route.workspaceId,
										commandId,
										expectedBillingVersion: billing.billingVersion,
										expectedRenewalVersion: renewal.version
									}
								}))
							}
						>
							Подтвердить отключение
						</Button>
					</div>
				) : dialog ? (
					<BillingComposer
						key={dialog}
						context={context}
						data={data}
						intent={dialog}
						locked={formLocked}
						onSubmit={command.submit}
					/>
				) : null}
			</Drawer>
		</div>
	)
}
