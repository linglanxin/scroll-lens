from __future__ import annotations

import re
from typing import Iterable, Sequence

import jieba

_TOKEN_CLEAN_RE = re.compile(r"[^\w\u4e00-\u9fff]+")


def _compile_alias_pattern(alias_terms: Sequence[str]) -> re.Pattern[str] | None:
    cleaned = sorted({t.strip() for t in alias_terms if t and t.strip()}, key=len, reverse=True)
    if not cleaned:
        return None
    return re.compile("(" + "|".join(re.escape(term) for term in cleaned) + ")")


def segment_with_aliases(text: str, alias_terms: Sequence[str] = ()) -> str:
    """Segment Chinese/English text using jieba cut_for_search while keeping aliases intact."""
    if not text:
        return ""
    pattern = _compile_alias_pattern(alias_terms)
    if pattern is None:
        return " ".join(jieba.cut_for_search(text))

    tokens: list[str] = []
    parts = pattern.split(text)
    alias_set = {t.strip() for t in alias_terms if t and t.strip()}
    for part in parts:
        if not part:
            continue
        if part in alias_set:
            tokens.append(part)
        else:
            tokens.append(" ".join(jieba.cut_for_search(part)))
    return " ".join(tokens)


def tokenize_query_term(term: str, alias_terms: Sequence[str] = ()) -> list[str]:
    """Tokenize a single query term cleanly using jieba.cut (aligns with cut_for_search index)."""
    term = term.strip()
    if not term:
        return []
    alias_set = {t.strip() for t in alias_terms if t and t.strip()}
    if term in alias_set:
        return [term]

    pattern = _compile_alias_pattern(alias_terms)
    tokens: list[str] = []
    if pattern is None:
        for tok in jieba.cut(term, cut_all=False):
            tok_s = tok.strip()
            if tok_s and not _TOKEN_CLEAN_RE.fullmatch(tok_s):
                tokens.append(tok_s)
    else:
        for part in pattern.split(term):
            if not part:
                continue
            if part in alias_set:
                tokens.append(part)
            else:
                for tok in jieba.cut(part, cut_all=False):
                    tok_s = tok.strip()
                    if tok_s and not _TOKEN_CLEAN_RE.fullmatch(tok_s):
                        tokens.append(tok_s)
    return tokens or [term]


def _fts_quote(token: str) -> str:
    safe = token.replace('"', "")
    return f'"{safe}"'


def build_fts_query(
    keywords: Sequence[str],
    alias_groups: Sequence[Sequence[str]] = (),
    match_mode: str = "AND",
) -> str:
    """Build a safe FTS5 MATCH query with automatic alias expansion."""
    all_aliases: list[str] = []
    term_to_group: dict[str, list[str]] = {}
    for group in alias_groups:
        clean_group = [g.strip() for g in group if g and g.strip()]
        if not clean_group:
            continue
        all_aliases.extend(clean_group)
        for item in clean_group:
            term_to_group[item] = clean_group

    clauses: list[str] = []
    for kw in keywords:
        kw_clean = kw.strip()
        if not kw_clean:
            continue
        expanded = term_to_group.get(kw_clean, [kw_clean])
        or_parts: list[str] = []
        for variant in expanded:
            toks = tokenize_query_term(variant, all_aliases)
            if len(toks) == 1:
                or_parts.append(_fts_quote(toks[0]))
            else:
                or_parts.append("(" + " AND ".join(_fts_quote(t) for t in toks) + ")")
        if len(or_parts) == 1:
            clauses.append(or_parts[0])
        else:
            clauses.append("(" + " OR ".join(or_parts) + ")")

    if not clauses:
        return ""
    joiner = " OR " if match_mode.upper() == "OR" else " AND "
    return joiner.join(clauses)


def build_plain_fts_query(keywords: Iterable[str], match_mode: str = "AND") -> str:
    return build_fts_query(list(keywords), alias_groups=(), match_mode=match_mode)
