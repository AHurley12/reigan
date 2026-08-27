import { useCallback, useState } from 'react'
import { checkAttachment } from '../../../../shared/attachmentPolicy'
import type { ChatAttachmentInput } from '../../../../shared/types'
import { useToastStore } from '../../stores/toastStore'

export interface PendingAttachment extends ChatAttachmentInput {
  /** Local only, for React keys and removal. */
  id: string
  byteSize: number
  kind: 'image' | 'document'
}

/** Strips the `data:<mime>;base64,` prefix a FileReader result carries. */
function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(toBase64(String(reader.result)))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

/**
 * The composer's pending attachments.
 *
 * Held here rather than in the chat store because they belong to a draft, not
 * to the conversation: switching conversations or hitting Escape should not
 * leave a half-composed turn's files lying around in global state.
 *
 * Paste, drop and the file picker all funnel through `add`, so one policy
 * decision covers all three entry points instead of three that can disagree.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])

  const add = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    // Accumulated locally: setState is async, so consulting `attachments` for
    // each file in the loop would judge every one against the same stale list
    // and let a batch through that exceeds the per-turn ceiling together.
    const accepted: PendingAttachment[] = []
    const rejections: string[] = []

    setAttachments((current) => {
      // Read the live list once, synchronously, before any await.
      accepted.push(...current)
      return current
    })

    for (const file of files) {
      const verdict = checkAttachment(
        { name: file.name, mimeType: file.type, byteSize: file.size },
        accepted.map((a) => ({ name: a.filename, mimeType: a.mimeType, byteSize: a.byteSize }))
      )

      if (!verdict.ok) {
        rejections.push(verdict.reason)
        continue
      }

      try {
        accepted.push({
          id: crypto.randomUUID(),
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
          kind: verdict.kind,
          data: await readAsBase64(file),
        })
      } catch (err) {
        rejections.push(`${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setAttachments(accepted)
    // One toast per refusal, each naming the limit it broke.
    for (const reason of rejections) useToastStore.getState().push(reason, 'warning')
  }, [])

  const remove = useCallback((id: string) => {
    setAttachments((current) => current.filter((a) => a.id !== id))
  }, [])

  const clear = useCallback(() => setAttachments([]), [])

  return { attachments, add, remove, clear }
}
