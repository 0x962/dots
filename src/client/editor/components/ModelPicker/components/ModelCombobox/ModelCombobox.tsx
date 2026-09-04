import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogModel } from "../../../../../../core/harness";

/**
 * Picks one model out of a list too long to scroll. Two hundred models
 * arrive from one provider, so the list is cut into groups by the vendor
 * that made the model: `openai/gpt-5.4` and `openai/o3` sit together under
 * `openai`. A few model names carry no vendor part; those go last, under
 * "other".
 *
 * Typing filters on the whole name, vendor included, so "opus" and
 * "anthropic" both narrow to the Claude models. Up and down walk the
 * filtered list, Enter takes the one under the cursor, Escape closes
 * without changing anything.
 */
export function ModelCombobox({
	models,
	value,
	onPick,
}: {
	models: CatalogModel[];
	value?: string;
	onPick: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const selected = models.find((m) => m.id === value);

	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? models.filter((m) => m.label.toLowerCase().includes(q)) : models;
	}, [models, query]);

	const groups = useMemo(() => groupByVendor(matches), [matches]);

	// A filter that moves the list out from under the cursor would otherwise
	// leave it pointing past the end.
	useEffect(() => setCursor(0), [query]);

	useEffect(() => {
		listRef.current
			?.querySelector('[data-at-cursor="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [cursor]);

	const take = (id: string) => {
		onPick(id);
		setOpen(false);
		setQuery("");
	};

	if (!open) {
		return (
			<button
				type="button"
				className="combo-value"
				onClick={() => {
					setOpen(true);
					setCursor(Math.max(0, matches.findIndex((m) => m.id === value)));
				}}
			>
				{selected ? selected.label : "no model"}
			</button>
		);
	}

	return (
		<>
			<div className="pop-veil" onClick={() => setOpen(false)} />
			<div className="combo">
				{/* biome-ignore lint/a11y/noAutofocus: opening the list is the request to type in it */}
				<input
					autoFocus
					className="input combo-search"
					value={query}
					placeholder={`search ${models.length} models…`}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setCursor((c) => Math.min(c + 1, matches.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setCursor((c) => Math.max(c - 1, 0));
						} else if (e.key === "Enter") {
							e.preventDefault();
							const pick = matches[cursor];
							if (pick) take(pick.id);
						} else if (e.key === "Escape") {
							e.preventDefault();
							setOpen(false);
						}
					}}
				/>
				<div className="combo-list" ref={listRef}>
					{matches.length === 0 && (
						<div className="combo-empty">nothing matches "{query}"</div>
					)}
					{groups.map((group) => (
						<div key={group.vendor}>
							<div className="combo-group">
								{group.vendor} <span>{group.models.length}</span>
							</div>
							{group.models.map((m) => {
								const at = matches.indexOf(m) === cursor;
								return (
									<button
										type="button"
										key={m.id}
										data-at-cursor={at}
										className={`combo-row${at ? " at" : ""}${m.id === value ? " picked" : ""}`}
										onMouseEnter={() => setCursor(matches.indexOf(m))}
										onClick={() => take(m.id)}
									>
										<span className="combo-name">{shortName(m.label)}</span>
										<span className="combo-meta">
											{m.contextWindow ? formatTokens(m.contextWindow) : ""}
											{m.thinks ? " · thinks" : ""}
										</span>
									</button>
								);
							})}
						</div>
					))}
				</div>
			</div>
		</>
	);
}

/** `openai/gpt-5.4` is listed under `openai` as `gpt-5.4`. */
function vendorOf(label: string): string {
	return label.includes("/") ? label.split("/")[0] : "other";
}

function shortName(label: string): string {
	return label.includes("/") ? label.slice(label.indexOf("/") + 1) : label;
}

function groupByVendor(
	models: CatalogModel[],
): Array<{ vendor: string; models: CatalogModel[] }> {
	const byVendor = new Map<string, CatalogModel[]>();
	for (const m of models) {
		const vendor = vendorOf(m.label);
		const list = byVendor.get(vendor);
		if (list) list.push(m);
		else byVendor.set(vendor, [m]);
	}
	return [...byVendor.entries()]
		.map(([vendor, list]) => ({ vendor, models: list }))
		// "other" holds the names with no vendor part, so it goes last.
		.sort((a, b) =>
			a.vendor === "other"
				? 1
				: b.vendor === "other"
					? -1
					: a.vendor.localeCompare(b.vendor),
		);
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
	return String(n);
}
