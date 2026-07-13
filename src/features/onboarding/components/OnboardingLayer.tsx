import type { Onboarding } from "../hooks/use-onboarding";
import { COACHMARKS } from "../logic/coachmarks";
import { Coachmark } from "./Coachmark";
import { TourOverlay } from "./TourOverlay";

export function OnboardingLayer({ onboarding }: { onboarding: Onboarding }) {
	if (onboarding.tourVisible) {
		return (
			<TourOverlay
				steps={onboarding.steps}
				stepIndex={onboarding.stepIndex}
				onNext={onboarding.next}
				onBack={onboarding.back}
				onSkip={onboarding.skip}
			/>
		);
	}
	// Tour inactive: show any coachmarks the user has not dismissed. Visibility
	// already accounts for tour suppression via `isCoachmarkVisible`.
	return (
		<>
			{COACHMARKS.filter((c) => onboarding.isCoachmarkVisible(c.id)).map(
				(c) => (
					<Coachmark
						key={c.id}
						coachmark={c}
						onDismiss={onboarding.dismissCoachmark}
					/>
				),
			)}
		</>
	);
}
