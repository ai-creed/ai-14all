import { useMemo, useState } from "react";

type Props = {
	branches: string[];
	value: string | null;
	onChange: (branch: string) => void;
	disabled?: boolean;
};

/**
 * Minimal dependency-free searchable select for choosing a base branch. A filter
 * input sits above a scrollable listbox of `origin/*` options; clicking an
 * option (or pressing Enter on the top match) selects it. Degrades to a plain
 * short list when a repo has only a few remote branches.
 */
export function BaseBranchSelect({
	branches,
	value,
	onChange,
	disabled,
}: Props) {
	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return branches;
		return branches.filter((branch) => branch.toLowerCase().includes(q));
	}, [branches, query]);

	return (
		<div className="base-branch-select">
			<input
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls="base-branch-listbox"
				className="shell-input"
				placeholder="Search branches…"
				value={query}
				disabled={disabled}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && filtered.length > 0) {
						event.preventDefault();
						onChange(filtered[0]);
					}
				}}
			/>
			<ul
				id="base-branch-listbox"
				role="listbox"
				className="base-branch-select__list"
			>
				{filtered.length === 0 ? (
					<li className="base-branch-select__empty">No matching branches</li>
				) : (
					filtered.map((branch) => (
						<li key={branch}>
							<button
								type="button"
								role="option"
								aria-selected={branch === value}
								className={
									branch === value
										? "base-branch-select__option base-branch-select__option--selected"
										: "base-branch-select__option"
								}
								disabled={disabled}
								onClick={() => onChange(branch)}
							>
								{branch}
							</button>
						</li>
					))
				)}
			</ul>
		</div>
	);
}
