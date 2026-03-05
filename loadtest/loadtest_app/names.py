from __future__ import annotations

import random

FIRST_NAMES = [
    "Luca", "Giulia", "Marco", "Sofia", "Alessio", "Chiara", "Tommaso", "Elena",
    "Matteo", "Alice", "Davide", "Greta", "Nicol", "Marta", "Samuele", "Francesca",
    "Riccardo", "Noemi", "Andrea", "Giorgia", "Youssef", "Amina", "Nadia", "Edoardo",
]

LAST_NAMES = [
    "Rossi", "Bianchi", "Esposito", "Romano", "Colombo", "Ricci", "Marino", "Greco",
    "Ferrari", "Gallo", "Conti", "Fontana", "Caruso", "Rinaldi", "Lombardi", "Barbieri",
    "Moretti", "Santoro", "Testa", "Farina", "Serra", "Villa", "Leone", "Parisi",
]


def fake_student_name(index: int) -> str:
    rnd = random.Random(index * 7919)
    return f"{rnd.choice(FIRST_NAMES)} {rnd.choice(LAST_NAMES)} {index:03d}"
