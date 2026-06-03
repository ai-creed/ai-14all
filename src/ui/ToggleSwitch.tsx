// Accessible toggle switch built on the shadcn `Switch` (Radix) primitive so
// screen readers announce it as a toggle (role="switch" + aria-checked are
// provided by Radix). Used by the gitignored-files toggle in both
// `WorktreeTree` (Files tab) and `FilesOverlay` (Cmd+P).

import { Switch } from "@/components/ui/switch";

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
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={onChange}
				aria-label={ariaLabel ?? label}
			/>
		</label>
	);
}
