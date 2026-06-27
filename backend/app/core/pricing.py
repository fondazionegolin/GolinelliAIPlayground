from typing import Dict

class ModelPricing:
    def __init__(self, input_price: float, output_price: float, per_image: bool = False):
        """
        input_price: Cost per 1M tokens (for text) OR cost per generated asset/task (if per_image=True)
        output_price: Cost per 1M tokens (for text)
        """
        self.input_price = input_price
        self.output_price = output_price
        self.per_image = per_image

# Admin budgets are stored and displayed in EUR. Provider list prices are USD,
# so catalog values are converted once here. Update USD_TO_EUR when invoices or
# the finance rate used by the project changes.
USD_TO_EUR = 0.86
MESHY_CREDIT_EUR = 0.02 * USD_TO_EUR


def usd(input_price: float, output_price: float, per_image: bool = False) -> ModelPricing:
    return ModelPricing(input_price * USD_TO_EUR, output_price * USD_TO_EUR, per_image)


def meshy_credits(credits: int) -> ModelPricing:
    return ModelPricing(credits * MESHY_CREDIT_EUR, 0.0, per_image=True)


PRICING_CATALOG: Dict[str, ModelPricing] = {
    # OpenAI, official list price per 1M tokens, converted USD -> EUR.
    "gpt-5.4-mini": usd(0.25, 2.00),  # internal alias, priced as GPT-5 mini
    "gpt-5.2": usd(1.75, 14.00),
    "gpt-5.2-chat-latest": usd(1.75, 14.00),
    "gpt-5.1": usd(1.25, 10.00),
    "gpt-5.1-chat-latest": usd(1.25, 10.00),
    "gpt-5": usd(1.25, 10.00),
    "gpt-5-chat-latest": usd(1.25, 10.00),
    "gpt-5-mini": usd(0.25, 2.00),
    "gpt-5-nano": usd(0.05, 0.40),
    "gpt-4.1": usd(2.00, 8.00),
    "gpt-4.1-mini": usd(0.40, 1.60),
    "gpt-4.1-nano": usd(0.10, 0.40),
    "gpt-4o": usd(2.50, 10.00),
    "gpt-4o-mini": usd(0.15, 0.60),
    "gpt-3.5-turbo": usd(0.50, 1.50),
    "o3": usd(2.00, 8.00),
    "o4-mini": usd(1.10, 4.40),
    "o1": usd(15.00, 60.00),
    "o1-preview": usd(15.00, 60.00),
    "o1-mini": usd(1.10, 4.40),
    
    # Anthropic Claude, official list price per 1M tokens, converted USD -> EUR.
    "claude-haiku-4-5-20251001": usd(1.00, 5.00),
    "claude-sonnet-4-6": usd(3.00, 15.00),
    "claude-sonnet-4-5": usd(3.00, 15.00),
    "claude-opus-4-8": usd(5.00, 25.00),
    "claude-opus-4-7": usd(5.00, 25.00),
    "claude-opus-4-6": usd(5.00, 25.00),
    "claude-opus-4-5": usd(5.00, 25.00),
    "claude-3-5-sonnet-20241022": usd(3.00, 15.00),
    "claude-3-haiku-20240307": usd(0.25, 1.25),
    "claude-3-opus-20240229": usd(15.00, 75.00),

    # Google Gemini
    "gemini-2.0-flash": usd(0.075, 0.30),
    "gemini-2.0-flash-lite": usd(0.0375, 0.15),

    # DeepSeek
    "deepseek-chat": usd(0.0, 0.0),
    "deepseek-reasoner": usd(0.0, 0.0),
    "deepseek-v4-flash": usd(0.0, 0.0),
    "deepseek-v4-pro": usd(0.0, 0.0),
    
    # Ollama (Self-hosted = 0 cost usually, unless we want to attribute server cost)
    "mistral": ModelPricing(0.0, 0.0),
    "llama3": ModelPricing(0.0, 0.0),
    "deepseek-r1": ModelPricing(0.0, 0.0),
    
    # Image generation, approximate standard 1024px request cost converted to EUR.
    "dall-e-3": usd(0.040, 0.0, per_image=True),
    "gpt-image-1": usd(0.040, 0.0, per_image=True),
    "gpt-image-1.5": usd(0.034, 0.0, per_image=True),
    "gpt-image-2": usd(0.020, 0.0, per_image=True),
    
    # Flux (via Golinelli API or similar - assuming cost or 0 if internal)
    "flux-schnell": ModelPricing(0.00, 0.0, per_image=True), # Check if there is a cost
    "flux-dev": ModelPricing(0.00, 0.0, per_image=True),
    "sdxl": ModelPricing(0.0, 0.0, per_image=True),

    # Meshy API. Meshy charges API tasks in Meshy credits; MESHY_CREDIT_EUR
    # maps account credits to EUR for the shared platform budget.
    "meshy-text-to-3d-preview": meshy_credits(20),
    "meshy-image-to-3d": meshy_credits(20),
    "meshy-image-to-3d-pbr": meshy_credits(30),
    "meshy-text-to-image": meshy_credits(9),
}

def calculate_cost(provider: str, model: str, input_tokens: int = 0, output_tokens: int = 0, image_count: int = 0) -> float:
    # Normalize model name
    model_key = model
    
    # Handle variations or prefixes
    if model.startswith("gpt-"):
        pass # keep as is
    
    pricing = PRICING_CATALOG.get(model_key)
    
    # Fallback/Default prices
    if not pricing:
        if "gpt-4" in model:
            pricing = PRICING_CATALOG["gpt-4o"]
        elif "gpt-5" in model:
            pricing = PRICING_CATALOG["gpt-5-mini"]
        elif "claude" in model:
            pricing = PRICING_CATALOG["claude-sonnet-4-6"]
        elif "dall-e" in model:
            pricing = PRICING_CATALOG["dall-e-3"]
        elif "meshy" in model:
            pricing = PRICING_CATALOG["meshy-text-to-3d-preview"]
        else:
            return 0.0 # Unknown model, assume 0 or free
            
    if pricing.per_image:
        return pricing.input_price * image_count
    else:
        # Cost = (Input * InputPrice + Output * OutputPrice) / 1,000,000
        cost = (input_tokens * pricing.input_price + output_tokens * pricing.output_price) / 1_000_000.0
        return round(cost, 6) # Precision
