"""
Teacher Agent Service - Agentic system for teacher support chat
Automatically detects teacher intent and activates specialized content generation
"""

import json
import re
import asyncio
from typing import Optional, Dict, Any, AsyncGenerator
import logging

from app.services.llm_service import llm_service
from app.schemas.content import (
    IntentResult,
    TeacherIntent,
    QuizData,
    ExerciseData,
)

logger = logging.getLogger(__name__)


# ============================================================================
# PLATFORM KNOWLEDGE BASE
# Injected into teacher chat so the assistant can guide teachers on features
# ============================================================================

PLATFORM_KNOWLEDGE_BASE = """
## CONOSCENZA DELLA PIATTAFORMA GOLINELLI AI PLAYGROUND

Sei esperto di tutte le funzionalità della piattaforma. Usale per guidare attivamente il docente.

### STRUTTURA DELLA PIATTAFORMA
La piattaforma è organizzata in **Classi** → **Sessioni** → **Contenuti**.
- **Classe**: gruppo di studenti (es. "3A Liceo Scientifico"). Ogni classe ha un codice di invito per gli studenti.
- **Sessione**: spazio di lavoro attivo all'interno di una classe, con chat di classe, chatbot, compiti e documenti.
- **Studenti**: si uniscono tramite codice sessione e scelgono un nickname. Non serve registrazione.

### FUNZIONALITÀ PER IL DOCENTE

**1. CHAT DI CLASSE**
- Chat in tempo reale tra docente e studenti della sessione
- Il docente può pubblicare messaggi, link e **notifiche** (quiz, compiti, documenti) direttamente in chat
- Le notifiche cliccabili aprono automaticamente il contenuto pubblicato nell'interfaccia dello studente

**2. TEACHERBOT (Chatbot AI personalizzati)**
- Il docente crea chatbot AI con personalità, tono e obiettivi didattici personalizzati
- Ogni teacherbot ha: nome, colore, prompt di sistema, modello AI scelto
- I teacherbot vengono pubblicati nella sessione e gli studenti possono chattare con loro
- Il docente può **creare report automatici** sulle conversazioni degli studenti con il teacherbot
- Profili studente standard: Tutor, Quiz, Intervista, Esame Orale, Dataset Generator, Math Coach

**3. COMPITI (Tasks)**
- Tipi disponibili: **Quiz** (scelta multipla), **Esercizio** (risposta aperta), **Lezione** (documento HTML), **Presentazione** (slides)
- I compiti vengono creati dall'assistente AI e poi pubblicati nella sessione
- Gli studenti vedono i compiti nella sezione "Compiti" e ricevono una notifica in chat
- Il docente può visualizzare le consegne degli studenti e inserire voti/feedback
- Per creare un quiz: chiedere all'assistente "CREA QUIZ: [argomento]"
- Per creare un esercizio: chiedere "CREA ESERCIZIO: [testo esercizio]"

**4. DOCUMENTI**
- Il docente può caricare documenti (PDF, immagini) nella sessione
- I documenti sono accessibili dagli studenti nella sezione "Documenti"
- L'assistente può generare lezioni HTML o presentazioni da pubblicare come documenti

**5. ML LAB (Machine Learning)**
- Modulo per classificazione con AI: immagini, testo, dati CSV
- Gli studenti possono sperimentare con modelli di classificazione direttamente nel browser
- Utile per introdurre concetti di machine learning in modo pratico

**6. GENERAZIONE IMMAGINI**
- I teacherbot possono generare immagini con DALL-E 3 o GPT Image 1
- Le immagini generate possono essere trascinate nella chat di classe
- Attivare la generazione immagini nel profilo del chatbot studente

**7. REPORT E ANALYTICS**
- Report automatici sulle conversazioni studente-teacherbot
- Statistiche di partecipazione per sessione
- Andamento dei compiti e delle consegne
- Per generare un report: chiedere "Voglio un report della sessione [nome]"

**8. LIMITE CREDITI**
- Ogni docente ha un budget mensile di utilizzo AI (default: 3€/mese)
- Ogni studente ha un budget di 1€/mese + eventuale bonus di classe (max 5€ totale)
- L'admin può modificare i limiti del docente; il docente può impostare il bonus studenti

### WORKFLOW CONSIGLIATI

**Creare una lezione interattiva:**
1. Crea una sessione per la classe
2. Crea un teacherbot come "guida" alla lezione con istruzioni specifiche sull'argomento
3. Genera una lezione HTML o presentazione con l'assistente
4. Pubblica il materiale nella chat di classe
5. Gli studenti interagiscono con il teacherbot e accedono ai documenti
6. A fine sessione, genera report sulle conversazioni

**Condurre una verifica:**
1. Chiedi all'assistente "CREA QUIZ: [argomento] con N domande"
2. Modifica il quiz se necessario
3. Pubblica nella chat di classe (notifica automatica agli studenti)
4. Visualizza le consegne e inserisci voti/feedback

**Progettare un'Unità Didattica (UDA):**
1. Descrivi l'UDA all'assistente (argomento, obiettivi, ore disponibili, classe)
2. L'assistente suggerirà struttura, attività, materiali
3. Genera quiz, esercizi e documenti per ciascuna fase
4. Crea teacherbot specifici per accompagnare ogni modulo
"""


# ============================================================================
# INTENT CLASSIFICATION
# ============================================================================

INTENT_CLASSIFIER_PROMPT = """Sei un classificatore di intenti per l'Assistente Personale del docente.

Il tuo compito è distinguere tra richieste di strumenti specifici e dialogo libero di supporto/brainstorming.

INTENTI DISPONIBILI:
1. quiz_generation - Il docente chiede ESPLICITAMENTE di creare un quiz, una verifica o domande a scelta multipla.
2. exercise_generation - Il docente chiede ESPLICITAMENTE di creare esercizi o attività pratiche.
3. dataset_generation - Il docente chiede di creare/generare un dataset, file CSV o tabella di dati sintetici.
4. report_generation - Il docente chiede dati, statistiche o report sull'andamento di sessioni o studenti.
5. web_search - Il docente chiede di cercare informazioni aggiornate online.
6. action_menu - Il docente chiede aiuto, opzioni o cosa può fare l'assistente.
7. analytics - (DEFAULT / CHAT LIBERA) Il docente vuole dialogare, fare brainstorming, progettare lezioni, discutere di pedagogia o chiedere consigli generali. Usa questo intento per ogni interazione che non sia una richiesta tecnica esplicita di generazione contenuti.

REGOLE DI CLASSIFICAZIONE:
- Se il messaggio è colloquiale, riflessivo o di progettazione ("Cosa ne pensi di...", "Aiutami a ideare...", "Come posso spiegare...") → usa analytics.
- Non forzare l'uso di quiz/esercizi se il docente sta solo esplorando un tema.
- Se il docente chiede di "progettare una lezione" senza chiedere i dati strutturati finali → usa analytics per il brainstorming.
- "dataset", "CSV", "tabella dati", "dati sintetici" → dataset_generation.
- In caso di dubbio o ambiguità → analytics.

FORMATO OUTPUT:
Rispondi SOLO con un JSON valido:
{
  "intent": "analytics",
  "confidence": 0.9,
  "topic": "estratto dell'argomento"
}"""


def classify_intent_by_keywords(message: str) -> IntentResult:
    """
    Simple keyword-based intent classification fallback.
    Works without any LLM API calls.
    """
    message_lower = message.lower()

    # Web search keywords
    web_keywords = [
        "cerca", "ricerca", "trova", "cerca online", "cerca sul web",
        "informazioni recenti", "ultime notizie", "aggiornamenti",
        "cerca in internet", "informazioni su", "dimmi di", "cosa sai di",
        "novità su", "news", "attualità"
    ]

    # Quiz keywords
    quiz_keywords = [
        "quiz", "verifica", "test", "domande", "quesiti",
        "crea un quiz", "genera un quiz", "prepara un quiz"
    ]

    # Exercise keywords
    exercise_keywords = [
        "esercizio", "esercizi", "problema", "problemi",
        "attività pratica", "crea esercizi", "genera esercizi"
    ]

    # Report/Analytics keywords
    report_keywords = [
        "report", "analisi", "statistiche", "andamento", "resoconto",
        "come stanno andando", "risultati", "sessioni attive"
    ]

    # Action menu keywords
    menu_keywords = [
        "menu", "opzioni", "cosa puoi fare", "aiutami", "comandi", "funzioni"
    ]

    # Dataset keywords
    dataset_keywords = [
        "dataset", "csv", "dati sintetici", "tabella dati", "genera dataset",
        "crea dataset", "file csv", "crea csv", "righe dati"
    ]

    # Document keywords
    document_keywords = [
        "pei", "ptof", "relazione", "verbale", "documento", "modulo"
    ]

    # Check for web search (highest priority for search-related queries)
    for keyword in web_keywords:
        if keyword in message_lower:
            # Extract topic (text after the keyword)
            topic = message
            for kw in web_keywords:
                if kw in message_lower:
                    idx = message_lower.find(kw)
                    topic = message[idx + len(kw):].strip()
                    break
            logger.info(f"Intent classified by keywords: web_search")
            return IntentResult(
                intent=TeacherIntent.WEB_SEARCH,
                confidence=0.85,
                extracted_params=topic or message
            )

    # Check for quiz
    for keyword in quiz_keywords:
        if keyword in message_lower:
            logger.info(f"Intent classified by keywords: quiz_generation")
            return IntentResult(
                intent=TeacherIntent.QUIZ_GENERATION,
                confidence=0.85,
                extracted_params=message
            )

    # Check for exercise
    for keyword in exercise_keywords:
        if keyword in message_lower:
            logger.info(f"Intent classified by keywords: exercise_generation")
            return IntentResult(
                intent=TeacherIntent.EXERCISE_GENERATION,
                confidence=0.85,
                extracted_params=message
            )

    # Check for report
    for keyword in report_keywords:
        if keyword in message_lower:
            logger.info(f"Intent classified by keywords: report_generation")
            return IntentResult(
                intent=TeacherIntent.REPORT_GENERATION,
                confidence=0.85,
                extracted_params=message
            )

    # Check for menu
    for keyword in menu_keywords:
        if keyword in message_lower:
            logger.info(f"Intent classified by keywords: action_menu")
            return IntentResult(
                intent=TeacherIntent.ACTION_MENU,
                confidence=0.85,
                extracted_params=message
            )

    # Check for dataset
    for keyword in dataset_keywords:
        if keyword in message_lower:
            logger.info(f"Intent classified by keywords: dataset_generation")
            return IntentResult(
                intent=TeacherIntent.DATASET_GENERATION,
                confidence=0.85,
                extracted_params=message
            )

    # Check for document
    for keyword in document_keywords:
        if keyword in message_lower:
            logger.info(f"Intent classified by keywords: document_help")
            return IntentResult(
                intent=TeacherIntent.DOCUMENT_HELP,
                confidence=0.75,
                extracted_params=message
            )

    # Default to analytics
    logger.info(f"Intent classified by keywords: analytics (default)")
    return IntentResult(
        intent=TeacherIntent.ANALYTICS,
        confidence=0.6,
        extracted_params=None
    )


async def classify_intent(message: str, history: list[dict]) -> IntentResult:
    """
    Classify teacher's intent using fast lightweight model.
    Returns intent category, confidence, and extracted parameters.
    Falls back to keyword-based classification if LLM is unavailable.
    """
    try:
        # Check for forced mode prefixes — these are injected by the frontend
        # and must ALWAYS route to the correct intent without LLM classification.
        mode_prefixes = {
            ("RICERCA WEB:", "🌐"): TeacherIntent.WEB_SEARCH,
            ("CREA QUIZ:", "GENERA QUIZ:", "❓"): TeacherIntent.QUIZ_GENERATION,
            ("CREA ESERCIZIO:", "GENERA ESERCIZIO:", "💪"): TeacherIntent.EXERCISE_GENERATION,
            ("GENERA DATASET:", "📊"): TeacherIntent.DATASET_GENERATION,
            ("GENERA REPORT:", "📈"): TeacherIntent.REPORT_GENERATION,
            ("EDITOR_AI:", "✍️"): TeacherIntent.TEXT_EDITOR,
        }

        for prefixes, intent in mode_prefixes.items():
            if any(prefix in message for prefix in prefixes):
                logger.info(f"Intent forced by prefix: {intent.value}")
                # Remove all prefix variants
                clean_message = message
                for prefix in prefixes:
                    clean_message = clean_message.replace(prefix, "")
                return IntentResult(
                    intent=intent,
                    confidence=1.0,
                    topic=clean_message.strip()
                )

        # Try LLM-based classification if OpenAI is available
        from app.core.config import settings
        if not settings.OPENAI_API_KEY:
            logger.info("OpenAI not configured, using keyword-based classification")
            return classify_intent_by_keywords(message)

        # Build context from recent history (last 3 messages)
        context_messages = []
        for msg in history[-3:]:
            role = msg.get("role", "user")
            content = msg.get("content", "")[:100]  # Truncate long messages
            context_messages.append(f"{role}: {content}")

        context = "\n".join(context_messages) if context_messages else "Nessun contesto precedente"

        # Build classification request
        classification_prompt = f"""Contesto conversazione recente:
{context}

Messaggio corrente da classificare:
{message}

Classifica l'intento e rispondi con JSON."""

        # Use fast, cheap model for classification
        response = await llm_service.generate(
            messages=[{"role": "user", "content": classification_prompt}],
            system_prompt=INTENT_CLASSIFIER_PROMPT,
            provider="openai",
            model="gpt-5-nano",  # Fast and cheap
            temperature=0.1,  # Low temperature for consistent classification
            max_tokens=200,
        )

        # Parse JSON response
        content = response.content.strip()

        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]

        result_dict = json.loads(content)

        # Validate and create IntentResult
        try:
            intent = TeacherIntent(result_dict["intent"])
        except ValueError:
            # If model invents an intent, fallback to analytics
            intent = TeacherIntent.ANALYTICS

        confidence = float(result_dict.get("confidence", 0.8))
        topic = result_dict.get("topic")

        logger.info(f"Intent classified: {intent.value} (confidence: {confidence})")

        return IntentResult(
            intent=intent,
            confidence=confidence,
            extracted_params=topic
        )

    except Exception as e:
        logger.warning(f"LLM intent classification failed: {e}, using keyword-based fallback")
        # Fallback to keyword-based classification on error
        return classify_intent_by_keywords(message)


# ============================================================================
# TOOL DEFINITIONS FOR OPENAI FUNCTION CALLING
# ============================================================================

QUIZ_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_quiz",
            "description": "Genera un quiz strutturato con domande a risposta multipla. Usa questa funzione per creare quiz didattici con domande, opzioni di risposta, e spiegazioni.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Titolo del quiz (es: 'Quiz sulle Equazioni di Secondo Grado')"
                    },
                    "description": {
                        "type": "string",
                        "description": "Descrizione breve del quiz e cosa verifica"
                    },
                    "questions": {
                        "type": "array",
                        "description": "Lista di domande del quiz",
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": {
                                    "type": "string",
                                    "description": "Il testo della domanda"
                                },
                                "options": {
                                    "type": "array",
                                    "description": "Lista di 4 opzioni di risposta",
                                    "items": {"type": "string"}
                                },
                                "correctIndex": {
                                    "type": "integer",
                                    "description": "Indice (0-based) della risposta corretta nell'array options"
                                },
                                "explanation": {
                                    "type": "string",
                                    "description": "Spiegazione della risposta corretta"
                                },
                                "points": {
                                    "type": "integer",
                                    "description": "Punti assegnati a questa domanda (default: 1)"
                                }
                            },
                            "required": ["question", "options", "correctIndex"]
                        }
                    },
                    "time_limit_minutes": {
                        "type": "integer",
                        "description": "Tempo limite in minuti (opzionale)"
                    }
                },
                "required": ["title", "description", "questions"]
            }
        }
    }
]

EXERCISE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_exercise",
            "description": "Genera esercizi pratici con istruzioni, esempi e soluzioni. Usa questa funzione per creare attività pratiche per gli studenti.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Titolo dell'esercizio"
                    },
                    "description": {
                        "type": "string",
                        "description": "Descrizione dell'esercizio"
                    },
                    "instructions": {
                        "type": "string",
                        "description": "Istruzioni dettagliate per svolgere l'esercizio"
                    },
                    "examples": {
                        "type": "array",
                        "description": "Esempi svolti per guidare lo studente",
                        "items": {"type": "string"}
                    },
                    "solution": {
                        "type": "string",
                        "description": "Soluzione completa dell'esercizio (nascosta agli studenti)"
                    },
                    "difficulty": {
                        "type": "string",
                        "enum": ["easy", "medium", "hard"],
                        "description": "Livello di difficoltà"
                    },
                    "hint": {
                        "type": "string",
                        "description": "Suggerimento opzionale per aiutare gli studenti"
                    }
                },
                "required": ["title", "description", "instructions"]
            }
        }
    }
]


# ============================================================================
# SYSTEM PROMPTS FOR SPECIALIZED AGENTS
# ============================================================================

QUIZ_AGENT_PROMPT = """Sei un esperto creatore di quiz didattici per docenti.

IL TUO COMPITO:
Crea un quiz ben strutturato sull'argomento richiesto dal docente.

REQUISITI DEL QUIZ:
- Titolo chiaro e descrittivo
- 5-10 domande varie e stimolanti
- Ogni domanda deve avere:
  * Testo chiaro e preciso
  * 4 opzioni di risposta plausibili
  * Una sola risposta corretta (correctIndex: 0-3)
  * Spiegazione della risposta corretta
  * Punti assegnati (default: 1)
- Difficoltà progressiva (inizia facile, poi aumenta)
- Copre diversi aspetti dell'argomento

FORMATO OUTPUT OBBLIGATORIO:
Devi SEMPRE rispondere in questo modo:

1. Prima, breve introduzione (1-2 frasi)
2. POI, il blocco JSON quiz (OBBLIGATORIO!)

ESEMPIO RISPOSTA:

Ho creato un quiz di 8 domande sulle equazioni di secondo grado, con difficoltà progressiva.

```quiz
{
  "title": "Quiz: Equazioni di Secondo Grado",
  "description": "Verifica la tua comprensione delle equazioni di secondo grado e della formula risolutiva",
  "total_points": 8,
  "time_limit_minutes": 20,
  "questions": [
    {
      "question": "Qual è la forma standard di un'equazione di secondo grado?",
      "options": [
        "ax + b = 0",
        "ax² + bx + c = 0",
        "ax³ + bx² + cx + d = 0",
        "a/x + b = 0"
      ],
      "correctIndex": 1,
      "explanation": "La forma standard è ax² + bx + c = 0, dove a ≠ 0. Il termine ax² è quello di grado più alto.",
      "points": 1
    },
    {
      "question": "Cosa rappresenta il discriminante (Δ = b² - 4ac)?",
      "options": [
        "Il numero di soluzioni reali dell'equazione",
        "La somma delle radici",
        "Il prodotto delle radici",
        "Il coefficiente del termine di grado massimo"
      ],
      "correctIndex": 0,
      "explanation": "Il discriminante determina il numero di soluzioni reali: Δ > 0 → 2 soluzioni, Δ = 0 → 1 soluzione, Δ < 0 → 0 soluzioni reali.",
      "points": 1
    }
  ]
}
```

REGOLE RIGIDE:
- Il blocco ```quiz è OBBLIGATORIO
- Genera ALMENO 5 domande
- Il JSON deve essere valido
- correctIndex deve essere 0, 1, 2 o 3
- Ogni domanda deve avere esattamente 4 options
- NON omettere MAI il blocco JSON

STILE:
- Professionale ma amichevole
- Domande chiare e prive di ambiguità
- Spiegazioni educative, non solo "è giusto/sbagliato"
- Considera il livello scolastico appropriato"""

EXERCISE_AGENT_PROMPT = """Sei un creatore esperto di esercizi didattici per docenti.

IL TUO COMPITO:
Crea esercizi pratici efficaci sull'argomento richiesto.

FORMATO OUTPUT OBBLIGATORIO:
Devi SEMPRE rispondere così:

1. Breve introduzione (1-2 frasi)
2. Il blocco JSON exercise_data (OBBLIGATORIO!)

```exercise_data
{
  "title": "Titolo Esercizio",
  "description": "Descrizione breve dell'esercizio",
  "instructions": "Istruzioni dettagliate passo-passo in markdown...",
  "examples": ["Esempio 1 svolto", "Esempio 2 svolto"],
  "solution": "Soluzione o criteri di valutazione",
  "difficulty": "medium",
  "hint": "Suggerimento opzionale"
}
```

REGOLE RIGIDE:
- Il blocco ```exercise_data è OBBLIGATORIO
- difficulty deve essere: "easy", "medium", o "hard"
- instructions deve contenere passi chiari
- examples è array di stringhe (almeno 1 esempio)
- NON omettere MAI il blocco JSON

STILE:
- Istruzioni passo-passo
- Esempi illuminanti
- Progressione graduale di difficoltà
- Feedback costruttivo nelle soluzioni"""


# ============================================================================
# TOOL EXECUTOR FUNCTIONS
# ============================================================================

def execute_create_quiz(args: dict) -> dict:
    """
    Execute quiz creation and validate the data.
    Returns validated quiz JSON.
    """
    try:
        # Validate using Pydantic
        quiz_data = QuizData(**args)

        # Convert to dict for JSON serialization
        return quiz_data.model_dump()

    except Exception as e:
        logger.error(f"Quiz validation error: {e}")
        raise ValueError(f"Errore nella creazione del quiz: {e}")


def execute_create_exercise(args: dict) -> dict:
    """
    Execute exercise creation and validate the data.
    Returns validated exercise JSON.
    """
    try:
        # Validate using Pydantic
        exercise_data = ExerciseData(**args)

        return exercise_data.model_dump()

    except Exception as e:
        logger.error(f"Exercise validation error: {e}")
        raise ValueError(f"Errore nella creazione dell'esercizio: {e}")


# ============================================================================
# CONTENT GENERATORS WITH TOOL CALLING
# ============================================================================

async def generate_quiz_with_tools(
    messages: list[dict],
    provider: str,
    model: str,
    max_iterations: int = 3
) -> str:
    """
    Generate quiz using OpenAI function calling.
    Similar pattern to math_agent but for quiz creation.
    """
    from openai import AsyncOpenAI
    from app.core.config import settings

    if provider != "openai" or not settings.OPENAI_API_KEY:
        # Fallback: generate without tools using direct LLM call
        return await generate_quiz_without_tools(messages, provider, model)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    # Prepare messages with system prompt
    full_messages = [
        {"role": "system", "content": QUIZ_AGENT_PROMPT}
    ] + messages

    quiz_json = None

    for iteration in range(max_iterations):
        try:
            # Call model with tools
            # GPT-5 and o-series models don't support custom temperature
            if model.startswith("gpt-5") or model.startswith("o1") or model.startswith("o3"):
                response = await client.chat.completions.create(
                    model=model,
                    messages=full_messages,
                    tools=QUIZ_TOOLS,
                    tool_choice="auto",
                )
            else:
                response = await client.chat.completions.create(
                    model=model,
                    messages=full_messages,
                    tools=QUIZ_TOOLS,
                    tool_choice="auto",
                    temperature=0.7,
                )

            message = response.choices[0].message

            # Check if we need to call tools
            if message.tool_calls:
                # Add assistant message with tool calls
                full_messages.append({
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in message.tool_calls
                    ]
                })

                # Execute each tool call
                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    try:
                        args = json.loads(tool_call.function.arguments)
                    except json.JSONDecodeError:
                        args = {}

                    # Execute the appropriate tool
                    if tool_name == "create_quiz":
                        quiz_json = execute_create_quiz(args)
                        tool_output = f"Quiz creato con successo: {quiz_json['title']} con {len(quiz_json['questions'])} domande"
                    else:
                        tool_output = f"Tool sconosciuto: {tool_name}"

                    # Add tool result to messages
                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_output
                    })
            else:
                # No more tool calls, return final response
                response_text = message.content or ""

                # Ensure response has quiz block
                if quiz_json and "```quiz" not in response_text:
                    response_text += f"\n\n```quiz\n{json.dumps(quiz_json, indent=2, ensure_ascii=False)}\n```"

                return response_text

        except Exception as e:
            logger.error(f"Quiz generation error at iteration {iteration}: {e}")
            if iteration == max_iterations - 1:
                raise

    # Max iterations reached, return with quiz if we have one
    if quiz_json:
        return f"Quiz generato:\n\n```quiz\n{json.dumps(quiz_json, indent=2, ensure_ascii=False)}\n```"

    return "Mi dispiace, non sono riuscito a completare la generazione del quiz."


async def generate_exercise_with_tools(
    messages: list[dict],
    provider: str,
    model: str,
    max_iterations: int = 3
) -> str:
    """Generate exercise using OpenAI function calling."""
    from openai import AsyncOpenAI
    from app.core.config import settings

    if provider != "openai" or not settings.OPENAI_API_KEY:
        return await generate_exercise_without_tools(messages, provider, model)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    full_messages = [
        {"role": "system", "content": EXERCISE_AGENT_PROMPT}
    ] + messages

    exercise_json = None

    for iteration in range(max_iterations):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=full_messages,
                tools=EXERCISE_TOOLS,
                tool_choice="auto",
                temperature=0.7,
            )

            message = response.choices[0].message

            if message.tool_calls:
                full_messages.append({
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in message.tool_calls
                    ]
                })

                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    try:
                        args = json.loads(tool_call.function.arguments)
                    except json.JSONDecodeError:
                        args = {}

                    if tool_name == "create_exercise":
                        exercise_json = execute_create_exercise(args)
                        tool_output = f"Esercizio creato: {exercise_json['title']}"
                    else:
                        tool_output = f"Tool sconosciuto: {tool_name}"

                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_output
                    })
            else:
                response_text = message.content or ""

                if exercise_json and "```exercise_data" not in response_text:
                    response_text += f"\n\n```exercise_data\n{json.dumps(exercise_json, indent=2, ensure_ascii=False)}\n```"

                return response_text

        except Exception as e:
            logger.error(f"Exercise generation error at iteration {iteration}: {e}")
            if iteration == max_iterations - 1:
                raise

    if exercise_json:
        return f"Esercizio generato:\n\n```exercise_data\n{json.dumps(exercise_json, indent=2, ensure_ascii=False)}\n```"

    return "Mi dispiace, non sono riuscito a completare la generazione dell'esercizio."


# ============================================================================
# FALLBACK GENERATORS (WITHOUT TOOLS)
# ============================================================================

async def generate_quiz_without_tools(messages: list[dict], provider: str, model: str) -> str:
    """Fallback quiz generation without function calling."""
    response = await llm_service.generate(
        messages=messages,
        system_prompt=QUIZ_AGENT_PROMPT,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=2048,
    )
    return response.content


async def generate_exercise_without_tools(messages: list[dict], provider: str, model: str) -> str:
    """Fallback exercise generation without function calling."""
    response = await llm_service.generate(
        messages=messages,
        system_prompt=EXERCISE_AGENT_PROMPT,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=2048,
    )
    return response.content


# ============================================================================
# DATASET GENERATOR
# ============================================================================

DATASET_AGENT_PROMPT = """Sei un esperto generatore di dataset CSV sintetici per docenti.

IL TUO COMPITO:
Crea un dataset CSV realistico e coerente basandoti sulla descrizione del docente.

FORMATO OUTPUT OBBLIGATORIO:
1. Breve introduzione (1-2 frasi)
2. Il blocco ```csv (OBBLIGATORIO)
3. Breve nota esplicativa (max 5 righe)

ESEMPIO RISPOSTA:

Ho generato un dataset con 50 studenti e i loro voti in 3 materie, con correlazione positiva matematica-scienze.

```csv
nome,matematica,italiano,scienze,media
Alice Rossi,8.5,7.0,9.0,8.17
Marco Bianchi,6.0,8.5,6.5,7.0
...
```

Nota: la correlazione tra matematica e scienze è stata impostata con r≈0.7.

REGOLE RIGIDE:
- Il blocco ```csv è OBBLIGATORIO
- La prima riga DEVE contenere le intestazioni
- Usa la virgola come separatore (formato CSV standard)
- Dati realistici e coerenti con il contesto
- Se l'utente specifica correlazioni, rispettarle
- Non superare 100 righe a meno che non esplicitamente richiesto
- NON omettere mai il blocco csv"""


async def generate_dataset(messages: list[dict], provider: str, model: str) -> str:
    """Generate a CSV dataset based on teacher's description."""
    response = await llm_service.generate(
        messages=messages,
        system_prompt=DATASET_AGENT_PROMPT,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=4096,
    )
    return response.content


# ============================================================================
# WEB SEARCH GENERATOR
# ============================================================================

async def generate_with_web_search(
    messages: list[dict],
    context: str,
    provider: str,
    model: str
) -> str:
    """
    Generate response with web search capability.
    Searches the web for fresh information and uses it to answer the teacher's question.
    Works with all supported LLM providers (OpenAI, Anthropic, Ollama).
    """
    from app.services.web_search_service import web_search_service

    # Extract the last user message as search query
    last_message = messages[-1]["content"] if messages else ""

    logger.info(f"[WebSearch] Provider: {provider}, Model: {model}")
    logger.info(f"[WebSearch] Performing web search for: {last_message[:100]}...")

    # Perform web search
    results = await web_search_service.search(
        query=last_message,
        num_results=5,
        fetch_content=True
    )

    if not results:
        # Fallback to analytics if search fails
        logger.warning("Web search returned no results, falling back to analytics")
        return "⚠️ **Ricerca web non riuscita**\n\nNon sono riuscito a trovare risultati per la tua query. Prova a riformulare la domanda o verifica la connessione internet."

    # Format search results for LLM context
    search_context_parts = []
    sources_list = []

    for i, result in enumerate(results, 1):
        source_text = f"**Fonte {i}: {result.title}**\nURL: {result.url}\n"
        if result.snippet:
            source_text += f"Anteprima: {result.snippet}\n"
        if result.content:
            # Truncate content to avoid token limits
            content_preview = result.content[:2000]
            source_text += f"Contenuto:\n{content_preview}\n"

        search_context_parts.append(source_text)
        sources_list.append(f"- [{result.title}]({result.url})")

    search_context = "\n---\n".join(search_context_parts)

    # Build numbered source reference
    source_refs = "\n".join([f"[{i}] {r.title} - {r.url}" for i, r in enumerate(results, 1)])

    web_search_prompt = f"""Genera un report di ricerca professionale basato ESCLUSIVAMENTE sulle fonti fornite.

FONTI DISPONIBILI:
{search_context}

---

STRUTTURA DEL REPORT (segui questo formato esatto):

**SOMMARIO**

Scrivi 2-3 frasi che sintetizzano i risultati principali. Cita le fonti con [1], [2], etc.

---

**RISULTATI PRINCIPALI**

| Aspetto | Dettaglio | Rif. |
|---------|-----------|------|
| [Tema 1] | [Informazione chiave estratta] | [1] |
| [Tema 2] | [Informazione chiave estratta] | [2] |
| [Tema 3] | [Informazione chiave estratta] | [1,3] |

---

**APPROFONDIMENTO**

**[Sottotitolo 1]**
Paragrafo breve con dettagli. Fonte: [1]

**[Sottotitolo 2]**
Paragrafo breve con dettagli. Fonte: [2]

---

**NOTE**
- Eventuali limitazioni o informazioni non trovate
- Aspetti che richiedono ulteriore verifica

---

REGOLE:
- Usa SOLO informazioni presenti nelle fonti
- Cita sempre con [numero] corrispondente alla fonte
- Nessuna emoji
- Formattazione pulita e professionale
- Se un'informazione non è disponibile, indicalo esplicitamente"""

    response = await llm_service.generate(
        messages=messages,
        system_prompt=web_search_prompt,
        provider=provider,
        model=model,
        temperature=0.3,
        max_tokens=4096,
    )

    response_text = response.content

    # Append source bibliography
    response_text += f"\n\n---\n\n**FONTI**\n\n{source_refs}"

    return response_text


async def generate_with_web_search_streaming(
    messages: list[dict],
    context: str,
    provider: str,
    model: str
):
    """
    Generator that yields progress updates during web search.
    Used for streaming real-time feedback to the frontend.
    """
    from app.services.web_search_service import web_search_service
    from app.services.llm_service import llm_service

    last_message = messages[-1]["content"] if messages else ""

    # Step 1: Query Refinement (Chain of Thought aka "CoT")
    yield {"type": "status", "message": "🤔 Analisi della richiesta..."}
    
    refinement_prompt = f"""Sei un esperto di ricerca web. Analizza la richiesta dell'utente e genera la MIGLIORE query di ricerca possibile per trovare informazioni pertinenti e aggiornate.
    
    Richiesta originale: "{last_message}"
    
    Regole:
    - Rimuovi convenevoli o parole inutili
    - Usa termini specifici e tecnici se necessario
    - Se la richiesta è generica, rendila più specifica per ottenere risultati di qualità
    - Rispondi SOLO con il testo della query, senza virgolette o altro.
    """

    try:
        # Use a fast internal call to refine the query
        refinement = await llm_service.generate(
            messages=[{"role": "user", "content": refinement_prompt}],
            system_prompt="Sei un motore di ottimizzazione query.",
            provider="openai", 
            model="gpt-4o-mini",  # Use correct model name
            temperature=0.3,
            max_tokens=60
        )
        refined_query = refinement.content.strip().replace('"', '') if refinement.content else ""
        
        # Fallback if query is empty or too short
        if not refined_query or len(refined_query) < 3:
            refined_query = last_message.replace("RICERCA WEB:", "").replace("ricerca web:", "").strip()
            yield {"type": "status", "message": f"🎯 Query: {refined_query}"}
        else:
            yield {"type": "status", "message": f"🎯 Query ottimizzata: {refined_query}"}
    except Exception as e:
        logger.error(f"Query refinement failed: {e}")
        refined_query = last_message.replace("RICERCA WEB:", "").replace("ricerca web:", "").strip()
        yield {"type": "status", "message": f"⚠️ Ottimizzazione fallita, uso query originale..."}

    # Step 2: Perform search
    yield {"type": "status", "message": "🌐 Ricerca sul web in corso..."}

    results = await web_search_service.search(
        query=refined_query,
        num_results=5,
        fetch_content=False  # First get basic results
    )

    if not results:
        yield {"type": "error", "message": "❌ Nessun risultato trovato"}
        yield {"type": "done", "content": "⚠️ **Ricerca web non riuscita**\n\nNon sono riuscito a trovare risultati per la tua ricerca."}
        return

    yield {"type": "status", "message": f"✅ Trovati {len(results)} risultati pertinenti"}

    # Step 3: Fetch content from each result
    search_context_parts = []
    
    for i, result in enumerate(results, 1):
        yield {"type": "source", "index": i, "title": result.title, "url": result.url, "status": "fetching"}

        # Fetch full content
        try:
            content = await web_search_service._fetch_page_content(result.url)
            result.content = content
            yield {"type": "source", "index": i, "title": result.title, "url": result.url, "status": "done", "content_length": len(content) if content else 0}
        except Exception as e:
            yield {"type": "source", "index": i, "title": result.title, "url": result.url, "status": "error", "error": str(e)}

        source_text = f"**Fonte {i}: {result.title}**\nURL: {result.url}\n"
        if result.snippet:
            source_text += f"Anteprima: {result.snippet}\n"
        if result.content:
            content_preview = result.content[:3000] # Increased context window
            source_text += f"Contenuto:\n{content_preview}\n"

        search_context_parts.append(source_text)

    search_context = "\n---\n".join(search_context_parts)

    # Step 4: Generate response
    yield {"type": "status", "message": f"🤖 Sintesi e scrittura risposta..."}

    # Build source links for easy reference
    source_links = "\n".join([f"- **[{i}]** [{r.title}]({r.url})" for i, r in enumerate(results, 1)])

    web_search_prompt = f"""Sei un assistente ricercatore avanzato. Genera un report DETTAGLIATO e AGENTICO basato ESCLUSIVAMENTE sulle fonti web fornite.

    DOMANDA UTENTE: "{last_message}"
    QUERY EFFETTIVA: "{refined_query}"

    ---
    📰 FONTI ANALIZZATE:

    {search_context}

    ---

    📋 **STRUTTURA RISPOSTA** (Markdown):

    ## 🎯 Sintesi Diretta
    [Rispondi direttamente alla domanda dell'utente sintetizzando le informazioni trovate. Usa citazioni [1], [2]...]

    ## 🔍 Analisi Approfondita
    [Analizza i vari aspetti del problema/argomento emersi dalla ricerca. Usa sottotitoli se necessario.]
    
    - **Punto Chiave 1**: dettaglio... [1]
    - **Punto Chiave 2**: dettaglio... [2]

    ## 📊 Dati e Fatti Rilevanti
    | Dato/Fatto | Fonte |
    |------------|-------|
    | [Esempio] | [1] |

    ## 💡 Conclusioni
    [Conclusioni o suggerimenti pratici basati sulla ricerca]

    ## ⚠️ Note
    [Eventuali contraddizioni o informazioni mancanti]

    ---
    
    REGOLE:
    1. Cita SEMPRE le fonti usando [n].
    2. Sii esaustivo ma ben strutturato.
    3. Se le fonti non rispondono alla domanda, dillo chiaramente.
    """

    response = await llm_service.generate(
        messages=messages,
        system_prompt=web_search_prompt,
        provider=provider,
        model=model,
        temperature=0.4,
        max_tokens=4096,
    )

    response_text = response.content

    # Always append verified source list at the end
    response_text += f"\n\n---\n### 📚 Fonti Consultate\n{source_links}"

    yield {"type": "done", "content": response_text}


# ============================================================================
# MAIN ORCHESTRATOR
# ============================================================================

async def run_teacher_agent(
    messages: list[dict],
    context: str,
    structured_context: Optional[dict] = None,
    provider: str = "openai",
    model: str = "gpt-5-mini",
    actor_type: str = "TEACHER",
    profile_key: str = "teacher_support"
) -> str:
    """
    Main teacher agent orchestrator.
    Detects intent and routes to appropriate specialized agent.

    Args:
        messages: Conversation history
        context: Database context (for analytics mode)
        structured_context: Raw database data (for widgets)
        provider: LLM provider
        model: Model to use
        actor_type: "TEACHER" or "STUDENT"
        profile_key: The specific chatbot profile key

    Returns:
        Generated response string
    """
    try:
        # 0. Handle specialized student profiles first
        if actor_type == "STUDENT" and profile_key == "math_coach":
            from app.services.math_agent import run_math_agent
            return await run_math_agent(
                messages=messages,
                provider=provider or "openai",
                model=model or "gpt-4o-mini",
                max_iterations=5,
            )

        # Extract last user message for intent classification
        last_message = messages[-1]["content"] if messages else ""
        history = messages[:-1] if len(messages) > 1 else []

        # Classify intent
        logger.info(f"Classifying {actor_type} intent...")
        intent_result = await classify_intent(last_message, history)

        logger.info(f"Intent: {intent_result.intent.value}, Confidence: {intent_result.confidence}")

        # If confidence is low, default to profile-specific behavior
        if intent_result.confidence < 0.6:
            logger.info("Low confidence, routing to default behavior")
            intent_result.intent = TeacherIntent.ANALYTICS # Analytics is the generic fallback

        # Route based on intent
        if intent_result.intent == TeacherIntent.QUIZ_GENERATION:
            logger.info("Routing to quiz generator")
            return await generate_quiz_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.EXERCISE_GENERATION:
            logger.info("Routing to exercise generator")
            return await generate_exercise_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.DATASET_GENERATION:
            logger.info("Routing to dataset generator")
            return await generate_dataset(messages, provider, model)

        elif intent_result.intent == TeacherIntent.REPORT_GENERATION:
            if actor_type == "STUDENT":
                # Students don't get report widgets, fallback to generic
                return await generate_generic_response(messages, provider, model, profile_key)
            logger.info("Routing to report generator (widgets)")
            return await generate_report_widgets(
                last_message, structured_context,
                full_context=context, messages=messages,
                provider=provider, model=model,
            )

        elif intent_result.intent == TeacherIntent.ACTION_MENU:
            logger.info("Routing to action menu generator")
            return await generate_action_menu_widget(actor_type)

        elif intent_result.intent == TeacherIntent.WEB_SEARCH:
            # Web search removed — fall through to generic/analytics response
            logger.info("WEB_SEARCH intent: web search disabled, routing to fallback")
            if actor_type == "STUDENT":
                return await generate_generic_response(messages, provider, model, profile_key)
            return await generate_with_analytics(messages, context, provider, model)

        elif intent_result.intent == TeacherIntent.TEXT_EDITOR:
            logger.info("Routing to text editor generator")
            return await generate_text_editor_response(messages, provider, model)

        elif intent_result.intent == TeacherIntent.DOCUMENT_HELP:
            # For now, use analytics mode with document-focused prompt
            logger.info("Routing to document help (analytics mode)")
            if actor_type == "STUDENT":
                return await generate_generic_response(messages, provider, model, profile_key)
            return await generate_with_analytics(messages, context, provider, model)

        else:  # ANALYTICS or default
            if actor_type == "STUDENT":
                return await generate_generic_response(messages, provider, model, profile_key)
            logger.info("Routing to analytics mode")
            return await generate_with_analytics(messages, context, provider, model)

    except Exception as e:
        logger.error(f"Agent error: {e}")
        # Fallback
        if actor_type == "STUDENT":
            return await generate_generic_response(messages, provider, model, profile_key)
        return await generate_with_analytics(messages, context, provider, model)


async def generate_generic_response(
    messages: list[dict],
    provider: str,
    model: str,
    profile_key: str
) -> str:
    """
    Generate a generic response based on the student's profile.
    """
    from app.services.chatbot_profiles import get_profile
    profile = get_profile(profile_key)
    
    response = await llm_service.generate(
        messages=messages,
        system_prompt=profile["system_prompt"],
        provider=provider,
        model=model,
        temperature=profile.get("temperature", 0.7),
        max_tokens=2048,
    )
    return response.content


async def generate_generic_response_stream(
    messages: list[dict],
    provider: str,
    model: str,
    profile_key: str,
    custom_system_prompt: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streaming version of generate_generic_response. Yields text chunks."""
    from app.services.chatbot_profiles import get_profile
    profile = get_profile(profile_key)

    system_prompt = custom_system_prompt if custom_system_prompt else profile["system_prompt"]

    async for chunk in llm_service.generate_stream(
        messages=messages,
        system_prompt=system_prompt,
        provider=provider,
        model=model,
        temperature=profile.get("temperature", 0.7),
        max_tokens=2048,
    ):
        yield chunk


async def generate_report_widgets(
    message: str,
    structured_context: Optional[dict],
    full_context: str = "",
    messages: Optional[list] = None,
    provider: str = "openai",
    model: str = "gpt-4o-mini",
) -> str:
    """
    Generate specialized markdown blocks for session/student selection widgets.
    If a session or students have already been selected (detected by UUID or
    explicit follow-up pattern), generate the actual LLM report directly.
    """
    import re

    if not structured_context:
        return "Non ho dati sufficienti per mostrarti i selettori. Assicurati di avere classi e sessioni attive."

    # ---------------------------------------------------------------
    # Detect if a session has already been selected (UUID in parens)
    # Frontend sends: "Generami un report per la sessione: Title (UUID)"
    # ---------------------------------------------------------------
    uuid_match = re.search(r"\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)", message, re.IGNORECASE)
    if uuid_match:
        session_id = uuid_match.group(1)
        # Find session in structured_context
        sessions = structured_context.get("active_sessions", [])
        session_info = next((s for s in sessions if s.get("id") == session_id), None)
        session_label = session_info["title"] if session_info else session_id

        report_system = f"""Sei un assistente specializzato nell'analisi delle sessioni didattiche.
Il docente ha richiesto un report dettagliato per la sessione: **{session_label}**.

Hai accesso ai seguenti dati reali della piattaforma:
{full_context}

Genera un report professionale e dettagliato per questa specifica sessione con le sezioni:
## 📊 Report: {session_label}
### Panoramica
### Partecipazione Studenti
### Compiti e Consegne
### Andamento della Chat
### Osservazioni e Suggerimenti

Usa tabelle markdown dove utile. Sii preciso, basati esclusivamente sui dati forniti."""

        report_messages = [{"role": "user", "content": f"Genera il report completo per la sessione '{session_label}' (ID: {session_id})."}]
        response = await llm_service.generate(
            messages=report_messages,
            system_prompt=report_system,
            provider=provider,
            model=model,
            temperature=0.4,
            max_tokens=2048,
        )
        return response.content

    # ---------------------------------------------------------------
    # Detect student follow-up: "Generami un report per questi studenti: names"
    # ---------------------------------------------------------------
    if "questi studenti:" in message.lower():
        student_section = message.lower().split("questi studenti:")[-1].strip()
        students_all = structured_context.get("students", [])

        report_system = f"""Sei un assistente specializzato nell'analisi delle performance degli studenti.
Il docente ha richiesto un report per specifici studenti: {student_section}

Hai accesso ai seguenti dati reali della piattaforma:
{full_context}

Genera un report strutturato per ciascuno degli studenti richiesti con:
## 👥 Report Studenti
Per ogni studente includi: sessione di appartenenza, partecipazione alla chat, consegne effettuate, voti ottenuti, osservazioni.

Usa tabelle markdown dove utile. Sii preciso, basati esclusivamente sui dati forniti."""

        report_messages = [{"role": "user", "content": f"Genera il report per questi studenti: {student_section}"}]
        response = await llm_service.generate(
            messages=report_messages,
            system_prompt=report_system,
            provider=provider,
            model=model,
            temperature=0.4,
            max_tokens=2048,
        )
        return response.content

    # ---------------------------------------------------------------
    # No selection yet — show the widget for the user to pick
    # ---------------------------------------------------------------
    message_lower = message.lower()
    is_student_report = any(kw in message_lower for kw in ["studente", "studenti", "ragazz"])

    response = "Certamente! Per procedere con il report, seleziona gli elementi di tuo interesse:\n\n"

    if is_student_report:
        students = structured_context.get("students", [])
        if not students:
            return "Non ho trovato studenti connessi in nessuna sessione al momento."
        response += "### Selezione Studenti\n"
        response += "Seleziona uno o più studenti per generare un report mirato.\n\n"
        response += "```student_selector\n"
        response += json.dumps(students, indent=2, ensure_ascii=False)
        response += "\n```"
    else:
        sessions = structured_context.get("active_sessions", [])
        if not sessions:
            return "Al momento non ci sono sessioni attive da analizzare."
        response += "### Selezione Sessione\n"
        response += "Seleziona la sessione per la quale vuoi il report dettagliato.\n\n"
        response += "```session_selector\n"
        response += json.dumps(sessions, indent=2, ensure_ascii=False)
        response += "\n```"

    response += "\n\nUna volta effettuata la selezione, clicca su 'Genera Report' per procedere."
    return response


async def generate_action_menu_widget(actor_type: str = "TEACHER") -> str:
    """
    Generate a quick action menu widget customized by actor type.
    """
    if actor_type == "STUDENT":
        actions = [
            {"label": "❓ Allenami con un Quiz", "value": "Generami un quiz sull'argomento che abbiamo trattato"},
            {"label": "💪 Dammi un Esercizio", "value": "Fammi fare un esercizio pratico"},
            {"label": "💡 Spiegami un Concetto", "value": "Puoi spiegami meglio un concetto difficile?"},
            {"label": "🎨 Crea un'Immagine", "value": "Disegna un'immagine che rappresenti quello di cui stiamo parlando"},
            {"label": "🌐 Ricerca Web", "value": "Cercami informazioni aggiornate su..."},
        ]
    else:
        actions = [
            {"label": "📊 Report Sessione", "value": "Voglio un report della sessione"},
            {"label": "👥 Report Studenti", "value": "Voglio un report degli studenti"},
            {"label": "❓ Crea Quiz", "value": "CREA QUIZ: Generami un quiz"},
            {"label": "💪 Crea Esercizio", "value": "CREA ESERCIZIO: Generami un esercizio"},
            {"label": "🌐 Ricerca Web", "value": "RICERCA WEB: Cercami informazioni su..."},
            {"label": "📈 Analisi Classe", "value": "Analizza l'andamento generale della classe"},
        ]
    
    response = "Ciao! Sono il tuo assistente AI. Ecco alcune azioni rapide che posso eseguire per te:\n\n"
    response += "```action_menu\n"
    response += json.dumps(actions, indent=2, ensure_ascii=False)
    response += "\n```"
    return response


async def generate_text_editor_response(
    messages: list[dict],
    provider: str,
    model: str
) -> str:
    """
    Generate response for the text editor.
    Respects the system prompt provided in messages completely, 
    without injecting teacher support profile or analytics context.
    """
    response = await llm_service.generate(
        messages=messages,
        # We don't pass system_prompt here because it's already in the messages list 
        # sent from the frontend (role: system)
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=4096,
    )

    return response.content


async def generate_with_analytics(
    messages: list[dict],
    context: str,
    provider: str,
    model: str
) -> str:
    """
    Generate response using analytics mode with full database context.
    This is the existing behavior for teacher support chat.
    """
    from app.services.chatbot_profiles import get_profile

    profile = get_profile("teacher_support")
    base_prompt = profile["system_prompt"]

    # Enhance system prompt with platform knowledge + database context
    enhanced_prompt = f"""{base_prompt}

{PLATFORM_KNOWLEDGE_BASE}

HAI ACCESSO AI SEGUENTI DATI REALI DEL DOCENTE:

{context}

LINEE GUIDA PER RISPOSTE CHIARE E TRASPARENTI:

📊 **DATI E STATISTICHE**:
- Usa questi dati reali per fornire risposte personalizzate
- Quando mostri dati, usa tabelle markdown ben formattate
- Formatta statistiche come "X su Y" per visualizzazione grafica
- Usa emoji per rendere le risposte leggibili (📊 📈 ✅ ⚠️)

🔍 **EXPLAINABILITY** (MOLTO IMPORTANTE):
- Spiega sempre il TUO RAGIONAMENTO: come sei arrivato a una conclusione
- Non limitarti a dare risposte: spiega il "perché" e il "come"
- Se fai inferenze dai dati, dichiaralo: "Dai dati emerge che..." oppure "Osservando X, posso dedurre Y perché..."
- Se ci sono limitazioni nei dati o incertezze, comunicale chiaramente

💡 **SUGGERIMENTI PRATICI**:
- Fornisci sempre suggerimenti azionabili
- Spiega il razionale dietro ogni suggerimento
- Indica priorità e impatto atteso delle azioni consigliate

⚠️ **TRASPARENZA**:
- Distingui tra fatti (dai dati) e interpretazioni/suggerimenti
- Se non hai abbastanza dati per rispondere, dillo chiaramente
- Evita affermazioni generiche: sii specifico e basato sui dati
"""

    response = await llm_service.generate(
        messages=messages,
        system_prompt=enhanced_prompt,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=4096,
    )

    return response.content


async def generate_with_analytics_stream(
    messages: list[dict],
    context: str,
    provider: str,
    model: str,
    custom_system_prompt: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Streaming version of generate_with_analytics.
    Yields text chunks as they arrive from the LLM.
    """
    from app.services.chatbot_profiles import get_profile

    profile = get_profile("teacher_support")
    base_prompt = custom_system_prompt if custom_system_prompt else profile["system_prompt"]

    enhanced_prompt = f"""{base_prompt}

{PLATFORM_KNOWLEDGE_BASE}

HAI ACCESSO AI SEGUENTI DATI REALI DEL DOCENTE:

{context}

LINEE GUIDA PER RISPOSTE CHIARE E TRASPARENTI:

📊 **DATI E STATISTICHE**:
- Usa questi dati reali per fornire risposte personalizzate
- Quando mostri dati, usa tabelle markdown ben formattate
- Formatta statistiche come "X su Y" per visualizzazione grafica
- Usa emoji per rendere le risposte leggibili (📊 📈 ✅ ⚠️)

🔍 **EXPLAINABILITY** (MOLTO IMPORTANTE):
- Spiega sempre il TUO RAGIONAMENTO: come sei arrivato a una conclusione
- Non limitarti a dare risposte: spiega il "perché" e il "come"
- Se fai inferenze dai dati, dichiaralo: "Dai dati emerge che..." oppure "Osservando X, posso dedurre Y perché..."
- Se ci sono limitazioni nei dati o incertezze, comunicale chiaramente

💡 **SUGGERIMENTI PRATICI**:
- Fornisci sempre suggerimenti azionabili
- Spiega il razionale dietro ogni suggerimento
- Indica priorità e impatto atteso delle azioni consigliate

⚠️ **TRASPARENZA**:
- Distingui tra fatti (dai dati) e interpretazioni/suggerimenti
- Se non hai abbastanza dati per rispondere, dillo chiaramente
- Evita affermazioni generiche: sii specifico e basato sui dati
"""

    async for chunk in llm_service.generate_stream(
        messages=messages,
        system_prompt=enhanced_prompt,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=4096,
    ):
        yield chunk
