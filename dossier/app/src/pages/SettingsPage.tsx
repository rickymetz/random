import { useRef, useState } from 'react'
import { destroyAllData } from '../lib/db'
import { exportBundle, exportFileName, importBundle } from '../lib/export'
import { unlockVault } from '../lib/vault'
import { useVaultStore } from '../store/vaultStore'

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
      <ExportSection />
      <ImportSection />
      <section>
        <h2>Danger</h2>
        <button className="danger" onClick={destroy}>
          Destroy all data
        </button>
        <p className="hint">
          Nothing ever leaves this device except encrypted backups, so this is the whole
          story: wipe here, and it's gone.
        </p>
      </section>
    </div>
  )
}

/**
 * Encrypted export (§4.5): re-entering the passphrase both keys the bundle
 * and proves the user still knows it. Verified against the vault before
 * exporting so a typo can't produce a backup with a surprise passphrase.
 */
function ExportSection() {
  const records = useVaultStore((s) => s.records)
  const [passphrase, setPassphrase] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'wrong'>('idle')

  const doExport = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('busy')
    try {
      if (!(await unlockVault(passphrase))) {
        setState('wrong')
        return
      }
      const text = await exportBundle(passphrase, [...records.values()])
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName()
      a.click()
      URL.revokeObjectURL(url)
      setState('done')
    } finally {
      setPassphrase('')
    }
  }

  return (
    <section>
      <h2>Backup</h2>
      <p className="hint">
        Downloads an encrypted backup — the only way data leaves this device. It opens
        with your passphrase on any device; without it, the file is noise.
      </p>
      <form className="row" onSubmit={doExport}>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Confirm passphrase"
          autoComplete="current-password"
        />
        <button type="submit" disabled={!passphrase || state === 'busy'}>
          {state === 'busy' ? '…' : 'Export'}
        </button>
      </form>
      {state === 'wrong' && <p className="hint error">That's not the vault passphrase.</p>}
      {state === 'done' && <p className="hint">Backup saved.</p>}
    </section>
  )
}

function ImportSection() {
  const importRecords = useVaultStore((s) => s.importRecords)
  const fileRef = useRef<HTMLInputElement>(null)
  const [passphrase, setPassphrase] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setError(null)
    const file = fileRef.current?.files?.[0]
    if (!file) return
    try {
      const restored = await importBundle(passphrase, await file.text())
      if (restored === null) {
        setError('Wrong passphrase for this backup.')
        return
      }
      const count = await importRecords(restored)
      setMessage(`Restored ${count} records.`)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setPassphrase('')
    }
  }

  return (
    <section>
      <h2>Restore</h2>
      <p className="hint">
        Merges a backup into this vault (newer entries win by id). On a fresh device:
        create a vault, then restore here.
      </p>
      <form className="column" onSubmit={doImport}>
        <input ref={fileRef} type="file" accept=".ledger,application/json" />
        <div className="row">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Backup passphrase"
            autoComplete="off"
          />
          <button type="submit" disabled={!passphrase}>
            Restore
          </button>
        </div>
      </form>
      {error && <p className="hint error">{error}</p>}
      {message && <p className="hint">{message}</p>}
    </section>
  )
}
