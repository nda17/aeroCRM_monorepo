'use client'

import type { HomePageFaqContent } from '@/entities/home-page-content'
import { useState } from 'react'
import styles from './HomeFaq.module.scss'

interface Props {
	content: HomePageFaqContent
}

const HomeFaq = ({ content }: Props) => {
	const [openIndex, setOpenIndex] = useState<number | null>(0)

	const toggle = (index: number) => {
		setOpenIndex(openIndex === index ? null : index)
	}

	return (
		<section id="faq" className={styles.section}>
			<h2 className={styles.title}>{content.title}</h2>
			<div className={styles.list}>
				{content.items.map((item, index) => {
					const isOpen = openIndex === index
					return (
						<div
							key={index}
							className={`${styles.item} ${isOpen ? styles.itemOpen : ''}`}
						>
							<button
								className={styles.question}
								onClick={() => toggle(index)}
								type="button"
								aria-expanded={isOpen}
							>
								<span>{item.question}</span>
								<span
									className={`${styles.icon} ${isOpen ? styles.iconOpen : ''}`}
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 20 20"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path
											d="M5 7.5L10 12.5L15 7.5"
											stroke="currentColor"
											strokeWidth="1.8"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</span>
							</button>
							<div
								className={`${styles.answerWrapper} ${isOpen ? styles.answerOpen : ''}`}
							>
								<div
									className={styles.answer}
									dangerouslySetInnerHTML={{
										__html: item.answerHtml
									}}
								/>
							</div>
						</div>
					)
				})}
			</div>
		</section>
	)
}

export default HomeFaq
