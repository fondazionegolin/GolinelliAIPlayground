import { describe, expect, it } from 'vitest'
import { mediaKind, youtubeVideo } from './media'
import { isPodcastRequest } from './podcasts'

describe('media source detection', () => {
  it('recognizes YouTube URLs and timestamps without accepting lookalike hosts', () => {
    expect(youtubeVideo('https://youtu.be/dQw4w9WgXcQ?t=1m12s')).toEqual({ id: 'dQw4w9WgXcQ', start: 72 })
    expect(youtubeVideo('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ', start: 0 })
    expect(youtubeVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ')).not.toBeNull()
    expect(youtubeVideo('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeVideo('https://evil.test/?youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeVideo('javascript:alert(1)')).toBeNull()
  })
  it('recognizes upload MIME types and signed media links', () => {
    expect(mediaKind('lecture', 'video/mp4')).toBe('video')
    expect(mediaKind('https://cdn.test/lecture.MP3?signature=test')).toBe('audio')
    expect(mediaKind('notes.pdf')).toBeNull()
  })
})
describe('podcast configuration routing', () => {
  it.each(['Crea un podcast sulla fotosintesi', 'Fammi un riassunto audio del documento', 'Vorrei ascoltare una sintesi audio', 'Genera un audio da questi appunti', 'Un podcast sulla rivoluzione francese'])('opens configuration for %s', text => {
    expect(isPodcastRequest(text)).toBe(true)
  })
  it.each(['Cos’è un podcast?', 'Riassumi questo documento', 'Come si modifica un file audio?', 'Puoi riprodurre questo audio?', 'Riproduci questo podcast', 'Trascrivi questo audio'])('keeps ordinary questions in chat: %s', text => {
    expect(isPodcastRequest(text)).toBe(false)
  })
})
