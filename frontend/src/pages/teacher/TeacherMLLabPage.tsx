import ClassificationModule from '../student/ClassificationModule'

export default function TeacherMLLabPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">ML Lab</h1>
        <p className="text-slate-500 mt-1">
          Laboratorio di Machine Learning - Addestra modelli per classificare testi e immagini.
        </p>
      </div>

      <ClassificationModule />
    </div>
  )
}
