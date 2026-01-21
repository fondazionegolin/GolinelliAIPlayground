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
    ExerciseData,
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

2. exercise_generation - Il docente vuole creare esercizi/problemi
   Parole chiave: "esercizio", "esercizi", "problema", "problemi", "attività pratica"

3. web_search - Il docente vuole cercare informazioni aggiornate dal web
   Parole chiave: "cerca", "ricerca", "trova", "cerca online", "cerca sul web", "informazioni recenti", "ultime notizie", "aggiornamenti", "cerca in internet", "informazioni su", "dimmi di", "cosa sai di"

4. document_help - Il docente vuole aiuto con documenti scolastici
   Parole chiave: "PEI", "PTOF", "relazione", "verbale", "documento", "modulo"

5. analytics - Il docente vuole analisi, statistiche, valutazioni (DEFAULT)
   Parole chiave: "statistiche", "performance", "valutazioni", "come sta andando", "dati"

REGOLE DI CLASSIFICAZIONE:
- Se il messaggio menziona esplicitamente creazione di contenuti didattici → usa intent specifico
- Se usa verbi come "cerca", "ricerca", "trova", "dimmi di" seguiti da un argomento → web_search
- Se chiede di cercare online o informazioni aggiornate → web_search
- Se chiede "informazioni su X" dove X è un argomento generale → web_search
- Se chiede analisi o informazioni sulla classe → analytics
- Se chiede aiuto con documenti → document_help
- In caso di ambiguità → analytics (è il più sicuro)

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
            ("CREA QUIZ:", "❓"): TeacherIntent.QUIZ_GENERATION,
            ("CREA ESERCIZIO:", "💪"): TeacherIntent.EXERCISE_GENERATION,
            ("GENERA REPORT:", "📈"): TeacherIntent.ANALYTICS,
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

        elif intent_result.intent == TeacherIntent.EXERCISE_GENERATION:
            logger.info("Routing to exercise generator")
            return await generate_exercise_with_tools(messages, provider, model)

        elif intent_result.intent == TeacherIntent.WEB_SEARCH:
            logger.info("Routing to web search generator")
            return await generate_with_web_search(messages, context, provider, model)

        elif intent_result.intent == TeacherIntent.TEXT_EDITOR:
            logger.info("Routing to text editor generator")
            return await generate_text_editor_response(messages, provider, model)

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
