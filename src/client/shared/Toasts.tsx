import { useToasts } from "./toast";

export function Toasts() {
	const toasts = useToasts((s) => s.toasts);
	if (toasts.length === 0) return null;
	return (
		<div className="toasts">
			{toasts.map((t) => (
				<div key={t.id} className={`toast ${t.kind}`}>
					{t.text}
				</div>
			))}
		</div>
	);
}
