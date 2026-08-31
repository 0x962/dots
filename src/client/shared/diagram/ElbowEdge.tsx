import { BaseEdge, type EdgeProps } from "@xyflow/react";

/**
 * Orthogonal connector: straight down when the two ends line up, otherwise
 * down from the source, one horizontal run at the halfway height, and down
 * into the target. Corners are rounded. Two branches that point at the same
 * node meet on the target's vertical, so a merge reads like a flowchart join.
 */
export function ElbowEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
	const dx = targetX - sourceX;
	let path: string;
	if (Math.abs(dx) < 0.75) {
		path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
	} else {
		const midY = (sourceY + targetY) / 2;
		const dir = dx > 0 ? 1 : -1;
		const r = Math.max(
			0,
			Math.min(7, Math.abs(dx) / 2, Math.abs(midY - sourceY), Math.abs(targetY - midY)),
		);
		path = [
			`M ${sourceX} ${sourceY}`,
			`L ${sourceX} ${midY - r}`,
			`Q ${sourceX} ${midY} ${sourceX + dir * r} ${midY}`,
			`L ${targetX - dir * r} ${midY}`,
			`Q ${targetX} ${midY} ${targetX} ${midY + r}`,
			`L ${targetX} ${targetY}`,
		].join(" ");
	}
	return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
