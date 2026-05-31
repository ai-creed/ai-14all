import { useState, useRef } from "react";
import { AppDialog } from "../../../components/AppDialog";
import { RepositoryInput } from "../../repository/RepositoryInput";
import "../onboarding-wizard.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onLoadPath: (path: string) => Promise<void>;
};

const TOTAL_STEPS = 5;

function StepWelcome() {
  return (
    <>
      <h2 className="onboarding-step__title">Welcome to ai-14all</h2>
      <p className="onboarding-step__body">
        Your multi-worktree development environment. Manage multiple branches,
        terminals, and code reviews — all in one place.
      </p>
      <div className="onboarding-step__illustration">
        <ul className="onboarding-step__body" style={{ margin: 0, paddingLeft: "var(--space-4)" }}>
          <li>Work on multiple branches simultaneously with <strong>worktrees</strong></li>
          <li>Run up to 6 <strong>terminal</strong> sessions per worktree</li>
          <li>Built-in <strong>code review</strong> with inline comments</li>
        </ul>
      </div>
    </>
  );
}

function StepWorktrees() {
  return (
    <>
      <h2 className="onboarding-step__title">Workspaces & Worktrees</h2>
      <p className="onboarding-step__body">
        A <strong>workspace</strong> is a git repository. Each workspace can have
        multiple <strong>worktrees</strong> — independent branch checkouts you can
        switch between instantly.
      </p>
      <div className="onboarding-step__illustration">
        <div className="onboarding-concept">
          <span className="onboarding-concept__badge onboarding-concept__badge--workspace">
            Workspace
          </span>
          <span className="onboarding-concept__arrow">→</span>
          <span className="onboarding-concept__badge onboarding-concept__badge--worktree">
            Worktree
          </span>
          <span className="onboarding-concept__badge onboarding-concept__badge--worktree">
            Worktree
          </span>
          <span className="onboarding-concept__badge onboarding-concept__badge--worktree">
            Worktree
          </span>
        </div>
        <p className="onboarding-step__body" style={{ marginTop: "var(--space-3)" }}>
          The sidebar lets you switch between worktrees. Each worktree has its own
          terminals, files, and review state.
        </p>
      </div>
    </>
  );
}

function StepTerminals() {
  return (
    <>
      <h2 className="onboarding-step__title">Terminals</h2>
      <p className="onboarding-step__body">
        Each worktree has its own terminal grid — up to 6 shells in flexible
        layouts. Save frequently used commands as presets.
      </p>
      <div className="onboarding-step__illustration">
        <div className="onboarding-terminal-grid">
          <div className="onboarding-terminal-cell" style={{ color: "var(--accent)" }}>
            $ npm run dev
          </div>
          <div className="onboarding-terminal-cell" style={{ color: "var(--warning)" }}>
            $ npm test
          </div>
          <div className="onboarding-terminal-cell onboarding-terminal-cell--wide">
            $ git log --oneline
          </div>
        </div>
      </div>
    </>
  );
}

function StepReview() {
  return (
    <>
      <h2 className="onboarding-step__title">Code Review</h2>
      <p className="onboarding-step__body">
        Review changes without leaving the app. Browse files, view diffs, and
        leave inline comments.
      </p>
      <div className="onboarding-step__illustration">
        <div className="onboarding-review-tabs">
          <span className="onboarding-review-tab" style={{ color: "var(--accent)" }}>Files</span>
          <span className="onboarding-review-tab" style={{ color: "var(--warning)" }}>Changes</span>
          <span className="onboarding-review-tab">Commits</span>
        </div>
        <div className="onboarding-diff">
          <div className="onboarding-diff__side">
            <div className="onboarding-diff__removed">- old code</div>
          </div>
          <div className="onboarding-diff__side">
            <div className="onboarding-diff__added">+ new code</div>
          </div>
        </div>
      </div>
    </>
  );
}

function StepRepository({ onLoadPath }: { onLoadPath: (path: string) => Promise<void> }) {
  return (
    <>
      <h2 className="onboarding-step__title">Open a Repository</h2>
      <p className="onboarding-step__body">
        Point to a git repository to get started.
      </p>
      <div style={{ marginTop: "var(--space-3)" }}>
        <RepositoryInput onLoadPath={onLoadPath} />
      </div>
    </>
  );
}

const STEPS = [StepWelcome, StepWorktrees, StepTerminals, StepReview];

export function OnboardingWizard({ open, onClose, onLoadPath }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const stepKey = useRef(0);

  function goNext() {
    if (stepIndex < TOTAL_STEPS - 1) {
      setDirection("forward");
      stepKey.current += 1;
      setStepIndex((i) => i + 1);
    }
  }

  function goBack() {
    if (stepIndex > 0) {
      setDirection("backward");
      stepKey.current += 1;
      setStepIndex((i) => i - 1);
    }
  }

  function handleLoadPath(path: string) {
    localStorage.setItem("ai14all:onboarding-completed", "true");
    return onLoadPath(path);
  }

  function handleSkip() {
    localStorage.setItem("ai14all:onboarding-completed", "true");
    onClose();
  }

  const isLastStep = stepIndex === TOTAL_STEPS - 1;

  return (
    <AppDialog open={open} onOpenChange={(v) => { if (!v) handleSkip(); }} size="wide">
      <AppDialog.Body>
        <div
          className="onboarding-step"
          data-direction={direction}
          key={stepKey.current}
          aria-live="polite"
        >
          {isLastStep ? (
            <StepRepository onLoadPath={handleLoadPath} />
          ) : (
            (() => { const Step = STEPS[stepIndex]; return <Step />; })()
          )}
        </div>
      </AppDialog.Body>
      <AppDialog.Footer>
        <div className="onboarding-footer">
          <div className="onboarding-footer__left">
            {stepIndex > 0 && (
              <button
                type="button"
                className="shell-button shell-button--compact"
                onClick={goBack}
              >
                Back
              </button>
            )}
          </div>
          <div className="onboarding-dots" data-testid="onboarding-dots">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`onboarding-dot${i === stepIndex ? " onboarding-dot--active" : ""}`}
              />
            ))}
          </div>
          <div className="onboarding-footer__right">
            <button
              type="button"
              className="onboarding-skip"
              onClick={handleSkip}
            >
              Skip
            </button>
            {!isLastStep && (
              <button
                type="button"
                className="shell-button shell-button--compact shell-button--primary"
                onClick={goNext}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </AppDialog.Footer>
    </AppDialog>
  );
}
