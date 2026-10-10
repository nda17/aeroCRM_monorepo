'use client'

import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { BrandLogo } from '@/shared/ui/brand-logo'
import { Drawer } from '@/shared/ui/drawer'
import { CRM_NAVIGATION } from '@/widgets/crm-app-shell/model/crm-navigation'
import { PREVIEW_DEALS, PREVIEW_STAGES } from '../model/preview-data'
import type { PreviewDeal } from '../model/preview-data'
import styles from './DesignPreview.module.scss'

const money = (value: number) =>
	`${new Intl.NumberFormat('ru-RU').format(value)} ₽`
const owners = [...new Set(PREVIEW_DEALS.map(deal => deal.owner))]
type View = 'board' | 'list'
type Scope = 'all' | 'mine' | 'overdue'

export default function DesignPreview() {
	const [deals, setDeals] = useState(PREVIEW_DEALS)
	const [view, setView] = useState<View>('board')
	const [scope, setScope] = useState<Scope>('all')
	const [search, setSearch] = useState('')
	const [owner, setOwner] = useState('')
	const [stage, setStage] = useState('')
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [creating, setCreating] = useState(false)
	const [mobileNav, setMobileNav] = useState(false)
	const [notes, setNotes] = useState<Record<string, string[]>>({})
	const [note, setNote] = useState('')
	const [notice, setNotice] = useState('')
	const searchRef = useRef<HTMLInputElement>(null)
	const selected = deals.find(deal => deal.id === selectedId)
	const total = deals.reduce((sum, deal) => sum + deal.amount, 0)
	const overdue = deals.filter(deal => deal.overdue).length
	const mine = deals.filter(deal => deal.owner === owners[0]).length
	const filtered = useMemo(
		() =>
			deals.filter(deal => {
				const query = search.trim().toLocaleLowerCase('ru')
				return (
					(!query ||
						`${deal.title} ${deal.company} ${deal.contact} ${deal.id}`
							.toLocaleLowerCase('ru')
							.includes(query)) &&
					(!owner || deal.owner === owner) &&
					(stage === '' || deal.stage === Number(stage)) &&
					(scope !== 'mine' || deal.owner === owners[0]) &&
					(scope !== 'overdue' || deal.overdue)
				)
			}),
		[deals, search, owner, stage, scope]
	)
	const hasFilters = Boolean(search || owner || stage || scope !== 'all')
	const reset = () => {
		setSearch('')
		setOwner('')
		setStage('')
		setScope('all')
	}
	const openDeal = (id: string) => {
		setSelectedId(id)
		setNote('')
		setNotice('')
	}
	const updateDeal = (patch: Partial<PreviewDeal>) => {
		setDeals(items =>
			items.map(deal =>
				deal.id === selectedId ? { ...deal, ...patch } : deal
			)
		)
		setNotice('Изменения сохранены в демоверсии')
	}
	const createDeal = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const data = new FormData(event.currentTarget)
		const title = String(data.get('title') ?? '').trim()
		const company = String(data.get('company') ?? '').trim()
		if (!title || !company) return
		const id = `DEMO-${Date.now()}`
		setDeals(items => [
			{
				id,
				title,
				company,
				contact: 'Контакт не указан',
				initials: company.slice(0, 2).toUpperCase(),
				amount: Number(data.get('amount')),
				stage: Number(data.get('stage')),
				owner: owners[0],
				ownerInitials: PREVIEW_DEALS[0].ownerInitials,
				task: 'Назначить следующий шаг',
				due: 'Без срока',
				overdue: false,
				source: 'Создана вручную'
			},
			...items
		])
		setCreating(false)
		reset()
		openDeal(id)
	}
	const addNote = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!selected || !note.trim()) return
		setNotes(items => ({
			...items,
			[selected.id]: [note.trim(), ...(items[selected.id] ?? [])]
		}))
		setNote('')
		setNotice('Заметка добавлена в демоверсии')
	}
	const dealCard = (deal: PreviewDeal) => (
		<button
			key={deal.id}
			className={styles.dealCard}
			onClick={() => openDeal(deal.id)}
		>
			<span className={styles.cardCompany}>
				<span className={styles.companyMark}>
					{deal.company
						.split(' ')
						.slice(0, 2)
						.map(word => word[0])
						.join('')}
				</span>
				{deal.company}
			</span>
			<strong className={styles.cardTitle}>{deal.title}</strong>
			<span className={styles.cardAmount}>{money(deal.amount)}</span>
			<span className={styles.cardBottom}>
				<span className={deal.overdue ? styles.overdue : styles.taskDue}>
					<AppIcon name="clock" size={13} />
					{deal.due}
				</span>
				<span className={styles.avatar} title={deal.owner}>
					{deal.ownerInitials}
				</span>
			</span>
			<span className={styles.cardTask}>{deal.task}</span>
		</button>
	)

	return (
		<div className={styles.preview}>
			<a href="#preview-main" className={styles.skipLink}>
				К содержимому
			</a>
			<aside
				className={`${styles.sidebar} ${mobileNav ? styles.sidebarOpen : ''}`}
			>
				<div className={styles.brand}>
					<BrandLogo />
					<button
						className={styles.mobileClose}
						aria-label="Закрыть меню"
						onClick={() => setMobileNav(false)}
					>
						<AppIcon name="close" size={20} />
					</button>
				</div>
				<div className={styles.workspace}>
					<span className={styles.workspaceMark}>С</span>
					<span>
						<strong>Студия Север</strong>
						<small>Рабочее пространство</small>
					</span>
				</div>
				<span className={styles.navCaption}>РАБОТА</span>
				<nav aria-label="Разделы CRM" className={styles.navigation}>
					{CRM_NAVIGATION.map(item => (
						<button
							key={item.href}
							disabled={item.href !== '/deals'}
							aria-current={item.href === '/deals' ? 'page' : undefined}
							title={
								item.href !== '/deals'
									? 'В этом прототипе доступен раздел «Сделки»'
									: undefined
							}
							onClick={() => setMobileNav(false)}
						>
							<AppIcon name={item.icon} size={18} />
							<span>{item.label}</span>
							{item.href === '/deals' && (
								<span className={styles.navCount}>{deals.length}</span>
							)}
						</button>
					))}
				</nav>
				<div className={styles.sidebarFoot}>
					<span className={styles.previewDot} />
					Дизайн-превью<span>Демонстрационные данные</span>
				</div>
				<div className={styles.profile}>
					<span className={styles.profileAvatar}>
						{PREVIEW_DEALS[0].ownerInitials}
					</span>
					<span>
						<strong>{owners[0]}</strong>
						<small>Моё пространство</small>
					</span>
				</div>
			</aside>
			<div className={styles.main}>
				<header className={styles.topbar}>
					<button
						className={styles.mobileMenu}
						aria-label="Открыть меню"
						aria-expanded={mobileNav}
						onClick={() => setMobileNav(true)}
					>
						<AppIcon name="menu" size={21} />
					</button>
					<div className={styles.breadcrumb}>
						Рабочее пространство<span>/</span>
						<strong>Сделки</strong>
					</div>
					<span className={styles.localBadge}>
						<span />
						Локальный просмотр
					</span>
				</header>
				<main id="preview-main" className={styles.content}>
					<div className={styles.pageHeading}>
						<div>
							<div className={styles.eyebrow}>ПРОДАЖИ</div>
							<h1>
								Сделки<span>{deals.length}</span>
							</h1>
							<p>Основная воронка · команда продаж</p>
						</div>
						<button
							className={styles.primaryButton}
							onClick={() => setCreating(true)}
						>
							<AppIcon name="plus" size={17} />
							Новая сделка
						</button>
					</div>
					<section
						className={styles.metrics}
						aria-label="Показатели воронки"
					>
						<div>
							<span>В работе</span>
							<strong>{money(total)}</strong>
							<small>{deals.length} активных сделок</small>
						</div>
						<div>
							<span>На согласовании</span>
							<strong>
								{money(
									deals
										.filter(deal => deal.stage === 3)
										.reduce((sum, deal) => sum + deal.amount, 0)
								)}
							</strong>
							<small>Этап перед оплатой</small>
						</div>
						<div>
							<span>Ожидаем оплату</span>
							<strong>
								{money(
									deals
										.filter(deal => deal.stage === 4)
										.reduce((sum, deal) => sum + deal.amount, 0)
								)}
							</strong>
							<small>Финальный этап воронки</small>
						</div>
						<button
							onClick={() => {
								reset()
								setScope('overdue')
							}}
						>
							<span>
								Требуют внимания
								<AppIcon name="alert" size={14} />
							</span>
							<strong className={overdue ? styles.attention : ''}>
								{overdue}
								<em>сделки</em>
							</strong>
							<small>
								Просрочен следующий шаг <span aria-hidden="true">↗</span>
							</small>
						</button>
					</section>
					<div className={styles.viewBar}>
						<div className={styles.tabs} aria-label="Подборка сделок">
							{(
								[
									{
										value: 'all',
										label: 'Все сделки',
										count: deals.length
									},
									{ value: 'mine', label: 'Мои', count: mine },
									{
										value: 'overdue',
										label: 'Требуют внимания',
										count: overdue
									}
								] as const
							).map(tab => (
								<button
									key={tab.value}
									className={scope === tab.value ? styles.activeTab : ''}
									aria-pressed={scope === tab.value}
									onClick={() => setScope(tab.value)}
								>
									{tab.label}
									<span>{tab.count}</span>
								</button>
							))}
						</div>
						<div className={styles.viewToggle} aria-label="Вид сделок">
							<button
								aria-pressed={view === 'board'}
								onClick={() => setView('board')}
							>
								<AppIcon name="products" size={15} />
								Канбан
							</button>
							<button
								aria-pressed={view === 'list'}
								onClick={() => setView('list')}
							>
								<AppIcon name="menu" size={16} />
								Список
							</button>
						</div>
					</div>
					<div className={styles.toolbar}>
						<label className={styles.search}>
							<AppIcon name="search" size={17} />
							<input
								ref={searchRef}
								aria-label="Поиск сделок"
								value={search}
								onChange={event => setSearch(event.target.value)}
								placeholder="Название, компания или контакт"
							/>
							{search && (
								<button
									aria-label="Очистить поиск"
									onClick={() => {
										setSearch('')
										searchRef.current?.focus()
									}}
								>
									<AppIcon name="close" size={14} />
								</button>
							)}
						</label>
						<label className={styles.selectWrap}>
							<AppIcon name="user" size={15} />
							<select
								aria-label="Ответственный"
								value={owner}
								onChange={event => setOwner(event.target.value)}
							>
								<option value="">Все ответственные</option>
								{owners.map(item => (
									<option key={item}>{item}</option>
								))}
							</select>
							<AppIcon name="chevronDown" size={13} />
						</label>
						<label className={styles.selectWrap}>
							<AppIcon name="filter" size={14} />
							<select
								aria-label="Этап сделки"
								value={stage}
								onChange={event => setStage(event.target.value)}
							>
								<option value="">Все этапы</option>
								{PREVIEW_STAGES.map((item, index) => (
									<option key={item} value={index}>
										{item}
									</option>
								))}
							</select>
							<AppIcon name="chevronDown" size={13} />
						</label>
						{hasFilters && (
							<button className={styles.clearButton} onClick={reset}>
								Сбросить
							</button>
						)}
						<span className={styles.results} aria-live="polite">
							{filtered.length} из {deals.length}
						</span>
					</div>
					{filtered.length === 0 ? (
						<div className={styles.empty}>
							<AppIcon name="search" size={28} />
							<h2>Сделки не найдены</h2>
							<p>Попробуйте другое название или измените фильтры.</p>
							<button className={styles.secondaryButton} onClick={reset}>
								Сбросить фильтры
							</button>
						</div>
					) : view === 'board' ? (
						<div
							className={styles.board}
							tabIndex={0}
							aria-label="Воронка продаж, прокручивается по горизонтали"
						>
							{PREVIEW_STAGES.map((title, index) => {
								const items = filtered.filter(deal => deal.stage === index)
								return (
									<section
										key={title}
										className={styles.column}
										data-stage={index}
									>
										<div className={styles.columnHeader}>
											<h2>
												<span className={styles.stageDot} />
												{title}
												<span className={styles.columnCount}>
													{items.length}
												</span>
											</h2>
											<span className={styles.columnSum}>
												{money(
													items.reduce((sum, deal) => sum + deal.amount, 0)
												)}
											</span>
										</div>
										<div className={styles.cardStack}>
											{items.map(dealCard)}
											{items.length === 0 && (
												<div className={styles.emptyColumn}>
													На этом этапе пока нет сделок
												</div>
											)}
										</div>
									</section>
								)
							})}
						</div>
					) : (
						<div className={styles.tableScroll}>
							<table className={styles.table}>
								<caption className={styles.srOnly}>
									Сделки и следующие действия
								</caption>
								<thead>
									<tr>
										<th scope="col">Сделка / Компания</th>
										<th scope="col">Сумма</th>
										<th scope="col">Этап</th>
										<th scope="col">Следующий шаг</th>
										<th scope="col">Ответственный</th>
									</tr>
								</thead>
								<tbody>
									{filtered.map(deal => (
										<tr key={deal.id}>
											<td>
												<button
													className={styles.recordLink}
													onClick={() => openDeal(deal.id)}
												>
													{deal.title}
												</button>
												<span className={styles.tableCompany}>
													{deal.company}
												</span>
											</td>
											<td className={styles.amountCell}>
												{money(deal.amount)}
											</td>
											<td>
												<span
													className={styles.stageLabel}
													data-stage={deal.stage}
												>
													<span className={styles.stageDot} />
													{PREVIEW_STAGES[deal.stage]}
												</span>
											</td>
											<td>
												<span className={styles.tableTask}>
													{deal.task}
												</span>
												<span
													className={
														deal.overdue ? styles.overdue : styles.taskDue
													}
												>
													<AppIcon name="clock" size={12} />
													{deal.due}
												</span>
											</td>
											<td>
												<span className={styles.tableOwner}>
													<span className={styles.avatar}>
														{deal.ownerInitials}
													</span>
													{deal.owner}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<footer className={styles.contentFoot}>
						<span>Основная воронка · {PREVIEW_STAGES.length} этапов</span>
						<span>Изменения в демоверсии действуют до перезагрузки</span>
					</footer>
				</main>
			</div>
			<Drawer
				isOpen={Boolean(selected)}
				onClose={() => setSelectedId(null)}
				title="Карточка сделки"
				description={selected?.company}
				size="lg"
				className={styles.previewDrawer}
			>
				{selected && (
					<div className={styles.detail}>
						<div className={styles.detailEyebrow}>
							<span
								className={styles.stageLabel}
								data-stage={selected.stage}
							>
								<span className={styles.stageDot} />
								{PREVIEW_STAGES[selected.stage]}
							</span>
							<span>{selected.id}</span>
						</div>
						<h2>{selected.title}</h2>
						<p className={styles.detailAmount}>{money(selected.amount)}</p>
						<label className={styles.detailStage}>
							Этап сделки
							<select
								value={selected.stage}
								onChange={event =>
									updateDeal({ stage: Number(event.target.value) })
								}
							>
								{PREVIEW_STAGES.map((item, index) => (
									<option key={item} value={index}>
										{item}
									</option>
								))}
							</select>
						</label>
						<div className={styles.stageProgress} aria-hidden="true">
							{PREVIEW_STAGES.map((item, index) => (
								<span key={item} data-complete={index <= selected.stage} />
							))}
						</div>
						<section className={styles.nextStep}>
							<div>
								<span className={styles.sectionKicker}>СЛЕДУЮЩИЙ ШАГ</span>
								<span
									className={
										selected.overdue ? styles.overdue : styles.taskDue
									}
								>
									<AppIcon name="clock" size={13} />
									{selected.due}
								</span>
							</div>
							<h3>{selected.task}</h3>
							<p>{selected.owner}</p>
							{selected.due !== 'Выполнено' && (
								<button
									className={styles.secondaryButton}
									onClick={() =>
										updateDeal({
											overdue: false,
											due: 'Выполнено',
											task: 'Следующий шаг выполнен'
										})
									}
								>
									<AppIcon name="check" size={16} />
									Отметить выполненным
								</button>
							)}
						</section>
						<section className={styles.detailInfo}>
							<h3>О сделке</h3>
							<dl>
								<div>
									<dt>Компания</dt>
									<dd>{selected.company}</dd>
								</div>
								<div>
									<dt>Контакт</dt>
									<dd>{selected.contact}</dd>
								</div>
								<div>
									<dt>Ответственный</dt>
									<dd>
										<span className={styles.avatar}>
											{selected.ownerInitials}
										</span>
										{selected.owner}
									</dd>
								</div>
								<div>
									<dt>Источник</dt>
									<dd>{selected.source}</dd>
								</div>
							</dl>
						</section>
						<section className={styles.activity}>
							<h3>Заметки и история</h3>
							<form onSubmit={addNote}>
								<label className={styles.srOnly} htmlFor="deal-note">
									Новая заметка
								</label>
								<textarea
									id="deal-note"
									value={note}
									onChange={event => setNote(event.target.value)}
									placeholder="Запишите важное о договорённостях…"
									rows={3}
									maxLength={4000}
								/>
								<div>
									<small>Видно в этой демоверсии</small>
									<button
										className={styles.primaryButton}
										disabled={!note.trim()}
										type="submit"
									>
										Добавить заметку
									</button>
								</div>
							</form>
							<div className={styles.timeline}>
								{(notes[selected.id] ?? []).map((text, index) => (
									<article key={`${index}-${text}`}>
										<span className={styles.avatar}>
											{PREVIEW_DEALS[0].ownerInitials}
										</span>
										<div>
											<strong>
												{owners[0]}
												<time>Сейчас</time>
											</strong>
											<p>{text}</p>
										</div>
									</article>
								))}
								<article>
									<span className={styles.eventIcon}>
										<AppIcon name="plus" size={14} />
									</span>
									<div>
										<strong>
											Сделка добавлена<time>Демонстрация</time>
										</strong>
										<p>Источник: {selected.source}</p>
									</div>
								</article>
							</div>
						</section>
						<p className={styles.notice} role="status">
							{notice}
						</p>
					</div>
				)}
			</Drawer>
			<Drawer
				isOpen={creating}
				onClose={() => setCreating(false)}
				title="Новая сделка"
				description="Добавьте договорённость в рабочую воронку"
				className={styles.previewDrawer}
			>
				<form className={styles.createForm} onSubmit={createDeal}>
					<label>
						Название сделки
						<input
							name="title"
							required
							maxLength={150}
							placeholder="Например, разработка интернет-магазина"
						/>
					</label>
					<label>
						Компания
						<input
							name="company"
							required
							maxLength={100}
							placeholder="Название компании"
						/>
					</label>
					<label>
						Сумма, ₽
						<input
							name="amount"
							type="number"
							min="0"
							max="100000000000"
							step="0.01"
							required
							placeholder="0"
						/>
					</label>
					<label>
						Этап
						<select name="stage">
							{PREVIEW_STAGES.map((item, index) => (
								<option value={index} key={item}>
									{item}
								</option>
							))}
						</select>
					</label>
					<p>
						Сделка появится только в демоверсии. Данные сохраняются до
						перезагрузки страницы.
					</p>
					<div>
						<button
							type="button"
							className={styles.secondaryButton}
							onClick={() => setCreating(false)}
						>
							Отмена
						</button>
						<button type="submit" className={styles.primaryButton}>
							Создать сделку
						</button>
					</div>
				</form>
			</Drawer>
		</div>
	)
}
