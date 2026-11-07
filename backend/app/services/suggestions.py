"""Suggested questions generated from the documents' own distinctive words. No AI is involved.

The template deliberately uses only stopwords around the term ("Tell me about X"), so the term is the whole
query and every suggestion is guaranteed to pass the evidence test."""
import math
import re
from collections import Counter

from sqlalchemy.orm import Session

from app.rag.retrieval import load_scope, tokenize

# Same word boundaries as the search tokenizer (letters AND digits), so every candidate term is guaranteed to be a
# token the document-frequency table knows about. A different pattern once crashed on text like "Selfridge1".
_RAW_TOKEN = re.compile(r"[A-Za-z0-9]+")
MIN_WORD_CHARS = 5


def suggest_questions(session: Session, collection_id: int | None = None, limit: int = 4) -> list[dict]:
    corpus = load_scope(session, collection_id, None)
    if not corpus:
        return []
    doc_freq: Counter[str] = Counter()
    total: Counter[str] = Counter()
    surface: dict[str, Counter[str]] = {}
    for chunk, _ in corpus:
        tokens = tokenize(chunk.text)
        total.update(tokens)
        doc_freq.update(set(tokens))
        for raw in _RAW_TOKEN.findall(chunk.text):
            if raw.isalpha() and len(raw) >= MIN_WORD_CHARS:  # real words only: skip codes like "abcde1" or "1978133"
                stems = tokenize(raw)
                if stems:
                    surface.setdefault(stems[0], Counter())[raw.lower()] += 1
    n = len(corpus)
    scored = sorted(((total[t] * math.log(1 + n / doc_freq[t]), t) for t in surface if doc_freq.get(t)), reverse=True)
    picked: list[dict] = []
    seen_words: set[str] = set()
    for _, stem in scored:
        word = surface[stem].most_common(1)[0][0]
        if word in seen_words or any(word.startswith(w[:5]) for w in seen_words):
            continue
        seen_words.add(word)
        picked.append({"term": word, "question": f"Tell me about {word}"})
        if len(picked) == limit:
            break
    return picked