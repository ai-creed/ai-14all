import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
	DefinitionRowPayload,
	WorktreeStatusPayload,
} from "../../../../shared/contracts/commands.js";
import { unavailableMessage } from "./unavailable-message.js";
import { highlightMatch } from "./highlight-match.js";

export type SymbolResultsProps = {
	status: WorktreeStatusPayload | null;
	results: DefinitionRowPayload[];
	loading: boolean;
	error: string | null;
	cursor: number;
	query: string;
	refreshing: boolean;
	onPick: (index: number) => void;
	onRefresh: () => void;
};

function isMethod(row: DefinitionRowPayload): boolean {
	return row.qualified_name.includes(".");
}

export function SymbolResults({
	status,
	results,
	loading,
	error,
	cursor,
	query,
	refreshing,
	onPick,
	onRefresh,
}: SymbolResultsProps) {
	const scrollParentRef = useRef<HTMLDivElement | null>(null);

	const rowVirtualizer = useVirtualizer({
		count: results.length,
		getScrollElement: () => scrollParentRef.current,
		estimateSize: () => 44,
		overscan: 10,
	});

	useEffect(() => {
		if (results.length > 0) rowVirtualizer.scrollToIndex(cursor);
	}, [cursor, results.length, rowVirtualizer]);

	if (status && status.available === false) {
		return (
			<div
				role="status"
				data-testid="code-nav-unavailable-banner"
				className="code-nav-unavailable-banner"
			>
				{unavailableMessage(status.reason)}
			</div>
		);
	}

	const hasQuery = query.trim().length > 0;

	return (
		<div className="symbol-results">
			{status?.dirtyAtIndex && (
				<div
					role="status"
					data-testid="stale-index-banner"
					className="code-nav-stale-banner"
				>
					<span>Index reflects HEAD, not working tree.</span>
					<button type="button" onClick={onRefresh} disabled={refreshing}>
						{refreshing ? "Refreshing…" : "Refresh index"}
					</button>
				</div>
			)}
			{loading && <p className="symbol-results__status">Searching…</p>}
			{error && (
				<p role="alert" className="symbol-results__status">
					{error}
				</p>
			)}
			{!loading && results.length === 0 && hasQuery && (
				<p className="symbol-results__empty" data-testid="symbol-results-empty">
					No symbols match "{query}".
				</p>
			)}
			{!loading && results.length === 0 && !hasQuery && (
				<p className="symbol-results__empty">Search symbols by name…</p>
			)}
			<div
				ref={scrollParentRef}
				className="symbol-results__list"
				role="listbox"
				style={{ overflow: "auto" }}
			>
				<div
					style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
				>
					{rowVirtualizer.getVirtualItems().map((virtualRow) => {
						const i = virtualRow.index;
						const r = results[i]!;
						const method = isMethod(r);
						return (
							<div
								key={r.id}
								role="option"
								aria-selected={i === cursor}
								className={"symbol-row" + (i === cursor ? " is-selected" : "")}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${virtualRow.start}px)`,
								}}
								onClick={() => onPick(i)}
							>
								<span
									className={
										"symbol-row__kind " +
										(method
											? "symbol-row__kind--method"
											: "symbol-row__kind--fn")
									}
									aria-label={method ? "method" : "function"}
								>
									{method ? "◇" : "ƒ"}
								</span>
								<div className="symbol-row__body">
									<div className="symbol-row__line1">
										<span className="symbol-row__name">
											{highlightMatch(r.qualified_name, query).map((seg, j) =>
												seg.hit ? (
													<span key={j} className="symbol-row__hit">
														{seg.text}
													</span>
												) : (
													<span key={j}>{seg.text}</span>
												),
											)}
										</span>
										<span className="symbol-row__tag">
											{method ? "method" : "fn"}
										</span>
									</div>
									<div className="symbol-row__path">
										{r.file}:{r.line}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
