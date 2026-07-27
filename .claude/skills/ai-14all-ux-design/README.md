# ai-14all-ux-design

Enforces production-grade UI/UX for ai-14all features: every UI change is
grounded in the app's terminal/TUI design language (tokens, four themes,
WCAG floors), every major UI update passes a live-HTML-mockup gate before
its spec is finalized or code is written, and UX research runs
internal-first with external references only when the app has no precedent.
In-app dashboards and charts are in scope, composing with the dataviz skill
for chart-form craft while this skill owns the surface, theming, and
app-specific chart rules.

## Develop

    shakespii lint .
    shakespii test .
