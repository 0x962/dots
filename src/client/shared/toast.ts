import { create } from "zustand";

export interface Toast {
	id: number;
	text: string;
	kind: "info" | "error";
}

interface ToastStore {
	toasts: Toast[];
	push: (text: string, kind?: Toast["kind"]) => void;
	dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastStore>((set) => ({
	toasts: [],
	push: (text, kind = "info") => {
		const id = ++seq;
		set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
		setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
	},
	dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, kind: Toast["kind"] = "info") =>
	useToasts.getState().push(text, kind);
