# Starter Template Evaluation

## Primary Technology Domain

Full-stack web application (interactive Next.js frontend + Django REST backend + deterministic compute engine)

## Starter Options Considered

1. **Next.js official starter (create-next-app)**
   - Best fit for App Router + TypeScript + Tailwind + App Router defaults.
   - Officially supported and keeps us on the "happy path" for Next.js.

2. **shadcn/ui CLI initialization**
   - Adds design system primitives and Tailwind setup for component-driven UI.

3. **Cookiecutter Django**
   - Production-ready Django starter with Postgres, DRF, CI options, and optional Docker.

## Selected Starter: Next.js + shadcn/ui (frontend) + Cookiecutter Django (backend)

**Rationale for Selection:**
- Matches stated stack preferences (Next.js App Router, Tailwind, TypeScript, Django, Postgres).
- Provides a clean, maintainable base without over-committing to SaaS boilerplates (payments later).
- Supports CI/CD workflows from day one (frontend via standard CI, backend via cookiecutter options).

**Initialization Commands:**

Frontend (Next.js App Router + TS + Tailwind):
```bash
npx create-next-app@latest mawareeth-web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
```

UI system (shadcn/ui init):
```bash
pnpm dlx shadcn@latest init
```

Backend (Django + DRF + Postgres via Cookiecutter):
```bash
pipx run cookiecutter gh:cookiecutter/cookiecutter-django
```

**Architectural Decisions Provided by Starters:**

**Language & Runtime:**
- Frontend: TypeScript + React (Next.js App Router).
- Backend: Python + Django (choose DRF during cookiecutter prompts).

**Styling Solution:**
- Tailwind CSS baseline from Next.js starter.
- shadcn/ui components initialized into the project for controlled, local customization.

**Build Tooling:**
- Next.js build pipeline with App Router defaults.
- Django project structure with environment-based settings (cookiecutter).

**Testing Framework:**
- Frontend: ESLint configured; E2E can be added (Playwright planned).
- Backend: Cookiecutter offers CI selection (choose GitHub Actions) and test scaffolding.

**Code Organization:**
- Next.js `src/` layout and App Router conventions.
- Django modular settings and standard app structure.

**Development Experience:**
- Hot reload and fast dev server on both ends.
- CI/CD ready with GitHub Actions and container-friendly layout (use Docker in cookiecutter if desired).

**Note:** Hetzner deployment is compatible but not enforced by these starters. We can target container-based deployments to keep cloud portability.
