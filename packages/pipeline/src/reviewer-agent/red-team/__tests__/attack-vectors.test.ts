import { describe, it, expect } from 'vitest'
import { RED_TEAM_SYSTEM_PROMPT } from '../prompts'

const ATTACK_VECTORS = [
  'sandbox_escape',
  'bridge_abuse',
  'data_exfiltration',
  'prompt_injection',
  'cross_component',
  'supply_chain',
  'state_persistence',
  'timing_dos',
] as const

describe('RED_TEAM_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof RED_TEAM_SYSTEM_PROMPT).toBe('string')
    expect(RED_TEAM_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it('instructs the agent to think adversarially', () => {
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('ATTACKER')
  })

  it('requires tool use for evidence', () => {
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('tools')
  })

  it('defines feasibility levels: demonstrated', () => {
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('demonstrated')
  })

  it('defines feasibility levels: plausible', () => {
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('plausible')
  })

  it('defines feasibility levels: theoretical', () => {
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('theoretical')
  })

  it('specifies JSON output format', () => {
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('exploitAttempts')
    expect(RED_TEAM_SYSTEM_PROMPT).toContain('overallThreatLevel')
  })

  for (const vector of ATTACK_VECTORS) {
    it(`covers attack vector: ${vector}`, () => {
      expect(RED_TEAM_SYSTEM_PROMPT).toContain(vector)
    })
  }
})
