// Minimal accessible toggle switch — `role="switch"` + `aria-checked` so
// screen readers announce it as a toggle, not a generic button. Used by the
// gitignored-files toggle in both `WorktreeTree` (Files tab) and
// `FilesOverlay` (Cmd+P).

type Props = {
	checked: boolean;
	onChange: () => void;
	label: string;
	ariaLabel?: string;
	id?: string;
};

export function ToggleSwitch({
	checked,
	onChange,
	label,
	ariaLabel,
	id,
}: Props): React.ReactElement {
	return (
		<label className="shell-toggle-switch" htmlFor={id}>
			<span className="shell-toggle-switch__label">{label}</span>
			<button
				id={id}
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={ariaLabel ?? label}
				className="shell-toggle-switch__track"
				data-checked={checked ? "true" : "false"}
				onClick={onChange}
			>
				<span className="shell-toggle-switch__thumb" aria-hidden="true" />
			</button>
		</label>
	);
}
