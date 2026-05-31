import { useState, useRef } from "react";
import { AppDialog } from "../../../components/AppDialog";
import { RepositoryInput } from "../../repository/RepositoryInput";

type Props = {
  open: boolean;
  onClose: () => void;
  onLoadPath: (path: string) => Promise<void>;
};

const TOTAL_STEPS = 5;

function StepWelcome() {
  return (
    <>
      <h2 className="text-base font-semibold text-foreground">Welcome to ai-14all</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Your multi-worktree development environment. Manage multiple branches,
        terminals, and code reviews — all in one place.
      </p>
      <div className="rounded border border-border bg-background p-4 my-2">
        <ul className="text-sm text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
          <li>Work on multiple branches simultaneously with <strong className="text-foreground">worktrees</strong></li>
          <li>Run up to 6 <strong className="text-foreground">terminal</strong> sessions per worktree</li>
          <li>Built-in <strong className="text-foreground">code review</strong> with inline comments</li>
        </ul>
      </div>
    </>
  );
}

function StepWorktrees() {
  return (
    <>
      <h2 className="text-base font-semibold text-foreground">Workspaces & Worktrees</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        A <strong className="text-foreground">workspace</strong> is a git repository. Each workspace can have
        multiple <strong className="text-foreground">worktrees</strong> — independent branch checkouts you can
        switch between instantly.
      </p>
      <div className="rounded border border-border bg-background p-4 my-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-semibold bg-primary/15 text-primary">
            Workspace
          </span>
          <span className="text-muted-foreground text-base">→</span>
          <span className="inline-block px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-semibold bg-[color:var(--warning)]/15 text-[color:var(--warning)]">
            Worktree
          </span>
          <span className="inline-block px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-semibold bg-[color:var(--warning)]/15 text-[color:var(--warning)]">
            Worktree
          </span>
          <span className="inline-block px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-semibold bg-[color:var(--warning)]/15 text-[color:var(--warning)]">
            Worktree
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-3">
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
      <h2 className="text-base font-semibold text-foreground">Terminals</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Each worktree has its own terminal grid — up to 6 shells in flexible
        layouts. Save frequently used commands as presets.
      </p>
      <div className="rounded border border-border bg-background p-4 my-2">
        <div className="grid grid-cols-2 gap-1">
          <div className="border border-border rounded-sm px-2 py-1.5 font-[family-name:var(--font-terminal)] text-[10px] text-primary">
            $ npm run dev
          </div>
          <div className="border border-border rounded-sm px-2 py-1.5 font-[family-name:var(--font-terminal)] text-[10px] text-[color:var(--warning)]">
            $ npm test
          </div>
          <div className="col-span-2 border border-border rounded-sm px-2 py-1.5 font-[family-name:var(--font-terminal)] text-[10px] text-muted-foreground">
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
      <h2 className="text-base font-semibold text-foreground">Code Review</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Review changes without leaving the app. Browse files, view diffs, and
        leave inline comments.
      </p>
      <div className="rounded border border-border bg-background p-4 my-2">
        <div className="flex gap-2 mb-2">
          <span className="px-2 py-0.5 rounded-sm bg-secondary text-[10px] uppercase tracking-wider font-semibold text-primary">Files</span>
          <span className="px-2 py-0.5 rounded-sm bg-secondary text-[10px] uppercase tracking-wider font-semibold text-[color:var(--warning)]">Changes</span>
          <span className="px-2 py-0.5 rounded-sm bg-secondary text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Commits</span>
        </div>
        <div className="flex gap-0.5 border border-border rounded-sm p-2">
          <div className="flex-1 font-[family-name:var(--font-terminal)] text-[10px]">
            <div className="text-destructive">- old code</div>
          </div>
          <div className="flex-1 font-[family-name:var(--font-terminal)] text-[10px]">
            <div className="text-primary">+ new code</div>
          </div>
        </div>
      </div>
    </>
  );
}

function StepRepository({ onLoadPath }: { onLoadPath: (path: string) => Promise<void> }) {
  return (
    <>
      <h2 className="text-base font-semibold text-foreground">Open a Repository</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Point to a git repository to get started.
      </p>
      <div className="mt-3">
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
          className={`min-h-[320px] flex flex-col gap-3 ${
            direction === "forward"
              ? "animate-[slide-in-right_200ms_ease]"
              : "animate-[slide-in-left_200ms_ease]"
          } motion-reduce:animate-none`}
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
        <div className="flex items-center justify-between w-full">
          <div className="min-w-[60px]">
            {stepIndex > 0 && (
              <button
                type="button"
                className="h-8 px-2.5 text-[13px] leading-8 text-foreground bg-card border border-border rounded-sm cursor-pointer hover:border-muted-foreground"
                onClick={goBack}
              >
                Back
              </button>
            )}
          </div>
          <div className="flex gap-1.5" data-testid="onboarding-dots">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                  i === stepIndex
                    ? "bg-primary scale-125"
                    : "bg-border"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2 items-center min-w-[120px] justify-end">
            <button
              type="button"
              className="bg-transparent border-none text-muted-foreground text-[13px] cursor-pointer px-2 py-1 hover:text-secondary-foreground"
              onClick={handleSkip}
            >
              Skip
            </button>
            {!isLastStep && (
              <button
                type="button"
                className="h-8 px-2.5 text-[13px] leading-8 text-primary bg-card border border-primary rounded-sm cursor-pointer hover:bg-accent"
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
