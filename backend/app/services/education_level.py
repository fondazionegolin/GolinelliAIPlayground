from typing import Optional


SCHOOL_GRADE_OPTIONS = [
    "II ciclo primaria",
    "Secondaria I grado",
    "Biennio Secondaria II grado",
    "Triennio Secondaria II grado",
    "Università",
]

# Appended to every grade prompt: adversarial self-check + explicit age-override rule
_SELF_CHECK = (
    "\nVERIFICA OBBLIGATORIA: Prima di finalizzare ogni risposta, controlla che ogni termine, simbolo,"
    " formula e concetto usato sia effettivamente nel curriculum di questo livello e non richieda"
    " prerequisiti superiori. Se trovi elementi inadeguati, semplifica o ometti."
    " Se nella conversazione viene specificata un'età o un grado diverso (es. 'per un bambino di 6 anni',"
    " 'spiegalo come a una classe di seconda elementare'), quella indicazione ha PRIORITÀ ASSOLUTA:"
    " adatta la risposta a quell'età specifica, anche se è inferiore al grado scolastico della sessione."
)

SCHOOL_GRADE_PROMPTS = {
    "II ciclo primaria": (
        "Adatta il linguaggio a bambine/i 8-11 anni: frasi brevi, lessico semplice, esempi concreti e quotidiani. "
        "Concetti APPROPRIATI: operazioni aritmetiche di base (+/−/×/÷ con numeri piccoli), frazioni semplici (½, ¼),"
        " figure geometriche elementari (quadrato, triangolo, cerchio), misure quotidiane (cm, kg, litri). "
        "Concetti da EVITARE: π (pi greco), formule algebriche, variabili, equazioni, potenze, radici quadrate,"
        " notazione scientifica, qualunque concetto astratto non ancorato all'esperienza sensoriale diretta. "
        "Per i quiz usa domande brevi con 3-4 opzioni, difficoltà base/intermedia, senza tecnicismi non spiegati."
        + _SELF_CHECK
    ),
    "Secondaria I grado": (
        "Adatta il linguaggio a studentesse/studenti 11-14 anni: chiarezza, progressione guidata, definizioni semplici. "
        "Concetti APPROPRIATI: frazioni e percentuali, equazioni di primo grado, geometria piana, scienze di base,"
        " introduzione alla chimica (atomo, molecola), storia e geografia a livello descrittivo. "
        "Concetti da EVITARE: derivate, integrali, logaritmi, trigonometria avanzata, terminologia universitaria. "
        "Per i quiz usa difficoltà crescente leggera, con brevi spiegazioni della risposta corretta."
        + _SELF_CHECK
    ),
    "Biennio Secondaria II grado": (
        "Adatta il linguaggio a studentesse/studenti 14-16 anni: precisione terminologica moderata e metodo di studio. "
        "Concetti APPROPRIATI: algebra, geometria analitica di base, scienze sperimentali introduttive, equazioni di II grado. "
        "Concetti da EVITARE: analisi matematica avanzata (limiti, derivate, integrali), terminologia universitaria specialistica. "
        "Per i quiz proponi difficoltà intermedia, con collegamenti tra concetti."
        + _SELF_CHECK
    ),
    "Triennio Secondaria II grado": (
        "Adatta il linguaggio a studentesse/studenti 16-19 anni: approccio analitico, terminologia disciplinare appropriata,"
        " argomentazione più strutturata. "
        "Concetti APPROPRIATI: analisi matematica (limiti, derivate, integrali di liceo), termodinamica, elettromagnetismo"
        " a livello liceale, letteratura e filosofia del triennio. "
        "Concetti da EVITARE: modelli e formalismi propri esclusivamente dell'università (es. tensori, meccanica quantistica avanzata). "
        "Per i quiz includi applicazioni e ragionamento critico."
        + _SELF_CHECK
    ),
    "Università": (
        "Adatta il linguaggio a livello universitario: terminologia specialistica, profondità teorica, rigore concettuale"
        " e collegamenti interdisciplinari. Per i quiz usa difficoltà medio-alta/alta con focus su analisi critica."
        + _SELF_CHECK
    ),
}


def get_school_grade_instruction(school_grade: Optional[str]) -> str:
    if not school_grade:
        return ""
    prompt = SCHOOL_GRADE_PROMPTS.get(school_grade)
    if not prompt:
        return ""
    return f"\n\nCONTESTO DIDATTICO - GRADO SCOLASTICO: {school_grade}\n{prompt}"

