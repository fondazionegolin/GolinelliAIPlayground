"""
Teacher Agent Service - Agentic system for teacher support chat
Automatically detects teacher intent and activates specialized content generation
"""

import json
import re
import asyncio
from typing import Optional, Dict, Any
import logging

from app.services.llm_service import llm_service
from app.schemas.content import (
    IntentResult,
    TeacherIntent,
    QuizData,
    LessonData,
    ExerciseData,
    PresentationData,
)

logger = logging.getLogger(__name__)


# ============================================================================
# INTENT CLASSIFICATION
# ============================================================================

INTENT_CLASSIFIER_PROMPT = """Sei un classificatore di intenti per un assistente docente AI.

Analizza il messaggio del docente e determina cosa vuole fare.

INTENTI DISPONIBILI:
1. quiz_generation - Il docente vuole creare un quiz/verifica con domande
   Parole chiave: "quiz", "verifica", "test", "domande", "quesiti"

2. lesson_generation - Il docente vuole creare una lezione strutturata
   Parole chiave: "lezione", "spiegazione", "unità didattica", "spiego", "insegno"

3. exercise_generation - Il docente vuole creare esercizi/problemi
   Parole chiave: "esercizio", "esercizi", "problema", "problemi", "attività pratica"

4. presentation_generation - Il docente vuole creare una presentazione/slide
   Parole chiave: "presentazione", "slide", "diapositive", "power point", "keynote"

5. web_search - Il docente vuole cercare informazioni aggiornate dal web
   Parole chiave: "cerca", "ricerca", "trova", "cerca online", "cerca sul web", "informazioni recenti", "ultime notizie", "aggiornamenti", "cerca in internet", "informazioni su", "dimmi di", "cosa sai di"

6. document_help - Il docente vuole aiuto con documenti scolastici
   Parole chiave: "PEI", "PTOF", "relazione", "verbale", "documento", "modulo"

7. analytics - Il docente vuole analisi, statistiche, valutazioni (DEFAULT)
   Parole chiave: "statistiche", "performance", "valutazioni", "come sta andando", "dati"

REGOLE DI CLASSIFICAZIONE:
- Se il messaggio menziona esplicitamente creazione di contenuti didattici → usa intent specifico
- Se chiede "slide" o "presentazione" → presentation_generation
- Se usa verbi come "cerca", "ricerca", "trova", "dimmi di" seguiti da un argomento → web_search
- Se chiede di cercare online o informazioni aggiornate → web_search
- Se chiede "informazioni su X" dove X è un argomento generale → web_search
- Se chiede analisi o informazioni sulla classe → analytics
- Se chiede aiuto con documenti → document_help
- In caso di ambiguità → analytics (è il più sicuro)
- Il docente potrebbe caricare un documento e chiedere di generare contenuti da esso

FORMATO OUTPUT:
Rispondi SOLO con un JSON valido (senza markdown):
{
  "intent": "quiz_generation",
  "confidence": 0.95,
  "topic": "estratto del tema/argomento se presente"
}

Confidence deve essere:
- 0.9-1.0: Molto chiaro dall'uso di parole chiave
- 0.7-0.89: Probabile ma non esplicito
- 0.5-0.69: Ambiguo, usa fallback
- <0.5: Molto incerto, usa analytics"""


async def classify_intent(message: str, history: list[dict]) -> IntentResult:
    """
    Classify teacher's intent using fast lightweight model.
    Returns intent category, confidence, and extracted parameters.
    """
    try:
        # Check for forced mode prefixes
        mode_prefixes = {
            ("RICERCA WEB:", "🌐"): TeacherIntent.WEB_SEARCH,
            ("CREA PRESENTAZIONE:", "📊"): TeacherIntent.PRESENTATION_GENERATION,
            ("CREA QUIZ:", "❓"): TeacherIntent.QUIZ_GENERATION,
            ("CREA LEZIONE:", "📚"): TeacherIntent.LESSON_GENERATION,
            ("GENERA REPORT:", "📈"): TeacherIntent.ANALYTICS,
            ("GENERA IMMAGINE:", "🎨"): TeacherIntent.ANALYTICS,  # Image gen non implementata, fallback
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
        intent = TeacherIntent(result_dict["intent"])
        confidence = float(result_dict.get("confidence", 0.8))
        topic = result_dict.get("topic")

        logger.info(f"Intent classified: {intent.value} (confidence: {confidence})")

        return IntentResult(
            intent=intent,
            confidence=confidence,
            extracted_params=topic
        )

    except Exception as e:
        logger.warning(f"Intent classification failed: {e}, falling back to analytics")
        # Fallback to analytics on error
        return IntentResult(
            intent=TeacherIntent.ANALYTICS,
            confidence=0.5,
            extracted_params=None
        )


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

LESSON_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_lesson",
            "description": "Genera una lezione strutturata con obiettivi, sezioni, attività e risorse. Usa questa funzione per creare piani di lezione completi.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Titolo della lezione"
                    },
                    "description": {
                        "type": "string",
                        "description": "Descrizione generale della lezione"
                    },
                    "objectives": {
                        "type": "array",
                        "description": "Obiettivi di apprendimento della lezione",
                        "items": {"type": "string"}
                    },
                    "sections": {
                        "type": "array",
                        "description": "Sezioni/fasi della lezione",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {
                                    "type": "string",
                                    "description": "Titolo della sezione"
                                },
                                "content": {
                                    "type": "string",
                                    "description": "Contenuto della sezione (può usare markdown)"
                                },
                                "duration_minutes": {
                                    "type": "integer",
                                    "description": "Durata stimata in minuti"
                                }
                            },
                            "required": ["title", "content"]
                        }
                    },
                    "activities": {
                        "type": "array",
                        "description": "Attività pratiche da svolgere",
                        "items": {"type": "string"}
                    },
                    "resources": {
                        "type": "array",
                        "description": "Risorse e materiali necessari",
                        "items": {"type": "string"}
                    }
                },
                "required": ["title", "description", "objectives", "sections"]
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

PRESENTATION_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_presentation",
            "description": "Genera una presentazione strutturata con slide. Usa questa funzione per creare presentazioni educative con slide di solo testo formattato.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Titolo della presentazione"
                    },
                    "description": {
                        "type": "string",
                        "description": "Descrizione breve della presentazione"
                    },
                    "slides": {
                        "type": "array",
                        "description": "Array di slide della presentazione",
                        "items": {
                            "type": "object",
                            "properties": {
                                "order": {
                                    "type": "integer",
                                    "description": "Ordine della slide (0-based)"
                                },
                                "title": {
                                    "type": "string",
                                    "description": "Titolo della slide"
                                },
                                "content": {
                                    "type": "string",
                                    "description": "Contenuto della slide in formato markdown. Usa liste puntate, grassetto, corsivo per formattare."
                                },
                                "speaker_notes": {
                                    "type": "string",
                                    "description": "Note per il docente (opzionali)"
                                }
                            },
                            "required": ["order", "title", "content"]
                        }
                    }
                },
                "required": ["title", "slides"]
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
2. POI, il blocco JSON quiz_data (OBBLIGATORIO!)

ESEMPIO RISPOSTA:

Ho creato un quiz di 8 domande sulle equazioni di secondo grado, con difficoltà progressiva.

```quiz_data
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
- Il blocco ```quiz_data è OBBLIGATORIO
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

LESSON_AGENT_PROMPT = """Sei un esperto di progettazione didattica per docenti.

IL TUO COMPITO:
Crea una lezione completa e ben strutturata sull'argomento richiesto.

STRUTTURA LEZIONE IDEALE:
1. **Obiettivi di Apprendimento**: Cosa gli studenti sapranno/sapranno fare
2. **Sezioni/Fasi**: Introduzione → Spiegazione → Esempi → Pratica → Verifica
3. **Attività Pratiche**: Cosa faranno gli studenti
4. **Risorse e Materiali**: Cosa serve
5. **Tempi Stimati**: Durata di ogni fase

FORMATO OUTPUT OBBLIGATORIO:
Devi SEMPRE rispondere così:

1. Breve introduzione (1-2 frasi)
2. Il blocco JSON lesson_data (OBBLIGATORIO!)

```lesson_data
{
  "title": "Titolo Lezione",
  "description": "Descrizione breve",
  "objectives": ["Obiettivo 1", "Obiettivo 2", "Obiettivo 3"],
  "sections": [
    {
      "title": "Introduzione",
      "content": "Contenuto della sezione in markdown...",
      "duration_minutes": 10
    },
    {
      "title": "Concetti Chiave",
      "content": "Spiegazione dei concetti...",
      "duration_minutes": 20
    }
  ],
  "activities": ["Attività 1", "Attività 2"],
  "resources": ["Risorsa 1", "Risorsa 2"]
}
```

REGOLE RIGIDE:
- Il blocco ```lesson_data è OBBLIGATORIO
- Genera ALMENO 3 sezioni
- objectives, activities, resources sono array di stringhe
- sections è array di oggetti con title, content, duration_minutes
- NON omettere MAI il blocco JSON

STILE:
- Pedagogicamente solido
- Attivo e coinvolgente
- Concreto e applicabile"""

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

PRESENTATION_AGENT_PROMPT = """Sei un esperto creatore di presentazioni didattiche per docenti.

IL TUO COMPITO:
Crea una presentazione strutturata con slide chiare e ben formattate sull'argomento richiesto.

STRUTTURA PRESENTAZIONE IDEALE:
- 5-10 slide per presentazione
- Prima slide: Titolo e introduzione
- Slide centrali: Contenuti principali (un concetto per slide)
- Ultima slide: Riepilogo o domande

CARATTERISTICHE SLIDE:
- Titolo chiaro e conciso
- Contenuto in formato bullet points markdown
- Usa grassetto **testo** per enfatizzare
- Usa liste puntate - o numerate 1. 2. 3.
- Mantieni il testo breve e leggibile (max 5-6 punti per slide)
- Ogni slide deve trasmettere UN concetto principale

FORMATO OUTPUT OBBLIGATORIO:
Devi SEMPRE rispondere in questo modo:

1. Prima, una breve introduzione (1-2 frasi)
2. POI, il blocco JSON presentation_data (OBBLIGATORIO!)

ESEMPIO RISPOSTA:

Ho creato una presentazione di 7 slide sulla Rivoluzione Francese per studenti di scuola superiore.

```presentation_data
{
  "title": "La Rivoluzione Francese",
  "description": "Cause, eventi principali e conseguenze della Rivoluzione Francese (1789-1799)",
  "slides": [
    {
      "order": 0,
      "title": "La Rivoluzione Francese",
      "content": "# Introduzione\n\n- Periodo: 1789-1799\n- Luogo: Francia\n- Evento cruciale della storia moderna\n- Trasformazione radicale della società"
    },
    {
      "order": 1,
      "title": "Cause della Rivoluzione",
      "content": "- **Crisi economica**: debito pubblico enorme\n- **Disuguaglianze sociali**: privilegi di nobiltà e clero\n- **Influenza illuminista**: idee di libertà e uguaglianza\n- **Debolezza monarchica**: re Luigi XVI indeciso"
    },
    {
      "order": 2,
      "title": "La Presa della Bastiglia",
      "content": "- **14 luglio 1789**: data simbolo\n- Assalto alla prigione-fortezza\n- Simbolo del potere regio\n- Inizio della rivoluzione popolare"
    }
  ]
}
```

REGOLE RIGIDE:
- Il blocco ```presentation_data è OBBLIGATORIO
- Genera ALMENO 5 slide
- Il JSON deve essere valido
- Ogni slide deve avere: order (numero), title (stringa), content (markdown)
- Il content DEVE contenere bullet points con \n per andare a capo
- NON omettere MAI il blocco JSON

STILE:
- Professionale ma accessibile
- Contenuti visuali e sintetici
- Progressione logica degli argomenti
- Adatto al livello scolastico indicato"""


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


def execute_create_lesson(args: dict) -> dict:
    """
    Execute lesson creation and validate the data.
    Returns validated lesson JSON.
    """
    try:
        # Validate using Pydantic
        lesson_data = LessonData(**args)

        return lesson_data.model_dump()

    except Exception as e:
        logger.error(f"Lesson validation error: {e}")
        raise ValueError(f"Errore nella creazione della lezione: {e}")


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


def execute_create_presentation(args: dict) -> dict:
    """
    Execute presentation creation and validate the data.
    Returns validated presentation JSON.
    """
    try:
        # Validate using Pydantic
        presentation_data = PresentationData(**args)

        return presentation_data.model_dump()

    except Exception as e:
        logger.error(f"Presentation validation error: {e}")
        raise ValueError(f"Errore nella creazione della presentazione: {e}")


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

                # Ensure response has quiz_data block
                if quiz_json and "```quiz_data" not in response_text:
                    response_text += f"\n\n```quiz_data\n{json.dumps(quiz_json, indent=2, ensure_ascii=False)}\n```"

                return response_text

        except Exception as e:
            logger.error(f"Quiz generation error at iteration {iteration}: {e}")
            if iteration == max_iterations - 1:
                raise

    # Max iterations reached, return with quiz if we have one
    if quiz_json:
        return f"Quiz generato:\n\n```quiz_data\n{json.dumps(quiz_json, indent=2, ensure_ascii=False)}\n```"

    return "Mi dispiace, non sono riuscito a completare la generazione del quiz."


async def generate_lesson_with_tools(
    messages: list[dict],
    provider: str,
    model: str,
    max_iterations: int = 3
) -> str:
    """Generate lesson using OpenAI function calling."""
    from openai import AsyncOpenAI
    from app.core.config import settings

    if provider != "openai" or not settings.OPENAI_API_KEY:
        return await generate_lesson_without_tools(messages, provider, model)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    full_messages = [
        {"role": "system", "content": LESSON_AGENT_PROMPT}
    ] + messages

    lesson_json = None

    for iteration in range(max_iterations):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=full_messages,
                tools=LESSON_TOOLS,
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

                    if tool_name == "create_lesson":
                        lesson_json = execute_create_lesson(args)
                        tool_output = f"Lezione creata: {lesson_json['title']} con {len(lesson_json['sections'])} sezioni"
                    else:
                        tool_output = f"Tool sconosciuto: {tool_name}"

                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_output
                    })
            else:
                response_text = message.content or ""

                if lesson_json and "```lesson_data" not in response_text:
                    response_text += f"\n\n```lesson_data\n{json.dumps(lesson_json, indent=2, ensure_ascii=False)}\n```"

                return response_text

        except Exception as e:
            logger.error(f"Lesson generation error at iteration {iteration}: {e}")
            if iteration == max_iterations - 1:
                raise

    if lesson_json:
        return f"Lezione generata:\n\n```lesson_data\n{json.dumps(lesson_json, indent=2, ensure_ascii=False)}\n```"

    return "Mi dispiace, non sono riuscito a completare la generazione della lezione."


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


async def generate_lesson_without_tools(messages: list[dict], provider: str, model: str) -> str:
    """Fallback lesson generation without function calling."""
    response = await llm_service.generate(
        messages=messages,
        system_prompt=LESSON_AGENT_PROMPT,
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


async def generate_presentation_without_tools(messages: list[dict], provider: str, model: str) -> str:
    """Fallback presentation generation without function calling."""

    # Add explicit instruction to the last user message
    enhanced_messages = messages.copy()
    if enhanced_messages:
        last_msg = enhanced_messages[-1]["content"]
        enhanced_messages[-1] = {
            "role": "user",
            "content": f"{last_msg}\n\nRICORDA: Devi SEMPRE includere il blocco ```presentation_data con il JSON completo!"
        }

    response = await llm_service.generate(
        messages=enhanced_messages,
        system_prompt=PRESENTATION_AGENT_PROMPT,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=4096,
    )

    content = response.content

    # Ensure presentation_data block exists
    if "```presentation_data" not in content:
        logger.warning("No presentation_data block found, attempting to extract JSON")
        # Try to extract JSON from response and create the block
        try:
            # Look for JSON object in the response (more flexible pattern)
            json_match = re.search(r'\{[\s\S]*?"title"[\s\S]*?"slides"[\s\S]*?\[[\s\S]*?\][\s\S]*?\}', content)
            if json_match:
                json_str = json_match.group(0)
                # Validate it's proper JSON
                presentation_data = json.loads(json_str)
                # Validate structure
                if "title" in presentation_data and "slides" in presentation_data and len(presentation_data["slides"]) > 0:
                    # Add the block
                    content += f"\n\n```presentation_data\n{json.dumps(presentation_data, indent=2, ensure_ascii=False)}\n```"
                    logger.info("Successfully extracted and added presentation_data block")
                else:
                    logger.error("Extracted JSON missing required fields")
            else:
                # Last resort: ask user to try again
                logger.error("No valid presentation JSON found in response")
                content += "\n\n⚠️ Non sono riuscito a generare la presentazione nel formato corretto. Per favore, riprova con una richiesta più specifica."
        except Exception as e:
            logger.error(f"Failed to extract presentation JSON: {e}")
            content += "\n\n⚠️ Errore nella generazione della presentazione. Riprova."

    return content


# ============================================================================
# PRESENTATION GENERATOR WITH TOOL CALLING
# ============================================================================

async def generate_presentation_with_tools(
    messages: list[dict],
    provider: str,
    model: str,
    max_iterations: int = 3
) -> str:
    """Generate presentation using OpenAI function calling."""
    from openai import AsyncOpenAI
    from app.core.config import settings

    if provider != "openai" or not settings.OPENAI_API_KEY:
        return await generate_presentation_without_tools(messages, provider, model)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    full_messages = [
        {"role": "system", "content": PRESENTATION_AGENT_PROMPT}
    ] + messages

    presentation_json = None

    for iteration in range(max_iterations):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=full_messages,
                tools=PRESENTATION_TOOLS,
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

                    if tool_name == "create_presentation":
                        presentation_json = execute_create_presentation(args)
                        tool_output = f"Presentazione creata: {presentation_json['title']} con {len(presentation_json['slides'])} slide"
                    else:
                        tool_output = f"Tool sconosciuto: {tool_name}"

                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_output
                    })
            else:
                response_text = message.content or ""

                if presentation_json and "```presentation_data" not in response_text:
                    response_text += f"\n\n```presentation_data\n{json.dumps(presentation_json, indent=2, ensure_ascii=False)}\n```"

                return response_text

        except Exception as e:
            logger.error(f"Presentation generation error at iteration {iteration}: {e}")
            if iteration == max_iterations - 1:
                raise

    if presentation_json:
        return f"Presentazione generata:\n\n```presentation_data\n{json.dumps(presentation_json, indent=2, ensure_ascii=False)}\n```"

    return "Mi dispiace, non sono riuscito a completare la generazione della presentazione."


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
    """
    from app.services.web_search_service import web_search_service

    # Extract the last user message as search query
    last_message = messages[-1]["content"] if messages else ""

    logger.info(f"Performing web search for: {last_message[:100]}...")

    # Perform web search
    results = await web_search_service.search(
        query=last_message,
        num_results=5,
        fetch_content=True
    )

    if not results:
        # Fallback to analytics if search fails
        logger.warning("Web search returned no results, falling back to analytics")
        return await generate_with_analytics(messages, context, provider, model)

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

    # Build enhanced prompt with search results
    web_search_prompt = f"""Sei un assistente AI per docenti con accesso a informazioni aggiornate dal web.

Ho cercato informazioni aggiornate per rispondere alla tua domanda. Ecco i risultati della ricerca:

{search_context}

ISTRUZIONI:
1. Usa le informazioni trovate per rispondere in modo accurato e aggiornato
2. Cita le fonti quando usi informazioni specifiche
3. Se le informazioni sono contrastanti, segnalalo
4. Se la ricerca non ha trovato informazioni rilevanti, dillo chiaramente
5. Formatta la risposta in modo chiaro e leggibile

Alla fine della risposta, aggiungi una sezione "📚 Fonti:" con i link alle fonti utilizzate."""

    # Generate response with web context
    response = await llm_service.generate(
        messages=messages,
        system_prompt=web_search_prompt,
        provider=provider,
        model=model,
        temperature=0.7,
        max_tokens=4096,
    )

    response_text = response.content

    # Ensure sources are included
    if "Fonti:" not in response_text and sources_list:
        response_text += f"\n\n📚 **Fonti:**\n" + "\n".join(sources_list)

    return response_text


# ============================================================================
# MAIN ORCHESTRATOR
# ============================================================================

async def run_teacher_agent(
    messages: list[dict],
    context: str,
    provider: str = "openai",
    model: str = "gpt-5-mini",
) -> str:
    """
    Main teacher agent orchestrator.
    Detects intent and routes to appropriate specialized agent.

    Args:
        messages: Conversation history
        context: Database context (for analytics mode)
        provider: LLM provider
        model: Model to use

    Returns:
        Generated response string
    """
    try:
        # Extract last user message for intent classification
        last_message = messages[-1]["content"] if messages else ""
        history = messages[:-1] if len(messages) > 1 else []

        # Classify intent
        logger.info("Classifying teacher intent...")
        intent_result = await classify_intent(last_message, history)

        logger.info(f"Intent: {intent_result.intent.value}, Confidence: {intent_result.confidence}")

        # If confidence is low, default to analytics
        if intent_result.confidence < 0.6:
            logger.info("Low confidence, routing to analytics")
            intent_result.intent = TeacherIntent.ANALYTICS

        # Route based on intent
        if intent_result.intent == TeacherIntent.QUIZ_GENERATION:
            logger.info("Routing to quiz generator")
            return await generate_quiz_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.LESSON_GENERATION:
            logger.info("Routing to lesson generator")
            return await generate_lesson_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.EXERCISE_GENERATION:
            logger.info("Routing to exercise generator")
            return await generate_exercise_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.PRESENTATION_GENERATION:
            logger.info("Routing to presentation generator")
            return await generate_presentation_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.WEB_SEARCH:
            logger.info("Routing to web search generator")
            return await generate_with_web_search(messages, context, provider, model)

        elif intent_result.intent == TeacherIntent.DOCUMENT_HELP:
            # For now, use analytics mode with document-focused prompt
            logger.info("Routing to document help (analytics mode)")
            return await generate_with_analytics(messages, context, provider, model)

        else:  # ANALYTICS or default
            logger.info("Routing to analytics mode")
            return await generate_with_analytics(messages, context, provider, model)

    except Exception as e:
        logger.error(f"Teacher agent error: {e}")
        # Fallback to analytics on any error
        return await generate_with_analytics(messages, context, provider, model)


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

    # Enhance system prompt with database context
    enhanced_prompt = f"""{base_prompt}

HAI ACCESSO AI SEGUENTI DATI REALI DEL DOCENTE:

{context}

IMPORTANTE:
- Usa questi dati reali per fornire risposte personalizzate
- Quando mostri dati, usa tabelle markdown ben formattate
- Aggiungi emoji per rendere le risposte più leggibili (📊 📈 ✅ ⚠️ etc.)
- Se devi mostrare statistiche, formattale come "X su Y" per attivare la visualizzazione grafica
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
