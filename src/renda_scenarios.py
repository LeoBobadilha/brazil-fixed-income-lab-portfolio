"""Tesouro Renda+ 2065 rate-shock scenarios for a hypothetical purchase.

Renda+ 2065 has its first payment on 15/01/2065 and its final payment on 15/12/2084
(the dataset maturity). The example uses a generic R$ 10,000 purchase at the latest
observed price, the official cash-flow model (240 amortisations, du/252) and a sale at
the observed sell rate plus each shock.

    python -m src.renda_scenarios
"""

from __future__ import annotations

from datetime import date

import duckdb

from src.config import DUCKDB_PATH
from src.pricing import scenario as S

SECURITY = "RENDA-20841215"  # Tesouro Renda+ Aposentadoria Extra 2065
EXAMPLE_AMOUNT = 10_000.0  # hypothetical example
SHOCKS_BP = [-300, -200, -100, -50, 0, 50, 100, 200]


def main(horizon_years: float = 3.0, inflation_pa: float = 4.0) -> None:
    with duckdb.connect(str(DUCKDB_PATH), read_only=True) as con:
        q = con.execute(
            "SELECT * FROM fact_quotes WHERE security_id = ? ORDER BY base_date DESC LIMIT 1", [SECURITY]).df().iloc[0]
        vna = con.execute(
            "SELECT vna_consensus FROM vna_daily WHERE indexer='ipca' AND side='base' AND base_date = ?", [q["base_date"]]
        ).fetchone()[0]
    d0 = q["base_date"].date()
    print(f"Renda+ 2065 ({SECURITY}) on {d0}: buy IPCA+{q['buy_rate']:.2f}% at R$ {q['buy_price']:.2f}, sell IPCA+{q['sell_rate']:.2f}%")
    print(f"Hypothetical purchase R$ {EXAMPLE_AMOUNT:,.0f}; sale after {horizon_years:g} years; IPCA assumption {inflation_pa:g}% p.a.\n")
    print(f"{'shock bp':>9}{'exit rate':>11}{'gross R$':>12}{'net R$':>12}{'net % p.a.':>12}{'real % p.a.':>12}")
    for s in SHOCKS_BP:
        r = S.run(S.ScenarioInput(product_code="RENDA", maturity=date(2084, 12, 15), valuation_date=d0,
                                  buy_price=float(q["buy_price"]), buy_rate=float(q["buy_rate"]), sell_rate=float(q["sell_rate"]),
                                  vna0=float(vna), amount=EXAMPLE_AMOUNT, horizon_years=horizon_years, shock_bp=s,
                                  inflation_pa=inflation_pa))
        print(f"{s:>9}{r.exit_rate:>11.2f}{r.gross_value:>12,.0f}{r.net_value:>12,.0f}{r.net_return_pa_pct:>12.2f}{r.real_net_return_pa_pct:>12.2f}")
    print("\nScenarios are hypothetical illustrations, not forecasts.")


if __name__ == "__main__":
    main()
