"""
Math Agent Service - Agentic system for Math Coach with tool calling
Provides calculator and Python execution for accurate math problem solving
"""

import re
import math
import json
import asyncio
from typing import Optional
from dataclasses import dataclass

from app.services.llm_service import llm_service


@dataclass
class ToolResult:
    tool_name: str
    input_data: str
    output: str
    success: bool
    error: Optional[str] = None


# Safe math functions available for evaluation
SAFE_MATH_FUNCTIONS = {
    'abs': abs,
    'round': round,
    'min': min,
    'max': max,
    'sum': sum,
    'pow': pow,
    'sqrt': math.sqrt,
    'sin': math.sin,
    'cos': math.cos,
    'tan': math.tan,
    'asin': math.asin,
    'acos': math.acos,
    'atan': math.atan,
    'atan2': math.atan2,
    'sinh': math.sinh,
    'cosh': math.cosh,
    'tanh': math.tanh,
    'exp': math.exp,
    'log': math.log,
    'log10': math.log10,
    'log2': math.log2,
    'floor': math.floor,
    'ceil': math.ceil,
    'factorial': math.factorial,
    'gcd': math.gcd,
    'lcm': getattr(math, 'lcm', lambda a, b: abs(a * b) // math.gcd(a, b)),
    'degrees': math.degrees,
    'radians': math.radians,
    'pi': math.pi,
    'e': math.e,
    'tau': math.tau,
    'inf': math.inf,
}


def safe_calculator(expression: str) -> ToolResult:
    """
    Safely evaluate a mathematical expression.
    Supports basic arithmetic, powers, roots, trig functions, etc.
    """
    try:
        # Clean the expression
        expr = expression.strip()
        
        # Replace common math notation
        expr = expr.replace('^', '**')
        expr = expr.replace('×', '*')
        expr = expr.replace('÷', '/')
        expr = expr.replace('√', 'sqrt')
        
        # Validate - only allow safe characters
        allowed_chars = set('0123456789+-*/.()[], ')
        allowed_words = set(SAFE_MATH_FUNCTIONS.keys())
        
        # Extract words from expression
        words = re.findall(r'[a-zA-Z_]+', expr)
        for word in words:
            if word.lower() not in allowed_words:
                return ToolResult(
                    tool_name="calculator",
                    input_data=expression,
                    output="",
                    success=False,
                    error=f"Funzione non consentita: {word}"
                )
        
        # Evaluate safely
        result = eval(expr, {"__builtins__": {}}, SAFE_MATH_FUNCTIONS)
        
        # Format result
        if isinstance(result, float):
            if result == int(result):
                result = int(result)
            else:
                result = round(result, 10)
        
        return ToolResult(
            tool_name="calculator",
            input_data=expression,
            output=str(result),
            success=True
        )
    except Exception as e:
        return ToolResult(
            tool_name="calculator",
            input_data=expression,
            output="",
            success=False,
            error=str(e)
        )


def safe_python_math(code: str) -> ToolResult:
    """
    Safely execute Python code for mathematical computations.
    Limited to math operations only - no file I/O, network, etc.
    """
    try:
        # Create a restricted globals environment
        safe_globals = {
            "__builtins__": {
                'abs': abs,
                'round': round,
                'min': min,
                'max': max,
                'sum': sum,
                'pow': pow,
                'len': len,
                'range': range,
                'enumerate': enumerate,
                'zip': zip,
                'map': map,
                'filter': filter,
                'sorted': sorted,
                'reversed': reversed,
                'list': list,
                'tuple': tuple,
                'set': set,
                'dict': dict,
                'int': int,
                'float': float,
                'str': str,
                'bool': bool,
                'print': print,
                'isinstance': isinstance,
                'type': type,
            },
            'math': math,
            'sqrt': math.sqrt,
            'sin': math.sin,
            'cos': math.cos,
            'tan': math.tan,
            'pi': math.pi,
            'e': math.e,
            'log': math.log,
            'exp': math.exp,
        }
        
        # Capture output
        output_lines = []
        original_print = print
        
        def capture_print(*args, **kwargs):
            output_lines.append(' '.join(str(a) for a in args))
        
        safe_globals['__builtins__']['print'] = capture_print
        
        # Create local namespace for results
        local_vars = {}
        
        # Execute the code
        exec(code, safe_globals, local_vars)
        
        # Get the result - either from print statements or last assigned variable
        if output_lines:
            result = '\n'.join(output_lines)
        elif 'result' in local_vars:
            result = str(local_vars['result'])
        elif 'risultato' in local_vars:
            result = str(local_vars['risultato'])
        elif local_vars:
            # Return the last assigned variable
            last_var = list(local_vars.values())[-1]
            result = str(last_var)
        else:
            result = "Codice eseguito senza output"
        
        return ToolResult(
            tool_name="python",
            input_data=code,
            output=result,
            success=True
        )
    except Exception as e:
        return ToolResult(
            tool_name="python",
            input_data=code,
            output="",
            success=False,
            error=str(e)
        )


# Tool definitions for OpenAI function calling
MATH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Esegue calcoli matematici. Usa questa funzione per qualsiasi operazione aritmetica, potenze, radici, funzioni trigonometriche, logaritmi, etc. Restituisce il risultato numerico esatto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "L'espressione matematica da calcolare. Esempi: '2+2', 'sqrt(16)', 'sin(pi/2)', '2^10', 'log(100, 10)'"
                    }
                },
                "required": ["expression"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "python_math",
            "description": "Esegue codice Python per calcoli matematici complessi come equazioni, sistemi, derivate numeriche, integrali numerici, statistiche, etc. Usa questa funzione quando il calcolo richiede più passaggi o algoritmi.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Il codice Python da eseguire. Deve stampare il risultato con print() o assegnarlo a una variabile 'result'. Hai accesso a math e funzioni base."
                    }
                },
                "required": ["code"]
            }
        }
    }
]


MATH_AGENT_SYSTEM_PROMPT = """Sei un mentor matematico che segue il METODO POLYA e l'approccio SOCRATICO.

⚠️ REGOLA FONDAMENTALE: NON DARE MAI LA SOLUZIONE DIRETTAMENTE!
Guida lo studente a trovare la risposta da solo attraverso domande.

📐 FORMATTAZIONE MATEMATICA (IMPORTANTE):
- Scrivi SEMPRE le formule matematiche in LaTeX
- Per formule inline usa: $formula$ (es: $x^2 + 2x + 1$)
- Per formule a blocco usa: $$formula$$ (es: $$\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$)
- Esempi: $x^3 - 2x^2 = 1$ invece di x^3 - 2x^2 = 1
- Frazioni: $\\frac{a}{b}$, radici: $\\sqrt{x}$, potenze: $x^n$, pedici: $x_i$

HAI ACCESSO A STRUMENTI DI CALCOLO (calculator, python_math) MA:
- Usali SOLO INTERNAMENTE per verificare se la risposta dello studente è corretta
- NON mostrare il risultato dei tuoi calcoli allo studente
- Se lo studente dà una risposta, verifica silenziosamente e poi:
  - Se CORRETTA: congratulati e chiedi come ci è arrivato
  - Se SBAGLIATA: NON dire il risultato giusto, chiedi di ricontrollare un passaggio specifico

METODO POLYA (4 fasi):
1. COMPRENDERE IL PROBLEMA
   - "Cosa ti viene chiesto di trovare?"
   - "Quali dati hai a disposizione?"

2. ELABORARE UN PIANO
   - "Conosci un problema simile?"
   - "Quale operazione/formula potrebbe servire?"

3. ESEGUIRE IL PIANO
   - Lascia che lo studente faccia i calcoli
   - Se sbaglia, chiedi: "Sei sicuro di questo passaggio?"

4. VERIFICARE
   - "Il risultato ti sembra ragionevole?"
   - Solo QUI, se lo studente ha finito, usa i tool per confermare

STILE:
- Breve e incoraggiante (max 2-3 frasi per risposta)
- Domande aperte che stimolano il ragionamento
- Mai giudicante, sempre costruttivo
- Usa emoji per rendere il dialogo amichevole 🎯 ✨ 🤔

QUANDO LO STUDENTE CHIEDE "quanto fa X?" o "risolvi questo":
- NON calcolare e dare il risultato
- Rispondi: "Proviamo insieme! Come imposteresti questo problema?"

QUANDO LO STUDENTE DICE "è giusto X?" o "ho trovato X":
- USA i tool per verificare internamente
- Se giusto: "Ottimo! ✨ Come ci sei arrivato?"
- Se sbagliato: "Mmm, ricontrolla il passaggio dove... 🤔" (senza dire la risposta)"""


async def run_math_agent(
    messages: list[dict],
    provider: str = "openai",
    model: str = "gpt-4o-mini",
    max_iterations: int = 5
) -> str:
    """
    Run the math agent with tool calling capabilities.
    Iteratively calls tools until a final answer is reached.
    """
    from openai import AsyncOpenAI
    from app.core.config import settings
    
    if provider != "openai" or not settings.OPENAI_API_KEY:
        # Fallback to regular LLM without tools
        response = await llm_service.generate(
            messages=messages,
            system_prompt=MATH_AGENT_SYSTEM_PROMPT,
            provider=provider,
            model=model,
            temperature=0.3,
        )
        return response.content
    
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Prepare messages with system prompt
    full_messages = [
        {"role": "system", "content": MATH_AGENT_SYSTEM_PROMPT}
    ] + messages
    
    for iteration in range(max_iterations):
        # Call the model with tools
        response = await client.chat.completions.create(
            model=model,
            messages=full_messages,
            tools=MATH_TOOLS,
            tool_choice="auto",
            temperature=0.3,
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
                if tool_name == "calculator":
                    result = safe_calculator(args.get("expression", ""))
                elif tool_name == "python_math":
                    result = safe_python_math(args.get("code", ""))
                else:
                    result = ToolResult(
                        tool_name=tool_name,
                        input_data=str(args),
                        output="",
                        success=False,
                        error=f"Tool sconosciuto: {tool_name}"
                    )
                
                # Add tool result to messages
                if result.success:
                    tool_output = f"Risultato: {result.output}"
                else:
                    tool_output = f"Errore: {result.error}"
                
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_output
                })
        else:
            # No more tool calls, return the final response
            return message.content or ""
    
    # Max iterations reached, return last response
    return message.content or "Mi dispiace, non sono riuscito a completare il calcolo."


# Singleton instance
math_agent = None

def get_math_agent():
    global math_agent
    if math_agent is None:
        math_agent = run_math_agent
    return math_agent
