'use client'

import type { CSSProperties } from 'react'
import styles from './Snowflakes.module.scss'

const SNOWFLAKES_COUNT = 60
const SNOWFLAKE_SEED = 20260422

interface SnowflakeConfig {
	id: number
	left: number
	size: number
	duration: number
	delay: number
	opacity: number
	drift: number
	symbol: string
}

const SYMBOLS = ['❄', '❅', '❆', '✦', '•']

function createSeededRandom(seed: number) {
	let value = seed

	return () => {
		value |= 0
		value = (value + 0x6d2b79f5) | 0
		let t = Math.imul(value ^ (value >>> 15), 1 | value)
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function generateFlakes(seed: number): SnowflakeConfig[] {
	const random = createSeededRandom(seed)

	return Array.from({ length: SNOWFLAKES_COUNT }, (_, i) => ({
		id: i,
		left: random() * 100,
		size: 10 + random() * 16,
		duration: 8 + random() * 14,
		delay: -(random() * 20),
		opacity: 0.4 + random() * 0.6,
		drift: -30 + random() * 60,
		symbol: SYMBOLS[Math.floor(random() * SYMBOLS.length)]
	}))
}

const FLAKES = generateFlakes(SNOWFLAKE_SEED)

const Snowflakes = () => {
	return (
		<div className={styles.container} aria-hidden="true">
			{FLAKES.map(flake => (
				<span
					key={flake.id}
					className={styles.flake}
					style={
						{
							left: `${flake.left}%`,
							fontSize: `${flake.size}px`,
							opacity: flake.opacity,
							animationDuration: `${flake.duration}s`,
							animationDelay: `${flake.delay}s`,
							'--drift': `${flake.drift}px`
						} as CSSProperties
					}
				>
					{flake.symbol}
				</span>
			))}
		</div>
	)
}

export default Snowflakes
