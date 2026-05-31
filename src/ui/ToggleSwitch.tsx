import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

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
		<div className="flex items-center gap-2">
			<Label htmlFor={id} className="text-xs text-muted-foreground uppercase tracking-wider cursor-pointer">
				{label}
			</Label>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={() => onChange()}
				aria-label={ariaLabel ?? label}
			/>
		</div>
	);
}
