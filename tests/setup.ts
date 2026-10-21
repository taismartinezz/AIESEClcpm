import '@testing-library/jest-dom'
import { vi } from 'vitest'

// localStorage stub: jsdom v29 localStorage is not fully implemented in all Vitest envs.

const storage: Record<string, string> = {}

const localStorageMock = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = String(value) },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]) },
  length: 0,
  key: () => null,
}

vi.stubGlobal('localStorage', localStorageMock)

// window.location: jsdom v29 made this non-configurable (browser-spec compliant).
// Object.defineProperty throws TypeError: don't redefine it.
// jsdom already sets location.origin to 'http://localhost', which is sufficient.
