export type AttackVector =
  | 'sandbox_escape'
  | 'bridge_abuse'
  | 'data_exfiltration'
  | 'prompt_injection'
  | 'cross_component'
  | 'supply_chain'
  | 'state_persistence'
  | 'timing_dos'

export const ATTACK_VECTORS: AttackVector[] = [
  'sandbox_escape',
  'bridge_abuse',
  'data_exfiltration',
  'prompt_injection',
  'cross_component',
  'supply_chain',
  'state_persistence',
  'timing_dos',
]

export const ATTACK_VECTOR_DESCRIPTIONS: Record<AttackVector, string> = {
  sandbox_escape: 'Can the code reach outside the sandbox?',
  bridge_abuse: 'Dynamic source IDs, eavesdropping, config leaks via bridge API?',
  data_exfiltration: 'CSS props, error messages, image tags, timing-based data leaks?',
  prompt_injection: 'Instructions in context.md targeting AI agents?',
  cross_component: 'Event/action injection, state poisoning across components?',
  supply_chain: 'Known vulnerable dependencies?',
  state_persistence: 'Module-level closures, WeakMaps for cross-render persistence?',
  timing_dos: 'Infinite loops, memory exhaustion, CPU-bound freezing?',
}
