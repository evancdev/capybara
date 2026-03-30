import { rmSync } from 'fs'

for (const dir of ['out', 'dist', 'release']) {
  rmSync(dir, { recursive: true, force: true })
}
