import { describe, it, expect } from 'vitest'
import { BRIDGE_API_SPEC, PLATFORM_CONSTRAINTS } from '../platform-spec'

describe('BRIDGE_API_SPEC', () => {
  it('is a non-empty string', () => {
    expect(typeof BRIDGE_API_SPEC).toBe('string')
    expect(BRIDGE_API_SPEC.length).toBeGreaterThan(0)
  })

  it('documents bridge.fetch', () => {
    expect(BRIDGE_API_SPEC).toContain('bridge.fetch')
  })

  it('documents bridge.subscribe', () => {
    expect(BRIDGE_API_SPEC).toContain('bridge.subscribe')
  })

  it('documents bridge.getConfig', () => {
    expect(BRIDGE_API_SPEC).toContain('bridge.getConfig')
  })

  it('describes sandbox restrictions', () => {
    expect(BRIDGE_API_SPEC).toContain('sandbox')
  })

  it('mentions side channels', () => {
    expect(BRIDGE_API_SPEC).toContain('side')
  })
})

describe('PLATFORM_CONSTRAINTS', () => {
  it('is a non-empty string', () => {
    expect(typeof PLATFORM_CONSTRAINTS).toBe('string')
    expect(PLATFORM_CONSTRAINTS.length).toBeGreaterThan(0)
  })

  it('lists what is blocked', () => {
    expect(PLATFORM_CONSTRAINTS).toContain('BLOCKED')
  })

  it('lists what is allowed', () => {
    expect(PLATFORM_CONSTRAINTS).toContain('Allowed')
  })

  it('mentions eval as blocked', () => {
    expect(PLATFORM_CONSTRAINTS).toContain('eval')
  })

  it('lists known side-channel risks', () => {
    expect(PLATFORM_CONSTRAINTS).toContain('Side-Channel')
  })
})
