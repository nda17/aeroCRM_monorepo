import Analysis from '@/screens/home/ui/analysis/Analysis'
import HomeAudiences from '@/screens/home/ui/audiences/HomeAudiences'
import HomeCaseStudies from '@/screens/home/ui/case-studies/HomeCaseStudies'
import CtaBanner from '@/screens/home/ui/cta-banner/CtaBanner'
import HomeCustomization from '@/screens/home/ui/customization/HomeCustomization'
import HomeDashboardPreview from '@/screens/home/ui/dashboard-preview/HomeDashboardPreview'
import HomeFaq from '@/screens/home/ui/faq/HomeFaq'
import HeroSection from '@/screens/home/ui/hero/HeroSection'
import HomeLeadFlow from '@/screens/home/ui/lead-flow/HomeLeadFlow'
import HomeMicroCta from '@/screens/home/ui/micro-cta/HomeMicroCta'
import HomePricing from '@/screens/home/ui/pricing/HomePricing'
import HomeSecurity from '@/screens/home/ui/security/HomeSecurity'
import HomeSeoText from '@/screens/home/ui/seo-text/HomeSeoText'
import HomeSteps from '@/screens/home/ui/steps/HomeSteps'
import CurvedCarousel from '@/screens/home/ui/integrations/curved-carousel/CurvedCarousel'
import type { HomePageContent } from '@/entities/home-page-content'
import type { CrmPricingPolicy } from '@/entities/crm-pricing'
import styles from './Home.module.scss'

interface Props {
	content: HomePageContent
	crmPricingPolicy?: CrmPricingPolicy | null
}

const Home = ({
	content,
	crmPricingPolicy = null
}: Props) => {
	return (
		<div className={styles.page}>
			<HeroSection content={content.hero} />
			{content.integrations.enabled && (
				<CurvedCarousel content={content.integrations} />
			)}
			{content.analysis.enabled && <Analysis content={content.analysis} />}
			<HomeMicroCta
				content={content.microCta}
				text={content.microCta.afterIntegrationsText}
				buttonText={content.microCta.afterIntegrationsButtonText}
			/>
			<HomeAudiences content={content.audiences} />
			<HomeCaseStudies content={content.caseStudies} />
			<HomeLeadFlow content={content.leadFlow} />
			{content.customization.enabled && (
				<HomeCustomization content={content.customization} />
			)}
			{content.steps.enabled && <HomeSteps content={content.steps} />}
			<HomeMicroCta
				content={content.microCta}
				text={content.microCta.afterStepsText}
				buttonText={content.microCta.afterStepsButtonText}
			/>
			<HomeDashboardPreview content={content.dashboardPreview} />
			<HomeSecurity content={content.security} />


			{content.pricing.enabled && (
				<HomePricing
					content={content.pricing}
					crmPricingPolicy={crmPricingPolicy}
				/>
			)}
			{content.faq.enabled && <HomeFaq content={content.faq} />}
			<HomeSeoText content={content.seoText} />
			{content.cta.enabled && (
				<div className={styles.offerWrapper}>
					<div className={styles.circleOrange}></div>
					<div className={styles.circleYellow}></div>
					<div className={styles.circlePink}></div>
					<CtaBanner content={content.cta} />
				</div>
			)}
		</div>
	)
}

export default Home
