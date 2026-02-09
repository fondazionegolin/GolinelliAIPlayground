from typing import Optional


SCHOOL_GRADE_OPTIONS = [
    "II ciclo primaria",
    "Secondaria I grado",
    "Biennio Secondaria II grado",
    "Triennio Secondaria II grado",
    "Università",
]


SCHOOL_GRADE_PROMPTS = {
    "II ciclo primaria": (
        "Adatta il linguaggio a bambine/i 8-11 anni: frasi brevi, lessico semplice, esempi concreti e quotidiani. "
        "Per i quiz usa domande brevi con 3-4 opzioni, difficoltà base/intermedia, senza tecnicismi non spiegati."
    ),
    "Secondaria I grado": (
        "Adatta il linguaggio a studentesse/studenti 11-14 anni: chiarezza, progressione guidata, definizioni semplici. "
        "Per i quiz usa difficoltà crescente leggera, con brevi spiegazioni della risposta corretta."
    ),
    "Biennio Secondaria II grado": (
        "Adatta il linguaggio a studentesse/studenti 14-16 anni: precisione terminologica moderata e metodo di studio. "
        "Per i quiz proponi difficoltà intermedia, con collegamenti tra concetti."
    ),
    "Triennio Secondaria II grado": (
        "Adatta il linguaggio a studentesse/studenti 16-19 anni: approccio analitico, terminologia disciplinare appropriata, "
        "argomentazione più strutturata. Per i quiz includi applicazioni e ragionamento."
    ),
    "Università": (
        "Adatta il linguaggio a livello universitario: terminologia specialistica, profondità teorica, rigore concettuale "
        "e collegamenti interdisciplinari. Per i quiz usa difficoltà medio-alta/alta con focus su analisi critica."
    ),
}


def get_school_grade_instruction(school_grade: Optional[str]) -> str:
    if not school_grade:
        return ""
    prompt = SCHOOL_GRADE_PROMPTS.get(school_grade)
    if not prompt:
        return ""
    return f"\n\nCONTESTO DIDATTICO - GRADO SCOLASTICO: {school_grade}\n{prompt}"

