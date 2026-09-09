import { destroyAllData } from '../lib/db'
import { useVaultStore } from '../store/vaultStore'

/**
 * Settings stub. Grows into: lock timers, PIN + biometric enrollment,
 * disguise choice, encrypted export/import, and reminder preferences.
 */
export default function SettingsPage() {
  const lock = useVaultStore((s) => s.lock)

  const destroy = async () => {
    const answer = prompt('Type DELETE to destroy all data on this device. There is no undo.')
    if (answer !== 'DELETE') return
    await destroyAllData()
    lock()
    location.reload()
  }

  return (
    <div className="settings">
      <section>
        <h2>Backup</h2>
        <p className="hint">Encrypted export/import lands here (the only way data leaves this device).</p>
      </section>
      <section>
        <h2>Danger</h2>
        <button className="danger" onClick={destroy}>
          Destroy all data
        </button>
      </section>
    </div>
  )
}
