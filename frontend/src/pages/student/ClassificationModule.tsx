import MLLabImageStudio from '@/components/mllab/MLLabImageStudio'

/**
 * ML Lab entry point (teachers and students). Text and tabular classification moved to the Dataflow Studio,
 * so only the image classifier is left here: library of projects first, then the editor.
 */
export default function ClassificationModule({ sessionId }: { sessionId?: string } = {}) {
  return <MLLabImageStudio sessionId={sessionId} />
}
