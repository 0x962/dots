/**
 * The "Core Echo" dot-matrix loader from dotmatrix.zzzzshawn.cloud
 * (github.com/zzzzshawn/matrix, dotm-3x3-6): a 3×3 grid whose dots ripple
 * outward from the center in Manhattan rings. Recreated here with the
 * original timing so it matches the reference; colored by currentColor.
 */
export function CoreEcho({ size = 14 }: { size?: number }) {
	return (
		<span className="core-echo" style={{ width: size, height: size }} aria-hidden>
			{Array.from({ length: 9 }, (_, i) => {
				const ring = Math.abs(Math.floor(i / 3) - 1) + Math.abs((i % 3) - 1);
				return <span key={i} style={{ animationDelay: `${ring * 165}ms` }} />;
			})}
		</span>
	);
}
