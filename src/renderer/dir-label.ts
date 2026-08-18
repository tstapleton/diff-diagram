// Shared label format for every directory-representing box (subdir container,
// stub, clustered directory node): an icon signaling how much of the
// directory is visible, plus the true total member count, so a partially
// or fully collapsed box never reads as if it were the whole directory.

export type DirState = "open" | "partial" | "closed";

const ICONS: Record<DirState, string> = {
	open: "○",
	partial: "◐",
	closed: "●",
};

export function formatDirLabel(
	state: DirState,
	name: string,
	total: number,
): string {
	return `${ICONS[state]} ${name} (${total})`;
}
