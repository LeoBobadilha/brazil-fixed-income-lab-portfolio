-- Analytical views over the Brazil Fixed Income Lab DuckDB model.
-- Legacy view names (vw_monthly_rates, vw_latest_prices, vw_annual_rate_summary)
-- are preserved with date-aware security identifiers.

CREATE OR REPLACE VIEW vw_latest_prices AS
SELECT s.security_id, s.display_name, s.product_code, s.family, s.indexer, s.maturity_date, s.conversion_date,
       q.base_date, q.buy_rate, q.sell_rate, q.buy_price, q.sell_price, q.base_price,
       ROUND((q.sell_rate - q.buy_rate) * 100, 2) AS rate_spread_bp
FROM fact_quotes q
JOIN dim_security s USING (security_id)
WHERE q.base_date = (SELECT MAX(base_date) FROM fact_quotes);

CREATE OR REPLACE VIEW vw_monthly_rates AS
SELECT strftime(q.base_date, '%Y-%m') AS year_month, s.security_id, s.display_name, s.product_code, s.family,
       AVG(q.buy_rate) AS avg_buy_rate, AVG(q.sell_rate) AS avg_sell_rate,
       AVG(q.sell_rate - q.buy_rate) AS avg_rate_spread, COUNT(*) AS observations,
       arg_max(q.buy_rate, q.base_date) AS month_end_buy_rate
FROM fact_quotes q JOIN dim_security s USING (security_id)
GROUP BY ALL;

CREATE OR REPLACE VIEW vw_annual_rate_summary AS
SELECT strftime(q.base_date, '%Y') AS year, s.security_id, s.display_name, s.product_code,
       AVG(q.buy_rate) AS avg_buy_rate, MIN(q.buy_rate) AS min_buy_rate, MAX(q.buy_rate) AS max_buy_rate,
       COUNT(*) AS total_records
FROM fact_quotes q JOIN dim_security s USING (security_id)
GROUP BY ALL;

-- Reconciliation quality by product and year (official vs modelled prices)
CREATE OR REPLACE VIEW vw_reconciliation_by_year AS
SELECT product_code, year(base_date) AS year, side, COUNT(*) AS rows,
       AVG(CASE WHEN abs(price_error) < 0.005 THEN 1 ELSE 0 END) AS exact_share,
       AVG(CASE WHEN abs(price_error) <= 0.0100001 THEN 1 ELSE 0 END) AS within_1c_share,
       MAX(abs(price_error)) AS max_abs_error
FROM fact_valuation
GROUP BY ALL;

-- Duration-bucketed curve on each date (purchase rates)
CREATE OR REPLACE VIEW vw_curve AS
SELECT q.base_date, s.security_id, s.display_name, s.family, s.product_code,
       r.years_to_last_flow, r.macaulay, r.modified, q.buy_rate
FROM fact_quotes q
JOIN dim_security s USING (security_id)
JOIN fact_risk r ON r.security_id = q.security_id AND r.base_date = q.base_date;

-- Month-end macro observations
CREATE OR REPLACE VIEW vw_macro_month_end AS
SELECT series, date_trunc('month', date) AS month, arg_max(value, date) AS value, MAX(date) AS reference_date
FROM macro_series
GROUP BY ALL;
