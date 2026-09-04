import { useEffect, useState } from "react";
import type { CatalogModel, HarnessId } from "../../../../core/harness";

export interface HarnessCatalog {
	id: HarnessId;
	label: string;
	efforts: string[];
	models: CatalogModel[];
	noModelsHint: string;
}

/**
 * What each harness can run, asked once per editor session. The server
 * builds this by running `pi --list-models`, so the answer is whatever pi
 * really reaches on this machine today, not a list written down in the
 * editor. An empty model list means pi has no key for any provider.
 */
let pending: Promise<HarnessCatalog[]> | null = null;

function load(refresh: boolean): Promise<HarnessCatalog[]> {
	if (!refresh && pending) return pending;
	pending = fetch(`/api/harnesses${refresh ? "?refresh=1" : ""}`)
		.then((r) => r.json())
		.then((body: { harnesses: HarnessCatalog[] }) => body.harnesses);
	return pending;
}

export function useHarnessCatalog(): {
	catalogs: HarnessCatalog[];
	loading: boolean;
	refresh: () => void;
} {
	const [catalogs, setCatalogs] = useState<HarnessCatalog[]>([]);
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		let live = true;
		setLoading(true);
		load(tick > 0).then((next) => {
			if (!live) return;
			setCatalogs(next);
			setLoading(false);
		});
		return () => {
			live = false;
		};
	}, [tick]);

	return { catalogs, loading, refresh: () => setTick((n) => n + 1) };
}
