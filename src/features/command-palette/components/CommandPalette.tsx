import { useEffect, useMemo, useRef, useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { X } from "lucide-react";
import { SHORTCUT_REGISTRY, type Platform } from "../../../app/shortcut-registry";
import { useCommands } from "../hooks/use-command-registry";
import { matchCommands } from "../logic/command-match";
import type { Command } from "../logic/command";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	platform: Platform;
}

const KEY_BY_ID = Object.fromEntries(SHORTCUT_REGISTRY.map((s) => [s.id, s]));

function keyHint(command: Command, platform: Platform): string | null {
	if (!command.keybindingId) return null;
	const entry = KEY_BY_ID[command.keybindingId];
	if (!entry) return null;
	return platform === "mac" ? entry.mac : entry.other;
}

export function CommandPalette({ open, onOpenChange, platform }: Props) {
	const allCommands = useCommands();
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const selectedRowRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);

	const rows = useMemo(() => {
		const available = allCommands.filter((c) => c.isAvailable?.() ?? true);
		return matchCommands(query, available);
	}, [allCommands, query]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [query, open]);

	useEffect(() => {
		if (selectedIndex >= rows.length && rows.length > 0) {
			setSelectedIndex(rows.length - 1);
		}
	}, [rows.length, selectedIndex]);

	// Keep the active row visible as ↑/↓ moves the selection past the fold — the
	// list overflows (many commands) but does not otherwise follow the selection.
	useEffect(() => {
		selectedRowRef.current?.scrollIntoView?.({ block: "nearest" });
	}, [selectedIndex, rows.length]);

	const runAt = (index: number) => {
		const command = rows[index];
		if (!command) return;
		command.run();
		onOpenChange(false);
	};

	// Group rows in display order (rows are pre-sorted by group→title).
	const groups: { label: string; commands: { command: Command; index: number }[] }[] =
		[];
	rows.forEach((command, index) => {
		const last = groups[groups.length - 1];
		if (last && last.label === command.group) {
			last.commands.push({ command, index });
		} else {
			groups.push({ label: command.group, commands: [{ command, index }] });
		}
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onOpenChange(false);
			}}
		>
			<DialogContent
				className="shell-command-palette"
				data-testid="command-palette"
				aria-label="Command palette"
				hideClose
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setSelectedIndex((i) => Math.min(rows.length - 1, i + 1));
						return;
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						setSelectedIndex((i) => Math.max(0, i - 1));
						return;
					}
					if (e.key === "Enter") {
						e.preventDefault();
						runAt(selectedIndex);
						return;
					}
				}}
			>
				<div className="shell-command-palette__titlebar">
					<DialogTitle className="shell-command-palette__title">
						Command palette
					</DialogTitle>
					<DialogClose
						className="shell-command-palette__close"
						aria-label="Close command palette"
					>
						<Icon name="close" lucide={X} className="h-4 w-4" />
					</DialogClose>
				</div>
				<DialogDescription className="sr-only">
					Search for a command and press Enter to run it.
				</DialogDescription>
				<input
					className="shell-command-palette__search"
					data-testid="command-palette-search"
					placeholder="Type a command…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					autoFocus
				/>
				{rows.length === 0 ? (
					<div
						className="shell-command-palette__empty"
						data-testid="command-palette-empty"
					>
						No matching commands.
					</div>
				) : (
					<div
						className="shell-command-palette__list"
						data-testid="command-palette-list"
					>
						{groups.map((group) => (
							<section
								key={group.label}
								className="shell-command-palette__group"
							>
								<h3 className="shell-command-palette__group-label">
									{group.label}
								</h3>
								{group.commands.map(({ command, index }) => {
									const hint = keyHint(command, platform);
									return (
										<div
											key={command.id}
											ref={
												index === selectedIndex ? selectedRowRef : undefined
											}
											role="button"
											tabIndex={-1}
											data-testid={`command-palette-row-${command.id}`}
											data-selected={index === selectedIndex ? "true" : "false"}
											className={
												"shell-command-palette__row" +
												(index === selectedIndex
													? " shell-command-palette__row--selected"
													: "")
											}
											onMouseMove={() => setSelectedIndex(index)}
											onClick={() => runAt(index)}
										>
											<span className="shell-command-palette__row-title">
												{command.title}
											</span>
											{hint && (
												<kbd className="shell-command-palette__row-keys">
													{hint}
												</kbd>
											)}
										</div>
									);
								})}
							</section>
						))}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
