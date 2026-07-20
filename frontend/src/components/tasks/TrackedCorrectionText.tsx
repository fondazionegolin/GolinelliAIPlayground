import { Fragment } from 'react'

type DiffPart = {
  value: string
  changed: boolean
}

const tokenize = (value: string) => value.split(/(\s+)/).filter(Boolean)

function buildTrackedText(original: string, corrected: string): DiffPart[] {
  const before = tokenize(original)
  const after = tokenize(corrected)

  // Keep the editor responsive for unusually large pasted answers.
  if (before.length * after.length > 120_000) {
    return [{ value: corrected, changed: original !== corrected }]
  }

  const lengths = Array.from({ length: before.length + 1 }, () =>
    new Uint16Array(after.length + 1)
  )
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const parts: DiffPart[] = []
  const append = (value: string, changed: boolean) => {
    const previous = parts[parts.length - 1]
    if (previous?.changed === changed) previous.value += value
    else parts.push({ value, changed })
  }

  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      append(after[j], false)
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      // Removed text remains in the immutable original response and is omitted
      // from the teacher's corrected reading version.
      i += 1
    } else {
      append(after[j], !/^\s+$/.test(after[j]))
      j += 1
    }
  }
  while (j < after.length) {
    append(after[j], !/^\s+$/.test(after[j]))
    j += 1
  }
  return parts
}

export function TrackedCorrectionText({ original, corrected }: { original: string; corrected: string }) {
  const parts = buildTrackedText(original, corrected)
  return (
    <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part.value.slice(0, 12)}`}>
          {part.changed ? (
            <mark
              className="rounded bg-amber-200 px-0.5 text-amber-950 decoration-clone"
              title="Correzione del docente"
            >
              {part.value}
            </mark>
          ) : part.value}
        </Fragment>
      ))}
    </p>
  )
}
