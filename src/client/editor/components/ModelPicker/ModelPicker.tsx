import { useState } from "react";
import type { HarnessId } from "../../../../core/harness";
import type { HarnessCatalog } from "../../hooks/useHarnessCatalog";

/**
 * Picks what one node's agent runs on: the harness (the coding-agent CLI),
 * the provider that serves the model, the model, and how hard it thinks.
 *
 * The provider is the first segment of the model string pi is given
 * (`vercel-ai-gateway/meta/muse-spark-1.1`), so it is shown as its own
 * dropdown but never stored on its own. Claude reaches one provider, so its
 * provider row is left out.
 *
 * Effort is greyed out on a model whose thinking column says no, and its
 * levels come from the harness: claude runs low through max, pi runs off
 * through xhigh. Neither set is translated into the other, so changing the
 * harness clears both the model and the effort.
 */
export interface ModelChoice {
	harness?: HarnessId;
	model?: string;
	effort?: string;
}

export function ModelPicker({
	value,
	fallbackHarness,
	catalogs,
	loading,
	onChange,
	onRefresh,
}: {
	value: ModelChoice;
	/** The harness this node inherits when it names none. */
	fallbackHarness: HarnessId;
	catalogs: HarnessCatalog[];
	loading: boolean;
	onChange: (patch: ModelChoice) => void;
	onRefresh: () => void;
}) {
	const activeId = value.harness ?? fallbackHarness;
	const catalog = catalogs.find((c) => c.id === activeId);
	const models = catalog?.models ?? [];

	const providers = [...new Set(models.map((m) => m.provider))].sort();
	const multiProvider = providers.length > 1;
	// The provider is not stored: it is the first segment of the model
	// string. Browsing providers before picking a model is the one time it
	// has to live somewhere, so it lives here until a model is chosen.
	const [browsing, setBrowsing] = useState<string | null>(null);
	const chosenProvider = models.find((m) => m.id === value.model)?.provider;
	const provider = browsing ?? chosenProvider ?? providers[0] ?? "";
	const shown = multiProvider
		? models.filter((m) => m.provider === provider)
		: models;

	const selected = models.find((m) => m.id === value.model);
	const canThink = !selected || selected.thinks;

	return (
		<>
			<div className="field">
				<label>Harness</label>
				<select
					className="select"
					value={value.harness ?? ""}
					onChange={(e) => {
						setBrowsing(null);
						onChange({
							harness: (e.target.value || undefined) as HarnessId | undefined,
							model: undefined,
							effort: undefined,
						});
					}}
				>
					<option value="">
						Graph default (
						{catalogs.find((c) => c.id === fallbackHarness)?.label ?? fallbackHarness})
					</option>
					{catalogs.map((c) => (
						<option key={c.id} value={c.id}>
							{c.label}
						</option>
					))}
				</select>
				<span className="hint">the coding-agent CLI this node's agent runs in</span>
			</div>

			{multiProvider && (
				<div className="field">
					<label>Provider</label>
					<select
						className="select"
						value={provider}
						onChange={(e) => {
							setBrowsing(e.target.value);
							// The old model belongs to the old provider.
							onChange({ ...value, model: undefined, effort: undefined });
						}}
					>
						{providers.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</select>
					<span className="hint">
						{shown.length} of {models.length} models
					</span>
				</div>
			)}

			<div className="field">
				<label>Model</label>
				<select
					className="select"
					value={value.model ?? ""}
					onChange={(e) =>
						onChange({ ...value, model: e.target.value || undefined })
					}
				>
					<option value="">Default ({catalog?.label ?? activeId} picks)</option>
					{shown.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
				<span className="hint">
					{loading
						? "asking the harness what it can reach…"
						: models.length === 0
							? (catalog?.noModelsHint ?? "no models")
							: describe(selected)}
				</span>
			</div>

			<div className="field">
				<label>Effort</label>
				<select
					className="select"
					value={value.effort ?? ""}
					disabled={!canThink}
					onChange={(e) =>
						onChange({ ...value, effort: e.target.value || undefined })
					}
				>
					<option value="">Default ({catalog?.label ?? activeId} picks)</option>
					{(catalog?.efforts ?? []).map((level) => (
						<option key={level} value={level}>
							{level}
						</option>
					))}
				</select>
				<span className="hint">
					{canThink
						? "how hard the model thinks before it answers"
						: `${selected?.label} has no thinking mode`}
				</span>
			</div>

			<button type="button" className="btn ghost sm" onClick={onRefresh}>
				Reload the model list
			</button>
		</>
	);
}

function describe(model?: { contextWindow?: number; thinks: boolean }): string {
	if (!model) return "the model this node's agent runs on";
	const parts: string[] = [];
	if (model.contextWindow) parts.push(`${formatTokens(model.contextWindow)} context`);
	parts.push(model.thinks ? "thinks" : "no thinking mode");
	return parts.join(" · ");
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
	return String(n);
}
