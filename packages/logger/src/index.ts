import pino from 'pino'

const root = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
})

export function createLogger(module: string) {
  return root.child({ module })
}

export type Logger = ReturnType<typeof createLogger>
