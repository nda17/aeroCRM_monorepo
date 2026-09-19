import styles from './LegalPageContent.module.scss'

interface Props {
	html: string
}

const LegalPageContent = ({ html }: Props) => {
	return (
		<article className={styles.wrapper}>
			<div
				className={styles.content}
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</article>
	)
}

export default LegalPageContent
