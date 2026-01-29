import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react'
import { triggerHaptic } from '@/lib/haptics'

interface ZoomableImageProps {
  src: string
  alt?: string
  className?: string
  maxZoom?: number
  minZoom?: number
  onDownload?: () => void
}

export function ZoomableImage({
  src,
  alt = 'Image',
  className = '',
  maxZoom = 3,
  minZoom = 1,
  onDownload,
}: ZoomableImageProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const lastTouchDistance = useRef<number | null>(null)
  const lastTouchCenter = useRef({ x: 0, y: 0 })
  const isPinching = useRef(false)
  const doubleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    }
  }, [isOpen])

  // Get distance between two touches
  const getTouchDistance = (touches: React.TouchList): number => {
    if (touches.length < 2) return 0
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Get center point between two touches
  const getTouchCenter = (touches: React.TouchList): { x: number; y: number } => {
    if (touches.length < 2) return { x: touches[0].clientX, y: touches[0].clientY }
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    }
  }

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true
      lastTouchDistance.current = getTouchDistance(e.touches)
      lastTouchCenter.current = getTouchCenter(e.touches)
    } else if (e.touches.length === 1) {
      // Double tap detection
      if (doubleTapTimer.current) {
        clearTimeout(doubleTapTimer.current)
        doubleTapTimer.current = null

        // Double tap - toggle zoom
        triggerHaptic('light')
        if (scale > 1) {
          setScale(1)
          setPosition({ x: 0, y: 0 })
        } else {
          setScale(2)
        }
      } else {
        doubleTapTimer.current = setTimeout(() => {
          doubleTapTimer.current = null
        }, 300)
      }
    }
  }, [scale])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current) {
      e.preventDefault()

      const newDistance = getTouchDistance(e.touches)
      const newCenter = getTouchCenter(e.touches)

      if (lastTouchDistance.current) {
        const scaleChange = newDistance / lastTouchDistance.current
        const newScale = Math.min(maxZoom, Math.max(minZoom, scale * scaleChange))

        // Haptic feedback at zoom limits
        if (newScale === maxZoom || newScale === minZoom) {
          triggerHaptic('light')
        }

        setScale(newScale)
      }

      // Pan while pinching
      if (scale > 1) {
        const dx = newCenter.x - lastTouchCenter.current.x
        const dy = newCenter.y - lastTouchCenter.current.y
        setPosition(prev => ({
          x: prev.x + dx,
          y: prev.y + dy,
        }))
      }

      lastTouchDistance.current = newDistance
      lastTouchCenter.current = newCenter
    } else if (e.touches.length === 1 && scale > 1 && !isPinching.current) {
      // Pan when zoomed
      const touch = e.touches[0]
      const dx = touch.clientX - lastTouchCenter.current.x
      const dy = touch.clientY - lastTouchCenter.current.y

      setPosition(prev => ({
        x: prev.x + dx,
        y: prev.y + dy,
      }))

      lastTouchCenter.current = { x: touch.clientX, y: touch.clientY }
    }
  }, [scale, maxZoom, minZoom])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      isPinching.current = false
      lastTouchDistance.current = null
    }
    if (e.touches.length === 1) {
      lastTouchCenter.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }, [])

  const handleZoomIn = useCallback(() => {
    triggerHaptic('light')
    setScale(prev => Math.min(maxZoom, prev + 0.5))
  }, [maxZoom])

  const handleZoomOut = useCallback(() => {
    triggerHaptic('light')
    const newScale = Math.max(minZoom, scale - 0.5)
    setScale(newScale)
    if (newScale === 1) {
      setPosition({ x: 0, y: 0 })
    }
  }, [minZoom, scale])

  const handleDownload = useCallback(() => {
    triggerHaptic('success')
    if (onDownload) {
      onDownload()
    } else {
      const link = document.createElement('a')
      link.href = src
      link.download = alt || 'image'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }, [src, alt, onDownload])

  return (
    <>
      {/* Thumbnail */}
      <button
        onClick={() => {
          triggerHaptic('light')
          setIsOpen(true)
        }}
        className={`cursor-zoom-in ${className}`}
      >
        <img
          src={src}
          alt={alt}
          className="w-full h-auto rounded-lg"
          loading="lazy"
        />
      </button>

      {/* Fullscreen viewer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black"
          >
            {/* Close button */}
            <button
              onClick={() => {
                triggerHaptic('light')
                setIsOpen(false)
              }}
              className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Zoom controls */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-2 py-1">
              <button
                onClick={handleZoomOut}
                disabled={scale <= minZoom}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white disabled:opacity-50"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-white text-sm font-medium min-w-[3rem] text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                disabled={scale >= maxZoom}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white disabled:opacity-50"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              {onDownload && (
                <>
                  <div className="w-px h-6 bg-white/30" />
                  <button
                    onClick={handleDownload}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            {/* Image */}
            <motion.div
              className="w-full h-full flex items-center justify-center"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                touchAction: 'none',
              }}
            >
              <motion.img
                src={src}
                alt={alt}
                className="max-w-full max-h-full object-contain select-none"
                style={{
                  scale,
                  x: position.x,
                  y: position.y,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                draggable={false}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default ZoomableImage
