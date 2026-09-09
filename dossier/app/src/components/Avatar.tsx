import { useEffect, useState } from 'react'
import { getPhotoUrl, peekPhotoUrl } from '../lib/photoCache'
import type { Person } from '../lib/models'
import { selectAvatar, useVaultStore } from '../store/vaultStore'

/** Face circle (§4.1): avatar photo when set, initials otherwise. */
export default function Avatar({
  person,
  size = 40,
}: {
  person: Person
  size?: number
}) {
  const records = useVaultStore((s) => s.records)
  const vault = useVaultStore((s) => s.vault)
  const avatar = selectAvatar(records, person.id)
  // Synchronous cache peek avoids an initials flash on every mount.
  const [url, setUrl] = useState<string | null>(() =>
    avatar ? peekPhotoUrl(avatar.blobRecordId, avatar.mimeType) : null,
  )

  useEffect(() => {
    let cancelled = false
    if (avatar && vault) {
      const cached = peekPhotoUrl(avatar.blobRecordId, avatar.mimeType)
      setUrl(cached)
      if (!cached) {
        void getPhotoUrl(vault, avatar.blobRecordId, avatar.mimeType).then((u) => {
          if (!cancelled) setUrl(u)
        })
      }
    } else {
      setUrl(null)
    }
    return () => {
      cancelled = true
    }
  }, [avatar?.blobRecordId, avatar?.mimeType, vault])

  const initials = person.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const style = { width: size, height: size, fontSize: size * 0.4 }
  if (url) {
    return (
      <img
        className="avatar"
        style={style}
        src={url}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    )
  }
  return (
    <span className="avatar avatar-initials" style={style} aria-hidden="true">
      {initials}
    </span>
  )
}
