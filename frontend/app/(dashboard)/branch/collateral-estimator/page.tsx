"use client";

import { useEffect, useState } from "react";
import { branchCollateralEstimate, type CollateralEstimateResult } from "@/lib/api";
import { Spinner } from "@/components/ui";
import {
  Home,
  MapPin,
  Ruler,
  Car,
  ShieldCheck,
  AlertTriangle,
  Info,
} from "lucide-react";

const LOCATIONS = [
  "Kathmandu",
  "Lalitpur",
  "Pokhara",
  "Bharatpur",
  "Biratnagar",
  "Butwal",
  "Janakpur",
  "Sarlahi",
];

const LOCATION_RATE: Record<string, number> = {
  Kathmandu: 12000,
  Lalitpur: 10500,
  Pokhara: 9000,
  Bharatpur: 7500,
  Biratnagar: 6800,
  Butwal: 6200,
  Janakpur: 5200,
  Sarlahi: 4500,
};

function fmtNpr(v: number) {
  if (v >= 1_000_000) return `NPR ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `NPR ${(v / 1_000).toFixed(1)}K`;
  return `NPR ${Math.round(v).toLocaleString()}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-ink-soft">{label}</label>
        {hint && <span className="text-[10px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, step, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-line bg-canvas py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition px-3"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default function CollateralEstimatorPage() {
  const [assetType, setAssetType] = useState<"land" | "building" | "vehicle">("land");
  const [location, setLocation] = useState("Kathmandu");
  const [areaSqFt, setAreaSqFt] = useState(1200);
  const [marketIndex, setMarketIndex] = useState(1.0);
  const [condition, setCondition] = useState<"excellent" | "good" | "fair" | "poor">("good");
  const [buildingAge, setBuildingAge] = useState(8);
  const [vehicleType, setVehicleType] = useState<"car" | "suv" | "bike" | "truck">("car");
  const [vehicleAge, setVehicleAge] = useState(3);
  const [estimate, setEstimate] = useState<CollateralEstimateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    branchCollateralEstimate({
      asset_type: assetType,
      location,
      area_sqft: areaSqFt,
      market_index: marketIndex,
      condition,
      building_age: buildingAge,
      vehicle_type: vehicleType,
      vehicle_age: vehicleAge,
    })
      .then((res) => {
        if (active) setEstimate(res);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [assetType, location, areaSqFt, marketIndex, condition, buildingAge, vehicleType, vehicleAge]);

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-[#0c1626] to-[#11203A] p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Home size={20} className="opacity-80" />
              <span className="text-sm font-medium opacity-80">Collateral Estimator</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Property Valuation Preview</h1>
            <p className="mt-1 text-cyan-100 text-sm">
              Gradient Boosting style heuristic with location, area, and market index inputs.
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
              <ShieldCheck size={14} className="text-cyan-100" />
              <span className="text-xs font-semibold text-white">Available</span>
            </div>
            <p className="text-[11px] text-cyan-200 mt-1">Branch valuation support</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-5">
            <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-4">Asset Inputs</p>
            <div className="space-y-4">
              <Field label="Collateral Type">
                <select
                  value={assetType}
                  onChange={(e) => setAssetType(e.target.value as "land" | "building" | "vehicle")}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-cyan-400"
                >
                  <option value="land">Land</option>
                  <option value="building">Building</option>
                  <option value="vehicle">Vehicle</option>
                </select>
              </Field>

              <Field label="Location" hint="Market zone">
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full rounded-xl border border-line bg-canvas pl-9 pr-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    {LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </Field>

              {(assetType === "land" || assetType === "building") && (
                <Field label="Area" hint="sq ft">
                  <div className="relative">
                    <Ruler size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <input
                      type="number"
                      value={areaSqFt}
                      min={200}
                      step={50}
                      onChange={(e) => setAreaSqFt(Number(e.target.value))}
                      className="w-full rounded-xl border border-line bg-canvas pl-9 pr-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                  </div>
                </Field>
              )}

              {assetType === "building" && (
                <Field label="Building Age" hint="years">
                  <NumInput value={buildingAge} onChange={setBuildingAge} min={0} max={60} />
                </Field>
              )}

              {assetType === "vehicle" && (
                <>
                  <Field label="Vehicle Type">
                    <div className="relative">
                      <Car size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                      <select
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value as "car" | "suv" | "bike" | "truck")}
                        className="w-full rounded-xl border border-line bg-canvas pl-9 pr-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      >
                        <option value="car">Car</option>
                        <option value="suv">SUV</option>
                        <option value="bike">Bike</option>
                        <option value="truck">Truck</option>
                      </select>
                    </div>
                  </Field>
                  <Field label="Vehicle Age" hint="years">
                    <NumInput value={vehicleAge} onChange={setVehicleAge} min={0} max={20} />
                  </Field>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Market Index" hint="0.7 to 1.3">
                  <NumInput value={marketIndex} onChange={setMarketIndex} min={0.7} max={1.3} step={0.01} />
                </Field>
                <Field label="Condition">
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as "excellent" | "good" | "fair" | "poor")}
                    className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-5">
          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wider">Estimated Value</p>
                <p className="text-3xl font-black text-ink mt-1">
                  {estimate ? fmtNpr(estimate.adjusted_value) : "--"}
                </p>
                <p className="text-xs text-ink-soft mt-1">
                  Range: {estimate ? `${fmtNpr(estimate.range_low)} - ${fmtNpr(estimate.range_high)}` : "--"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink-faint">Confidence</p>
                <p className="text-2xl font-bold text-cyan-700">
                  {estimate ? Math.round(estimate.confidence) : "--"}%
                </p>
                <p className="text-[11px] text-ink-faint mt-0.5">{estimate?.confidence_label ?? "--"}</p>
              </div>
            </div>

            {loading && (
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
                <Spinner size="sm" /> Updating estimate...
              </div>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-600">{error}</div>
            )}

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Max Loan (70% LTV)</p>
                <p className="text-lg font-bold text-ink mt-1">
                  {estimate ? fmtNpr(estimate.max_ltv) : "--"}
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Location Rate</p>
                <p className="text-lg font-bold text-ink mt-1">
                  NPR {(estimate?.location_rate ?? LOCATION_RATE[location]).toLocaleString()}/sq ft
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-ink-faint">Asset Type</p>
                <p className="text-lg font-bold text-ink mt-1 capitalize">{assetType}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Info size={16} className="text-cyan-600" />
              <h2 className="text-sm font-semibold text-ink">Valuation Breakdown</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(estimate?.breakdown ?? []).map((b) => (
                <div key={b.label} className="flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3 text-sm">
                  <span className="text-ink-soft">{b.label}</span>
                  <span className="font-semibold text-ink">{b.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              {(estimate?.notes?.length ?? 0) > 0 ? (
                <AlertTriangle size={16} className="text-amber-500" />
              ) : (
                <ShieldCheck size={16} className="text-emerald-500" />
              )}
              <h2 className="text-sm font-semibold text-ink">Risk Notes</h2>
            </div>
            {(estimate?.notes?.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-soft">No red flags detected. Collateral fits standard criteria.</p>
            ) : (
              <ul className="space-y-2 text-sm text-ink-soft">
                {(estimate?.notes ?? []).map((n, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
