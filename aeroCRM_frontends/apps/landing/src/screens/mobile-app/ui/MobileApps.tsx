'use client'

import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import Image from 'next/image'
import { useState } from 'react'
import styles from './MobileApps.module.scss'

export interface AndroidReleaseMetadata {
	schemaVersion: number
	available: boolean
	versionName: string | null
	versionCode: number | null
	packageId: string
	downloadUrl: string | null
	sizeBytes: number | null
	sha256: string | null
	minSdk: number | null
	minAndroidVersion: string | null
	compatibleBrowser: string
}

const isAvailable = (release: AndroidReleaseMetadata) => {
	if (
		release.schemaVersion !== 1 ||
		!release.available ||
		!release.versionName ||
		!Number.isSafeInteger(release.versionCode) ||
		!release.versionCode ||
		release.versionCode < 1 ||
		!Number.isSafeInteger(release.sizeBytes) ||
		!release.sizeBytes ||
		release.sizeBytes < 1 ||
		!Number.isSafeInteger(release.minSdk) ||
		!release.minSdk ||
		release.minSdk < 1 ||
		!release.minAndroidVersion ||
		!release.compatibleBrowser ||
		!release.sha256 ||
		!/^[a-f0-9]{64}$/i.test(release.sha256) ||
		!release.downloadUrl
	) {
		return false
	}

	try {
		const url = new URL(release.downloadUrl)
		return (
			url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			url.pathname.endsWith(
				`/aerocrm/android/${release.versionName}/aeroCRM.apk`
			)
		)
	} catch {
		return false
	}
}

const MobileApps = ({ release }: { release: AndroidReleaseMetadata }) => {
	const [showDownloadDialog, setShowDownloadDialog] = useState(false)
	const available = isAvailable(release)
	const size = available
		? `${new Intl.NumberFormat('ru-RU', {
				maximumFractionDigits: 1
			}).format((release.sizeBytes ?? 0) / 1024 / 1024)} МБ`
		: ''

	const download = () => {
		if (!available || !release.downloadUrl) return
		setShowDownloadDialog(false)
		window.location.assign(release.downloadUrl)
	}

	return (
		<main className={styles.page}>
			<header className={styles.header}>
				<h1>Мобильные приложения</h1>
				<p>
					Работайте с обращениями, сделками и задачами aeroCRM на телефоне.
				</p>
			</header>
			<section className={styles.card} aria-labelledby="android-app-title">
				<div className={styles.appHeading}>
					<Image
						src="/icon.svg"
						alt=""
						width={64}
						height={64}
						unoptimized
					/>
					<div>
						<h2 id="android-app-title">aeroCRM для Android</h2>
						<p>Ваше рабочее пространство в отдельном приложении.</p>
					</div>
				</div>
				{available ? (
					<>
						<dl className={styles.details}>
							<div>
								<dt>Версия</dt>
								<dd>{release.versionName}</dd>
							</div>
							<div>
								<dt>Размер</dt>
								<dd>{size}</dd>
							</div>
							<div>
								<dt>Система</dt>
								<dd>Android {release.minAndroidVersion} и новее</dd>
							</div>
						</dl>
					</>
				) : (
					<p className={styles.note}>
						Приложение готовится к выпуску. Скачивание появится здесь после
						публикации.
					</p>
				)}
				<button
					type="button"
					className={styles.download}
					disabled={!available}
					onClick={() => setShowDownloadDialog(true)}
				>
					aeroCRM.apk для Android
				</button>
				{available && (
					<p className={styles.installHint}>
						После скачивания откройте APK на Android и разрешите установку
						для браузера, если система попросит.
					</p>
				)}
			</section>
			{showDownloadDialog && available && (
				<ConfirmDialog
					title="Скачать aeroCRM.apk?"
					message={`Версия ${release.versionName}, ${size}. Для Android ${release.minAndroidVersion} и новее.`}
					confirmLabel="Скачать"
					cancelLabel="Отмена"
					onConfirm={download}
					onCancel={() => setShowDownloadDialog(false)}
				/>
			)}
		</main>
	)
}

export default MobileApps
