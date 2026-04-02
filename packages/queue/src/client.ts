import PgBoss from 'pg-boss'

let _boss: PgBoss | null = null

export async function getBoss(): Promise<PgBoss> {
  if (!_boss) {
    _boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInHours: 24,
      archiveCompletedAfterSeconds: 7 * 24 * 3600,
    })
    await _boss.start()
  }
  return _boss
}

export async function stopBoss(): Promise<void> {
  if (_boss) {
    await _boss.stop()
    _boss = null
  }
}
