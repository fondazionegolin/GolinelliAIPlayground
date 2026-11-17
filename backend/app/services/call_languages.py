"""Languages offered for translating call/recording transcripts (and speaking them).

Curated for schools that welcome students who do not speak Italian yet. `native` is shown next to the name so a
student's family can recognise it. Speech is attempted for every language: ElevenLabs when its models cover the
code, otherwise (or when ElevenLabs is down) a fallback model on OpenRouter that detects the language by itself.
"""
LANGUAGES: list[dict[str, str]] = [
    {"code": "en", "name": "Inglese", "native": "English"},
    {"code": "fr", "name": "Francese", "native": "Français"},
    {"code": "es", "name": "Spagnolo", "native": "Español"},
    {"code": "de", "name": "Tedesco", "native": "Deutsch"},
    {"code": "pt", "name": "Portoghese", "native": "Português"},
    {"code": "ro", "name": "Rumeno", "native": "Română"},
    {"code": "sq", "name": "Albanese", "native": "Shqip"},
    {"code": "uk", "name": "Ucraino", "native": "Українська"},
    {"code": "ru", "name": "Russo", "native": "Русский"},
    {"code": "ar", "name": "Arabo", "native": "العربية"},
    {"code": "zh", "name": "Cinese", "native": "中文"},
    {"code": "hi", "name": "Hindi", "native": "हिन्दी"},
    {"code": "bn", "name": "Bengalese", "native": "বাংলা"},
    {"code": "ur", "name": "Urdu", "native": "اردو"},
    {"code": "pa", "name": "Punjabi", "native": "ਪੰਜਾਬੀ"},
    {"code": "tl", "name": "Tagalog (filippino)", "native": "Tagalog"},
    {"code": "tr", "name": "Turco", "native": "Türkçe"},
    {"code": "fa", "name": "Persiano", "native": "فارسی"},
    {"code": "pl", "name": "Polacco", "native": "Polski"},
    {"code": "bg", "name": "Bulgaro", "native": "Български"},
    {"code": "hr", "name": "Croato", "native": "Hrvatski"},
    {"code": "sr", "name": "Serbo", "native": "Српски"},
    {"code": "mk", "name": "Macedone", "native": "Македонски"},
    {"code": "el", "name": "Greco", "native": "Ελληνικά"},
    {"code": "nl", "name": "Olandese", "native": "Nederlands"},
    {"code": "sv", "name": "Svedese", "native": "Svenska"},
    {"code": "da", "name": "Danese", "native": "Dansk"},
    {"code": "no", "name": "Norvegese", "native": "Norsk"},
    {"code": "fi", "name": "Finlandese", "native": "Suomi"},
    {"code": "cs", "name": "Ceco", "native": "Čeština"},
    {"code": "sk", "name": "Slovacco", "native": "Slovenčina"},
    {"code": "sl", "name": "Sloveno", "native": "Slovenščina"},
    {"code": "hu", "name": "Ungherese", "native": "Magyar"},
    {"code": "ja", "name": "Giapponese", "native": "日本語"},
    {"code": "ko", "name": "Coreano", "native": "한국어"},
    {"code": "vi", "name": "Vietnamita", "native": "Tiếng Việt"},
    {"code": "id", "name": "Indonesiano", "native": "Bahasa Indonesia"},
    {"code": "th", "name": "Thailandese", "native": "ไทย"},
    {"code": "ta", "name": "Tamil", "native": "தமிழ்"},
    {"code": "sw", "name": "Swahili", "native": "Kiswahili"},
    {"code": "he", "name": "Ebraico", "native": "עברית"},
]
BY_CODE = {item["code"]: item for item in LANGUAGES}
# The source language of recordings.
SOURCE = {"code": "it", "name": "Italiano", "native": "Italiano"}


def language_name(code: str) -> str:
    item = BY_CODE.get(code) or (SOURCE if code == SOURCE["code"] else None)
    return item["name"] if item else code
