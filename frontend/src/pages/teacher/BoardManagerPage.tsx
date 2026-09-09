import BoardManager from '@/components/boards/BoardManager'

export default function BoardManagerPage({ sessionId }: { sessionId?: string }) {
  return <BoardManager sessionId={sessionId} />
}
