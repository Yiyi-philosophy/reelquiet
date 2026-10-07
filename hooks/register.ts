// ReelQuiet hooks module: the only file that may touch $.
// Stage 1 wiring waits on the T1 platform probes; until then this registers nothing.
import type { Register } from 'claude-code'

export const register: Register = () => {}
