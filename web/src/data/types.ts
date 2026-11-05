import type { Family, ProductCode } from "../engine/instruments";

export interface Security {
  id: string; code: ProductCode; name_pt: string; name_en: string; product_pt: string; product_en: string;
  instrument: string; family: Family; indexer: string; coupon: string; modelled: boolean;
  maturity: string; conversion: string | null; year: number; first: string; last: string; obs: number; active: boolean;
}

export interface Percentile { percentile: number | null; observations: number; start?: string; valid: boolean }

export interface LatestRow {
  id: string; buy_rate: number | null; sell_rate: number | null; buy_price: number | null; sell_price: number | null;
  base_price: number | null; spread_bp: number | null; change_bp: Record<string, number | null>; percentile: Percentile;
  days_to_maturity: number; days_to_conversion: number | null; hist_min: number; hist_max: number; hist_mean: number;
  buy_offered: boolean; macaulay?: number; modified?: number; convexity?: number; dv01_brl?: number; years_to_last_flow?: number;
}

export interface VnaPoint { consensus: number | null; independent: number | null; single_vna_consistent: boolean }

export interface Latest {
  date: string;
  reference_dates: Record<string, string | null>;
  rows: LatestRow[];
  vna: Record<"ipca" | "selic", Record<"base" | "buy" | "sell", VnaPoint>>;
}

export interface Manifest {
  schema_version: number; snapshot_id: string; generated_at: string; data_as_of: string; status: "current" | "stale";
  business_days_since_data: number; failed_sources: string[];
  sources: Record<string, { status?: string; last_success_at?: string; source_published_at?: string; url?: string; error?: string; failed_at?: string }>;
  source_freshness?: Record<string, { reference_date: string | null; stale: boolean; stale_reason: string | null }>;
  freshness_thresholds?: Record<string, number>;
  licences: Record<string, { publisher: string; licence: string; landing: string }>;
  counts: { quotes: number; securities: number; active_securities: number };
}

export interface History {
  id: string; d: number[]; br: (number | null)[]; sr: (number | null)[]; bp: (number | null)[]; sp: (number | null)[];
  mac: (number | null)[]; mod: (number | null)[]; cvx: (number | null)[]; dv01: (number | null)[];
}

export interface DecodedHistory {
  id: string; dates: string[]; buyRate: (number | null)[]; sellRate: (number | null)[]; buyPrice: (number | null)[];
  sellPrice: (number | null)[]; macaulay: (number | null)[]; modified: (number | null)[]; convexity: (number | null)[]; dv01: (number | null)[];
}

export interface Curves { dates: string[]; curves: Record<string, [string, number, number, number][]> }

export interface Benchmarks { d: number[]; series: Record<string, (number | null)[]>; notes: Record<string, string> }

export interface MacroSeries { sgs_id: number; title: string; unit: string; frequency: string; reference_date: string; fetched_at?: string; dates: string[]; values: (number | null)[] }

export interface Macro {
  series: Record<string, MacroSeries>;
  focus: {
    survey_date: string; note: string;
    latest: { indicator: string; year: number; median: number; min: number; max: number; respondents: number | null }[];
    history: Record<string, { dates: string[]; median: number[] }>;
  };
}

export interface Debt {
  months: string[]; indexers: string[]; stock_bn: Record<string, number[]>; total_bn: number[];
  avg_years_to_final_maturity: number[]; share_maturing_12m_pct: number[]; latest_month: string;
  maturity_profile_bn: Record<string, number>; notes: Record<string, string>;
}

export interface WindowRow { window: string; days: number; mean_change_bp: number; std_bp: number; diff_vs_rest_bp: number; t_stat: number; p_value: number; p_perm: number; p_holm: number; significant_5pct: boolean }

export interface Research {
  calendar: {
    universe: string;
    windows: { rows: WindowRow[]; start: string; end: string; n_days: number };
    out_of_sample: { split_date: string; in_sample_best_window: string; in_sample_means_bp: Record<string, number>; oos_diff_vs_rest_bp: number; oos_t: number; oos_p: number; oos_supported: boolean };
    business_day_edges: { position: string; days: number; mean_change_bp: number }[];
    legacy_metric: { rows: { window: string; mean_deviation_bp: number; days: number }[]; caveat: string };
  };
  percentiles: Record<string, Percentile & { last: number | null }>;
  regimes: Record<string, { bounds: number[]; horizon_business_days: number; rows: { regime: string; days: number; obs_with_forward: number; effective_independent_obs: number; mean_change_bp: number | null; median_change_bp: number | null; share_rate_fell: number | null }[] }>;
  drawdowns: { id: string; max_drawdown_pct: number; peak_date: string; trough_date: string; recovery_date: string | null; days_peak_to_trough: number; obs: number }[];
  daily_changes: Record<string, { n: number; std_bp: number; p01_bp: number; p99_bp: number; max_rise_bp: number; max_fall_bp: number; hist: number[] }>;
  slope_episodes: { threshold_bp: number; months: number; steepening: string[]; flattening: string[] };
}

export interface ReconRow { product_code: string; rows: number; exact_pct: number; within_1c_pct: number; within_2c_pct: number; max_abs_error: number; first: string; last: string }

export interface Reconciliation {
  by_product: ReconRow[];
  by_year: Record<string, Record<string, number | null>>;
  single_vna_consistent_by_year: Record<string, Record<string, number | null>>;
  independent_vna_diff_bp: Record<string, Record<string, number | null>>;
  lft_spread_precision_bp_by_year: Record<string, Record<string, number | null>>;
  largest_errors: { id: string; date: string; side: string; rate: number; official: number; model: number; error: number }[];
  validation_categories?: { id: string; title: string; what: string; independence: string }[];
  independent_nominal?: Record<string, { rows: number; within_1c_pct: number }>;
  conventions: Record<string, string>;
}

/** Written by the deploy workflow (scripts/write_build_info.py); absent in local builds. */
export interface BuildInfo {
  commit: string; trigger: "code" | "data" | "manual"; built_at: string; workflow?: string;
  run_id?: string; run_attempt?: string; run_url?: string | null; snapshot_id?: string; data_as_of?: string;
}

export interface QualityCheck { name: string; severity: "error" | "warn"; passed: boolean; detail: string }

export interface VnaHistory { d: number[]; ipca: (number | null)[]; selic: (number | null)[]; ipca_consistent: (boolean | null)[]; note: string }
