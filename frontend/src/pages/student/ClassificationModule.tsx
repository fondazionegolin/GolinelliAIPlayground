import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { 
  Camera, Type, Database, Play, Square, Trash2, Plus, 
  Upload, Loader2, CheckCircle, XCircle, BarChart3, Info,
  TrendingUp, Tags, AlertCircle, Lightbulb, Box, Grid2X2
} from 'lucide-react'
import * as tf from '@tensorflow/tfjs'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// Lazy load Plotly for 3D charts
const Plot = lazy(() => import('react-plotly.js'))

type ClassificationMode = 'images' | 'text' | 'data'

interface ImageClass {
  id: string
  name: string
  samples: string[] // base64 images
  color: string
}

interface TextSample {
  text: string
  label: string
}

const CLASS_COLORS = [
  'bg-rose-500',
  'bg-blue-500', 
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
]

export default function ClassificationModule() {
  const [mode, setMode] = useState<ClassificationMode | null>(null)

  if (!mode) {
    return <ModeSelector onSelect={setMode} />
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => setMode(null)} className="mb-2">
        ← Cambia modalità
      </Button>
      
      {mode === 'images' && <ImageClassification />}
      {mode === 'text' && <TextClassification />}
      {mode === 'data' && <DataClassification />}
    </div>
  )
}

function ModeSelector({ onSelect }: { onSelect: (mode: ClassificationMode) => void }) {
  const modes = [
    { 
      key: 'images' as const, 
      icon: Camera, 
      title: 'Immagini', 
      description: 'Classifica immagini dalla webcam in tempo reale',
      color: 'bg-rose-100 text-rose-600 border-rose-200'
    },
    { 
      key: 'text' as const, 
      icon: Type, 
      title: 'Testo', 
      description: 'Analisi del sentiment e classificazione testuale',
      color: 'bg-blue-100 text-blue-600 border-blue-200'
    },
    { 
      key: 'data' as const, 
      icon: Database, 
      title: 'Dati', 
      description: 'Classificazione e regressione su dati tabellari CSV',
      color: 'bg-emerald-100 text-emerald-600 border-emerald-200'
    },
  ]

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-2">Classificazione con Machine Learning</h2>
      <p className="text-muted-foreground mb-6">Scegli il tipo di dati da classificare</p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modes.map((m) => (
          <Card 
            key={m.key}
            className={`cursor-pointer hover:shadow-lg transition-all border-2 ${m.color}`}
            onClick={() => onSelect(m.key)}
          >
            <CardContent className="p-6 text-center">
              <m.icon className="h-12 w-12 mx-auto mb-4" />
              <h3 className="font-bold text-lg mb-2">{m.title}</h3>
              <p className="text-sm opacity-80">{m.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ImageClassification() {
  const [classes, setClasses] = useState<ImageClass[]>([
    { id: '1', name: 'Classe 1', samples: [], color: CLASS_COLORS[0] },
    { id: '2', name: 'Classe 2', samples: [], color: CLASS_COLORS[1] },
  ])
  const [isCapturing, setIsCapturing] = useState<string | null>(null)
  const [isTraining, setIsTraining] = useState(false)
  const [model, setModel] = useState<tf.LayersModel | null>(null)
  const [isPredicting, setIsPredicting] = useState(false)
  const [predictions, setPredictions] = useState<{className: string, confidence: number}[]>([])
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const predictionIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize webcam
  useEffect(() => {
    const initWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 224, height: 224, facingMode: 'user' } 
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        console.error('Webcam error:', err)
      }
    }
    initWebcam()

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
        tracks.forEach(track => track.stop())
      }
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current)
      if (predictionIntervalRef.current) clearInterval(predictionIntervalRef.current)
    }
  }, [])

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return null
    
    canvasRef.current.width = 64
    canvasRef.current.height = 64
    ctx.drawImage(videoRef.current, 0, 0, 64, 64)
    return canvasRef.current.toDataURL('image/jpeg', 0.5)
  }, [])

  const startCapturing = (classId: string) => {
    setIsCapturing(classId)
    captureIntervalRef.current = setInterval(() => {
      const frame = captureFrame()
      if (frame) {
        setClasses(prev => prev.map(c => {
          if (c.id === classId && c.samples.length < 100) {
            return { ...c, samples: [...c.samples, frame] }
          }
          return c
        }))
      }
    }, 100) // Capture every 100ms
  }

  const stopCapturing = () => {
    setIsCapturing(null)
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current)
      captureIntervalRef.current = null
    }
  }

  const addClass = () => {
    if (classes.length >= 5) return
    const newId = String(classes.length + 1)
    setClasses([...classes, {
      id: newId,
      name: `Classe ${newId}`,
      samples: [],
      color: CLASS_COLORS[classes.length]
    }])
  }

  const removeClass = (id: string) => {
    if (classes.length <= 2) return
    setClasses(classes.filter(c => c.id !== id))
  }

  const clearSamples = (id: string) => {
    setClasses(classes.map(c => c.id === id ? { ...c, samples: [] } : c))
  }

  const updateClassName = (id: string, name: string) => {
    setClasses(classes.map(c => c.id === id ? { ...c, name } : c))
  }

  const trainModel = async () => {
    const totalSamples = classes.reduce((sum, c) => sum + c.samples.length, 0)
    if (totalSamples < 10) {
      alert('Raccogli almeno 10 samples totali per addestrare il modello')
      return
    }

    setIsTraining(true)
    
    try {
      // Prepare training data
      const xs: number[][] = []
      const ys: number[] = []
      
      for (let classIdx = 0; classIdx < classes.length; classIdx++) {
        const cls = classes[classIdx]
        for (const sample of cls.samples) {
          const img = new Image()
          img.src = sample
          await new Promise(resolve => img.onload = resolve)
          
          const canvas = document.createElement('canvas')
          canvas.width = 64
          canvas.height = 64
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, 64, 64)
          
          const imageData = ctx.getImageData(0, 0, 64, 64)
          const pixels: number[] = []
          for (let i = 0; i < imageData.data.length; i += 4) {
            pixels.push(imageData.data[i] / 255)
            pixels.push(imageData.data[i + 1] / 255)
            pixels.push(imageData.data[i + 2] / 255)
          }
          xs.push(pixels)
          ys.push(classIdx)
        }
      }

      // Create model
      const numClasses = classes.length
      const newModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [64 * 64 * 3], units: 128, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 64, activation: 'relu' }),
          tf.layers.dense({ units: numClasses, activation: 'softmax' })
        ]
      })

      newModel.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy']
      })

      // Convert to tensors
      const xTensor = tf.tensor2d(xs)
      const yTensor = tf.tensor1d(ys, 'float32')

      // Train
      await newModel.fit(xTensor, yTensor, {
        epochs: 20,
        batchSize: 16,
        shuffle: true,
        validationSplit: 0.1,
      })

      setModel(newModel)
      xTensor.dispose()
      yTensor.dispose()
      
    } catch (err) {
      console.error('Training error:', err)
      alert('Errore durante il training')
    } finally {
      setIsTraining(false)
    }
  }

  const startPrediction = () => {
    if (!model) return
    setIsPredicting(true)
    
    predictionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !model) return
      
      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return
      
      canvasRef.current.width = 64
      canvasRef.current.height = 64
      ctx.drawImage(videoRef.current, 0, 0, 64, 64)
      
      const imageData = ctx.getImageData(0, 0, 64, 64)
      const pixels: number[] = []
      for (let i = 0; i < imageData.data.length; i += 4) {
        pixels.push(imageData.data[i] / 255)
        pixels.push(imageData.data[i + 1] / 255)
        pixels.push(imageData.data[i + 2] / 255)
      }
      
      const input = tf.tensor2d([pixels])
      const prediction = model.predict(input) as tf.Tensor
      const probs = await prediction.data()
      
      const results = classes.map((c, i) => ({
        className: c.name,
        confidence: probs[i] * 100
      })).sort((a, b) => b.confidence - a.confidence)
      
      setPredictions(results)
      input.dispose()
      prediction.dispose()
    }, 200)
  }

  const stopPrediction = () => {
    setIsPredicting(false)
    if (predictionIntervalRef.current) {
      clearInterval(predictionIntervalRef.current)
      predictionIntervalRef.current = null
    }
    setPredictions([])
  }

  const totalSamples = classes.reduce((sum, c) => sum + c.samples.length, 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Webcam Panel */}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Webcam
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative aspect-square bg-black rounded-lg overflow-hidden mb-4">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover"
            />
            {isPredicting && predictions.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-2">
                <div className="text-white text-sm font-bold">
                  {predictions[0].className}: {predictions[0].confidence.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          
          {model ? (
            <div className="space-y-2">
              <Button 
                className="w-full"
                variant={isPredicting ? "destructive" : "default"}
                onClick={isPredicting ? stopPrediction : startPrediction}
              >
                {isPredicting ? (
                  <><Square className="h-4 w-4 mr-2" /> Stop Classificazione</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" /> Avvia Classificazione</>
                )}
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => { setModel(null); stopPrediction() }}
              >
                Reset Modello
              </Button>
            </div>
          ) : (
            <Button 
              className="w-full" 
              onClick={trainModel}
              disabled={isTraining || totalSamples < 10}
            >
              {isTraining ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Training...</>
              ) : (
                <><BarChart3 className="h-4 w-4 mr-2" /> Addestra Modello ({totalSamples} samples)</>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Classes Panel */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Classi ({classes.length}/5)</CardTitle>
            <Button 
              size="sm" 
              variant="outline"
              onClick={addClass}
              disabled={classes.length >= 5}
            >
              <Plus className="h-4 w-4 mr-1" /> Aggiungi
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {classes.map((cls) => (
            <div key={cls.id} className="border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-4 h-4 rounded ${cls.color}`} />
                <Input 
                  value={cls.name}
                  onChange={(e) => updateClassName(cls.id, e.target.value)}
                  className="h-8 flex-1"
                />
                <span className="text-sm text-muted-foreground">
                  {cls.samples.length}/100
                </span>
                <Button 
                  size="sm" 
                  variant="ghost"
                  onClick={() => clearSamples(cls.id)}
                  disabled={cls.samples.length === 0}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {classes.length > 2 && (
                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => removeClass(cls.id)}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              <div className="flex items-center gap-2 mb-2">
                <Button
                  size="sm"
                  variant={isCapturing === cls.id ? "destructive" : "secondary"}
                  onMouseDown={() => startCapturing(cls.id)}
                  onMouseUp={stopCapturing}
                  onMouseLeave={stopCapturing}
                  onTouchStart={() => startCapturing(cls.id)}
                  onTouchEnd={stopCapturing}
                  disabled={cls.samples.length >= 100 || (isCapturing !== null && isCapturing !== cls.id)}
                >
                  <Camera className="h-4 w-4 mr-1" />
                  {isCapturing === cls.id ? 'Rilascia...' : 'Tieni premuto per scattare'}
                </Button>
              </div>
              
              {/* Samples thumbnails */}
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {cls.samples.map((sample, idx) => (
                  <img 
                    key={idx}
                    src={sample}
                    alt={`Sample ${idx}`}
                    className="w-8 h-8 object-cover rounded border"
                  />
                ))}
                {cls.samples.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nessun sample. Tieni premuto il pulsante per acquisire.
                  </p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Predictions Panel */}
      {isPredicting && predictions.length > 0 && (
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Risultati Classificazione</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {predictions.map((pred, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="w-24 text-sm font-medium truncate">{pred.className}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div 
                      className={`h-full ${CLASS_COLORS[idx] || 'bg-gray-500'} transition-all duration-200`}
                      style={{ width: `${pred.confidence}%` }}
                    />
                  </div>
                  <span className="w-16 text-sm text-right">{pred.confidence.toFixed(1)}%</span>
                </div>
              ))}
            </div>
            
            {/* Explainability */}
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <strong>Spiegazione:</strong> Il modello analizza i pixel dell'immagine (64x64, {64*64*3} valori RGB normalizzati) 
                  attraverso una rete neurale con 2 layer densi. La classe "{predictions[0]?.className}" ha la confidenza più alta 
                  ({predictions[0]?.confidence.toFixed(1)}%) perché i pattern visivi catturati sono più simili ai {classes.find(c => c.name === predictions[0]?.className)?.samples.length || 0} samples 
                  di training di quella classe.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TextClassification() {
  const [samples, setSamples] = useState<TextSample[]>([])
  const [isTraining, setIsTraining] = useState(false)
  const [model, setModel] = useState<tf.LayersModel | null>(null)
  const [testText, setTestText] = useState('')
  const [prediction, setPrediction] = useState<{label: string, confidence: number} | null>(null)
  const [labels, setLabels] = useState<string[]>([])
  const [vocabulary, setVocabulary] = useState<Map<string, number>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const lines = text.split('\n').filter(l => l.trim())
      
      const newSamples: TextSample[] = []
      const uniqueLabels = new Set<string>()
      
      for (const line of lines) {
        // Try different CSV formats: "text,label" or "text;label"
        const parts = line.includes(';') ? line.split(';') : line.split(',')
        if (parts.length >= 2) {
          const label = parts[parts.length - 1].trim().replace(/"/g, '')
          const text = parts.slice(0, -1).join(',').trim().replace(/"/g, '')
          if (text && label) {
            newSamples.push({ text, label })
            uniqueLabels.add(label)
          }
        }
      }
      
      setSamples(newSamples)
      setLabels(Array.from(uniqueLabels))
    }
    reader.readAsText(file)
  }

  // Convert text to Bag-of-Words vector
  const textToBoW = (text: string, vocab: Map<string, number>, vocabSize: number): number[] => {
    const bow = new Array(vocabSize).fill(0)
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    words.forEach(word => {
      const idx = vocab.get(word)
      if (idx !== undefined) {
        bow[idx] += 1
      }
    })
    // Normalize
    const sum = bow.reduce((a, b) => a + b, 0)
    if (sum > 0) {
      for (let i = 0; i < bow.length; i++) {
        bow[i] = bow[i] / sum
      }
    }
    return bow
  }

  const trainModel = async () => {
    if (samples.length < 10 || labels.length < 2) {
      alert('Carica almeno 10 samples con almeno 2 etichette diverse')
      return
    }

    setIsTraining(true)

    try {
      // Build vocabulary with word frequency filtering
      const wordCounts = new Map<string, number>()
      samples.forEach(s => {
        const words = s.text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
        words.forEach(word => {
          if (word.length > 2) { // Skip very short words
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
          }
        })
      })
      
      // Keep only words that appear at least twice
      const vocab = new Map<string, number>()
      let idx = 0
      wordCounts.forEach((count, word) => {
        if (count >= 2) {
          vocab.set(word, idx++)
        }
      })
      setVocabulary(vocab)
      
      const vocabSize = vocab.size
      if (vocabSize < 5) {
        alert('Vocabolario troppo piccolo. Carica più testi con parole diverse.')
        setIsTraining(false)
        return
      }

      // Prepare data using Bag-of-Words
      const xs = samples.map(s => textToBoW(s.text, vocab, vocabSize))

      const labelToIdx = new Map(labels.map((l, i) => [l, i]))
      const ys = samples.map(s => labelToIdx.get(s.label) || 0)

      // Create simple dense model for BoW
      const newModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [vocabSize], units: 64, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.3 }),
          tf.layers.dense({ units: 32, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: labels.length, activation: 'softmax' })
        ]
      })

      newModel.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy']
      })

      const xTensor = tf.tensor2d(xs)
      const yTensor = tf.tensor1d(ys, 'float32')

      await newModel.fit(xTensor, yTensor, {
        epochs: 50,
        batchSize: Math.min(16, Math.floor(samples.length / 2)),
        shuffle: true,
        validationSplit: 0.15,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(`Epoch ${epoch + 1}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`)
          }
        }
      })

      setModel(newModel)
      xTensor.dispose()
      yTensor.dispose()

    } catch (err) {
      console.error('Training error:', err)
      alert('Errore durante il training: ' + (err as Error).message)
    } finally {
      setIsTraining(false)
    }
  }

  const predict = async () => {
    if (!model || !testText.trim()) return

    const bow = textToBoW(testText, vocabulary, vocabulary.size)
    const input = tf.tensor2d([bow])
    const pred = model.predict(input) as tf.Tensor
    const probs = await pred.data()

    const probsArray = Array.from(probs)
    const maxIdx = probsArray.indexOf(Math.max(...probsArray))
    setPrediction({
      label: labels[maxIdx],
      confidence: probs[maxIdx] * 100
    })

    input.dispose()
    pred.dispose()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Upload Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Carica Dataset
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Seleziona CSV
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Formato: testo,etichetta (una riga per sample)
            </p>
          </div>

          {samples.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {samples.length} samples caricati
              </p>
              <div className="flex flex-wrap gap-1">
                {labels.map((label, idx) => (
                  <span 
                    key={label}
                    className={`text-xs px-2 py-1 rounded ${CLASS_COLORS[idx]} text-white`}
                  >
                    {label}: {samples.filter(s => s.label === label).length}
                  </span>
                ))}
              </div>
              
              <div className="max-h-40 overflow-y-auto border rounded p-2 text-xs">
                {samples.slice(0, 10).map((s, i) => (
                  <div key={i} className="flex gap-2 py-1 border-b last:border-0">
                    <span className="flex-1 truncate">{s.text}</span>
                    <span className="font-medium">{s.label}</span>
                  </div>
                ))}
                {samples.length > 10 && (
                  <p className="text-muted-foreground mt-1">
                    ...e altri {samples.length - 10} samples
                  </p>
                )}
              </div>

              <Button 
                className="w-full" 
                onClick={trainModel}
                disabled={isTraining || samples.length < 10}
              >
                {isTraining ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Training...</>
                ) : (
                  <><BarChart3 className="h-4 w-4 mr-2" /> Addestra Modello</>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Type className="h-5 w-5" />
            Testa Classificazione
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {model ? (
            <>
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="Inserisci un testo da classificare..."
                className="w-full h-32 p-3 border rounded-lg resize-none"
              />
              <Button onClick={predict} disabled={!testText.trim()}>
                Classifica
              </Button>

              {prediction && (
                <div className="space-y-3">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="font-bold">{prediction.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Confidenza: {prediction.confidence.toFixed(1)}%
                    </p>
                  </div>
                  
                  {/* Explainability */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5" />
                      <div className="text-xs text-amber-800">
                        <strong>Spiegazione:</strong> Il modello usa un approccio Bag-of-Words con {vocabulary.size} parole nel vocabolario. 
                        Il testo inserito è stato convertito in un vettore di frequenze normalizzate, poi elaborato da una rete neurale 
                        con 2 layer densi. La classe "{prediction.label}" è stata scelta perché le parole nel testo sono statisticamente 
                        più associate a questa etichetta nei {samples.filter(s => s.label === prediction.label).length} esempi di training 
                        di quella categoria.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              Carica un dataset e addestra il modello per testare la classificazione
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface DataRow {
  [key: string]: string | number
}

interface ColumnInfo {
  name: string
  type: 'numeric' | 'categorical'
  uniqueValues: number
  sampleValues: (string | number)[]
}

type TaskType = 'classification' | 'regression' | null

function DataClassification() {
  const [data, setData] = useState<DataRow[]>([])
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [targetColumn, setTargetColumn] = useState<string | null>(null)
  const [suggestedTask, setSuggestedTask] = useState<TaskType>(null)
  const [taskExplanation, setTaskExplanation] = useState<string>('')
  const [xAxis, setXAxis] = useState<string | null>(null)
  const [yAxis, setYAxis] = useState<string | null>(null)
  const [zAxis, setZAxis] = useState<string | null>(null)
  const [is3D, setIs3D] = useState(false)
  const [model, setModel] = useState<tf.LayersModel | null>(null)
  const [isTraining, setIsTraining] = useState(false)
  const [prediction, setPrediction] = useState<{ value: string | number; confidence: number; explanation: string } | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [labelEncoder, setLabelEncoder] = useState<Map<string, number>>(new Map())
  const [featureScalers, setFeatureScalers] = useState<{ min: number[]; max: number[] }>({ min: [], max: [] })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const analyzeColumn = (values: (string | number)[]): ColumnInfo => {
    const uniqueValues = new Set(values)
    const numericCount = values.filter(v => !isNaN(Number(v)) && v !== '').length
    const isNumeric = numericCount > values.length * 0.8
    
    return {
      name: '',
      type: isNumeric ? 'numeric' : 'categorical',
      uniqueValues: uniqueValues.size,
      sampleValues: Array.from(uniqueValues).slice(0, 5)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) return

      // Parse header
      const separator = lines[0].includes(';') ? ';' : ','
      const headers = lines[0].split(separator).map(h => h.trim().replace(/"/g, ''))
      
      // Parse data
      const parsedData: DataRow[] = []
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(separator).map(v => v.trim().replace(/"/g, ''))
        if (values.length === headers.length) {
          const row: DataRow = {}
          headers.forEach((h, idx) => {
            const val = values[idx]
            row[h] = isNaN(Number(val)) || val === '' ? val : Number(val)
          })
          parsedData.push(row)
        }
      }

      // Analyze columns
      const columnInfos: ColumnInfo[] = headers.map(header => {
        const values = parsedData.map(row => row[header])
        const info = analyzeColumn(values)
        info.name = header
        return info
      })

      setData(parsedData)
      setColumns(columnInfos)
      setTargetColumn(null)
      setSuggestedTask(null)
      setModel(null)
      setPrediction(null)
      
      // Auto-select axes for visualization
      const numericCols = columnInfos.filter(c => c.type === 'numeric')
      if (numericCols.length >= 2) {
        setXAxis(numericCols[0].name)
        setYAxis(numericCols[1].name)
        if (numericCols.length >= 3) {
          setZAxis(numericCols[2].name)
        }
      }
    }
    reader.readAsText(file)
  }

  const selectTarget = (colName: string) => {
    setTargetColumn(colName)
    const col = columns.find(c => c.name === colName)
    if (!col) return

    // Determine task type based on column characteristics
    if (col.type === 'categorical' || (col.type === 'numeric' && col.uniqueValues <= 10)) {
      setSuggestedTask('classification')
      setTaskExplanation(
        col.type === 'categorical' 
          ? `La colonna "${colName}" contiene valori categoriali (${col.uniqueValues} categorie diverse). ` +
            `Questo indica un problema di **classificazione**: il modello imparerà a predire a quale categoria appartiene un nuovo dato.`
          : `La colonna "${colName}" è numerica ma ha solo ${col.uniqueValues} valori unici. ` +
            `Questo suggerisce un problema di **classificazione** (es. classi discrete come 0/1/2).`
      )
    } else {
      setSuggestedTask('regression')
      setTaskExplanation(
        `La colonna "${colName}" contiene valori numerici continui (${col.uniqueValues} valori unici). ` +
        `Questo indica un problema di **regressione**: il modello imparerà a predire un valore numerico.`
      )
    }
  }

  const trainModel = async () => {
    if (!targetColumn || data.length < 10) return
    setIsTraining(true)

    try {
      const featureCols = columns.filter(c => c.name !== targetColumn)

      // Prepare features
      const numericFeatures = featureCols.filter(c => c.type === 'numeric')
      const categoricalFeatures = featureCols.filter(c => c.type === 'categorical')

      // Encode categorical features
      const catEncoders: Map<string, Map<string, number>> = new Map()
      categoricalFeatures.forEach(col => {
        const encoder = new Map<string, number>()
        const uniqueVals = [...new Set(data.map(row => String(row[col.name])))]
        uniqueVals.forEach((val, idx) => encoder.set(val, idx))
        catEncoders.set(col.name, encoder)
      })

      // Build feature vectors
      const xs: number[][] = data.map(row => {
        const features: number[] = []
        // Numeric features
        numericFeatures.forEach(col => {
          features.push(Number(row[col.name]) || 0)
        })
        // One-hot encode categorical features
        categoricalFeatures.forEach(col => {
          const encoder = catEncoders.get(col.name)!
          const oneHot = new Array(encoder.size).fill(0)
          const idx = encoder.get(String(row[col.name]))
          if (idx !== undefined) oneHot[idx] = 1
          features.push(...oneHot)
        })
        return features
      })

      // Normalize numeric features
      const numNumeric = numericFeatures.length
      const mins: number[] = []
      const maxs: number[] = []
      for (let i = 0; i < numNumeric; i++) {
        const vals = xs.map(x => x[i])
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        mins.push(min)
        maxs.push(max === min ? 1 : max)
        xs.forEach(x => {
          x[i] = max === min ? 0 : (x[i] - min) / (max - min)
        })
      }
      setFeatureScalers({ min: mins, max: maxs })

      // Prepare targets
      let ys: number[]
      let numOutputs: number

      if (suggestedTask === 'classification') {
        const encoder = new Map<string, number>()
        const uniqueTargets = [...new Set(data.map(row => String(row[targetColumn])))]
        uniqueTargets.forEach((val, idx) => encoder.set(val, idx))
        setLabelEncoder(encoder)
        ys = data.map(row => encoder.get(String(row[targetColumn])) || 0)
        numOutputs = encoder.size
      } else {
        ys = data.map(row => Number(row[targetColumn]) || 0)
        // Normalize target for regression
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        ys = ys.map(y => (y - minY) / (maxY - minY || 1))
        numOutputs = 1
      }

      // Create model
      const inputDim = xs[0].length
      const newModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [inputDim], units: 32, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 16, activation: 'relu' }),
          suggestedTask === 'classification'
            ? tf.layers.dense({ units: numOutputs, activation: 'softmax' })
            : tf.layers.dense({ units: 1, activation: 'linear' })
        ]
      })

      newModel.compile({
        optimizer: tf.train.adam(0.01),
        loss: suggestedTask === 'classification' ? 'sparseCategoricalCrossentropy' : 'meanSquaredError',
        metrics: ['accuracy']
      })

      const xTensor = tf.tensor2d(xs)
      const yTensor = suggestedTask === 'classification' 
        ? tf.tensor1d(ys, 'float32')
        : tf.tensor2d(ys.map(y => [y]))

      await newModel.fit(xTensor, yTensor, {
        epochs: 50,
        batchSize: Math.min(16, Math.floor(data.length / 2)),
        shuffle: true,
        validationSplit: 0.15,
      })

      setModel(newModel)
      xTensor.dispose()
      yTensor.dispose()

      // Initialize input values
      const initInputs: Record<string, string> = {}
      featureCols.forEach(col => {
        initInputs[col.name] = col.type === 'numeric' 
          ? String(col.sampleValues[0] || '0')
          : String(col.sampleValues[0] || '')
      })
      setInputValues(initInputs)

    } catch (err) {
      console.error('Training error:', err)
      alert('Errore durante il training: ' + (err as Error).message)
    } finally {
      setIsTraining(false)
    }
  }

  const predict = async () => {
    if (!model || !targetColumn) return

    const featureCols = columns.filter(c => c.name !== targetColumn)
    const numericFeatures = featureCols.filter(c => c.type === 'numeric')
    const categoricalFeatures = featureCols.filter(c => c.type === 'categorical')

    // Build feature vector
    const features: number[] = []
    const featureExplanations: string[] = []

    numericFeatures.forEach((col, i) => {
      let val = Number(inputValues[col.name]) || 0
      featureExplanations.push(`${col.name}=${val}`)
      // Normalize
      val = (val - featureScalers.min[i]) / (featureScalers.max[i] - featureScalers.min[i] || 1)
      features.push(val)
    })

    categoricalFeatures.forEach(col => {
      const uniqueVals = [...new Set(data.map(row => String(row[col.name])))]
      const oneHot = new Array(uniqueVals.length).fill(0)
      const idx = uniqueVals.indexOf(inputValues[col.name])
      if (idx >= 0) oneHot[idx] = 1
      featureExplanations.push(`${col.name}="${inputValues[col.name]}"`)
      features.push(...oneHot)
    })

    const input = tf.tensor2d([features])
    const pred = model.predict(input) as tf.Tensor
    const probs = await pred.data()

    if (suggestedTask === 'classification') {
      const probsArray = Array.from(probs)
      const maxIdx = probsArray.indexOf(Math.max(...probsArray))
      const labels = Array.from(labelEncoder.keys())
      const predictedLabel = labels[maxIdx]
      const confidence = probs[maxIdx] * 100

      // Build explanation
      const topFeatures = featureExplanations.slice(0, 3).join(', ')
      const explanation = `🔍 **Spiegazione**: Il modello ha analizzato ${featureCols.length} caratteristiche. ` +
        `Con i valori inseriti (${topFeatures}${featureCols.length > 3 ? '...' : ''}), ` +
        `la classe più probabile è "${predictedLabel}" con confidenza ${confidence.toFixed(1)}%. ` +
        `Le altre classi hanno probabilità: ${labels.filter((_, i) => i !== maxIdx).map((l, i) => 
          `"${l}": ${(probsArray[i < maxIdx ? i : i + 1] * 100).toFixed(1)}%`
        ).join(', ')}.`

      setPrediction({ value: predictedLabel, confidence, explanation })
    } else {
      // Regression - denormalize
      const targetVals = data.map(row => Number(row[targetColumn]))
      const minY = Math.min(...targetVals)
      const maxY = Math.max(...targetVals)
      const predictedValue = probs[0] * (maxY - minY) + minY

      const explanation = `🔍 **Spiegazione**: Il modello di regressione ha stimato il valore basandosi su ${featureCols.length} caratteristiche. ` +
        `Con i valori inseriti, la predizione è ${predictedValue.toFixed(2)}. ` +
        `Il range dei dati di training va da ${minY.toFixed(2)} a ${maxY.toFixed(2)}.`

      setPrediction({ value: predictedValue.toFixed(2), confidence: 100, explanation })
    }

    input.dispose()
    pred.dispose()
  }

  const numericColumns = columns.filter(c => c.type === 'numeric')
  const chartData = data.slice(0, 200).map(row => ({
    x: xAxis ? Number(row[xAxis]) : 0,
    y: yAxis ? Number(row[yAxis]) : 0,
    label: targetColumn ? String(row[targetColumn]) : ''
  }))

  return (
    <div className="space-y-4">
      {/* Upload Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Carica Dataset CSV
          </CardTitle>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button onClick={() => fileInputRef.current?.click()} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            Seleziona file CSV
          </Button>
          
          {data.length > 0 && (
            <div className="mt-4 p-3 bg-emerald-50 rounded-lg">
              <p className="text-sm font-medium text-emerald-700">
                ✓ Caricati {data.length} righe, {columns.length} colonne
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {columns.map(col => (
                  <span 
                    key={col.name}
                    className={`text-xs px-2 py-1 rounded ${
                      col.type === 'numeric' 
                        ? 'bg-blue-100 text-blue-700' 
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {col.name} ({col.type === 'numeric' ? 'num' : 'cat'})
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visualization Panel */}
      {data.length > 0 && numericColumns.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Visualizzazione Dati
              </div>
              {numericColumns.length >= 3 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant={!is3D ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setIs3D(false)}
                  >
                    <Grid2X2 className="h-4 w-4 mr-1" />
                    2D
                  </Button>
                  <Button
                    variant={is3D ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setIs3D(true)}
                  >
                    <Box className="h-4 w-4 mr-1" />
                    3D
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`flex gap-4 mb-4 ${is3D ? 'flex-wrap' : ''}`}>
              <div className="flex-1 min-w-[100px]">
                <label className="text-sm font-medium">Asse X</label>
                <select 
                  className="w-full mt-1 p-2 border rounded"
                  value={xAxis || ''}
                  onChange={(e) => setXAxis(e.target.value)}
                >
                  {numericColumns.map(col => (
                    <option key={col.name} value={col.name}>{col.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="text-sm font-medium">Asse Y</label>
                <select 
                  className="w-full mt-1 p-2 border rounded"
                  value={yAxis || ''}
                  onChange={(e) => setYAxis(e.target.value)}
                >
                  {numericColumns.map(col => (
                    <option key={col.name} value={col.name}>{col.name}</option>
                  ))}
                </select>
              </div>
              {is3D && (
                <div className="flex-1 min-w-[100px]">
                  <label className="text-sm font-medium">Asse Z</label>
                  <select 
                    className="w-full mt-1 p-2 border rounded"
                    value={zAxis || ''}
                    onChange={(e) => setZAxis(e.target.value)}
                  >
                    {numericColumns.map(col => (
                      <option key={col.name} value={col.name}>{col.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            {!is3D ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" name={xAxis || ''} type="number" fontSize={12} />
                    <YAxis dataKey="y" name={yAxis || ''} type="number" fontSize={12} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter name="Dati" data={chartData} fill="#8884d8" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-80">
                <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
                  <Plot
                    data={[{
                      x: data.slice(0, 200).map(row => xAxis ? Number(row[xAxis]) : 0),
                      y: data.slice(0, 200).map(row => yAxis ? Number(row[yAxis]) : 0),
                      z: data.slice(0, 200).map(row => zAxis ? Number(row[zAxis]) : 0),
                      mode: 'markers',
                      type: 'scatter3d',
                      marker: {
                        size: 5,
                        color: data.slice(0, 200).map((_, i) => i),
                        colorscale: 'Viridis',
                        opacity: 0.8
                      }
                    }]}
                    layout={{
                      autosize: true,
                      margin: { l: 0, r: 0, b: 0, t: 0 },
                      scene: {
                        xaxis: { title: { text: xAxis || 'X' } },
                        yaxis: { title: { text: yAxis || 'Y' } },
                        zaxis: { title: { text: zAxis || 'Z' } }
                      }
                    }}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: '100%', height: '100%' }}
                  />
                </Suspense>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Target Selection */}
      {data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Seleziona Colonna Target
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Scegli la colonna che vuoi predire. Il sistema suggerirà automaticamente il tipo di analisi.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {columns.map(col => (
                <Button
                  key={col.name}
                  variant={targetColumn === col.name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => selectTarget(col.name)}
                  className="justify-start"
                >
                  {col.type === 'numeric' ? (
                    <TrendingUp className="h-4 w-4 mr-2" />
                  ) : (
                    <Tags className="h-4 w-4 mr-2" />
                  )}
                  {col.name}
                </Button>
              ))}
            </div>

            {suggestedTask && (
              <div className={`mt-4 p-4 rounded-lg ${
                suggestedTask === 'classification' 
                  ? 'bg-purple-50 border border-purple-200' 
                  : 'bg-blue-50 border border-blue-200'
              }`}>
                <div className="flex items-start gap-2">
                  <Lightbulb className={`h-5 w-5 mt-0.5 ${
                    suggestedTask === 'classification' ? 'text-purple-600' : 'text-blue-600'
                  }`} />
                  <div>
                    <p className={`font-medium ${
                      suggestedTask === 'classification' ? 'text-purple-700' : 'text-blue-700'
                    }`}>
                      Suggerimento: {suggestedTask === 'classification' ? 'Classificazione' : 'Regressione'}
                    </p>
                    <p className="text-sm mt-1 text-gray-600">{taskExplanation}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Training */}
      {targetColumn && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-5 w-5" />
              Training Modello
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={trainModel} 
              disabled={isTraining}
              className="w-full"
            >
              {isTraining ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Training in corso...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Addestra Modello ({suggestedTask === 'classification' ? 'Classificazione' : 'Regressione'})
                </>
              )}
            </Button>

            {model && (
              <div className="mt-4 p-3 bg-emerald-50 rounded-lg">
                <p className="text-sm font-medium text-emerald-700 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Modello addestrato con successo!
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Prediction */}
      {model && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Predizione
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              {columns.filter(c => c.name !== targetColumn).map(col => (
                <div key={col.name}>
                  <label className="text-xs font-medium text-gray-600">{col.name}</label>
                  {col.type === 'numeric' ? (
                    <Input
                      type="number"
                      value={inputValues[col.name] || ''}
                      onChange={(e) => setInputValues({ ...inputValues, [col.name]: e.target.value })}
                      className="mt-1"
                    />
                  ) : (
                    <select
                      className="w-full mt-1 p-2 border rounded text-sm"
                      value={inputValues[col.name] || ''}
                      onChange={(e) => setInputValues({ ...inputValues, [col.name]: e.target.value })}
                    >
                      {col.sampleValues.map(v => (
                        <option key={String(v)} value={String(v)}>{String(v)}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>

            <Button onClick={predict} className="w-full">
              <Play className="h-4 w-4 mr-2" />
              Predici
            </Button>

            {prediction && (
              <div className="mt-4 space-y-3">
                <div className={`p-4 rounded-lg ${
                  suggestedTask === 'classification' 
                    ? 'bg-purple-50 border border-purple-200' 
                    : 'bg-blue-50 border border-blue-200'
                }`}>
                  <p className="text-lg font-bold">
                    {suggestedTask === 'classification' ? 'Classe predetta: ' : 'Valore predetto: '}
                    <span className={suggestedTask === 'classification' ? 'text-purple-700' : 'text-blue-700'}>
                      {prediction.value}
                    </span>
                  </p>
                  {suggestedTask === 'classification' && (
                    <p className="text-sm text-gray-600">
                      Confidenza: {prediction.confidence.toFixed(1)}%
                    </p>
                  )}
                </div>

                {/* Explainability */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      {prediction.explanation}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
