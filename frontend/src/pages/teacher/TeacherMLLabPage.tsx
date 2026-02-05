import ClassificationModule from '../student/ClassificationModule'

export default function TeacherMLLabPage() {
  return (
    <div className="relative overflow-hidden">

      <div className="relative p-6 md:p-8 max-w-6xl mx-auto space-y-8">
        {/* Hero */}
        <div className="rounded-3xl border border-sky-100 bg-white/70 backdrop-blur-sm shadow-xl shadow-sky-100/40 p-6 md:p-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 text-sky-700 px-3 py-1 text-xs font-semibold tracking-wide">
                Laboratorio Didattico
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900">
                ML Lab per Docenti
              </h1>
              <p className="text-slate-600 max-w-2xl">
                Progetta esperimenti guidati, allena classificatori e rendi visibili i risultati agli studenti.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white flex items-center justify-center shadow-lg shadow-cyan-200/60">
                <span className="text-lg font-bold">ML</span>
              </div>
              <div className="text-xs text-slate-500">
                Pronto per l’uso
              </div>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 bg-white/80 backdrop-blur-sm p-5 shadow-lg shadow-slate-100/60 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 text-white flex items-center justify-center shadow-md">
              <span className="text-sm font-bold">TXT</span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-800">Classificazione Testi</h3>
            <p className="mt-1 text-sm text-slate-600">
              Crea etichette, carica esempi e mostra come un modello impara a riconoscere argomenti e intenzioni.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white/80 backdrop-blur-sm p-5 shadow-lg shadow-slate-100/60 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-75">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-white flex items-center justify-center shadow-md">
              <span className="text-sm font-bold">IMG</span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-800">Classificazione Immagini</h3>
            <p className="mt-1 text-sm text-slate-600">
              Trasforma immagini in dataset didattici e confronta i risultati con esempi reali in classe.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white/80 backdrop-blur-sm p-5 shadow-lg shadow-slate-100/60 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shadow-md">
              <span className="text-sm font-bold">VAL</span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-800">Valutazioni e Insight</h3>
            <p className="mt-1 text-sm text-slate-600">
              Evidenzia accuratezza, errori comuni e cosa significa “generalizzare” in modo semplice e visivo.
            </p>
          </div>
        </div>

        {/* Lab Container */}
        <div className="rounded-3xl border border-slate-100 bg-white/90 backdrop-blur-sm shadow-2xl shadow-sky-100/50 p-4 md:p-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <ClassificationModule />
        </div>
      </div>
    </div>
  )
}
