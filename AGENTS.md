# Development workflow

- After application changes, rebuild and recreate the affected Docker Compose services before reporting the work complete. Verify startup and relevant application checks in the rebuilt containers.
- The development Compose project is `dev_golinelli_ai`; use an explicit project name to avoid operating on the separate production stack.
- A request to push to staging targets `origin/staging`. The `main` branch triggers the production deployment workflow.

# Design system

- Before changing frontend UI, read `frontend/src/design/README.md` and preserve the approved styles for fields, buttons, switches, dropdowns and section illustrations. Use shared components and tokens; update the design system when the user changes a style preference.
