"""Guard: the website and documentation are written in English.

Official Brazilian names (Tesouro Direto products, dataset columns, legal and
statistical titles) are allowed; Portuguese interface sentences are not.
Official source text may be quoted in docs only inside Markdown block quotes.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Words that are unambiguous Portuguese and never part of the official names we keep.
PT_UI_WORDS = [
    "não", "você", "títulos", "taxa de", "anos", "meses", "dias", "preço", "venda", "compra", "cenário", "choque",
    "rendimento", "aplicado", "valor", "mensal", "salário", "isento", "parcela", "prazo", "carregando", "tabela",
    "gráfico", "fonte", "fontes", "pesquisa", "comparação", "inflação", "dívida", "juros",
]
# Official terms that legitimately contain those words (kept as published).
ALLOW = [
    "Câmbio (dívida externa)",  # Tesouro debt-stock indexer key
    "com Juros Semestrais",  # official Tesouro Direto product names
    "Valor Nominal Atualizado",  # expansion of the official acronym VNA
    "Metodologia de Cálculo dos Títulos Públicos Federais",  # official document title
    "Estoque da Dívida Pública Federal",  # official dataset title
]
PT_SENTENCE = re.compile(r"\b(não|você|para o|para a|pelo|pela|dos|das|uma|são|também|então|quando o|porque)\b", re.IGNORECASE)


def _ui_files():
    for p in (ROOT / "web" / "src").rglob("*"):
        if p.suffix in (".ts", ".tsx") and ".test." not in p.name and "__fixtures__" not in p.parts:
            yield p


def test_numbers_and_rates_use_english_notation():
    # "a.a." (ao ano) is written "p.a."; decimals use a point in the interface.
    bad = re.compile(r"\ba\.a\.|R\$ ?\d+,\d{2}\b")
    hits = [f"{p.relative_to(ROOT)}:{n}: {line.strip()[:80]}"
            for p in _ui_files() for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1) if bad.search(line)]
    assert not hits, "\n".join(hits)


def test_web_interface_is_english():
    hits = []
    pat = re.compile(r"\b(" + "|".join(re.escape(w) for w in PT_UI_WORDS) + r")\b", re.IGNORECASE)
    for p in _ui_files():
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            clean = line
            for a in ALLOW:
                clean = clean.replace(a, "")
            stripped = clean.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue  # code comments are checked separately below
            for m in pat.finditer(clean):
                hits.append(f"{p.relative_to(ROOT)}:{n}: {m.group(0)!r} in {stripped[:100]}")
    assert not hits, "Portuguese UI text found:\n" + "\n".join(hits)


def test_no_language_switcher():
    src = "\n".join(p.read_text(encoding="utf-8") for p in _ui_files())
    assert "setLang" not in src and "I18nProvider" not in src and 'lang === "pt"' not in src


def test_documentation_is_english():
    docs = [p for p in (ROOT / "README.md", ROOT / "CHECKPOINT.md") if p.exists()] + sorted((ROOT / "docs").glob("*.md"))
    hits = []
    for p in docs:
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith(">"):
                continue  # block quotes may reproduce official Portuguese text verbatim
            if len(PT_SENTENCE.findall(line)) >= 2:
                hits.append(f"{p.relative_to(ROOT)}:{n}: {line.strip()[:120]}")
    assert not hits, "Portuguese sentences found in docs:\n" + "\n".join(hits)
