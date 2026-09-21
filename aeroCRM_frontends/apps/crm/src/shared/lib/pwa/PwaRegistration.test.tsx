import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAndroidAppContext } from './app-context'
import { PwaRegistration } from './PwaRegistration'

vi.mock('./app-context', () => ({
	captureAndroidAppContext: vi.fn()
}))

const mockedCapture = vi.mocked(captureAndroidAppContext)

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubEnv('NODE_ENV', 'production')
})

afterEach(() => {
	cleanup()
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('PwaRegistration', () => {
	it('captures the launch context before registering the service worker', async () => {
		const register = vi.fn(() => Promise.resolve())
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: { register }
		})

		render(<PwaRegistration />)
		await waitFor(() => expect(mockedCapture).toHaveBeenCalledOnce())
		await waitFor(() => expect(register).toHaveBeenCalledOnce())

		expect(mockedCapture.mock.invocationCallOrder[0]).toBeLessThan(
			register.mock.invocationCallOrder[0]
		)
		expect(register).toHaveBeenCalledWith('/sw.js', {
			scope: '/',
			updateViaCache: 'none'
		})
	})

	it('captures context in development without attempting service-worker registration', async () => {
		vi.stubEnv('NODE_ENV', 'test')
		render(<PwaRegistration />)

		await waitFor(() => expect(mockedCapture).toHaveBeenCalledOnce())
	})
})
