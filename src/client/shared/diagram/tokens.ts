import { useEffect, useState } from "react";

function read(names: string[]): Record<string, string> {
	const cs = getComputedStyle(document.documentElement);
	return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
}

/**
 * Resolved values of CSS custom properties, refreshed when the color scheme
 * flips. SVG presentation attributes (minimap fills, edge arrowheads) cannot
 * read var() themselves.
 */
export function useTokens(names: string[]): Record<string, string> {
	const [vals, setVals] = useState(() => read(names));
	useEffect(() => {
		const mq = matchMedia("(prefers-color-scheme: dark)");
		const refresh = () => setVals(read(names));
		mq.addEventListener("change", refresh);
		return () => mq.removeEventListener("change", refresh);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [names.join(",")]);
	return vals;
}

export function fmtDur(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
	if (s >= 60) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
	return `${s}s`;
}

export function fmtCost(usd: number): string {
	return usd >= 0.995 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`;
}
