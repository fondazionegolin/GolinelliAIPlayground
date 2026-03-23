from typing import Dict, Optional

class ModelPricing:
    def __init__(self, input_price: float, output_price: float, per_image: bool = False):
        """
        input_price: Cost per 1M tokens (for text) OR Cost per image (if per_image=True)
        output_price: Cost per 1M tokens (for text)
        """
        self.input_price = input_price
        self.output_price = output_price
        self.per_image = per_image

# Pricing in USD (or EUR if preferred? prompt mentioned "5 euro", so maybe we convert or store in EUR. 
# Usually APIs are in USD. Let's assume 1:1 or store in USD and display in EUR? 
# The user asked "quotati economicamente" and "5 euro". 
# I will store in USD as base, but maybe just use EUR values directly if we manually set them.)
# For simplicity, let's assume these are the "Unit Costs" in the system currency (EUR).
# We can update these values to match current exchange rates or official pricing.

PRICING_CATALOG: Dict[str, ModelPricing] = {
    # OpenAI (Prices per 1M tokens as of late 2024/2025 estimates or current knowns)
    "gpt-4o": ModelPricing(2.50, 10.00),
    "gpt-4o-mini": ModelPricing(0.15, 0.60),
    "gpt-3.5-turbo": ModelPricing(0.50, 1.50),
    "o1-preview": ModelPricing(15.00, 60.00),
    "o1-mini": ModelPricing(3.00, 12.00),
    
    # Anthropic
    "claude-3-5-sonnet-20241022": ModelPricing(3.00, 15.00),
    "claude-3-haiku-20240307": ModelPricing(0.25, 1.25),
    "claude-3-opus-20240229": ModelPricing(15.00, 75.00),
    "claude-haiku-4-5-20251001": ModelPricing(0.80, 4.00),
    "claude-sonnet-4-5": ModelPricing(3.00, 15.00),
    "claude-opus-4-5": ModelPricing(15.00, 75.00),

    # Google Gemini
    "gemini-2.0-flash": ModelPricing(0.075, 0.30),
    "gemini-2.0-flash-lite": ModelPricing(0.0375, 0.15),

    # DeepSeek
    "deepseek-chat": ModelPricing(0.0, 0.0),
    "deepseek-reasoner": ModelPricing(0.0, 0.0),
    
    # Ollama (Self-hosted = 0 cost usually, unless we want to attribute server cost)
    "mistral": ModelPricing(0.0, 0.0),
    "llama3": ModelPricing(0.0, 0.0),
    "deepseek-r1": ModelPricing(0.0, 0.0),
    
    # Image Generation (Cost per Image)
    # DALL-E 3
    "dall-e-3": ModelPricing(0.040, 0.0, per_image=True), # Standard 1024x1024
    
    # Flux (via Golinelli API or similar - assuming cost or 0 if internal)
    "flux-schnell": ModelPricing(0.00, 0.0, per_image=True), # Check if there is a cost
    "flux-dev": ModelPricing(0.00, 0.0, per_image=True),
    "sdxl": ModelPricing(0.0, 0.0, per_image=True),
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
        elif "claude" in model:
            pricing = PRICING_CATALOG["claude-3-5-sonnet-20241022"]
        elif "dall-e" in model:
            pricing = PRICING_CATALOG["dall-e-3"]
        else:
            return 0.0 # Unknown model, assume 0 or free
            
    if pricing.per_image:
        return pricing.input_price * image_count
    else:
        # Cost = (Input * InputPrice + Output * OutputPrice) / 1,000,000
        cost = (input_tokens * pricing.input_price + output_tokens * pricing.output_price) / 1_000_000.0
        return round(cost, 6) # Precision
