import heroBgDesktopAvif from '@/shared/assets/images/hero/hero-bg-desktop.avif'
import heroBgDesktopWebp from '@/shared/assets/images/hero/hero-bg-desktop.webp'
import heroBgMobileAvif from '@/shared/assets/images/hero/hero-bg-mobile.avif'
import heroBgMobileWebp from '@/shared/assets/images/hero/hero-bg-mobile.webp'
import type { HomePageHeroContent } from '@/entities/home-page-content'
import { getImageProps } from 'next/image'
import { Fragment } from 'react'
import HeroActions from './HeroActions'
import styles from './HeroSection.module.scss'

interface Props {
	content: HomePageHeroContent
}

const HeroSection = ({ content }: Props) => {
	const commonImageProps = {
		alt: '',
		sizes: '100vw',
		loading: 'eager' as const
	}

	const {
		props: { srcSet: desktopAvifSrcSet }
	} = getImageProps({
		...commonImageProps,
		src: heroBgDesktopAvif
	})

	const {
		props: { srcSet: desktopWebpSrcSet, ...desktopImageProps }
	} = getImageProps({
		...commonImageProps,
		src: heroBgDesktopWebp
	})

	const {
		props: { srcSet: mobileAvifSrcSet }
	} = getImageProps({
		...commonImageProps,
		src: heroBgMobileAvif
	})

	const {
		props: { srcSet: mobileWebpSrcSet, sizes: mobileSizes }
	} = getImageProps({
		...commonImageProps,
		src: heroBgMobileWebp
	})

	return (
		<section className={styles.heroWrapper} aria-labelledby="hero-title">
			<div className={styles.heroBackground} aria-hidden="true">
				<picture className={styles.heroBackgroundPicture}>
					<source
						media="(max-width: 767px)"
						srcSet={mobileAvifSrcSet}
						sizes={mobileSizes}
						type="image/avif"
					/>
					<source
						media="(max-width: 767px)"
						srcSet={mobileWebpSrcSet}
						sizes={mobileSizes}
						type="image/webp"
					/>
					<source
						media="(min-width: 768px)"
						srcSet={desktopAvifSrcSet}
						sizes={desktopImageProps.sizes}
						type="image/avif"
					/>
					<source
						media="(min-width: 768px)"
						srcSet={desktopWebpSrcSet}
						sizes={desktopImageProps.sizes}
						type="image/webp"
					/>
					<img
						{...desktopImageProps}
						alt=""
						fetchPriority="high"
						decoding="async"
						aria-hidden="true"
						className={styles.heroBackgroundImage}
					/>
				</picture>
			</div>
			<div className={styles.heroFirstCircle} aria-hidden="true"></div>
			<div className={styles.heroSecondCircle} aria-hidden="true"></div>
			<div className={styles.heroThirdCircle} aria-hidden="true"></div>
			<div className={styles.heroContent}>
				<h1 id="hero-title" className={styles.title}>
					{content.titleBeforeAccent
						.split('\n')
						.map((line, index, lines) => (
							<Fragment key={`${line}-${index}`}>
								{line}
								{index < lines.length - 1 && <br />}
							</Fragment>
						))}{' '}
					<span className={styles.percentWrapper}>
						<span className={styles.titleSide}></span>
						{content.accentText}
					</span>
					<br />
					{content.titleAfterAccent}
				</h1>
				<p className={styles.subtitle}>{content.subtitle}</p>
				<HeroActions content={content} />
			</div>
		</section>
	)
}

export default HeroSection
